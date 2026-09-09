import { OneEuroFilter, DEFAULT_D_CUTOFF } from '../filter/oneEuro';
import { expressionFeatures, melodyFeatures } from './features';
import { PinchGate, type GateEvent } from './gate';
import { createLayout, isContinuous, pitchAt, type PitchLayout } from './scales';
import { getPreset, presetForFingerCount, type Preset } from '../audio/presets';
import type { RoleAssignment } from '../tracking/types';
import type { Settings } from '../state/store';

/**
 * De magnitudes de la mano a parametros de audio.
 *
 * El suavizado se aplica aqui, sobre cada magnitud derivada, y no sobre los
 * puntos crudos. La razon es que el tono, el corte del filtro y el volumen
 * toleran cantidades de retardo muy distintas: el tono necesita estar
 * quirurgicamente quieto en reposo, y el volumen puede permitirse ser perezoso.
 * Un unico filtro compartido obligaria a elegir el peor compromiso para los tres.
 * Los puntos del overlay llevan su propio filtro, mas suelto, porque solo se
 * dibujan.
 */

/** Portamento en modo cuantizado: tapa el salto sin sonar a glissando. */
const QUANTIZED_GLIDE = 0.02;
/** Portamento en modo continuo. */
const CONTINUOUS_GLIDE = 0.06;

/** Fotogramas de un mismo recuento de dedos antes de cambiar de timbre. */
const PRESET_CONFIRM_FRAMES = 6;

/**
 * El gate no comparte los parametros de control, y la diferencia es enorme.
 * Con `minCutoff` 1.2 y `beta` 0.01 la pinza tarda ocho fotogramas en confirmar
 * el ataque: 267 ms, mas del triple del presupuesto de latencia entero. Un beta
 * alto deja pasar el movimiento rapido intacto y el gate confirma en dos
 * fotogramas, que es el minimo que impone su propia confirmacion. La proteccion
 * frente al ruido no la da el suavizado sino la banda muerta: medido sobre
 * treinta segundos de mano parada en el peor punto de la banda, los cortes
 * espurios son cero en ambos casos.
 */
const GATE_MIN_CUTOFF = 2.0;
const GATE_BETA = 6.0;

export interface MappingOutput {
  gateEvent: GateEvent;
  gateOpen: boolean;
  freq: number;
  noteName: string;
  glide: number;
  /** 0 = oscuro, 1 = brillante. */
  cutoffNorm: number;
  volume: number;
  /** Cambio de timbre confirmado, o null. */
  preset: Preset | null;
  pitchX: number;
  pitchXRaw: number;
  pinch: number;
  fingerCount: number;
}

export class Mapper {
  private layout: PitchLayout;
  private readonly gate = new PinchGate();

  private readonly pitchFilter: OneEuroFilter;
  private readonly cutoffFilter: OneEuroFilter;
  private readonly volumeFilter: OneEuroFilter;
  private readonly pinchFilter: OneEuroFilter;

  private volume: number;
  private currentPreset: Preset;
  private candidateFingers = 0;
  private candidateStreak = 0;
  private lastFreq = 440;
  private lastNote = '--';

  constructor(settings: Readonly<Settings>) {
    this.layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
    this.pitchFilter = new OneEuroFilter({
      minCutoff: settings.pitchMinCutoff,
      beta: settings.pitchBeta,
      dCutoff: DEFAULT_D_CUTOFF,
    });
    const control = { minCutoff: settings.controlMinCutoff, beta: settings.controlBeta, dCutoff: DEFAULT_D_CUTOFF };
    this.cutoffFilter = new OneEuroFilter({ ...control });
    this.volumeFilter = new OneEuroFilter({ ...control });
    this.pinchFilter = new OneEuroFilter({ minCutoff: GATE_MIN_CUTOFF, beta: GATE_BETA, dCutoff: DEFAULT_D_CUTOFF });
    this.volume = settings.masterVolume;
    this.currentPreset = getPreset(settings.preset);
  }

