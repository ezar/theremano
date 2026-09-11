import type { Landmark } from './types';

/**
 * Una mano dibujada, no detectada.
 *
 * Existe para la demostracion: el instrumento se toca solo y hay que ensenar
 * como se mueve la mano para tocarlo. La alternativa era grabar un video y
 * meterlo en el paquete, con todo lo que eso trae —pesa, envejece, no sabe en
 * que escala esta el instrumento y habria que regrabarlo cada vez que cambia
 * algo de la pantalla—. Con veintiun puntos puestos a mano, la demostracion
 * pasa por el mismo mapeador y el mismo overlay que una mano de verdad: lo que
 * se ve es exactamente lo que veria quien toca.
 *
 * La mano se describe en un espacio propio, con la muneca en el origen, los
 * dedos hacia arriba y la unidad igual al palmo —de la muneca a la base del
 * corazon—. Solo al final se lleva al encuadre, y ahi la x se divide por la
 * proporcion: los puntos normalizados dividen x por el ancho e y por el alto,
 * asi que una mano con la misma extension en las dos saldria ensanchada.
 *
 * La pinza se construye al reves que el resto. En vez de doblar los dedos y ver
 * que distancia queda, se decide primero donde se encuentran las dos puntas y a
 * que distancia estan, y despues se rellenan los nudillos que faltan. Es la
 * unica forma de que la pose de 0,2 abra la nota y la de 0,5 no la abra,
 * pasando por el mismo gate que una mano de verdad y sin depender de la
 * proporcion de la ventana.
 *
 * Los cinco dedos se dibujan igual: un arco desde el nudillo hasta la punta, con
 * los nudillos de en medio repartidos por longitud de hueso. Es lo que hace que
 * la mano parezca una mano. La primera version doblaba cada falange por su
 * angulo y resolvia el indice con dos circunferencias, y salia un garabato: el
 * codo del indice saltaba de un lado a otro —un rayo en vez de un dedo— y los
 * demas dedos se torcian hacia el menique como un rastrillo. Un dedo que se
 * cierra va hacia la palma, que es hacia la camara, y de frente eso se ve como
 * un dedo mas corto y algo arqueado, no como un dedo que se tuerce de lado.
 */

const DEG = Math.PI / 180;

interface Vec {
  x: number;
  y: number;
}

/** Puntos de la palma, en espacio de mano. */
const WRIST: Vec = { x: 0, y: 0 };
const INDEX_MCP: Vec = { x: -0.36, y: 0.88 };
const MIDDLE_MCP: Vec = { x: 0, y: 1 };
const RING_MCP: Vec = { x: 0.3, y: 0.95 };
const PINKY_MCP: Vec = { x: 0.56, y: 0.82 };
const THUMB_CMC: Vec = { x: -0.3, y: 0.24 };

interface FingerDef {
  base: Vec;
  /** Longitud de las tres falanges, en palmos. */
  lengths: readonly [number, number, number];
  /** Hacia donde apunta el dedo estirado, en grados. */
  angle: number;
  /**
   * Cuanto queda del dedo, visto de frente, cuando la mano se recoge del todo.
   *
   * Un dedo que se cierra va hacia la palma, o sea hacia la camara, y de frente
   * eso se ve como un dedo mas corto, no como un dedo que se tuerce de lado. La
   * primera version los doblaba girando cada falange y quedaban apuntando al
   * menique, como un rastrillo.
   */
  retract: number;
}

/**
 * Corazon, anular y menique. No hacen la pinza, pero se recogen con ella: es lo
 * que hacen solos al pellizcar, y dejarlos tiesos da una mano de maniqui.
 */
const RESTING: readonly FingerDef[] = [
  { base: MIDDLE_MCP, lengths: [0.45, 0.27, 0.21], angle: 88, retract: 0.62 },
  { base: RING_MCP, lengths: [0.42, 0.25, 0.2], angle: 83, retract: 0.6 },
  { base: PINKY_MCP, lengths: [0.33, 0.2, 0.17], angle: 76, retract: 0.58 },
];

/** Lo que se cierra el abanico de los dedos al recogerse la mano. */
const RESTING_TURN = 14;

/** Las tres falanges del indice, desde el nudillo hasta la punta. */
const INDEX_BONES: readonly number[] = [0.42, 0.25, 0.2];
/** Las del pulgar, desde el nudillo de la base. */
const THUMB_BONES: readonly number[] = [0.36, 0.34, 0.3];

