/**
 * Histeresis de la pinza.
 *
 * La banda muerta entre los dos umbrales es lo que evita el traqueteo cuando la
 * mano se queda justo en el limite. Sin ella el instrumento es inusable: la nota
 * entra y sale decenas de veces por segundo.
 */

export type GateEvent = 'attack' | 'release' | null;

/** Por debajo de esto la pinza esta cerrada y el instrumento suena. */
export const PINCH_CLOSE = 0.3;
/** Por encima de esto la pinza esta abierta y el instrumento calla. */
export const PINCH_OPEN = 0.42;
/** Fotogramas consecutivos necesarios para confirmar un cambio. */
export const CONFIRM_FRAMES = 2;

export class PinchGate {
  private open = false;
  private candidate: boolean | null = null;
  private streak = 0;

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * @param ratio distancia pulgar-indice normalizada por el tamano de la mano.
   * @returns el evento a enviar al motor de audio, o null si no hay cambio.
   */
  update(ratio: number): GateEvent {
    let target: boolean | null = null;
    if (ratio < PINCH_CLOSE) target = true;
    else if (ratio > PINCH_OPEN) target = false;
    // Dentro de la banda muerta no hay opinion: se mantiene el estado actual.

    if (target === null || target === this.open) {
      this.candidate = null;
      this.streak = 0;
      return null;
    }

    if (this.candidate === target) {
      this.streak += 1;
    } else {
      this.candidate = target;
      this.streak = 1;
    }

    if (this.streak < CONFIRM_FRAMES) return null;

    this.open = target;
    this.candidate = null;
    this.streak = 0;
    return this.open ? 'attack' : 'release';
  }

  /**
   * Cierra el gate sin pasar por la confirmacion. Se usa cuando la mano de
   * melodia desaparece de verdad, o al perder la pestana: dejar un oscilador
   * sonando solo porque nadie ha abierto los dedos seria un error.
   */
  forceClose(): GateEvent {
    this.candidate = null;
    this.streak = 0;
    if (!this.open) return null;
    this.open = false;
    return 'release';
  }
}
