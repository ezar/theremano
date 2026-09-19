import {
  KIT,
  MAX_LEVEL,
  TUNING_RANGE,
  normalizeLayout,
  normalizePieceNumbers,
  type DrumPiece,
} from '../mapping/kit';
import { isDuoMode, type DuoMode } from '../tracking/duo';
import type { ScaleId } from '../mapping/scales';
import type { PresetId } from '../audio/presets';
import type { ClipAspect } from '../capture/recorder';

/**
 * Que se ve detras del esqueleto.
 *
 * `hands` no difumina ni recorta el fondo: sencillamente no dibuja el fotograma
 * de la camara en ningun sitio, ni en pantalla ni en el clip. Lo que sale es el
 * esqueleto sobre un degradado. Es una garantia, no una estimacion: no hay
 * mascara que pueda fallar y dejar ver media cara.
 */
export type StageMode = 'camera' | 'hands';

/**
 * Estado observable minimo, sin dependencias.
 *
 * Se separa en dos: los ajustes (baja frecuencia, persistidos, con
 * suscriptores) y el estado de ejecucion (alta frecuencia, objeto mutable que
 * el HUD lee en cada fotograma). Emitir eventos 60 veces por segundo para
 * repintar un contador de fps solo generaria basura para el recolector.
 */

export interface Settings {
  scale: ScaleId;
  /** Clase de altura de la tonica, 0 = Do. Por defecto 9 = La. */
  tonicPc: number;
  /** Octava de la nota mas grave. */
  baseOctave: number;
  octaves: number;
  preset: PresetId;
  /** Espejo del video. Se autodetecta con la camara frontal y se puede forzar. */
  mirror: boolean;
  cameraId: string | null;
  masterVolume: number;
  pitchMinCutoff: number;
  pitchBeta: number;
  controlMinCutoff: number;
  controlBeta: number;
  overlayMinCutoff: number;
  overlayBeta: number;
  showDiagnostics: boolean;
  showRawTrace: boolean;
  /** Proporcion del clip que se graba para compartir. */
  clipAspect: ClipAspect;
  /** Fondo de la escena: el video de la camara o solo el esqueleto. */
  stageMode: StageMode;
  /** Claqueta continua mientras gira el bucle. */
  metronome: boolean;
  /**
   * Dos personas delante de la misma camara.
   *
   * 'off' es una sola, que es lo de siempre. 'halves' les da media pantalla a
   * cada una, con sus dos manos y la escala entera dentro de su mitad. 'hands'
   * les da una mano a cada una sobre el encuadre completo, sin mano de
   * expresion y pudiendo cruzarse.
   */
  duo: DuoMode;
  /**
   * El timbre de la segunda persona. Solo significa algo con el duo puesto.
   *
   * Propio y no compartido porque dos instrumentos con el mismo timbre tocando a
   * la vez suenan a uno desafinado: lo que hace que se oigan como dos es que
   * suenen distinto. Se elige como el otro -con los dedos de la mano de melodia
   * o en los ajustes-, solo que con la mano de la otra persona.
   *
   * De fabrica viene distinto del primero a proposito: encender el duo y que
   * suenen los dos igual es la primera impresion equivocada.
   */
  presetTwo: PresetId;
  /**
   * Las manos que grabaron cada capa, dibujadas mientras la capa suena.
   *
   * Se puede apagar porque con cuatro capas hay hasta cinco manos en pantalla y
   * eso, para quien solo quiere tocar encima de su propio bucle, es ruido.
   */
  ghosts: boolean;
  /**
   * Modo bateria: la mano golpea en lugar de sostener notas.
   *
   * De momento una sola voz y un tanteo: lo que se esta midiendo es si un golpe
   * dado en el aire llega a tiempo al altavoz.
   */
  drums: boolean;
  /**
   * Que pieza hay debajo de cada banda, de izquierda a derecha.
   *
   * Siempre las cuatro y una sola vez cada una: elegir una pieza para una banda
   * la cambia por la que hubiera, no la duplica.
   */
  kitBands: DrumPiece[];
  /** Afinacion de cada pieza, en semitonos sobre la de fabrica. */
  kitTuning: Record<DrumPiece, number>;
  /** Volumen de cada pieza, multiplicando el de fabrica. */
  kitLevel: Record<DrumPiece, number>;
  /**
   * Sala del kit, de 0 (seco) a 1.
   *
   * Cada pieza se moja lo suyo: el bombo casi nada, el plato mucho. Un kit del
   * todo seco suena a muestras pegadas una detras de otra, que es lo que sonaba
   * hasta ahora.
   */
  kitSpace: number;
  /**
   * Swing de las capas de ritmo, de 0 (recto, tal y como se toco) a 1.
   *
   * Se aplica al reproducir y no al grabar: lo que la capa guarda sigue siendo
   * el instante en que alguien golpeo, asi que esto se sube y se baja con la
   * vuelta girando y volver a cero devuelve lo que se toco.
   */
  swing: number;
  /** Melodia guiada activa. Cadena vacia si no hay ninguna. */
  melodyId: string;
  /** true en cuanto se ha visto la introduccion, se complete o se salte. */
  onboarded: boolean;
  /** Idioma elegido, o 'auto' para seguir al navegador. */
  locale: string;
}

