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
 * Cuantas bandas caben, y por que cuatro de fabrica: el ancho util son ochenta y
 * cuatro centesimas de encuadre, que a cuatro tocan a poco mas de un palmo por
 * pieza a distancia de brazo. A seis, cada banda se queda en dos tercios de eso,
 * y por debajo de cierto ancho empiezan los golpes en la pieza de al lado: no
 * por ruido del detector -que es cien veces mas pequeno que la banda mas
 * estrecha de aqui- sino por la punteria de una mano en el aire, sin nada que
 * tocar y sin nada donde apoyarse.
 *
 * Donde esta ese limite depende de quien toca, de lo lejos que este de la camara
 * y de lo ancho que sea el encuadre, asi que no lo decide este fichero: cuatro es
 * lo que viene puesto y quien toca puede subirlo. Lo que no se puede es subirlo a
 * ciegas y llamarlo mejor, porque cada pieza que se anade estrecha las otras.
 */

export type DrumPiece = 'kick' | 'snare' | 'tomLow' | 'tomHigh' | 'hat' | 'crash';

/**
 * Todas las piezas que existen, en orden de escenario.
 *
 * El orden importa y no es una lista cualquiera: los toms van entre la caja y el
 * charles porque es donde estan en una bateria de verdad y, sobre todo, porque
 * es donde la mano que alterna bombo y caja los alcanza sin cruzar el encuadre.
 */
export const ROSTER: readonly DrumPiece[] = ['kick', 'snare', 'tomLow', 'tomHigh', 'hat', 'crash'];

/** Las cuatro de siempre, de izquierda a derecha tal y como se ve uno en el espejo. */
export const KIT: readonly DrumPiece[] = ['kick', 'snare', 'hat', 'crash'];

export const MIN_PIECES = KIT.length;
export const MAX_PIECES = ROSTER.length;

/** Cuantas piezas caben de verdad en lo que llegue. */
export function normalizeSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MIN_PIECES;
  return Math.min(MAX_PIECES, Math.max(MIN_PIECES, Math.round(value)));
}

/**
 * El reparto de fabrica para un numero de piezas.
 *
 * Las cuatro de siempre estan en todos, y lo que se anade son toms en su sitio
 * de escenario. Asi, subir el numero no reordena lo que ya habia: mete una pieza
 * en medio y las demas siguen donde se las espera.
 */
export function defaultLayout(size: number): DrumPiece[] {
  const wanted = normalizeSize(size);
  const extras = ROSTER.filter((piece) => !KIT.includes(piece)).slice(0, wanted - KIT.length);
  return ROSTER.filter((piece) => KIT.includes(piece) || extras.includes(piece));
}