/**
 * Donde se encuentran las dos puntas, segun lo abierta que este la pinza.
 *
 * Sube al abrirse porque al estirar el indice la punta se va hacia arriba, y
 * tiene que subir bastante: con el encuentro demasiado bajo, el indice queda
 * doblado incluso con la pinza abierta del todo y se dibuja como un gancho.
 * Tampoco puede subir mas, porque el pulgar tiene el alcance que tiene y una
 * pinza que se encuentre por encima de esto no la hace ninguna mano.
 */
const MEET_CLOSED: Vec = { x: -0.56, y: 1.16 };
const MEET_OPEN: Vec = { x: -0.5, y: 1.4 };

/** Eje de la pinza: el indice queda de este lado, el pulgar del contrario. */
const PINCH_AXIS: Vec = { x: 0.18, y: 0.98 };

/** Cuanto se abre el arco de un dedo doblado, por unidad de hueso sobrante. */
const BOW = 0.55;

/**
 * El recorrido de pinza que de verdad se usa al tocar.
 *
 * La mano se dibuja abierta del todo en el extremo de arriba y cerrada del todo
 * en el de abajo, asi que estos dos numeros tienen que ser los de tocar y no los
 * de un gesto cualquiera: la banda muerta del gate —de 0,30 a 0,42— cae dentro.
 * Con un extremo superior mucho mas alto, la pose abierta salia con el indice ya
 * doblado, que es lo que hace la pinza antes de tocar y no lo que hace la mano
 * mientras viaja.
 */
const LOOK_OPEN = 0.55;
const LOOK_CLOSED = 0.12;

/**
 * Tamano de palma de una mano a distancia de trabajo.
 *
 * Es el valor alrededor del cual estan puestos los extremos de la profundidad,
 * asi que una mano de demostracion de este tamano deja sitio a los dos lados en
 * vez de salir con el espacio del sonido pegado a un extremo.
 */
const WORKING_PALM = 0.105;

/** Area del triangulo de la palma en espacio de mano. */
const PALM_AREA =
  Math.abs(
    (INDEX_MCP.x - WRIST.x) * (PINKY_MCP.y - WRIST.y) - (PINKY_MCP.x - WRIST.x) * (INDEX_MCP.y - WRIST.y),
  ) / 2;

/**
 * Palmo que hay que usar para que la mano se vea del tamano de una mano.
 *
 * Depende de la proporcion del encuadre, y no por capricho: al normalizar, un
 * encuadre vertical reparte la misma mano sobre mas alto, de modo que ocupa
 * menos fraccion de alto. Se despeja del area, que es la medida de tamano que
 * no cambia al girar la mano.
 */
export function phantomScale(aspect: number): number {
  return WORKING_PALM / Math.sqrt(PALM_AREA / Math.max(aspect, 1e-3));
}

