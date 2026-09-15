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

/**
 * Que pieza hay debajo de cada banda, de izquierda a derecha.
 *
 * El reparto de fabrica esta razonado arriba y es el que deberia servir a casi
 * todo el mundo, pero no a todo el mundo: quien toca con la izquierda quiere el
 * plato del otro lado, y quien solo usa caja y charles los quiere pegados en vez
 * de con el bombo en medio. Es siempre una permutacion de las cuatro piezas y no
 * una lista libre: con una pieza repetida se perderia otra, y una banda de menos
 * no es un kit mas simple, es una pieza que ya no se puede tocar.
 */
export type KitLayout = readonly DrumPiece[];

export function pieceAt(layout: KitLayout, x: number): DrumPiece {
  const index = pieceIndexAt(x);
  // El reparto de fabrica como respaldo: un reparto corto no puede dejar una
  // banda golpeando un undefined.
  return layout[index] ?? KIT[index]!;
}

/**
 * En que banda esta una pieza. Lo necesita quien sabe que tocar y no donde.
 *
 * El respaldo no deberia hacer falta -un reparto saneado tiene las cuatro- y
 * esta porque una pieza sin banda no tiene ningun sitio razonable adonde ir.
 */
export function bandOf(layout: KitLayout, piece: DrumPiece): number {
  const index = layout.indexOf(piece);
  return index >= 0 ? index : KIT.indexOf(piece);
}

/**
 * Deja en una permutacion valida cualquier cosa que llegue.
 *
 * Hace falta porque el reparto se guarda entre sesiones, y lo guardado no es un
 * numero ni una cadena: es una lista, y de una version anterior o de un
 * almacenamiento a medio escribir puede llegar cualquier cosa. Lo que se
 * reconoce se conserva en su sitio y lo que falta se anade en el orden de
 * fabrica, asi que la salida siempre tiene las cuatro piezas una sola vez.
 */
export function normalizeLayout(value: unknown): DrumPiece[] {
  const seen = new Set<DrumPiece>();
  const out: DrumPiece[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const piece = entry as DrumPiece;
      if (!KIT.includes(piece) || seen.has(piece)) continue;
      seen.add(piece);
      out.push(piece);
    }
  }
  for (const piece of KIT) if (!seen.has(piece)) out.push(piece);
  return out;
}

/**
 * Lo que se le puede retocar a una pieza sin cambiar de pieza.
 *
 * Afinar y subir el volumen son las dos cosas que se hacen con una bateria de
 * verdad antes de tocarla, y las dos unicas que se pueden hacer aqui sin
 * inventarse un instrumento distinto. Viajan juntas en un objeto y no como dos
 * numeros sueltos por un motivo practico: los dos son un numero por pieza, y
 * pasados sueltos se pueden intercambiar sin que el compilador diga nada.
 */
export interface PieceTrim {
  /** Afinacion, en semitonos. Cero es como viene de fabrica. */
  tuning: number;
  /** Volumen, multiplicando el de fabrica. Uno es como viene de fabrica. */
  level: number;
}

export type KitTrim = Record<DrumPiece, PieceTrim>;

/**
 * Cuanto se puede subir y bajar la afinacion, en semitonos.
 *
 * Una octava a cada lado. En el bombo es lo que se oye como afinar un parche; en
 * las otras tres, que son ruido y no tienen altura, mueve la ventana del
 * espectro donde vive el golpe, que es lo mismo que hace tensar un parche de
 * verdad: mas tenso, mas agudo y mas corto de cuerpo.
 */
export const TUNING_RANGE = 12;

/** Y cuanto se puede subir el volumen de una pieza sobre el suyo de fabrica. */
export const MAX_LEVEL = 2;

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

/**
 * Un numero por pieza, saneado.
 *
 * Mismo motivo que el reparto: esto se guarda y se recupera, y un NaN colado en
 * una ganancia no suena raro, apaga la pieza entera sin decir nada.
 */
export function normalizePieceNumbers(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): Record<DrumPiece, number> {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const out = {} as Record<DrumPiece, number>;
  for (const piece of KIT) {
    const entry = source[piece];
    out[piece] = typeof entry === 'number' && Number.isFinite(entry) ? clamp(entry, min, max) : fallback;
  }
  return out;
}

/**
 * Junta los dos ajustes por pieza en lo que espera el kit, saneandolos.
 *
 * Se sanea aqui y no solo al recuperarlos del almacenamiento por lo mismo que el
 * reparto: quien llegue con unos ajustes armados a mano no tiene por que saber
 * que estos dos tienen una entrada por pieza, y una entrada que falta llega a la
 * ganancia como un NaN. Un NaN en una ganancia no suena raro: apaga la pieza
 * entera y no vuelve.
 */
export function kitTrim(
  tuning: Record<DrumPiece, number>,
  level: Record<DrumPiece, number>,
): KitTrim {
  const tuned = normalizePieceNumbers(tuning, 0, -TUNING_RANGE, TUNING_RANGE);
  const levels = normalizePieceNumbers(level, 1, 0, MAX_LEVEL);
  const out = {} as KitTrim;
  for (const piece of KIT) out[piece] = { tuning: tuned[piece], level: levels[piece] };
  return out;
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
 * El umbral es un poco mas holgado que el del gate -que cierra en 0,30- y a
 * proposito: alli hay histeresis y una racha de confirmacion detras, y aqui hay
 * una sola lectura, en el fotograma del golpe y sobre puntos sin filtrar. Con el
 * mismo numero, un temblor en ese fotograma se lleva por delante el charles
 * abierto que si se estaba pidiendo.
 */
export const OPEN_HAT_PINCH = 0.35;

/** Centro de una banda, para dibujar su nombre y su destello. */
export function bandCenter(index: number): number {
  return (index + 0.5) * BAND;
}
