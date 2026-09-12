import { OneEuroFilter, DEFAULT_D_CUTOFF } from '../filter/oneEuro';
import { attackVelocity, depthFromSize, expressionFeatures, melodyFeatures, middlePinchRatio, normalize, palmCenter, palmSize, pinchRatio } from './features';
import { HoldGesture } from './holdGesture';
import { ClosingSpeed } from './closingSpeed';
import { VibratoDetector } from './vibrato';
import { StrikeDetector } from './strike';
import { pieceAt, type DrumPiece } from './kit';
import { PinchGate, type GateEvent } from './gate';
import { createLayout, isContinuous, pitchAt, type PitchLayout } from './scales';
import { getPreset, presetForFingerCount, type Preset, type PresetId } from '../audio/presets';
import type { RoleAssignment, TrackedHand } from '../tracking/types';
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
/**
 * Cuanto mas suavizada va la distancia que el resto de los controles.
 *
 * Se mueve despacio y no dispara nada, asi que puede ir mas filtrada sin que se
 * note un retraso.
 */
const SPACE_SMOOTHING = 0.6;

const GATE_MIN_CUTOFF = 2.0;
const GATE_BETA = 6.0;

export interface DrumHit {
  piece: DrumPiece;
  /** Lo fuerte que ha entrado, de 0 a 1. */
  force: number;
  /** Donde ha caido, en espacio de vista y sin normalizar: la salpicadura va ahi. */
  x: number;
  y: number;
}

