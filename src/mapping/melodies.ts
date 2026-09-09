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

export type MelodyKind = 'exercise' | 'song';

export interface Melody {
  id: string;
  /** Ejercicio inventado aqui, o cancion conocida. Solo cambia como se agrupa. */
  kind: MelodyKind;
  /**
   * Semitonos sobre la tonica. Se resuelven contra la escala activa buscando la
   * zona mas cercana, de modo que cualquier melodia se puede tocar en cualquier
   * escala sin quedarse sin notas.
   */
  notes: readonly number[];
  suggestedScale: ScaleId;
  /**
   * Octavas que necesita el encuadre para que la melodia quepa entera.
   *
   * Los ejercicios caben en una; las canciones recorren mas de una octava y con
   * el encuadre corto varias notas distintas caerian en la misma zona, que es
   * exactamente lo que hace que una cancion deje de reconocerse. Al elegirla se
   * amplia el rango si hace falta, igual que se aplica la escala sugerida.
   */
  minOctaves: number;
}

/**
 * Canciones. Todas son tradicionales o de dominio publico, y aqui solo esta la
 * linea melodica en grados, sin ritmo: la guia no mide el tiempo.
 *
 * Se escriben transportadas para que ninguna nota quede por debajo de la
 * tonica, porque el encuadre empieza justo ahi y una nota mas grave no tendria
 * zona donde caer. Por eso varias empiezan en 7 o en 12 en vez de en 0: es la
 * misma melodia una quinta o una octava mas arriba, que en un instrumento sin
 * afinacion fija no cambia nada.
 *
 * Cada nota existe exactamente en la escala sugerida; no hay ninguna que
 * dependa de caer en la zona mas cercana. Una prueba lo comprueba, porque una
 * nota aproximada en una cancion conocida se oye al momento.
 */
export const MELODIES: readonly Melody[] = [
  {
    // Beethoven, tema de la Novena. Mi mi fa sol sol fa mi re do do re mi mi re re.
    id: 'alegria',
    kind: 'song',
    notes: [4, 4, 5, 7, 7, 5, 4, 2, 0, 0, 2, 4, 4, 2, 2],
    suggestedScale: 'major',
    minOctaves: 1,
  },
  {
    // Escrita desde la quinta, que es donde empieza de verdad, subida una octava
    // para que esa quinta no caiga por debajo del borde del encuadre.
    id: 'cumple',
    kind: 'song',
    notes: [7, 7, 9, 7, 12, 11, 7, 7, 9, 7, 14, 12, 7, 7, 19, 16, 12, 11, 9, 17, 17, 16, 12, 14, 12],
    suggestedScale: 'major',
    minOctaves: 2,
  },
  {
    // Ah! vous dirai-je, maman. Do do sol sol la la sol, fa fa mi mi re re do.
    id: 'estrellita',
    kind: 'song',
    notes: [0, 0, 7, 7, 9, 9, 7, 5, 5, 4, 4, 2, 2, 0],
    suggestedScale: 'major',
    minOctaves: 1,
  },
  {
    // Sube una octava entera porque el "din, dan, don" del final baja a la
    // quinta grave.
    id: 'martinillo',
    kind: 'song',
    notes: [12, 14, 16, 12, 16, 17, 19, 19, 21, 19, 17, 16, 12, 12, 7, 12],
    suggestedScale: 'major',
    minOctaves: 2,
  },
  {
    // Version eolia, con septima menor: la escala menor de la aplicacion no
    // tiene sensible, y forzarla dejaria esa nota cayendo en la zona de al lado.
    // Es ademas como se ha tocado durante siglos, no un apano.
    id: 'greensleeves',
    kind: 'song',
    notes: [12, 15, 17, 19, 20, 19, 17, 14, 10, 12, 14, 15, 12, 12, 10, 12],
    suggestedScale: 'minor',
    minOctaves: 2,
  },
  {
    id: 'ascenso',
    kind: 'exercise',
    notes: [0, 3, 5, 7, 10, 12],
    suggestedScale: 'pentatonic',
    minOctaves: 1,
  },
  {
    id: 'ida-vuelta',
    kind: 'exercise',
    notes: [0, 3, 5, 7, 5, 3, 0],
    suggestedScale: 'pentatonic',
    minOctaves: 1,
  },
  {
    id: 'llamada',
    kind: 'exercise',
    notes: [0, 3, 0, 5, 0, 7, 5, 3, 0],
    suggestedScale: 'pentatonic',
    minOctaves: 1,
  },
  {
    id: 'blues',
    kind: 'exercise',
    notes: [0, 3, 5, 6, 7, 6, 5, 3, 0],
    suggestedScale: 'blues',
    minOctaves: 1,
  },
  {
    id: 'octavas',
    kind: 'exercise',
    notes: [0, 7, 12, 7, 12, 19, 12, 0],
    suggestedScale: 'pentatonic',
    minOctaves: 2,
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
