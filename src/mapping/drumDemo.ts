import { bandCenter, bandOf, type DrumPiece, type KitLayout } from './kit';
import { HARD_LIFT, SOFT_LIFT, strokePose, type Stroke } from './strokes';
import { CLOSED_PINCH, OPEN_PINCH, type HandPose } from '../tracking/phantom';

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

/**
 * Un golpe del patron, escrito como se escribe un ritmo: en negras y por pieza.
 *
 * La coreografia -el viaje, la caida, la altura- vive aparte y habla de
 * segundos y de sitios. Aqui solo esta lo que se decide al componer.
 */
interface Beat {
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

/** Silencio final, para que el plato acabe de sonar. */
const TAIL_SECONDS = 1.6;

/** Centro de la banda de una pieza, en el encuadre util. */
function pieceX(layout: KitLayout, piece: DrumPiece): number {
  return bandCenter(bandOf(layout, piece), layout.length);
}

/**
 * Desde donde cae cada golpe. Aqui esta toda la dinamica del ritmo.
 *
 * No hay ningun parametro de fuerza en este fichero: la fuerza la mide el
 * detector a partir de la velocidad de caida, y con la duracion de la caida fija
 * la velocidad la decide la altura. Levantar mas es pegar mas fuerte, que es
 * ademas lo que hace cualquiera con dos baquetas en la mano.
 *
 * El charles lleva el pulso y suena por debajo de todo lo demas: si se levantara
 * como la caja, cada corchea taparia el ritmo entero.
 */
const liftOf = (beat: Beat): number => (beat.piece === 'hat' ? SOFT_LIFT : HARD_LIFT);

const pinchOf = (beat: Beat): number => (beat.open ? CLOSED_PINCH : OPEN_PINCH);

/** Del patron a la coreografia: de negras y piezas a segundos y sitios. */
function choreograph(layout: KitLayout, beats: readonly Beat[]): Stroke[] {
  return beats.map((beat) => ({
    at: LEAD_IN_SECONDS + beat.at * BEAT_SECONDS,
    x: pieceX(layout, beat.piece),
    lift: liftOf(beat),
    pinch: pinchOf(beat),
  }));
}

/** Las corcheas seguidas del charles, que son casi todo el trabajo de esa mano. */
function eighths(from: number, to: number): Beat[] {
  const out: Beat[] = [];
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
const KICK_SNARE: readonly Beat[] = [
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
const HAT_CRASH: readonly Beat[] = [
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
  /**
   * @param layout donde esta cada pieza ahora mismo. El ritmo esta escrito en
   * piezas y no en bandas, asi que quien haya movido el plato a la izquierda ve
   * a la mano irse a la izquierda a buscarlo: la demostracion ensena el kit que
   * hay, no el de fabrica.
   */
  private readonly melodyStrokes: readonly Stroke[];
  private readonly expressionStrokes: readonly Stroke[];

  constructor(layout: KitLayout) {
    this.melodyStrokes = choreograph(layout, KICK_SNARE);
    this.expressionStrokes = choreograph(layout, HAT_CRASH);
  }

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
      // Nunca son null: los dos patrones tienen golpes escritos aqui al lado.
      melody: strokePose(this.melodyStrokes, seconds, 0)!,
      expression: strokePose(this.expressionStrokes, seconds, Math.PI)!,
    };
  }
}
