import { LM, point, type Landmark } from '../tracking/types';

/**
 * Magnitudes de control extraidas de una mano.
 *
 * Todas las medidas se dividen por una referencia interna de la propia mano,
 * de modo que acercarse o alejarse de la camara no cambia el gesto. Sin eso,
 * la pinza se dispararia sola al alejar la mano.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Centro de la palma: media de muneca (0), base del indice (5) y base del
 * menique (17). Mucho mas estable que la muneca sola, que se bambolea con
 * cualquier giro del antebrazo.
 */
export function palmCenter(landmarks: readonly Landmark[]): Vec2 {
  const a = point(landmarks, LM.WRIST);
  const b = point(landmarks, LM.INDEX_MCP);
  const c = point(landmarks, LM.PINKY_MCP);
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Referencia de escala de la mano: muneca (0) a base del corazon (9). */
export function handSpan(landmarks: readonly Landmark[]): number {
  const span = distance(point(landmarks, LM.WRIST), point(landmarks, LM.MIDDLE_MCP));
  // Un span degenerado (mano de perfil, deteccion mala) haria explotar todas las
  // razones que dependen de el.
  return span > 1e-3 ? span : 1e-3;
}

/** Distancia pulgar-indice normalizada. Es la senal del gate. */
export function pinchRatio(landmarks: readonly Landmark[]): number {
  return distance(point(landmarks, LM.THUMB_TIP), point(landmarks, LM.INDEX_TIP)) / handSpan(landmarks);
}

/**
 * Distancia pulgar-corazon normalizada. Es la senal del gesto de grabar.
 *
 * Se usa el corazon y no otro dedo porque es el unico que se junta con el
 * pulgar sin arrastrar al indice: con el anular o el menique, la mano entera
 * se cierra y el gesto se confunde con un puno.
 */
export function middlePinchRatio(landmarks: readonly Landmark[]): number {
  return distance(point(landmarks, LM.THUMB_TIP), point(landmarks, LM.MIDDLE_TIP)) / handSpan(landmarks);
}

/**
 * Cerca o lejos de la camara, de 0 a 1.
 *
 * Sale del tamano aparente de la mano, que ya se calcula para normalizar la
 * pinza: acercarse agranda la mano en el encuadre. No es una medida de
 * profundidad de verdad —el modelo da una z, pero es relativa a la propia mano y
 * no sirve para esto—, es la unica senal de distancia estable que hay aqui.
 *
 * Los dos extremos estan puestos alrededor de una mano a distancia de trabajo,
 * que mide unos 0,15 de la altura del encuadre. Quedan sitio para acercarse y
 * para alejarse sin llegar a saturar en ninguno de los dos lados.
 */
const SPAN_FAR = 0.09;
const SPAN_NEAR = 0.26;

export function depthFromSpan(span: number): number {
  return clamp01((span - SPAN_FAR) / (SPAN_NEAR - SPAN_FAR));
}

/**
 * Fuerza del ataque a partir de lo rapido que se cierra la pinza.
 *
 * Hasta ahora la dinamica venia entera de la otra mano, que es una mano que
 * puede no estar. Con esto, la mano que toca decide tambien cuanto entra la
 * nota, que es como se comporta cualquier instrumento: no es lo mismo posar los
 * dedos que dejarlos caer.
 *
 * El suelo no es cero a proposito. Una nota que no suena porque se cerro despacio
 * se lee como un fallo del instrumento, no como un matiz.
 */
const SLOW_CLOSE = 0.8;
const FAST_CLOSE = 6;
const SOFTEST = 0.62;

export function attackVelocity(closingSpeed: number): number {
  const t = clamp01((closingSpeed - SLOW_CLOSE) / (FAST_CLOSE - SLOW_CLOSE));
  return SOFTEST + (1 - SOFTEST) * t;
}

const FINGERS: ReadonlyArray<{ tip: number; pip: number }> = [
  { tip: LM.INDEX_TIP, pip: LM.INDEX_PIP },
  { tip: LM.MIDDLE_TIP, pip: LM.MIDDLE_PIP },
  { tip: LM.RING_TIP, pip: LM.RING_PIP },
  { tip: LM.PINKY_TIP, pip: LM.PINKY_PIP },
];

/**
 * Dedos extendidos, sin contar el pulgar: de 0 a 4.
 *
 * Un dedo esta extendido si su punta se aleja de la muneca mas que su segunda
 * falange. Al cerrarse, la punta vuelve hacia la palma y la razon cae por
 * debajo de 1. El margen del 8% evita que un dedo a medio doblar parpadee.
 */
export function countExtendedFingers(landmarks: readonly Landmark[]): number {
  const wrist = point(landmarks, LM.WRIST);
  let count = 0;
  for (const finger of FINGERS) {
    const tip = distance(point(landmarks, finger.tip), wrist);
    const pip = distance(point(landmarks, finger.pip), wrist);
    if (tip > pip * 1.08) count += 1;
  }
  return count;
}

export interface MelodyFeatures {
  /** 0 = borde izquierdo del encuadre, 1 = derecho, en espacio de vista. */
  x: number;
  /** 0 = arriba (brillante), 1 = abajo (oscuro). */
  y: number;
  pinch: number;
}

export interface ExpressionFeatures {
  /** 0 = arriba, 1 = abajo. */
  y: number;
  fingers: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Los bordes del encuadre son terreno poco fiable: la mano se sale y el modelo
 * extrapola. Se recorta un margen y se reescala, de modo que el rango util
 * completo se alcanza sin tener que pegar la mano al borde.
 */
const MARGIN = 0.08;

function normalize(v: number): number {
  return clamp01((v - MARGIN) / (1 - 2 * MARGIN));
}

/**
 * Inversa de la normalizacion. La necesita el overlay: la rejilla de la escala
 * tiene que dibujarse donde de verdad hay que poner la mano, no sobre el
 * encuadre completo.
 */
export function denormalize(v: number): number {
  return MARGIN + clamp01(v) * (1 - 2 * MARGIN);
}

export function melodyFeatures(landmarks: readonly Landmark[]): MelodyFeatures {
  const palm = palmCenter(landmarks);
  return { x: normalize(palm.x), y: normalize(palm.y), pinch: pinchRatio(landmarks) };
}

export function expressionFeatures(landmarks: readonly Landmark[]): ExpressionFeatures {
  const palm = palmCenter(landmarks);
  return { y: normalize(palm.y), fingers: countExtendedFingers(landmarks) };
}