export const DEFAULT_SETTINGS: Settings = {
  scale: 'pentatonic',
  tonicPc: 9,
  baseOctave: 3,
  octaves: 2,
  preset: 'theremin',
  mirror: true,
  cameraId: null,
  masterVolume: 0.75,
  pitchMinCutoff: 0.8,
  pitchBeta: 0.02,
  controlMinCutoff: 1.2,
  controlBeta: 0.01,
  overlayMinCutoff: 1.5,
  overlayBeta: 0.05,
  showDiagnostics: true,
  showRawTrace: false,
  clipAspect: 'vertical',
  stageMode: 'camera',
  metronome: false,
  duo: 'off',
  presetTwo: 'strings',
  ghosts: true,
  drums: false,
  kitBands: [...KIT],
  kitTuning: { kick: 0, snare: 0, hat: 0, crash: 0 },
  kitLevel: { kick: 1, snare: 1, hat: 1, crash: 1 },
  kitSpace: 0.3,
  swing: 0,
  melodyId: '',
  onboarded: false,
  locale: 'auto',
};

const STORAGE_KEY = 'theremano.settings.v1';

/**
 * Una copia de los ajustes de fabrica con los tres del kit aparte.
 *
 * Son los unicos que no son un numero, una cadena ni un booleano, y una copia
 * superficial los compartiria con la constante. Hoy nadie escribe dentro de
 * ellos -el panel siempre pone uno nuevo- asi que no hay nada roto que arreglar;
 * esto es para que no lo haya nunca. El dia que alguien escriba dentro en vez de
 * sustituir, lo que reescribiria son los propios valores de fabrica, y ya no
 * habria a donde volver: ni en esta sesion ni en las siguientes, porque de ahi
 * sale tambien lo que se guarda.
 */
function freshDefaults(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    kitBands: [...DEFAULT_SETTINGS.kitBands],
    kitTuning: { ...DEFAULT_SETTINGS.kitTuning },
    kitLevel: { ...DEFAULT_SETTINGS.kitLevel },
  };
}

type Listener = (settings: Settings, changed: ReadonlySet<keyof Settings>) => void;

/** Un cero a uno que de verdad lo es: ni NaN, ni infinito, ni fuera de rango. */
function normalizeUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function loadPersisted(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefaults();
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = freshDefaults();
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const value = parsed[key];
      // Solo se acepta lo que coincide en tipo con el valor por defecto: un
      // localStorage de una version anterior no debe romper el arranque.
      if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
        (merged[key] as unknown) = value;
      }
    }
    /*
     * Y los tres del kit, aparte.
     *
     * De los demas basta con el tipo, porque un numero es un numero. De estos
     * no: "object" es lo que dice typeof de una lista vacia, de un objeto sin
     * ninguna pieza dentro y de uno con un NaN en la afinacion, y las tres cosas
     * se cuelan por esa puerta. La primera deja una banda golpeando un undefined
     * y la ultima apaga la pieza entera sin decir nada.
     */
    // Una cadena cualquiera pasa la puerta del tipo y aqui dejaria un duo que no
    // existe: dos manos repartidas en dos instrumentos sin la segunda voz.
    if (!isDuoMode(merged.duo)) merged.duo = DEFAULT_SETTINGS.duo;
    merged.kitBands = normalizeLayout(merged.kitBands);
    merged.kitTuning = normalizePieceNumbers(merged.kitTuning, 0, -TUNING_RANGE, TUNING_RANGE);
    merged.kitLevel = normalizePieceNumbers(merged.kitLevel, 1, 0, MAX_LEVEL);
    // Un NaN aqui no da un error: deja el kit mudo o el ritmo programado en un
    // instante imposible. La puerta del tipo lo deja pasar, porque es un numero.
    merged.kitSpace = normalizeUnit(merged.kitSpace, DEFAULT_SETTINGS.kitSpace);
    merged.swing = normalizeUnit(merged.swing, DEFAULT_SETTINGS.swing);
    return merged;
  } catch {
    return freshDefaults();
  }
}

