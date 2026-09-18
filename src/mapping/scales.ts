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
  /** Grados en semitonos dentro de la octava. Vacio = sin cuantizar. */
  degrees: readonly number[];
}

export const SCALES: readonly ScaleDef[] = [
  { id: 'pentatonic', degrees: [0, 3, 5, 7, 10] },
  { id: 'blues', degrees: [0, 3, 5, 6, 7, 10] },
  { id: 'minor', degrees: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'major', degrees: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'chromatic', degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'continuous', degrees: [] },
];

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

/**
 * @param names las doce notas en la notacion del idioma activo. Se pasa en lugar
 * de leerse de un modulo global porque este fichero no debe saber nada de la
 * interfaz, y porque asi las pruebas fijan la notacion que comprueban.
 */
export function midiToName(midi: number, names: readonly string[]): string {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${names[pc] ?? '?'}${octave}`;
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
    return { freq: midiToFreq(midi), midi, index: -1 };
  }
  const n = layout.degrees.length;
  const index = Math.min(n - 1, Math.max(0, Math.round(clamped * (n - 1))));
  const midi = layout.baseMidi + (layout.degrees[index] ?? 0);
  return { freq: midiToFreq(midi), midi, index };
}

/**
 * La vuelta de pitchAt: donde habria que poner la mano para que suene esa nota.
 *
 * Existe porque una capa de bucle guarda el gesto y no el sonido, pero lo guarda
 * ya convertido -la frecuencia, no la posicion-, y hay una cosa que necesita
 * deshacer esa conversion: dibujar la mano que grabo la capa. La ida y la vuelta
 * tienen que ser la misma funcion leida al reves o la mano saldria un dedo a la
 * izquierda de donde estuvo.
 *
 * En cuantizado no siempre hay vuelta exacta: la capa pudo grabarse en otra
 * escala, y entonces su nota no existe en esta. Se devuelve la zona de la nota
 * mas cercana, que es lo unico util que se puede decir -ahi es donde hay que
 * poner la mano AHORA para que suene lo mas parecido- y nunca un hueco.
 */
export function xForMidi(layout: PitchLayout, midi: number): number {
  const n = layout.degrees.length;
  if (n === 0) {
    const span = layout.octaves * 12;
    return span > 0 ? clamp01((midi - layout.baseMidi) / span) : 0.5;
  }
  if (n === 1) return 0.5;
  const wanted = midi - layout.baseMidi;
  let best = 0;
  for (let i = 1; i < n; i += 1) {
    const here = Math.abs((layout.degrees[i] ?? 0) - wanted);
    if (here < Math.abs((layout.degrees[best] ?? 0) - wanted)) best = i;
  }
  return best / (n - 1);
}

/** Y la vuelta de midiToFreq, por el mismo motivo. */
export function freqToMidi(freq: number): number {
  // Una frecuencia de cero o negativa no sale de ningun gesto, pero si de una
  // capa a medio leer, y el logaritmo de cero es un menos infinito que se
  // propaga hasta la posicion de la mano.
  return freq > 0 ? 69 + 12 * Math.log2(freq / 440) : 0;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Centro horizontal de cada zona, para dibujar la rejilla. */
export function zoneCenters(layout: PitchLayout): number[] {
  const n = layout.degrees.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  return layout.degrees.map((_, i) => i / (n - 1));
}