export interface PhantomPose {
  /** Centro de la palma en espacio de vista: 0 a 1 sobre el encuadre. */
  x: number;
  y: number;
  /** Distancia pulgar-indice normalizada. La misma magnitud que lee el gate. */
  pinch: number;
  /** Ancho partido por alto del encuadre. */
  aspect: number;
  /** Ladeo de la mano, en radianes. Para que no parezca una pegatina. */
  tilt?: number;
  /** Palmo en fracciones de alto. Por defecto, el de una mano de verdad. */
  scale?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scaled = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const length = (a: Vec): number => Math.hypot(a.x, a.y);

/** Los tres nudillos de un dedo que no hace la pinza. */
function restingFinger(def: FingerDef, curl: number): Vec[] {
  const total = def.lengths.reduce((sum, l) => sum + l, 0);
  // Estirado no llega a estar recto del todo: un dedo tieso del todo es un dedo
  // que senala, no un dedo que toca.
  const reach = total * lerp(0.97, def.retract, curl);
  const angle = (def.angle - RESTING_TURN * curl) * DEG;
  const tip = add(def.base, { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
  return bowed(def.base, tip, def.lengths, -1);
}

/**
 * Los nudillos que faltan entre dos puntos conocidos.
 *
 * El indice y el pulgar se construyen al reves que los demas: la punta esta
 * puesta de antemano, porque es lo que fija la pinza, y hay que averiguar por
 * donde pasan los nudillos de en medio. Se colocan sobre un arco, repartidos por
 * longitud de hueso, y el arco se abre justo lo que sobra de dedo: estirado sale
 * una recta, recogido sale una curva.
 *
 * Es a proposito que los huesos se acorten al doblarse. Un dedo que se cierra va
 * hacia la palma, o sea hacia la camara, y de frente eso no se ve como un codo
 * que sobresale sino como un dedo mas corto. La primera version resolvia dos
 * circunferencias para conservar la longitud exacta, y el resultado era un
 * garabato: el codo saltaba de un lado a otro y el indice se dibujaba como un
 * rayo en vez de como un dedo.
 */
function bowed(from: Vec, to: Vec, lengths: readonly number[], side: number): Vec[] {
  const total = lengths.reduce((sum, l) => sum + l, 0);
  const delta = sub(to, from);
  const span = length(delta) || 1e-6;
  const slack = Math.max(0, total - span);
  const bow = (slack * BOW) * side;
  const control = {
    x: (from.x + to.x) / 2 - (delta.y / span) * bow,
    y: (from.y + to.y) / 2 + (delta.x / span) * bow,
  };
  const at = (u: number): Vec => ({
    x: (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * control.x + u * u * to.x,
    y: (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * control.y + u * u * to.y,
  });

  const out: Vec[] = [];
  let walked = 0;
  for (let i = 0; i < lengths.length - 1; i += 1) {
    walked += lengths[i]!;
    out.push(at(walked / total));
  }
  out.push(to);
  return out;
}

/**
 * Los veintiun puntos, en el orden de MediaPipe y en espacio de vista.
 */
export function phantomHand(pose: PhantomPose): Landmark[] {
  const aspect = pose.aspect > 0 ? pose.aspect : 1;
  const scale = pose.scale ?? phantomScale(aspect);
  const tilt = pose.tilt ?? 0;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);

  // Del espacio de mano al del encuadre: giro, escala, la x comprimida por la
  // proporcion y la y del reves, porque en la imagen crece hacia abajo.
  const toView = (p: Vec): Vec => ({
    x: ((p.x * cos - p.y * sin) * scale) / aspect,
    y: -(p.x * sin + p.y * cos) * scale,
  });
  // Y la vuelta, que hace falta para colocar las puntas: la distancia entre
  // ellas se mide en el encuadre, pero los dedos se doblan en espacio de mano.
  const toHand = (p: Vec): Vec => {
    const x = (p.x * aspect) / scale;
    const y = -p.y / scale;
    return { x: x * cos + y * sin, y: -x * sin + y * cos };
  };

  const curl = clamp01((LOOK_OPEN - pose.pinch) / (LOOK_OPEN - LOOK_CLOSED));

  // Palmo tal y como se mide en el encuadre. Con la mano ladeada no es el mismo
  // numero que la escala, porque la x va comprimida: hay que medirlo, no suponerlo.
  const span = length(toView(sub(MIDDLE_MCP, WRIST)));
  const axis = toView(PINCH_AXIS);
  const half = toHand(scaled(axis, (pose.pinch * span) / (2 * length(axis))));
  const meet: Vec = {
    x: lerp(MEET_CLOSED.x, MEET_OPEN.x, 1 - curl),
    y: lerp(MEET_CLOSED.y, MEET_OPEN.y, 1 - curl),
  };

  const indexTip = add(meet, half);
  const thumbTip = sub(meet, half);

  // El indice se arquea hacia el lado del corazon, que es como se recoge un dedo
  // de verdad: el nudillo de en medio se queda arriba y la punta baja a buscar al
  // pulgar. El pulgar se arquea al contrario, hacia fuera de la palma.
  const index = bowed(INDEX_MCP, indexTip, INDEX_BONES, -1);
  const thumb = bowed(THUMB_CMC, thumbTip, THUMB_BONES, 1);

  const hand: Vec[] = [
    WRIST,
    THUMB_CMC,
    thumb[0]!,
    thumb[1]!,
    thumb[2]!,
    INDEX_MCP,
    index[0]!,
    index[1]!,
    index[2]!,
    MIDDLE_MCP,
    ...restingFinger(RESTING[0]!, curl),
    RING_MCP,
    ...restingFinger(RESTING[1]!, curl),
    PINKY_MCP,
    ...restingFinger(RESTING[2]!, curl),
  ];

  const view = hand.map(toView);
  // La palma se centra donde pide la pose: es el punto que lee el mapeador para
  // saber en que nota esta la mano, asi que tiene que caer exactamente ahi.
  const center = {
    x: (view[0]!.x + view[5]!.x + view[17]!.x) / 3,
    y: (view[0]!.y + view[5]!.y + view[17]!.y) / 3,
  };
  return view.map((p) => ({ x: p.x - center.x + pose.x, y: p.y - center.y + pose.y, z: 0 }));
}
