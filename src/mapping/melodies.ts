import type { PitchLayout } from './scales';
import type { ScaleId } from './scales';

/**
 * Melodias guiadas.
 *
 * Sin esto el instrumento solo permite divagar, y divagar cansa en dos minutos.
 * Una secuencia que seguir da una razon para volver y convierte un clip en algo
 * que se puede terminar en lugar de cortar.
 *
 * No hay presion de tiempo a proposito. La latencia de la camara ronda los 60 ms
 * y el gate necesita dos fotogramas para confirmar: exigir precision ritmica
 * encima de eso seria injusto y frustrante. Se sigue el orden, no el compas.
 *
 * Las melodias son patrones de escala, escritos aqui: nada transcrito de
 * ninguna parte.
 */

export interface Melody {
  id: string;
  name: string;
  hint: string;
  /**
   * Semitonos sobre la tonica. Se resuelven contra la escala activa buscando la
   * zona mas cercana, de modo que cualquier melodia se puede tocar en cualquier
   * escala sin quedarse sin notas.
   */
  notes: readonly number[];
  suggestedScale: ScaleId;
}

export const MELODIES: readonly Melody[] = [
  {
    id: 'ascenso',
    name: 'Subida',
    hint: 'De izquierda a derecha, sin prisa.',
    notes: [0, 3, 5, 7, 10, 12],
    suggestedScale: 'pentatonic',
  },
  {
    id: 'ida-vuelta',
    name: 'Ida y vuelta',
    hint: 'Sube y baja por el mismo camino.',
    notes: [0, 3, 5, 7, 5, 3, 0],
    suggestedScale: 'pentatonic',
  },
  {
    id: 'llamada',
    name: 'Llamada y respuesta',
    hint: 'Vuelve a la tonica entre cada salto.',
    notes: [0, 3, 0, 5, 0, 7, 5, 3, 0],
    suggestedScale: 'pentatonic',
  },
  {
    id: 'blues',
    name: 'Vuelta de blues',
    hint: 'La nota de paso es la que le da el color.',
    notes: [0, 3, 5, 6, 7, 6, 5, 3, 0],
    suggestedScale: 'blues',
  },
  {
    id: 'octavas',
    name: 'Saltos de octava',
    hint: 'Cruza el encuadre entero de una vez.',
    notes: [0, 7, 12, 7, 12, 19, 12, 0],
    suggestedScale: 'pentatonic',
  },
];

export function getMelody(id: string): Melody | null {
  return MELODIES.find((m) => m.id === id) ?? null;
}

/**
 * Resuelve los semitonos de la melodia contra la escala activa.
 *
 * Si la escala no contiene exactamente esa nota se usa la zona mas cercana en
 * altura. Es preferible a declarar la melodia imposible: el interprete acaba
 * tocando la version de esa melodia que cabe en la escala que ha elegido.
 */
export function resolveTargets(melody: Melody, layout: PitchLayout): number[] {
  const degrees = layout.degrees;
  if (degrees.length === 0) return [];
  return melody.notes.map((semitone) => {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < degrees.length; i += 1) {
      const distance = Math.abs((degrees[i] ?? 0) - semitone);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  });
}

export type GuideResult = 'hit' | 'miss' | 'finished' | 'idle';

/**
 * El progreso por una melodia. Puro: no toca audio ni DOM, para poder
 * comprobarlo entero.
 */
export class GuideSession {
  private targets: number[];
  private cursor = 0;
  private hits = 0;
  private attempts = 0;

  constructor(
    readonly melody: Melody,
    layout: PitchLayout,
  ) {
    this.targets = resolveTargets(melody, layout);
  }

  /** El layout cambia si el interprete toca la escala o el rango a mitad. */
  relayout(layout: PitchLayout): void {
    this.targets = resolveTargets(this.melody, layout);
  }

  get targetZone(): number | null {
    return this.targets[this.cursor] ?? null;
  }

  get done(): number {
    return this.cursor;
  }

  get total(): number {
    return this.targets.length;
  }

  get finished(): boolean {
    return this.targets.length > 0 && this.cursor >= this.targets.length;
  }

  /** Aciertos sobre intentos, de 0 a 1. Vale 1 si aun no se ha intentado nada. */
  get accuracy(): number {
    return this.attempts === 0 ? 1 : this.hits / this.attempts;
  }

  reset(): void {
    this.cursor = 0;
    this.hits = 0;
    this.attempts = 0;
  }

  /**
   * Se llama en cada ataque. Un fallo no retrocede ni penaliza mas alla de la
   * estadistica: castigar el error en un instrumento que se toca en el aire
   * solo consigue que se abandone.
   */
  onAttack(zoneIndex: number): GuideResult {
    if (this.finished) return 'idle';
    this.attempts += 1;
    if (zoneIndex !== this.targetZone) return 'miss';
    this.hits += 1;
    this.cursor += 1;
    return this.finished ? 'finished' : 'hit';
  }
}
