/**
 * Lo rapido que se ha cerrado la pinza, medido en una ventana fija de tiempo.
 *
 * La ventana no es un detalle de implementacion, es lo que hace que la medida
 * valga. Mirar solo el ultimo fotograma tiene dos problemas, y los dos se notan:
 *
 * El primero es que el gate confirma con dos fotogramas de retraso, asi que
 * cuando llega el ataque la pinza ya esta cerrada y quieta; lo que se mediria
 * entonces no es el gesto, es el rebote que le queda al filtro.
 *
 * El segundo es que dependeria de los fotogramas por segundo. A treinta, la
 * diferencia entre dos muestras cubre el doble de tiempo que a sesenta, y el
 * mismo gesto daria dos fuerzas distintas segun lo cargado que vaya el
 * telefono. Con una ventana en segundos, no.
 */

/** Cuanto se mira hacia atras. Un gesto de cerrar la mano dura mas que esto. */
export const VELOCITY_WINDOW = 0.15;

interface Sample {
  t: number;
  ratio: number;
}

export class ClosingSpeed {
  private samples: Sample[] = [];

  /** @param t en segundos. @param ratio distancia pulgar-indice normalizada. */
  push(t: number, ratio: number): void {
    this.samples.push({ t, ratio });
    // Se conserva una muestra fuera de la ventana: es el ancla contra la que se
    // mide, y sin ella la ventana quedaria siempre corta.
    let anchor = 0;
    while (anchor + 1 < this.samples.length && this.samples[anchor + 1]!.t <= t - VELOCITY_WINDOW) {
      anchor += 1;
    }
    if (anchor > 0) this.samples = this.samples.slice(anchor);
  }

  /**
   * Unidades de pinza por segundo. Positivo al cerrarse.
   *
   * Vale cero mientras no haya dos muestras separadas en el tiempo: al empezar,
   * o justo despues de perder la mano.
   */
  get speed(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t <= first.t) return 0;
    return (first.ratio - last.ratio) / (last.t - first.t);
  }

  reset(): void {
    this.samples = [];
  }
}
