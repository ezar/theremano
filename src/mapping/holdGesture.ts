/**
 * Un gesto sostenido que dispara una accion una sola vez.
 *
 * Existe para la unica cosa del instrumento que todavia habia que hacer
 * tocando algo: grabar una capa de bucle. Un instrumento que presume de no
 * necesitar contacto y te obliga a buscar el teclado para cerrar la vuelta no
 * cumple lo que promete.
 *
 * Tres reglas, y las tres estan por el mismo motivo, que es que aqui un falso
 * positivo no es un pixel mal puesto sino una grabacion que arranca sola:
 *
 * - Histeresis, como en la pinza que suena. Sin banda muerta, una mano parada
 *   en el umbral dispara decenas de veces.
 * - Hay que mantenerlo. Un roce al pasar entre dos dedos no cuenta; medio
 *   segundo con los dedos juntos es una decision.
 * - Y una vez disparado se queda trabado hasta que la mano se abre. Sin eso,
 *   seguir con los dedos juntos volveria a dispararlo cada medio segundo.
 */

/** Por debajo de esto los dedos estan juntos. */
export const HOLD_CLOSE = 0.32;
/** Por encima de esto estan separados y el gesto se rearma. */
export const HOLD_OPEN = 0.46;
/** Lo que hay que aguantar para que cuente. */
export const HOLD_SECONDS = 0.45;

/**
 * El pulgar tiene que estar claramente mas cerca del corazon que del indice.
 *
 * Sin esto, una pinza normal —pulgar contra indice— tambien pide un bucle. En
 * una mano de verdad las puntas del indice y del corazon estan a un quinto del
 * tamano de la mano una de otra, asi que el pulgar posado en el indice queda
 * tambien cerca del corazon, por debajo del umbral. Este margen es lo que
 * distingue "el pulgar ha ido al corazon" de "el pulgar ha ido al indice y el
 * corazon estaba al lado".
 */
export const MIDDLE_MARGIN = 0.7;

export class HoldGesture {
  private held = 0;
  private fired = false;

  /** Tiempo sostenido, de 0 a 1, para poder pintar que algo esta pasando. */
  get progress(): number {
    return Math.min(1, this.held / HOLD_SECONDS);
  }

  /**
   * true mientras los dedos esten juntos, aunque aun no haya disparado.
   *
   * Lo mira el mapeador para no confundir el gesto con un cambio de timbre: al
   * juntar pulgar y corazon, el corazon se dobla y el recuento de dedos
   * extendidos baja uno. Sin esto, pedir un bucle cambiaria el instrumento.
   */
  get engaged(): boolean {
    return this.held > 0;
  }

  /**
   * @param middle distancia pulgar-corazon, normalizada por la mano.
   * @param index distancia pulgar-indice, normalizada igual.
   * @param dt segundos desde el fotograma anterior.
   * @returns true solo en el fotograma en que el gesto se completa.
   */
  update(middle: number, index: number, dt: number): boolean {
    if (middle > HOLD_OPEN) {
      this.held = 0;
      this.fired = false;
      return false;
    }
    if (middle > HOLD_CLOSE || middle > index * MIDDLE_MARGIN) {
      // Banda muerta: ni cuenta ni descuenta. Lo sostenido se conserva para que
      // un temblor en el umbral no obligue a empezar de nuevo. Aqui cae tambien
      // la pinza normal, que queda cerca del corazon sin ir a por el.
      return false;
    }

    this.held += dt;
    if (this.fired || this.held < HOLD_SECONDS) return false;
    this.fired = true;
    return true;
  }

  /** Al perder la mano de vista. Un gesto a medias no sobrevive a la ausencia. */
  reset(): void {
    this.held = 0;
    this.fired = false;
  }
}
