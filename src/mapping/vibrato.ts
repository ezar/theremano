/**
 * El temblor de la mano, convertido en vibrato.
 *
 * Es el gesto que define a un theremín y hasta ahora no hacía nada: oscilar la
 * mano sobre la nota. El instrumento tenía una sola forma de mover una nota ya
 * empezada —subirla o bajarla de brillo— y ninguna de darle vida sin cambiarla
 * de altura.
 *
 * Lo delicado no es medir la oscilación, es distinguirla de las otras dos cosas
 * que hace la misma mano en el mismo eje: viajar hasta la nota siguiente, que es
 * un movimiento grande y en una sola dirección, y temblar porque una mano en el
 * aire tiembla, que es pequeño y rapidísimo. Por eso no basta con la amplitud:
 * se cuentan además los cruces por el medio, y solo se acepta lo que oscila
 * entre tres y nueve veces por segundo. Un viaje no cruza; el ruido del detector
 * cruza demasiado.
 *
 * Se mide sobre la x cruda y no sobre la filtrada. El filtro del tono existe
 * precisamente para borrar esto: a cinco hercios deja pasar menos de la sexta
 * parte, que es lo que evita que el vibrato mueva la nota de zona. Lo que para
 * el tono es ruido, aquí es la señal.
 */

/** Cuánto se mira hacia atrás. Da para más de un ciclo del vibrato más lento. */
export const WINDOW = 0.3;

/**
 * Cruces por el centro que se exigen dentro de la ventana.
 *
 * Por debajo no es una oscilación sino un viaje; por encima no es una mano sino
 * el temblor del detector. Con esta ventana, el mínimo deja fuera todo lo que
 * oscile por debajo de unos tres hercios y el máximo, lo que pase de unos trece.
 */
export const MIN_CROSSINGS = 2;
export const MAX_CROSSINGS = 8;

/** Amplitud, en anchos de encuadre, a la que empieza y a la que satura. */
export const FLOOR = 0.012;
export const FULL = 0.05;

/** Ritmos que se aceptan, en hercios. Fuera de esto no es un vibrato. */
export const RATE_MIN = 3;
export const RATE_MAX = 9;

/**
 * Lo que tarda en entrar y en irse.
 *
 * Entra rápido y se va despacio, como el vibrato de cualquier instrumento de
 * cuerda: se empieza a oscilar y aparece, se para y se apaga solo. Sin esto, el
 * vibrato parpadearía con cada recuento de cruces.
 */
export const RISE_SECONDS = 0.12;
export const FALL_SECONDS = 0.25;

interface Sample {
  t: number;
  x: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class VibratoDetector {
  private samples: Sample[] = [];
  private smoothed = 0;
  private smoothedRate = 0;

  /** @param t en segundos. @param x posición horizontal sin filtrar. */
  push(t: number, x: number): void {
    this.samples.push({ t, x });
    while (this.samples.length > 1 && this.samples[0]!.t < t - WINDOW) this.samples.shift();

    const dt = this.samples.length > 1 ? t - (this.samples[this.samples.length - 2]?.t ?? t) : 0;
    const target = this.measure();
    // La subida y la bajada no van al mismo ritmo: un vibrato aparece en cuanto
    // se empieza a oscilar y se apaga solo cuando la mano se queda quieta.
    const seconds = target > this.smoothed ? RISE_SECONDS : FALL_SECONDS;
    const step = dt > 0 ? Math.min(1, dt / seconds) : 0;
    this.smoothed += (target - this.smoothed) * step;
  }

  /** Profundidad pedida por la mano, de 0 a 1. */
  get depth(): number {
    return this.smoothed;
  }

  /**
   * A qué ritmo oscila la mano, en hercios, o 0 si no hay vibrato.
   *
   * Se devuelve para que suene al ritmo al que se mueve la mano y no al que
   * traiga el timbre. Es la diferencia entre que aparezca un efecto y que el
   * temblor de quien toca sea el que se oye.
   */
  get rate(): number {
    return this.smoothed > 0.02 ? this.smoothedRate : 0;
  }

  reset(): void {
    this.samples = [];
    this.smoothed = 0;
    this.smoothedRate = 0;
  }

  /** La profundidad que pide la ventana actual, sin suavizar. */
  private measure(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return 0;
    const span = last.t - first.t;
    // Con menos de media ventana no hay con qué decidir: al empezar una nota, o
    // al recuperar una mano, todavía no se ha visto oscilar nada.
    if (span < WINDOW / 2 || this.samples.length < 5) return 0;

    let sum = 0;
    let low = Infinity;
    let high = -Infinity;
    for (const sample of this.samples) {
      sum += sample.x;
      if (sample.x < low) low = sample.x;
      if (sample.x > high) high = sample.x;
    }
    const middle = sum / this.samples.length;
    const amplitude = (high - low) / 2;

    let crossings = 0;
    let side = 0;
    for (const sample of this.samples) {
      const current = Math.sign(sample.x - middle);
      if (current !== 0 && side !== 0 && current !== side) crossings += 1;
      if (current !== 0) side = current;
    }
    if (crossings < MIN_CROSSINGS || crossings > MAX_CROSSINGS) return 0;

    // Cada ciclo cruza dos veces.
    const rate = crossings / (2 * span);
    if (rate < RATE_MIN || rate > RATE_MAX) return 0;
    this.smoothedRate = this.smoothedRate === 0 ? rate : this.smoothedRate * 0.85 + rate * 0.15;

    return clamp01((amplitude - FLOOR) / (FULL - FLOOR));
  }
}
