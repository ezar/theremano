/**
 * El swing: lo que separa un ritmo tocado de un ritmo cuadriculado.
 *
 * Un ritmo recto pone las corcheas exactamente a mitad de cada pulso, y eso es
 * lo que suena a maquina. Con swing la de en medio se retrasa: el pulso se
 * reparte en dos partes desiguales, larga y corta, que es como lo toca
 * cualquiera que lleve una baqueta. No es un efecto ni un adorno, es donde cae
 * cada golpe.
 *
 * Se aplica al reproducir y no al grabar, y esa es la decision que importa: lo
 * que la capa guarda sigue siendo el instante en que alguien golpeo de verdad.
 * Se puede subir y bajar con la vuelta girando, oir las dos y quedarse con una,
 * y ponerlo a cero devuelve exactamente lo que se toco. Escribirlo en la capa
 * seria perder el original en el primer intento.
 *
 * Y va sobre el mismo pulso que la claqueta, no sobre uno inventado: si el
 * swing contara los pulsos de otra manera, lo que se oye como el uno y lo que
 * el swing cree que es el uno serian dos cosas distintas, y el ritmo saldria
 * torcido en vez de con swing.
 */

/**
 * Lo mas tarde que llega a caer la corchea de en medio.
 *
 * A 0,5 esta en el centro exacto, que es el ritmo recto. A 0,66 el pulso queda
 * repartido en dos contra uno, que es el swing de libro y tambien el techo de lo
 * que suena a swing: mas alla la corchea se pega tanto al pulso siguiente que
 * deja de oirse como un tresillo y empieza a oirse como un golpe mal dado.
 */
const MAX_OFFBEAT = 0.66;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Donde cae un golpe con swing puesto.
 *
 * El pulso se estira por delante y se encoge por detras, con el punto medio
 * corrido: todo lo que caia en la primera mitad se reparte en la parte larga y
 * todo lo de la segunda en la corta. Es una unica linea quebrada, continua y
 * siempre creciente, y las dos cosas hacen falta. Continua, porque un salto en
 * el reparto mandaria dos golpes pegados al mismo instante; creciente, porque
 * si dos golpes se cruzaran, un ritmo con swing sonaria con las notas cambiadas
 * de orden.
 *
 * Los golpes que caen justo en el pulso no se mueven, pase lo que pase con el
 * swing. Son los que llevan el compas, y moverlos no seria darle swing al ritmo
 * sino cambiarlo de sitio entero.
 *
 * @param t instante del golpe dentro del ciclo, en segundos.
 * @param beatSeconds lo que dura un pulso. Cero o menos deja el golpe donde esta.
 * @param amount de 0 (recto, tal y como se toco) a 1.
 */
export function swingTime(t: number, beatSeconds: number, amount: number): number {
  const swing = clamp01(amount);
  if (!(beatSeconds > 0) || swing === 0 || !Number.isFinite(t)) return t;

  const beat = Math.floor(t / beatSeconds);
  const within = t / beatSeconds - beat;
  const middle = 0.5 + (MAX_OFFBEAT - 0.5) * swing;
  const moved = within <= 0.5 ? within * (middle / 0.5) : middle + (within - 0.5) * ((1 - middle) / 0.5);
  return (beat + moved) * beatSeconds;
}
