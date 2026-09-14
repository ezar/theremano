import { KIT, bandCenter, type DrumPiece } from './kit';
import { denormalize } from './features';
import { CLOSED_PINCH, OPEN_PINCH, edgeLean, type HandPose } from '../tracking/phantom';

/**
 * La coreografia de la demostracion de bateria: un ritmo tocado a dos manos.
 *
 * Es la hermana de la demostracion melodica y funciona igual de mentirosa: aqui
 * no suena nada. Lo unico que sale de este fichero son dos poses por instante, y
 * con ellas se fabrican dos manos sinteticas que entran en el mapeador por la
 * misma puerta que dos manos de verdad. El detector de golpes decide cuando
 * suena y con cuanta fuerza, y la banda de debajo de la palma decide que pieza.
 * Si algun dia el golpe se dispara mal, la demostracion se estropea con el, que
 * es exactamente lo que se quiere de una demostracion.
 *
 * Hacen falta las dos manos y no una. El reparto del kit -bombo y caja a la
 * izquierda, charles y plato a la derecha- solo tiene sentido viendolo: una mano
 * lleva el pulso sin parar y la otra alterna las dos piezas graves. Con una sola
 * mano cruzando el encuadre en cada negra, lo que se ensena es justo lo que no
 * hay que hacer.
 *
 * El golpe se dibuja al reves que una nota. Una nota se toca llegando y
 * cerrando la pinza; un golpe se toca cayendo, y lo que decide como suena es la
 * altura desde la que se cae. Por eso aqui no hay envolvente ni sostenido: cada
 * golpe es un viaje hasta arriba de la pieza siguiente y una caida, y toda la
 * dinamica sale de que el charles se levanta poco y la caja se levanta mucho.
 */

interface Stroke {
  /** Cuando aterriza la mano, en negras desde el principio del ritmo. */
  at: number;
  piece: DrumPiece;
  /** Charles abierto: se llega con la pinza cerrada. */
  open: boolean;
}

/**
 * El tempo, que no es una eleccion libre.
 *
 * A negra por segundo el ritmo suena a ejercicio, y por encima de cien las
 * corcheas del charles dejan de verse como golpes y se ven como un temblor: el
 * viaje de subida se queda en poco mas de una decima y la mano no llega a
 * despegar. Noventa y dos es un medio tiempo comodo, el sitio donde una mano de
 * verdad puede imitar lo que esta viendo sin correr.
 */
const BPM = 92;
export const BEAT_SECONDS = 60 / BPM;

/** Tiempo de manos quietas antes del primer golpe, para verlas enteras. */
export const LEAD_IN_SECONDS = 0.9;

/**
 * Lo que dura la caida de un golpe, desde arriba del todo hasta el parche.
 *
 * Es igual para todos los golpes, y eso es lo que mantiene el ritmo recto. El
 * golpe no suena al aterrizar sino a mitad de la caida -el detector dispara en
 * cuanto la mano supera cierta velocidad, que es como se recupera el retraso de
 * la camara-, asi que cada golpe se adelanta unas centesimas respecto a donde se
 * ve aterrizar. Con una caida de duracion fija ese adelanto es el mismo para
 * todos y el ritmo sale igual de recto que si no existiera; con caidas de
 * duracion distinta, los golpes fuertes llegarian antes que los flojos.
 *
 * Y tiene que caber en el hueco mas corto del patron, que es media negra: lo que
 * queda entre dos golpes es el viaje, y un viaje de duracion negativa no existe.
 */
const FALL_SECONDS = 0.1;

/** Altura de la palma al aterrizar, en el encuadre entero. */
const HIT_Y = 0.62;

/**
 * Desde donde cae cada golpe. Aqui esta toda la dinamica del ritmo.
 *
 * No hay ningun parametro de fuerza en este fichero: la fuerza la mide el
 * detector a partir de la velocidad de caida, y con la duracion de la caida fija
 * la velocidad la decide la altura. Levantar mas es pegar mas fuerte, que es
 * ademas lo que hace cualquiera con dos baquetas en la mano.
 */
