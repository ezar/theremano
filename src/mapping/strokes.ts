import { denormalize } from './features';
import { OPEN_PINCH, edgeLean, type HandPose } from '../tracking/phantom';

/**
 * La coreografia de un golpe: el viaje y la caida.
 *
 * Es lo unico que hay entre dos golpes, y es la misma forma la toque quien la
 * toque. Vive aparte porque la usan dos cosas que no se parecen en nada: la
 * demostracion, que inventa un ritmo y lo toca, y el fantasma, que reconstruye
 * el de una capa ya grabada. La primera va en negras y tiene principio y fin; la
 * segunda va en segundos y da vueltas sin acabar nunca. Lo que comparten es
 * justo esto y nada mas, asi que esto es lo que se comparte: una lista de
 * golpes con su instante, su sitio y su altura, y una funcion que dice donde
 * esta la mano entre dos de ellos.
 *
 * El golpe se dibuja al reves que una nota. Una nota se toca llegando y
 * cerrando la pinza; un golpe se toca cayendo, y lo que decide como suena es la
 * altura desde la que se cae. Por eso aqui no hay envolvente ni sostenido.
 */

export interface Stroke {
  /** Cuando aterriza la mano, en segundos. */
  at: number;
  /** Sobre que punto, en el encuadre util. */
  x: number;
  /** Desde que altura cae. Aqui esta toda la dinamica del golpe. */
  lift: number;
  /** Apertura de la pinza con la que se llega. */
  pinch: number;
}

/**
 * Lo que dura la caida, desde arriba del todo hasta el parche.
 *
 * Es igual para todos los golpes, y eso es lo que mantiene el ritmo recto. El
 * golpe no suena al aterrizar sino a mitad de la caida -el detector dispara en
 * cuanto la mano supera cierta velocidad, que es como se recupera el retraso de
 * la camara-, asi que cada golpe se adelanta unas centesimas respecto a donde se
 * ve aterrizar. Con una caida de duracion fija ese adelanto es el mismo para
 * todos y el ritmo sale igual de recto que si no existiera; con caidas de
 * duracion distinta, los golpes fuertes llegarian antes que los flojos.
 *
 * Y tiene que caber en el hueco mas corto que le echen: lo que queda entre dos
 * golpes es el viaje, y un viaje de duracion negativa no existe.
 */
export const FALL_SECONDS = 0.1;

/** Altura de la palma al aterrizar, en el encuadre entero. */
export const HIT_Y = 0.62;

/**
 * Las dos alturas de referencia, medidas.
 *
 * Son las que usa la demostracion, y de ahi salen los dos numeros que hacen
 * falta para deshacer el camino: soltar la mano desde la primera da un golpe de
 * fuerza 0,66 y desde la segunda uno de 0,90, medido a traves del detector de
 * verdad. Lo demas se interpola entre esos dos puntos.
 */
export const SOFT_LIFT = 0.17;
export const HARD_LIFT = 0.29;
const SOFT_FORCE = 0.66;
export const HARD_FORCE = 0.9;

/** Lo mas y lo menos que se levanta una mano, pase lo que pase con la fuerza. */
const MIN_LIFT = 0.1;
const MAX_LIFT = 0.34;

/** Lo que tarda la mano en volver a su altura de espera al acabar. */
export const RECOVER_SECONDS = 0.5;

/** Ladeo de adorno, para que una mano quieta no parezca una pegatina. */
const SWAY = 0.05;
const SWAY_PERIOD = 5.3;

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const smooth = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Desde que altura hay que soltar la mano para que el golpe suene asi de fuerte.
 *
 * Es la vuelta de lo que hace la demostracion, que levanta la mano y deja que el
 * detector decida la fuerza. Aqui la fuerza ya esta grabada y lo que falta es la
 * altura, asi que se interpola entre las dos medidas y se recorta: una capa
 * puede traer una fuerza de un golpe dado con la mano, no con esta coreografia,
 * y fuera de esa banda la mano se saldria del encuadre o no despegaria.
 */
export function liftForForce(force: number): number {
  const t = (force - SOFT_FORCE) / (HARD_FORCE - SOFT_FORCE);
  return clamp(lerp(SOFT_LIFT, HARD_LIFT, t), MIN_LIFT, MAX_LIFT);
}

/**
 * Donde esta la mano en un instante cualquiera.
 *
 * Entre dos golpes solo hay dos cosas: el viaje -que sube la mano hasta arriba
 * del golpe siguiente, la lleva a lo ancho hasta su sitio y abre o cierra la
 * pinza por el camino- y la caida. El viaje ocupa todo el hueco que queda, asi
 * que en las corcheas de un charles es corto y en un silencio es largo y la mano
 * espera arriba: igual que una baqueta.
 *
 * @param strokes en orden de instante. Una lista vacia no tiene mano que dibujar.
 * @param phase desfase del ladeo de adorno, para que dos manos no se balanceen a
 * la vez como un metronomo.
 */
export function strokePose(strokes: readonly Stroke[], seconds: number, phase = 0): HandPose | null {
  if (strokes.length === 0) return null;
  const sway = SWAY * Math.sin((seconds / SWAY_PERIOD) * Math.PI * 2 + phase);
  const pose = (x: number, y: number, pinch: number): HandPose => ({
    // La x va en el encuadre util, que es donde estan repartidos los sitios; la
    // altura va en el encuadre entero, porque lo que la lee es el detector de
    // golpes y ese mide sobre la palma cruda.
    x: denormalize(x),
    y,
    pinch,
    tilt: sway + edgeLean(x),
  });

  let next = 0;
  while (next < strokes.length && strokes[next]!.at <= seconds) next += 1;
  const previous = next > 0 ? strokes[next - 1] : undefined;

  if (!strokes[next]) {
    // Se acabo: la mano se recoge a su altura de espera y se queda ahi. Dejarla
    // en el parche daria la impresion de que todavia falta algo.
    const last = previous!;
    const recovered = smooth((seconds - last.at) / RECOVER_SECONDS);
    // La pinza tambien se recoge, y por el mismo camino: si el ultimo golpe
    // fuera un charles abierto, devolverla de golpe seria un salto.
    return pose(
      last.x,
      lerp(HIT_Y, HIT_Y - last.lift, recovered),
      lerp(last.pinch, OPEN_PINCH, recovered),
    );
  }

  const stroke = strokes[next]!;
  const top = HIT_Y - stroke.lift;
  const falling = seconds - (stroke.at - FALL_SECONDS);

  if (falling >= 0) {
    // La caida se acelera, que es lo que hace un brazo que se deja ir. Ademas es
    // lo que separa un golpe de colocar la mano: a velocidad constante, bajar
    // despacio y bajar deprisa se parecen demasiado al principio del recorrido.
    const u = falling / FALL_SECONDS;
    return pose(stroke.x, top + stroke.lift * u * u, stroke.pinch);
  }

  if (!previous) return pose(stroke.x, top, stroke.pinch);

  const travel = smooth((seconds - previous.at) / (stroke.at - FALL_SECONDS - previous.at));
  return pose(
    lerp(previous.x, stroke.x, travel),
    lerp(HIT_Y, top, travel),
    lerp(previous.pinch, stroke.pinch, travel),
  );
}
