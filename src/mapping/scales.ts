/**
 * Escalas y cuantizacion.
 *
 * El modo por defecto es pentatonica menor porque cualquier combinacion de sus
 * grados suena consonante: el instrumento resulta divertido en el primer minuto
 * aunque el interprete no tenga ni idea. El modo continuo existe, pero como
 * opcion, no como comportamiento base.
 */

export type ScaleId = 'chromatic' | 'major' | 'minor' | 'pentatonic' | 'blues' | 'continuous';

export interface ScaleDef {
  id: ScaleId;
  name: string;
  /** Grados en semitonos dentro de la octava. Vacio = sin cuantizar. */
  degrees: readonly number[];
}

export const SCALES: readonly ScaleDef[] = [
  { id: 'pentatonic', name: 'Pentatonica menor', degrees: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', degrees: [0, 3, 5, 6, 7, 10] },
  { id: 'minor', name: 'Menor natural', degrees: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'major', name: 'Mayor', degrees: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'chromatic', name: 'Cromatica', degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'continuous', name: 'Continua (sin cuantizar)', degrees: [] },
];

export const NOTE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'] as const;

export function getScale(id: ScaleId): ScaleDef {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]!;
}

export function isContinuous(id: ScaleId): boolean {
  return getScale(id).degrees.length === 0;
}

/** MIDI -> Hz en temperamento igual con La4 = 440. */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

/**
 * Los grados de la escala desplegados sobre el rango completo, en semitonos
 * relativos a la tonica. Se calcula una vez por cambio de ajustes, no por
 * fotograma.
 */
export function buildDegreeTable(scaleId: ScaleId, octaves: number): number[] {
  const { degrees } = getScale(scaleId);
  if (degrees.length === 0) return [];
  const table: number[] = [];
  for (let oct = 0; oct < octaves; oct += 1) {
    for (const d of degrees) table.push(oct * 12 + d);
  }
  // Cierra el rango con la tonica de la octava superior: sin ella, el borde
  // derecho del encuadre se queda a un grado de resolver y suena incompleto.
  table.push(octaves * 12);
  return table;
}

export interface PitchLayout {
  scaleId: ScaleId;
  /** Semitonos sobre la nota base, uno por zona. Vacio en modo continuo. */
  degrees: readonly number[];
  /** MIDI de la nota mas grave (borde izquierdo del encuadre). */
  baseMidi: number;
  octaves: number;
}

export function createLayout(scaleId: ScaleId, tonicPc: number, baseOctave: number, octaves: number): PitchLayout {
  return {
    scaleId,
    degrees: buildDegreeTable(scaleId, octaves),
    baseMidi: (baseOctave + 1) * 12 + tonicPc,
    octaves,
  };
}

export interface PitchResult {
  freq: number;
  midi: number;
  name: string;
  /** Indice de zona, o -1 en modo continuo. */
  index: number;
}

/**
 * Convierte una posicion horizontal normalizada (0 = izquierda, 1 = derecha) en
 * una nota. En modo cuantizado el encuadre se reparte en zonas de igual anchura,
 * una por grado: es lo que hace que la rejilla del HUD sea honesta y que el
 * interprete pueda apuntar a una nota concreta.
 */
export function pitchAt(layout: PitchLayout, x: number): PitchResult {
  const clamped = Math.min(1, Math.max(0, x));
  if (layout.degrees.length === 0) {
    const midi = layout.baseMidi + clamped * layout.octaves * 12;
    return { freq: midiToFreq(midi), midi, name: midiToName(midi), index: -1 };
  }
  const n = layout.degrees.length;
  const index = Math.min(n - 1, Math.max(0, Math.round(clamped * (n - 1))));
  const midi = layout.baseMidi + (layout.degrees[index] ?? 0);
  return { freq: midiToFreq(midi), midi, name: midiToName(midi), index };
}

/** Centro horizontal de cada zona, para dibujar la rejilla. */
export function zoneCenters(layout: PitchLayout): number[] {
  const n = layout.degrees.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  return layout.degrees.map((_, i) => i / (n - 1));
}
