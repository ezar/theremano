/**
 * Cuatro timbres. La mano de expresion los selecciona con el numero de dedos
 * extendidos, asi que el orden importa: es el orden en el que se cuentan los
 * dedos, de uno a cuatro.
 */

export type PresetId = 'theremin' | 'strings' | 'flute' | 'bass';

export interface Preset {
  id: PresetId;
  /** Dedos extendidos que lo seleccionan. */
  fingers: number;
  oscillator: {
    type: string;
    count?: number;
    spread?: number;
    modulationType?: string;
    harmonicity?: number;
  };
  envelope: { attack: number; decay: number; sustain: number; release: number };
  filter: {
    /** Corte con la mano abajo (sonido oscuro). */
    minHz: number;
    /** Corte con la mano arriba (sonido brillante). */
    maxHz: number;
    q: number;
  };
  vibrato: { frequency: number; depth: number };
  /**
   * Eco. Es lo que mas cambia la sensacion de una linea solista: sin el, una voz
   * sola en un espacio vacio suena a ejercicio; con el, a instrumento.
   */
  delay: { time: number; feedback: number; wet: number };
  reverbWet: number;
  /** Compensacion de nivel: un diente de sierra suena mucho mas que un seno. */
  trim: number;
  /** Portamento propio del timbre, en segundos. Se suma al del modo de escala. */
  glide: number;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'theremin',
    fingers: 1,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.06, decay: 0.1, sustain: 1, release: 0.25 },
    filter: { minHz: 400, maxHz: 9000, q: 0.7 },
    vibrato: { frequency: 5.2, depth: 0.12 },
    delay: { time: 0.3, feedback: 0.32, wet: 0.2 },
    reverbWet: 0.24,
    trim: 1,
    glide: 0.01,
  },
  {
    id: 'strings',
    fingers: 2,
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
    envelope: { attack: 0.14, decay: 0.2, sustain: 0.85, release: 0.4 },
    filter: { minHz: 220, maxHz: 6500, q: 2.5 },
    vibrato: { frequency: 4.4, depth: 0.08 },
    delay: { time: 0.36, feedback: 0.26, wet: 0.14 },
    reverbWet: 0.3,
    trim: 0.5,
    glide: 0.02,
  },
  {
    id: 'flute',
    fingers: 3,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.03, decay: 0.08, sustain: 0.95, release: 0.18 },
    filter: { minHz: 600, maxHz: 11000, q: 1.2 },
    vibrato: { frequency: 6, depth: 0.06 },
    delay: { time: 0.26, feedback: 0.34, wet: 0.22 },
    reverbWet: 0.18,
    trim: 0.85,
    glide: 0.005,
  },
  {
    id: 'bass',
    fingers: 4,
    oscillator: { type: 'square' },
    envelope: { attack: 0.008, decay: 0.12, sustain: 0.75, release: 0.12 },
    filter: { minHz: 140, maxHz: 4200, q: 6 },
    vibrato: { frequency: 0, depth: 0 },
    delay: { time: 0.18, feedback: 0.2, wet: 0.08 },
    reverbWet: 0.08,
    trim: 0.42,
    glide: 0.005,
  },
];

export function getPreset(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

export function presetForFingerCount(count: number): Preset | null {
  // Cero dedos es un puno: se ignora a proposito, para que cerrar la mano no
  // cambie el timbre sin querer.
  if (count < 1) return null;
  return PRESETS.find((p) => p.fingers === count) ?? null;
}