const SOFT_LIFT = 0.17;
const HARD_LIFT = 0.29;

/** Lo que tarda la mano en volver a su altura de reposo al acabar el ritmo. */
const RECOVER_SECONDS = 0.5;

/** Silencio final, para que el plato acabe de sonar. */
const TAIL_SECONDS = 1.6;

/** Ladeo de adorno, para que las dos manos no parezcan dos pegatinas. */
const SWAY = 0.05;
const SWAY_PERIOD = 5.3;

const smooth = (t: number): number => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Centro de la banda de una pieza, en el encuadre util. */
function pieceX(piece: DrumPiece): number {
  return bandCenter(KIT.indexOf(piece));
}

function liftOf(stroke: Stroke): number {
  // El charles lleva el pulso y suena por debajo de todo lo demas: si se
  // levantara como la caja, cada corchea taparia el ritmo entero.
  return stroke.piece === 'hat' ? SOFT_LIFT : HARD_LIFT;
}

const pinchOf = (stroke: Stroke): number => (stroke.open ? CLOSED_PINCH : OPEN_PINCH);

/** Las corcheas seguidas del charles, que son casi todo el trabajo de esa mano. */
function eighths(from: number, to: number): Stroke[] {
  const out: Stroke[] = [];
  for (let at = from; at < to; at += 0.5) out.push({ at, piece: 'hat', open: false });
  return out;
}

/**
 * La mano que alterna bombo y caja.
 *
 * Es el patron mas comun que existe -bombo en el uno, caja en el dos- con un
 * bombo de mas antes del cuatro en los dos primeros compases. Ese bombo doble
 * esta para que se vea que la mano puede volver a caer sin subir del todo, que
 * es lo que no se deduce mirando negras.
 */
const KICK_SNARE: readonly Stroke[] = [
  { at: 0, piece: 'kick', open: false },
  { at: 1, piece: 'snare', open: false },
  { at: 2, piece: 'kick', open: false },
  { at: 2.5, piece: 'kick', open: false },
  { at: 3, piece: 'snare', open: false },
  { at: 4, piece: 'kick', open: false },
  { at: 5, piece: 'snare', open: false },
  { at: 6, piece: 'kick', open: false },
  { at: 6.5, piece: 'kick', open: false },
  { at: 7, piece: 'snare', open: false },
  { at: 8, piece: 'kick', open: false },
  { at: 9, piece: 'snare', open: false },
  { at: 10, piece: 'kick', open: false },
  { at: 11, piece: 'snare', open: false },
  { at: 12, piece: 'kick', open: false },
];

/**
 * La mano del charles, que acaba en el plato.
 *
 * El charles abierto va en el ultimo compas y con un tiempo entero por delante
 * antes de cerrarlo. No es adorno: abierto y cerrado se distinguen por la cola,
 * y una cola de casi un segundo cortada a la corchea siguiente no se oye como
 * "abierto", se oye como un charles raro. Asi se oye primero lo que dura y
 * despues como el golpe cerrado lo apaga, que es lo que hace el pedal.
 */
const HAT_CRASH: readonly Stroke[] = [
  ...eighths(0, 10.5),
  { at: 10.5, piece: 'hat', open: true },
  { at: 11.5, piece: 'hat', open: false },
  { at: 12, piece: 'crash', open: false },
];

/**
 * Cuando cae el ultimo golpe del ritmo, en negras.
 *
 * Se saca de los patrones y no se escribe aparte: un numero copiado a mano se
 * queda corto en cuanto alguien alarga una de las dos manos, y la demostracion
 * se cortaria a mitad sin que nada lo avisara.
 */
const LAST_BEAT = Math.max(
  KICK_SNARE[KICK_SNARE.length - 1]?.at ?? 0,
  HAT_CRASH[HAT_CRASH.length - 1]?.at ?? 0,
);

export class DrumDemoPerformance {
  get seconds(): number {
    return LEAD_IN_SECONDS + LAST_BEAT * BEAT_SECONDS + TAIL_SECONDS;
  }

