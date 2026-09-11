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
const THUMB_CMC: Vec = { x: -0.3, y: 0.16 };

interface FingerDef {
  base: Vec;
  /** Longitud de las tres falanges, en palmos. */
  lengths: readonly [number, number, number];
  /** Angulo absoluto de cada falange con la mano abierta, en grados. */
  open: readonly [number, number, number];
  /** Lo mismo con la pinza cerrada del todo. */
  closed: readonly [number, number, number];
}

/**
 * Corazon, anular y menique. No hacen la pinza, pero se recogen un poco con
 * ella: es lo que hacen solos al pellizcar, y dejarlos tiesos da una mano de
 * maniqui.
 */
const RESTING: readonly FingerDef[] = [
  { base: MIDDLE_MCP, lengths: [0.45, 0.27, 0.21], open: [90, 86, 83], closed: [93, 62, 40] },
  { base: RING_MCP, lengths: [0.42, 0.25, 0.2], open: [85, 81, 78], closed: [87, 57, 34] },
  { base: PINKY_MCP, lengths: [0.33, 0.2, 0.17], open: [78, 74, 70], closed: [80, 52, 28] },
];

/** Falange de arranque del indice: sale del nudillo y gira poco al cerrarse. */
const INDEX_PROXIMAL = { length: 0.42, open: 97, closed: 112 };
/** Las dos falanges que quedan hasta la punta. */
const INDEX_DISTAL: readonly [number, number] = [0.25, 0.2];

/** Lo mismo para el pulgar, desde el nudillo de la base. */
const THUMB_PROXIMAL = { length: 0.38, open: 138, closed: 122 };
const THUMB_DISTAL: readonly [number, number] = [0.36, 0.3];

/**
 * Donde se encuentran las dos puntas, segun lo abierta que este la pinza.
 *
 * Sube al abrirse porque al estirar el indice la punta se va hacia arriba; y no
 * sube mas porque el pulgar tiene el alcance que tiene y una pinza que se
 * encuentre por encima de esto no la hace ninguna mano.
 */
const MEET_CLOSED: Vec = { x: -0.52, y: 1.0 };
const MEET_OPEN: Vec = { x: -0.48, y: 1.32 };

/** Eje de la pinza: el indice queda de este lado, el pulgar del contrario. */
const PINCH_AXIS: Vec = { x: 0.18, y: 0.98 };

/**
 * Cuanto se quedan los huesos de un dedo doblado, vistos de frente.
 *
 * No es una licencia: un dedo que se cierra se va hacia la palma, que es hacia
 * la camara, y en la imagen se acorta. Sin esto, el doblez tiene que salir todo
 * de lado y el indice pinzado se dibuja como un garabato en vez de como un dedo.
 */
const FORESHORTEN = 0.72;

/** Pinza a la que la mano se ve abierta del todo, y a la que se ve cerrada. */
const LOOK_OPEN = 0.9;
const LOOK_CLOSED = 0.1;

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

/** Cadena de tres falanges hacia delante, con las longitudes intactas. */
function chain(def: FingerDef, curl: number): Vec[] {
  const out: Vec[] = [];
  let point = def.base;
  for (let i = 0; i < 3; i += 1) {
    const angle = lerp(def.open[i]!, def.closed[i]!, curl) * DEG;
    point = add(point, { x: Math.cos(angle) * def.lengths[i]!, y: Math.sin(angle) * def.lengths[i]! });
    out.push(point);
  }
  return out;
}

/**
 * El nudillo que falta entre dos puntos conocidos.
 *
 * El indice y el pulgar se construyen al reves que los demas: la punta esta
 * puesta de antemano, porque es lo que fija la pinza, y hay que averiguar por
 * donde pasa el nudillo de en medio. Son dos circunferencias que se cortan; de
 * los dos cortes se coge el del lado que pide `side`, que es el que dobla el
 * dedo hacia fuera de la palma. Si la punta queda mas lejos que los dos huesos
 * juntos, el dedo se estira en linea recta: pasa solo en poses que ninguna mano
 * hace, y es mejor una mano estirada que una raiz cuadrada de un negativo.
 */
function elbow(from: Vec, to: Vec, first: number, second: number, side: number): Vec {
  const delta = sub(to, from);
  const span = length(delta);
  if (span < 1e-6) return add(from, { x: 0, y: first });
  const direction = scaled(delta, 1 / span);
  if (span >= first + second) return add(from, scaled(direction, first));
  // Escorzo. Un dedo que se dobla lo hace hacia la palma, o sea hacia la camara,
  // y de frente eso no se ve como un codo que sobresale sino como un dedo mas
  // corto. Acortar los dos huesos antes de resolver deja el doblez donde la vista
  // lo pone: poco de lado y mucho hacia dentro.
  const shrink = Math.max(FORESHORTEN, span / (first + second));
  const a = first * shrink;
  const b = second * shrink;
  const along = (a * a - b * b + span * span) / (2 * span);
  const across = Math.sqrt(Math.max(0, a * a - along * along));
  return {
    x: from.x + direction.x * along - direction.y * across * side,
    y: from.y + direction.y * along + direction.x * across * side,
  };
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

  const indexAngle = lerp(INDEX_PROXIMAL.open, INDEX_PROXIMAL.closed, curl) * DEG;
  const indexPip = add(INDEX_MCP, {
    x: Math.cos(indexAngle) * INDEX_PROXIMAL.length,
    y: Math.sin(indexAngle) * INDEX_PROXIMAL.length,
  });
  const indexDip = elbow(indexPip, indexTip, INDEX_DISTAL[0], INDEX_DISTAL[1], -1);

  const thumbAngle = lerp(THUMB_PROXIMAL.open, THUMB_PROXIMAL.closed, curl) * DEG;
  const thumbMcp = add(THUMB_CMC, {
    x: Math.cos(thumbAngle) * THUMB_PROXIMAL.length,
    y: Math.sin(thumbAngle) * THUMB_PROXIMAL.length,
  });
  const thumbIp = elbow(thumbMcp, thumbTip, THUMB_DISTAL[0], THUMB_DISTAL[1], 1);

  const hand: Vec[] = [
    WRIST,
    THUMB_CMC,
    thumbMcp,
    thumbIp,
    thumbTip,
    INDEX_MCP,
    indexPip,
    indexDip,
    indexTip,
    MIDDLE_MCP,
    ...chain(RESTING[0]!, curl),
    RING_MCP,
    ...chain(RESTING[1]!, curl),
    PINKY_MCP,
    ...chain(RESTING[2]!, curl),
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
