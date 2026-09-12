import { CLOSED_PINCH, OPEN_PINCH, edgeLean, type HandPose } from '../tracking/phantom';
import { normalize } from './features';

/**
 * Tocar sin camara, con el raton o con el dedo.
 *
 * Existe por la puerta donde se queda media la gente: el permiso de camara. Sin
 * camara no hay manos, pero si hay una mano dibujada —la misma que usa la
 * demostracion— y un puntero que la mueva. El puntero pone la palma, que es lo
 * que decide la nota, y pulsar cierra la pinza. De ahi para adelante el camino
 * es el de siempre: el mismo gate, la misma cuantizacion, la misma fuerza de
 * ataque y el mismo bucle. No es una version recortada del instrumento, es el
 * instrumento con otra entrada.
 *
 * Aqui no hay DOM: entran coordenadas ya normalizadas y sale una pose. Asi se
 * puede comprobar con numeros lo unico que de verdad puede salir mal, que es que
 * suene la nota de al lado.
 */

/**
 * Lo que tarda la pinza en cerrarse al pulsar.
 *
 * No se cierra de golpe a proposito. La fuerza del ataque sale de lo rapido que
 * se cierra la pinza, y un salto instantaneo la satura: todas las notas
 * entrarian al maximo. Ochenta milisegundos dan una entrada firme sin llegar al
 * tope, y son ochenta milisegundos que se notan menos que la latencia de la
 * camara, que es a lo que sustituye esto.
 */
export const PRESS_SECONDS = 0.08;

/** Lo que tarda en abrirse al soltar. */
export const RELEASE_SECONDS = 0.1;

/**
 * Un pulsado mas lejos que esto de donde estaba la mano es una mano nueva.
 *
 * Con el dedo, cada nota es un toque en un sitio distinto de la pantalla: la
 * mano no viaja hasta alli, aparece alli. Y el filtro del tono no distingue un
 * salto de un movimiento muy rapido, asi que llegaria a la nota dos decimas
 * despues de que el gate haya abierto y sonaria la zona de la que se venia.
 * Avisar de que la mano ha desaparecido y ha vuelto en otro sitio es lo que
 * pone el filtro a cero, que es exactamente lo que hace falta.
 */
export const JUMP = 0.015;

export class PointerPlayer {
  private x = 0.5;
  private y = 0.5;
  private pinch = OPEN_PINCH;
  private pressed = false;
  /** La primera pose no tiene pasado: tambien cuenta como aparicion. */
  private jumped = true;
  /** El segundo dedo, o el boton derecho: la mano que pone la nota pedal. */
  private second: { x: number; y: number } | null = null;

  get sounding(): boolean {
    return this.pressed;
  }

  /** @param x @param y en espacio de vista, 0 a 1 sobre el encuadre. */
  moveTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  press(x: number, y: number): void {
    if (Math.hypot(x - this.x, y - this.y) > JUMP) this.jumped = true;
    this.x = x;
    this.y = y;
    this.pressed = true;
  }

  release(): void {
    this.pressed = false;
  }

  /**
   * El segundo dedo apoyado, que hace de mano de expresion.
   *
   * Con camara son dos manos; aqui son dos dedos, y hacen exactamente lo mismo:
   * la pinza cerrada de esa mano sostiene la nota como pedal, y su altura es el
   * volumen. No hay ningun camino nuevo, solo una segunda mano dibujada.
   */
  pressSecond(x: number, y: number): void {
    this.second = { x, y };
  }

  moveSecond(x: number, y: number): void {
    if (this.second) this.second = { x, y };
  }

  releaseSecond(): void {
    this.second = null;
  }

  /** La pose de esa segunda mano, o null si no hay segundo dedo. */
  get expression(): HandPose | null {
    if (!this.second) return null;
    // Siempre con la pinza cerrada: el segundo dedo no esta para separarla y
    // juntarla, esta para decir "sostén esto".
    return { x: this.second.x, y: this.second.y, pinch: CLOSED_PINCH, tilt: edgeLean(normalize(this.second.x)) };
  }

  /**
   * La pose de este fotograma, o null si la mano acaba de aparecer en otro
   * sitio. Quien llame trata ese null como lo que es: un fotograma sin mano.
   *
   * @param dt segundos desde el fotograma anterior.
   */
  update(dt: number): HandPose | null {
    if (this.jumped) {
      this.jumped = false;
      // La pinza vuelve a su reposo: una mano que aparece, aparece abierta.
      this.pinch = OPEN_PINCH;
      return null;
    }

    const target = this.pressed ? CLOSED_PINCH : OPEN_PINCH;
    const seconds = this.pressed ? PRESS_SECONDS : RELEASE_SECONDS;
    const step = ((OPEN_PINCH - CLOSED_PINCH) / seconds) * Math.max(0, dt);
    this.pinch = this.pinch < target ? Math.min(target, this.pinch + step) : Math.max(target, this.pinch - step);

    return { x: this.x, y: this.y, pinch: this.pinch, tilt: edgeLean(normalize(this.x)) };
  }
}