/** Lo que mide cada banda en el espacio normalizado del encuadre util. */
export function bandWidth(count: number): number {
  return 1 / Math.max(1, count);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @param x posicion de la palma ya normalizada (0 = borde izquierdo del
 * encuadre util, 1 = derecho), la misma que usa la rejilla de la escala.
 */
export function pieceIndexAt(x: number, count: number): number {
  // El uno exacto cae fuera de la ultima banda al dividir, y la mano pegada al
  // borde derecho es una postura perfectamente normal.
  return Math.min(count - 1, Math.floor(clamp01(x) / bandWidth(count)));
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
  // El reparto manda sobre cuantas bandas hay: es la lista de lo que esta en el
  // escenario, y el encuadre se parte en tantas partes como piezas haya.
  const count = layout.length > 0 ? layout.length : KIT.length;
  const index = pieceIndexAt(x, count);
  // El reparto de fabrica como respaldo: un reparto corto no puede dejar una
  // banda golpeando un undefined.
  return layout[index] ?? KIT[index] ?? ROSTER[index]!;
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
 * fabrica, asi que la salida siempre tiene tantas piezas como se le pidan, una
 * sola vez cada una.
 *
 * El tamano es obligatorio a proposito, sin valor por defecto: un defecto de
 * cuatro recortaria en silencio un kit de seis, y lo que sale de eso no es un
 * error sino seis bandas dibujadas de las que solo suenan cuatro.
 */
export function normalizeLayout(value: unknown, size: number): DrumPiece[] {
  const wanted = normalizeSize(size);
  const given: DrumPiece[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const piece = entry as DrumPiece;
      if (ROSTER.includes(piece) && !given.includes(piece)) given.push(piece);
    }
  }

  /*
   * Al recortar se van los toms, no lo que estuviera mas a la derecha.
   *
   * Bajar de seis piezas a cuatro quedandose con las cuatro primeras del reparto
   * puede dejar un kit sin bombo y sin caja -basta con haberlos movido al lado
   * derecho- y eso no es un kit mas simple, es un kit con el que no se puede
   * tocar un ritmo. Las cuatro de siempre tienen preferencia, cada una en el
   * sitio en que estuviera, y lo que sobra son las que se anadieron.
   */
  const seen = new Set<DrumPiece>();
  const out: DrumPiece[] = [];
  // La preferencia solo se aplica cuando de verdad sobra alguna. Aplicarla
  // siempre reordenaria un reparto que cabe entero, y entonces esto dejaria de
  // ser sanear para pasar a ser colocar.
  const order =
    given.length > wanted
      ? [...given.filter((p) => KIT.includes(p)), ...given.filter((p) => !KIT.includes(p))]
      : given;
  for (const piece of order) {
    if (out.length >= wanted) break;
    seen.add(piece);
    out.push(piece);
  }
  // Lo que falte, detras y en el orden de fabrica. Recuperar un reparto a medio
  // escribir no puede mover de sitio lo que si se reconoce: quien puso el plato
  // a la izquierda lo encuentra donde lo dejo.
  for (const piece of defaultLayout(wanted)) {
    if (out.length >= wanted) break;
    if (seen.has(piece)) continue;
    seen.add(piece);
    out.push(piece);
  }
  return out;
}

/**
 * El mismo reparto con otro numero de piezas.
 *
 * No es lo mismo que sanear, y por eso es otra funcion: al sanear se recupera lo
 * que se guardo y lo que falta va detras, porque no se sabe si falta por que
 * alguien lo quito o porque el guardado se escribio a medias. Aqui si se sabe:
 * alguien acaba de pedir dos piezas mas, y esas dos tienen un sitio.
 *
 * Y el sitio no es el final. Anadirlas al final es lo facil y deja los toms
 * pasado el plato, que es el peor sitio que hay: el extremo solo puede
 * permitirselo una pieza que se usa una vez por compas, y un tom no lo es. Cada
 * una entra delante de la primera que en el escenario vaya detras de ella, asi
 * que lo que ya estaba conserva su orden y lo nuevo cae donde la mano lo alcanza.
 */
export function growLayout(bands: KitLayout, size: number): DrumPiece[] {
  const wanted = normalizeSize(size);
  const out = normalizeLayout(bands, Math.min(wanted, bands.length)).slice(0, wanted);
  for (const piece of defaultLayout(wanted)) {
    if (out.length >= wanted) break;
    if (out.includes(piece)) continue;
    const after = out.findIndex((placed) => ROSTER.indexOf(placed) > ROSTER.indexOf(piece));
    if (after < 0) out.push(piece);
    else out.splice(after, 0, piece);
  }
  // Y saneado al final, que es lo unico que puede prometer que sale un reparto.
  return normalizeLayout(out, wanted);
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
  // Todas las que existen y no solo las que estan puestas: quien afina un tom,
  // baja el kit a cuatro y vuelve a subirlo tiene que encontrarlo como lo dejo.
  for (const piece of ROSTER) {
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
  for (const piece of ROSTER) out[piece] = { tuning: tuned[piece], level: levels[piece] };
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
export function bandCenter(index: number, count: number): number {
  return (index + 0.5) * bandWidth(count);
}