export class SettingsStore {
  private state: Settings = loadPersisted();
  private readonly listeners = new Set<Listener>();
  private saveHandle: number | null = null;

  get(): Readonly<Settings> {
    return this.state;
  }

  set(patch: Partial<Settings>): void {
    const changed = new Set<keyof Settings>();
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      const value = patch[key];
      if (value === undefined || Object.is(this.state[key], value)) continue;
      (this.state[key] as unknown) = value;
      changed.add(key);
    }
    if (changed.size === 0) return;
    for (const listener of this.listeners) listener(this.state, changed);
    this.scheduleSave();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.set({ ...freshDefaults(), cameraId: this.state.cameraId });
  }

  private scheduleSave(): void {
    if (this.saveHandle !== null) return;
    // Escribir en localStorage es sincrono y bloquea; agrupar las escrituras
    // evita que arrastrar un deslizador provoque un guardado por pixel.
    this.saveHandle = window.setTimeout(() => {
      this.saveHandle = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        /* modo privado o cuota llena: los ajustes viven solo en memoria */
      }
    }, 250);
  }
}

/** Estado de ejecucion. Mutado en el bucle, leido por el HUD. */
export interface Runtime {
  running: boolean;
  gateOpen: boolean;
  noteName: string;
  freq: number;
  /** Posicion horizontal de la mano de melodia en espacio de vista, o -1. */
  pitchX: number;
  pitchXRaw: number;
  cutoffNorm: number;
  volume: number;
  fingerCount: number;
  melodyVisible: boolean;
  melodyHeld: boolean;
  expressionVisible: boolean;
  expressionHeld: boolean;
  fps: number;
  latencyMs: number;
  inferenceMs: number;
  pinchRatio: number;
  /** Vibrato que pide la mano, de 0 a 1. */
  vibrato: number;
  /** MIDI de la nota actual. El HUD lo usa para colorear. */
  midi: number;
  /**
   * Ultima pieza golpeada en modo bateria, o null si aun no ha sonado ninguna.
   *
   * Se queda puesta despues del golpe en vez de volver a vacio, igual que el
   * nombre de la nota se queda despues de soltarla: el panel dice en que estas,
   * no lo que suena en este milisegundo.
   */
  piece: DrumPiece | null;
  /** Fuerza del ultimo golpe, de 0 a 1. Solo para el panel de diagnostico. */
  strikeForce: number;
  /** Timbre al que apuntan los dedos, aun sin confirmar. */
  presetCandidate: string | null;
  /** Lo que le falta a ese candidato para confirmarse, de 0 a 1. */
  presetProgress: number;
  notice: string | null;
}

export const runtime: Runtime = {
  running: false,
  gateOpen: false,
  noteName: '--',
  freq: 0,
  pitchX: -1,
  pitchXRaw: -1,
  cutoffNorm: 0.5,
  volume: 0,
  fingerCount: 0,
  melodyVisible: false,
  melodyHeld: false,
  expressionVisible: false,
  expressionHeld: false,
  fps: 0,
  latencyMs: 0,
  inferenceMs: 0,
  pinchRatio: 1,
  vibrato: 0,
  midi: 69,
  piece: null,
  strikeForce: 0,
  presetCandidate: null,
  presetProgress: 0,
  notice: null,
};
