/**
 * El reparto de la bateria a lo ancho del encuadre.
 *
 * La altura ya esta ocupada: bajar es golpear. Lo unico que queda para elegir
 * pieza es la posicion horizontal, asi que el encuadre se parte en bandas y cada
 * mano golpea la que tiene debajo.
 *
 * El orden no es decorativo. Se toca con dos manos, cada una en su mitad, y un
 * ritmo cualquiera reparte el trabajo de una forma muy concreta: una mano lleva
 * el pulso en el charles, sin parar y casi sin moverse, y la otra alterna bombo
 * y caja. Por eso bombo y caja van juntos en la mitad izquierda —alternarlos es
 * un desplazamiento minimo— y el charles queda donde la mano derecha reposa de
 * forma natural.
 *
 * El platillo es el que va al extremo, que es el sitio incomodo, y es el unico
 * que puede permitirselo: en un compas entero se usa una vez, para un acento.
 * Poner ahi cualquiera de los otros tres seria condenar a la mano a cruzar el
 * encuadre en cada negra.
 *
 * Cuatro bandas y no mas: el ancho util son ochenta y cuatro centesimas de
 * encuadre, que a cuatro tocan a poco mas de un palmo por pieza a distancia de
 * brazo. Con seis piezas la banda se estrecha por debajo del temblor de la
 * propia mano y empiezan los golpes en la pieza de al lado.
 */

export type DrumPiece = 'kick' | 'snare' | 'hat' | 'crash';

/** De izquierda a derecha tal y como se ve uno en el espejo. */
export const KIT: readonly DrumPiece[] = ['kick', 'snare', 'hat', 'crash'];

/** Lo que mide cada banda en el espacio normalizado del encuadre util. */
export const BAND = 1 / KIT.length;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @param x posicion de la palma ya normalizada (0 = borde izquierdo del
 * encuadre util, 1 = derecho), la misma que usa la rejilla de la escala.
 */
export function pieceIndexAt(x: number): number {
  // El uno exacto cae fuera de la ultima banda al dividir, y la mano pegada al
  // borde derecho es una postura perfectamente normal.
  return Math.min(KIT.length - 1, Math.floor(clamp01(x) / BAND));
}

export function pieceAt(x: number): DrumPiece {
  return KIT[pieceIndexAt(x)]!;
}

/**
 * Pinza por debajo de la cual el charles suena abierto.
 *
 * El gesto no son los dedos estirados, que es lo primero que se prueba y lo
 * que no funciona: una mano que baja a golpear lleva los cuatro dedos
 * extendidos casi siempre -y la mano dibujada del puntero, siempre-, asi que
 * abierto acababa siendo lo que salia sin querer. Y el charles abierto en cada
 * corchea lo emborrona todo: el que tiene que salir solo es el cerrado.
 *
 * La pinza es lo contrario: en bateria no abre ninguna nota, asi que esta
 * libre, y es una postura deliberada que hay que sostener. Ademas es el gesto
 * que la aplicacion ya ensena y el que mejor mide. Y sale gratis con el raton:
 * mantener pulsado ya cierra la pinza de la mano dibujada.
 *
 * El umbral es mas exigente que el del gate porque aqui no hay histeresis que
 * valga: se mira una vez, en el fotograma del golpe.
 */
export const OPEN_HAT_PINCH = 0.35;

/** Centro de una banda, para dibujar su nombre y su destello. */
export function bandCenter(index: number): number {
  return (index + 0.5) * BAND;
}