export interface MappingOutput {
  gateEvent: GateEvent;
  gateOpen: boolean;
  freq: number;
  midi: number;
  /** Zona de la escala en la que esta la mano, o -1 en modo continuo. */
  zoneIndex: number;
  glide: number;
  /** 0 = oscuro, 1 = brillante. */
  cutoffNorm: number;
  volume: number;
  /** Cambio de timbre confirmado, o null. */
  preset: Preset | null;
  /**
   * Timbre al que apuntan los dedos ahora mismo, todavia sin confirmar.
   *
   * Sale del mapeador y no del HUD porque la racha de confirmacion vive aqui.
   * Ensenarlo es lo unico que convierte el gesto en algo que se descubre solo:
   * levantas tres dedos, ves el nombre del timbre asomar, y ya sabes que existe.
   */
  presetCandidate: PresetId | null;
  /** Cuanto le falta a ese candidato para confirmarse, de 0 a 1. */
  presetProgress: number;
  /**
   * Volumen que manda la mano de expresion, de 0 a 1. Es lo que se ensena.
   *
   * Para el audio esta `gain`, que es este multiplicado por la fuerza del
   * ataque. Se separan porque el riel del HUD tiene que seguir a la mano: si
   * mostrara la ganancia real, saltaria en cada nota sin que nadie haya movido
   * nada.
   */
  gain: number;
  /** Cerca o lejos de la camara, de 0 a 1. Manda el espacio del sonido. */
  space: number;
  /** Vibrato que pide el temblor de la mano, de 0 a 1. */
  vibrato: number;
  /**
   * Golpes de percusion entrados en este fotograma. Casi siempre vacio.
   *
   * Solo en modo bateria, y son eventos y no estado: existen en el fotograma en
   * que el golpe entra y en ninguno mas. Van en lista porque las dos manos
   * pueden caer a la vez, que no es un caso raro sino el principio de casi
   * cualquier compas.
   *
   * El array se reutiliza entre fotogramas: a sesenta por segundo, devolver uno
   * nuevo cada vez seria basura para el recolector a cambio de nada.
   */
  strikes: readonly DrumHit[];
  /** Nota que sostiene el pedal, en Hz, o 0 si no hay ninguna. */
  drone: number;
  /** La misma, en MIDI, para escribirla y para colorearla. */
  droneMidi: number;
  /** A que ritmo oscila esa mano, en hercios, o 0 si no oscila. */
  vibratoRate: number;
  /** true en el fotograma en que el gesto de grabar se completa. */
  loopGesture: boolean;
  /** Lo sostenido que va ese gesto, de 0 a 1. */
  loopGestureProgress: number;
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
  private readonly loopHold = new HoldGesture();
  /**
   * El pedal usa la misma pinza que la nota —pulgar contra indice— pero en la
   * otra mano, con la misma histeresis y la misma confirmacion. Es el mismo
   * gesto y tiene que costar lo mismo.
   */
  private readonly droneGate = new PinchGate();
  private droneFreq = 0;
  private droneMidi = 0;
  private readonly spaceFilter: OneEuroFilter;
  private space = 0.5;
  private readonly closing = new ClosingSpeed();
  private readonly vibrato = new VibratoDetector();
  /** Un detector por mano: cada una golpea por su cuenta y en su banda. */
  private readonly melodyStrike = new StrikeDetector();
  private readonly expressionStrike = new StrikeDetector();
  private readonly strikes: DrumHit[] = [];
  private drums = false;
  private lastTimestamp = -1;
  /** Fuerza de la nota que suena ahora, fijada en su ataque. */
  private velocity = 1;
  private lastFreq = 440;
  private lastMidi = 69;
  private lastZone = -1;

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
    // La distancia se mueve despacio y no dispara nada: puede ir mas suavizada
    // que el resto sin que se note un retraso.
    this.spaceFilter = new OneEuroFilter({ ...control, minCutoff: control.minCutoff * SPACE_SMOOTHING });
    this.volume = settings.masterVolume;
    this.currentPreset = getPreset(settings.preset);
    this.setDrums(settings.drums, settings.masterVolume);
  }

  /** Se llama solo cuando cambian los ajustes, no por fotograma. */
  syncSettings(settings: Readonly<Settings>): void {
    this.layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
    this.pitchFilter.setParams({ minCutoff: settings.pitchMinCutoff, beta: settings.pitchBeta });
    const control = { minCutoff: settings.controlMinCutoff, beta: settings.controlBeta };
    this.cutoffFilter.setParams(control);
    this.volumeFilter.setParams(control);
    this.spaceFilter.setParams({ ...control, minCutoff: control.minCutoff * SPACE_SMOOTHING });
    this.currentPreset = getPreset(settings.preset);
    this.setDrums(settings.drums, settings.masterVolume);
  }

  /**
   * En bateria la fuerza de la nota deja de tener sentido y tiene que valer uno.
   *
   * Se fija en el ataque de una nota, y ahi no hay ataques: se quedaria la de la
   * ultima nota de melodia que se toco, de modo que la ganancia que sale de aqui
   * -y con ella el volumen de los golpes- dependeria de lo fuerte que uno
   * cerrase la pinza hace un rato. En bateria el volumen lo pone el ajuste y la
   * dinamica la pone el golpe.
   */
  private setDrums(drums: boolean, volume: number): void {
    this.drums = drums;
    if (!drums) return;
    this.velocity = 1;
    /*
     * Y el volumen vuelve al del ajuste.
     *
     * En bateria esta mano golpea y deja de mandar el volumen, asi que el que
     * haya queda congelado. Mientras el modo se elegia antes de empezar eso era
     * el ajuste y ya esta; con el cambio en caliente puede ser el que dejo la
     * mano de expresion, que a media pantalla es la mitad y abajo es casi nada:
     * se pasaba a bateria y los golpes salian susurrando, sin nada en pantalla
     * que lo explicara y sin forma de arreglarlo salvo el mando de los ajustes.
     */
    this.volume = volume;
    this.volumeFilter.reset();
  }

  get currentLayout(): PitchLayout {
    return this.layout;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.volumeFilter.reset();
  }

  /**
   * Cierra el gate de inmediato, y con el la nota pedal. Para perdida de foco o
   * parada del instrumento: una nota sostenida por una mano que ya no esta
   * mirando nadie es exactamente lo que no puede quedarse sonando.
   */
  silence(): GateEvent {
    this.droneGate.forceClose();
    this.droneFreq = 0;
    this.droneMidi = 0;
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
    let space = this.space;
    let loopGesture = false;
    this.strikes.length = 0;

    if (melody) {
      const f = melodyFeatures(melody.hand.raw);
      pitchXRaw = f.x;
      pitchX = this.pitchFilter.filter(f.x, timestamp);
      // El corte va invertido respecto a la Y de la imagen: arriba es brillante.
      cutoffNorm = 1 - this.cutoffFilter.filter(f.y, timestamp);
      pinch = this.pinchFilter.filter(f.pinch, timestamp);

      /*
       * Velocidad de cierre. Se mide sobre la senal ya filtrada, que es la misma
       * que decide el gate: sobre la cruda, el ruido del detector se colaria como
       * fuerza y dos notas iguales sonarian distinto sin motivo.
       */
      this.closing.push(timestamp, pinch);
      /*
       * El vibrato se mide sobre la x cruda, no sobre la filtrada. El filtro del
       * tono existe para borrar precisamente esto: a cinco hercios deja pasar
       * menos de la sexta parte, que es lo que evita que oscilar la mano mueva
       * la nota de zona. Lo que para el tono es ruido, para el vibrato es la
       * senal.
       */
      this.vibrato.push(timestamp, f.x);

      /*
       * En modo bateria la pinza no abre ninguna nota: lo que suena es el golpe,
       * y una nota sostenida por debajo seria una segunda cosa sonando sin que
       * nadie la haya pedido. El gate se fuerza cerrado en cuanto se entra.
       */
      if (this.drums) {
        gateEvent = this.gate.forceClose();
        this.pushStrike(this.melodyStrike, melody, timestamp);
      } else {
        gateEvent = this.gate.update(pinch);
      }
      // La fuerza se fija en el ataque y dura toda la nota. Recalcularla por
      // fotograma convertiria un matiz de entrada en un temblor de volumen.
      if (gateEvent === 'attack') this.velocity = attackVelocity(this.closing.speed);

      space = this.spaceFilter.filter(depthFromSize(palmSize(melody.hand.raw)), timestamp);

      const pitch = pitchAt(this.layout, pitchX);
      this.lastFreq = pitch.freq;
      this.lastMidi = pitch.midi;
      this.lastZone = pitch.index;
    } else {
      // La mano ha desaparecido de verdad (mas alla del margen de 500 ms).
      // Sostener una nota que ya nadie toca seria peor que cortarla.
      gateEvent = this.gate.forceClose();
      this.pitchFilter.reset();
      this.cutoffFilter.reset();
      this.pinchFilter.reset();
      this.spaceFilter.reset();
      this.closing.reset();
      this.vibrato.reset();
      this.melodyStrike.reset();
      this.lastTimestamp = -1;
    }
    this.space = space;

    let preset: Preset | null = null;
    let fingerCount = 0;

    if (expression) {
      const f = expressionFeatures(expression.hand.raw);
      fingerCount = f.fingers;
      /*
       * En modo bateria esta mano tambien golpea, y entonces su altura no puede
       * seguir mandando el volumen: bajarla es dar un golpe, asi que cada golpe
       * subiria el volumen de todo lo demas. Se queda en el que haya puesto el
       * ajuste, que ademas es lo unico coherente con que golpear mas fuerte sea
       * ya la forma de sonar mas fuerte.
       */
      if (this.drums) this.pushStrike(this.expressionStrike, expression, timestamp);
      else this.volume = 1 - this.volumeFilter.filter(f.y, timestamp);

      // El gesto de grabar no se acepta sobre una mano que solo se esta
      // sosteniendo: medio segundo de mano recordada bastaria para dispararlo.
      const dt = this.lastTimestamp >= 0 ? Math.max(0, timestamp - this.lastTimestamp) : 0;
      if (expression.held) this.loopHold.reset();
      else {
        // Las dos distancias: el gesto exige que el pulgar este claramente mas
        // cerca del corazon que del indice, o una pinza normal lo dispararia.
        loopGesture = this.loopHold.update(
          middlePinchRatio(expression.hand.raw),
          pinchRatio(expression.hand.raw),
          dt,
        );
      }

      /*
       * La nota pedal. Se ignora mientras el gesto de grabar esta en marcha: el
       * pulgar pasa cerca del indice de camino al corazon, y un pedal que se
       * enciende solo al pedir un bucle es de las cosas mas desconcertantes que
       * puede hacer esto.
       */
      const droneEvent =
        // Y en modo bateria no hay pedal: lo que sostendria es una nota de la
        // melodia, que ahi no existe.
        expression.held || this.loopHold.engaged || this.drums
          ? this.droneGate.forceClose()
          : this.droneGate.update(pinchRatio(expression.hand.raw));
      if (droneEvent === 'attack') {
        // Se sostiene lo que esta sonando, no lo que hay debajo de la otra mano:
        // si no hay nota, no hay nada que sostener y el gesto no hace nada.
        this.droneFreq = this.gate.isOpen ? this.lastFreq : 0;
        this.droneMidi = this.gate.isOpen ? this.lastMidi : 0;
      } else if (droneEvent === 'release') {
        this.droneFreq = 0;
        this.droneMidi = 0;
      }

      /*
       * Mientras el gesto esta en marcha no se cambia de timbre.
       *
       * Vale para los dos: al juntar pulgar y corazon el corazon se dobla, y al
       * juntar pulgar e indice se dobla el indice. En los dos casos el recuento
       * de dedos extendidos baja uno, y sin esto pedir un bucle o poner un pedal
       * cambiaria el instrumento de paso.
       */
      // Y en modo bateria tampoco: el timbre es el de la melodia, y ahi lo que
      // hace la mano con los dedos mientras golpea no significa nada.
      const busy = this.loopHold.engaged || this.droneGate.isOpen || this.drums;
      preset = busy ? null : this.confirmPreset(f.fingers, expression.held);
      if (busy) this.candidateStreak = 0;
    } else {
      // Sin mano de expresion se conservan volumen y timbre. Perder una mano
      // nunca debe silenciar el instrumento.
      this.volumeFilter.reset();
      this.candidateStreak = 0;
      this.loopHold.reset();
      // El pedal lo sostiene esa mano: si la mano se va del todo, se va con ella.
      this.droneGate.forceClose();
      this.droneFreq = 0;
      this.droneMidi = 0;
      this.expressionStrike.reset();
    }
    this.lastTimestamp = timestamp;

    return {
      gateEvent,
      gateOpen: this.gate.isOpen,
      freq: this.lastFreq,
      midi: this.lastMidi,
      zoneIndex: this.lastZone,
      glide: isContinuous(this.layout.scaleId) ? CONTINUOUS_GLIDE : QUANTIZED_GLIDE,
      cutoffNorm,
      volume: this.volume,
      gain: this.volume * this.velocity,
      space,
      vibrato: this.vibrato.depth,
      vibratoRate: this.vibrato.rate,
      strikes: this.strikes,
      drone: this.droneFreq,
      droneMidi: this.droneMidi,
      loopGesture,
      loopGestureProgress: this.loopHold.progress,
      preset,
      // Al confirmarse deja de haber candidato: el destino ya es el actual.
      presetCandidate: preset || this.candidateStreak === 0 ? null : (presetForFingerCount(this.candidateFingers)?.id ?? null),
      presetProgress: preset ? 0 : Math.min(1, this.candidateStreak / PRESET_CONFIRM_FRAMES),
      pitchX,
      pitchXRaw,
      pinch,
      fingerCount,
    };
  }

  /**
   * Mira si esa mano acaba de golpear, y sobre que pieza.
   *
   * Las dos coordenadas de la palma se tratan distinto a proposito. La altura va
   * cruda, sin recortar al encuadre util: ese recorte se topa en los bordes, y
   * un golpe que termina abajo del todo se quedaria sin velocidad justo en el
   * unico momento que importa. La horizontal va normalizada, que es el espacio
   * en el que se dibujan las bandas, para que la pieza que suene sea la que se
   * ve debajo de la mano y no una vecina.
   */
  private pushStrike(detector: StrikeDetector, tracked: TrackedHand, timestamp: number): void {
    /*
     * Una mano que solo se esta recordando no golpea, y ademas hay que olvidar
     * lo que llevaba medida.
     *
     * Perder la mano del todo ya se atiende mas arriba, pero eso tarda medio
     * segundo en pasar: antes de eso el asignador de roles sigue entregando la
     * mano con los ultimos puntos que vio, congelados. El problema no son esos
     * fotogramas quietos, es el de despues: la mano de verdad reaparece donde
     * este ahora, y ese salto dentro de la ventana se lee como una caida
     * instantanea. Un golpe que nadie ha dado, y encima fuerte.
     *
     * Reiniciar cuesta que el primer golpe tras recuperar la mano necesite unas
     * centesimas de historia. Es el precio correcto: mejor un golpe que llega
     * tarde que uno que no se ha dado.
     */
    if (tracked.held) {
      detector.reset();
      return;
    }
    const palm = palmCenter(tracked.hand.raw);
    const force = detector.push(timestamp, palm.y);
    if (force > 0) this.strikes.push({ piece: pieceAt(normalize(palm.x)), force, x: palm.x, y: palm.y });
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