  /** Se llama solo cuando cambian los ajustes, no por fotograma. */
  syncSettings(settings: Readonly<Settings>): void {
    this.layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
    this.pitchFilter.setParams({ minCutoff: settings.pitchMinCutoff, beta: settings.pitchBeta });
    const control = { minCutoff: settings.controlMinCutoff, beta: settings.controlBeta };
    this.cutoffFilter.setParams(control);
    this.volumeFilter.setParams(control);
    this.currentPreset = getPreset(settings.preset);
  }

  get currentLayout(): PitchLayout {
    return this.layout;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.volumeFilter.reset();
  }

  /** Cierra el gate de inmediato. Para perdida de foco o parada del instrumento. */
  silence(): GateEvent {
    return this.gate.forceClose();
  }

  /** @param timestamp en segundos. */
  update(assignment: RoleAssignment, timestamp: number): MappingOutput {
    const melody = assignment.melody;
    const expression = assignment.expression;

    let pitchXRaw = -1;
    let pitchX = -1;
    let cutoffNorm = 0.5;
    let pinch = 1;
    let gateEvent: GateEvent = null;

    if (melody) {
      const f = melodyFeatures(melody.hand.raw);
      pitchXRaw = f.x;
      pitchX = this.pitchFilter.filter(f.x, timestamp);
      // El corte va invertido respecto a la Y de la imagen: arriba es brillante.
      cutoffNorm = 1 - this.cutoffFilter.filter(f.y, timestamp);
      pinch = this.pinchFilter.filter(f.pinch, timestamp);
      gateEvent = this.gate.update(pinch);

      const pitch = pitchAt(this.layout, pitchX);
      this.lastFreq = pitch.freq;
      this.lastNote = pitch.name;
    } else {
      // La mano ha desaparecido de verdad (mas alla del margen de 500 ms).
      // Sostener una nota que ya nadie toca seria peor que cortarla.
      gateEvent = this.gate.forceClose();
      this.pitchFilter.reset();
      this.cutoffFilter.reset();
      this.pinchFilter.reset();
    }

    let preset: Preset | null = null;
    let fingerCount = 0;

    if (expression) {
      const f = expressionFeatures(expression.hand.raw);
      fingerCount = f.fingers;
      this.volume = 1 - this.volumeFilter.filter(f.y, timestamp);
      preset = this.confirmPreset(f.fingers, expression.held);
    } else {
      // Sin mano de expresion se conservan volumen y timbre. Perder una mano
      // nunca debe silenciar el instrumento.
      this.volumeFilter.reset();
      this.candidateStreak = 0;
    }

    return {
      gateEvent,
      gateOpen: this.gate.isOpen,
      freq: this.lastFreq,
      noteName: this.lastNote,
      glide: isContinuous(this.layout.scaleId) ? CONTINUOUS_GLIDE : QUANTIZED_GLIDE,
      cutoffNorm,
      volume: this.volume,
      preset,
      pitchX,
      pitchXRaw,
      pinch,
      fingerCount,
    };
  }

  /**
   * Un recuento de dedos parpadea con facilidad en los bordes del gesto, y un
   * timbre que cambia solo es desconcertante. Se exige una racha antes de
   * confirmar, y no se acepta nada mientras la mano solo se este sosteniendo.
   */
  private confirmPreset(fingers: number, held: boolean): Preset | null {
    if (held) {
      this.candidateStreak = 0;
      return null;
    }
    const candidate = presetForFingerCount(fingers);
    if (!candidate || candidate.id === this.currentPreset.id) {
      this.candidateStreak = 0;
      return null;
    }
    if (this.candidateFingers === fingers) {
      this.candidateStreak += 1;
    } else {
      this.candidateFingers = fingers;
      this.candidateStreak = 1;
    }
    if (this.candidateStreak < PRESET_CONFIRM_FRAMES) return null;
    this.candidateStreak = 0;
    this.currentPreset = candidate;
    return candidate;
  }
}