  finishedAt(seconds: number): boolean {
    return seconds >= this.seconds;
  }

  /**
   * Las dos poses de este instante.
   *
   * Los nombres son los de los dos papeles del mapeador y no los de las dos
   * manos de nadie: en bateria las dos golpean y ninguna de las dos hace lo que
   * su nombre dice. Se conservan porque son las dos ranuras por las que entra
   * una mano, y cambiarlos aqui solo obligaria a traducirlos al salir.
   */
  poseAt(seconds: number): { melody: HandPose; expression: HandPose } {
    return {
      melody: lanePose(KICK_SNARE, seconds, 0),
      expression: lanePose(HAT_CRASH, seconds, Math.PI),
    };
  }
}

/**
 * Donde esta una mano en un instante cualquiera.
 *
 * Entre dos golpes solo hay dos cosas: el viaje -que sube la mano hasta arriba
 * de la pieza siguiente, la lleva a lo ancho hasta su banda y abre o cierra la
 * pinza por el camino- y la caida. El viaje ocupa todo el hueco que queda, asi
 * que en las corcheas del charles es corto y en un silencio es largo y la mano
 * espera arriba: igual que una baqueta.
 *
 * @param phase desfase del ladeo de adorno, para que las dos manos no se
 * balanceen a la vez como un metronomo.
 */
function lanePose(strokes: readonly Stroke[], seconds: number, phase: number): HandPose {
  const sway = SWAY * Math.sin((seconds / SWAY_PERIOD) * Math.PI * 2 + phase);
  const pose = (x: number, y: number, pinch: number): HandPose => ({
    // La x va en el encuadre util, que es donde estan repartidas las bandas; la
    // altura va en el encuadre entero, porque lo que la lee es el detector de
    // golpes y ese mide sobre la palma cruda.
    x: denormalize(x),
    y,
    pinch,
    tilt: sway + edgeLean(x),
  });

  const timeOf = (stroke: Stroke): number => LEAD_IN_SECONDS + stroke.at * BEAT_SECONDS;

  let next = 0;
  while (next < strokes.length && timeOf(strokes[next]!) <= seconds) next += 1;
  const previous = next > 0 ? strokes[next - 1] : undefined;

  if (next >= strokes.length) {
    // Se acabo el ritmo: la mano se recoge a su altura de espera y se queda
    // ahi. Dejarla en el parche daria la impresion de que todavia falta algo.
    const last = previous!;
    const since = seconds - timeOf(last);
    const rest = HIT_Y - liftOf(last);
    const recovered = smooth(since / RECOVER_SECONDS);
    // La pinza tambien se recoge, y por el mismo camino: si el ultimo golpe
    // fuera un charles abierto, devolverla de golpe seria un salto.
    return pose(
      pieceX(last.piece),
      lerp(HIT_Y, rest, recovered),
      lerp(pinchOf(last), OPEN_PINCH, recovered),
    );
  }

  const stroke = strokes[next]!;
  const x = pieceX(stroke.piece);
  const top = HIT_Y - liftOf(stroke);
  const landing = timeOf(stroke);
  const falling = seconds - (landing - FALL_SECONDS);

  if (falling >= 0) {
    // La caida se acelera, que es lo que hace un brazo que se deja ir. Ademas es
    // lo que separa un golpe de colocar la mano: a velocidad constante, bajar
    // despacio y bajar deprisa se parecen demasiado al principio del recorrido.
    const u = falling / FALL_SECONDS;
    return pose(x, top + liftOf(stroke) * u * u, pinchOf(stroke));
  }

  if (!previous) return pose(x, top, pinchOf(stroke));

  const from = timeOf(previous);
  const travel = smooth((seconds - from) / (landing - FALL_SECONDS - from));
  return pose(
    lerp(pieceX(previous.piece), x, travel),
    lerp(HIT_Y, top, travel),
    lerp(pinchOf(previous), pinchOf(stroke), travel),
  );
}
