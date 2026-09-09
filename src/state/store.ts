import type { ScaleId } from '../mapping/scales';
import type { PresetId } from '../audio/presets';
import type { ClipAspect } from '../capture/recorder';

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
  melodyId: '',
  onboarded: false,
  locale: 'auto',
};

const STORAGE_KEY = 'theremano.settings.v1';

type Listener = (settings: Settings, changed: ReadonlySet<keyof Settings>) => void;

function loadPersisted(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const value = parsed[key];
      // Solo se acepta lo que coincide en tipo con el valor por defecto: un
      // localStorage de una version anterior no debe romper el arranque.
      if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
        (merged[key] as unknown) = value;
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
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
    this.set({ ...DEFAULT_SETTINGS, cameraId: this.state.cameraId });
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
  /** MIDI de la nota actual. El HUD lo usa para colorear. */
  midi: number;
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
  midi: 69,
  notice: null,
};
