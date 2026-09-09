import type { Landmark } from '../src/tracking/types';

/** Generador reproducible: un test que falla una vez de cada diez no sirve. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Mano abierta y plana en una posicion dada, en coordenadas normalizadas.
 * Las proporciones estan sacadas de una deteccion real de MediaPipe, lo justo
 * para que las razones (span, pinza, dedos extendidos) tengan sentido.
 */
export function makeHand(cx: number, cy: number, options: { pinch?: number; fingers?: number; scale?: number } = {}): Landmark[] {
  const s = options.scale ?? 0.22;
  const pinch = options.pinch ?? 1;
  const fingers = options.fingers ?? 4;

  const p = (x: number, y: number): Landmark => ({ x: cx + x * s, y: cy + y * s, z: 0 });

  // Muneca abajo, dedos hacia arriba. y negativo = mas arriba en la imagen.
  const wrist = p(0, 0.5);
  const indexMcp = p(-0.28, -0.15);
  const middleMcp = p(-0.02, -0.2);
  const ringMcp = p(0.22, -0.15);
  const pinkyMcp = p(0.42, -0.05);

  // La pinza se modela acercando la punta del pulgar a la del indice. El valor
  // pedido es la razon dist(4,8)/dist(0,9), que es justo lo que mide el gate.
  const span = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
  const indexTip = p(-0.33, -0.75);
  const gap = pinch * span;
  const thumbTip: Landmark = { x: indexTip.x - gap, y: indexTip.y + gap * 0.25, z: 0 };

  const folded = (mcp: Landmark, pip: Landmark): Landmark => ({
    // Un dedo cerrado devuelve la punta hacia la palma: queda mas cerca de la
    // muneca que su segunda falange.
    x: mcp.x + (wrist.x - mcp.x) * 0.15,
    y: mcp.y + (wrist.y - mcp.y) * 0.35,
    z: 0,
  }) as Landmark & typeof pip;

  const finger = (mcp: Landmark, dx: number, extended: boolean) => {
    const pip = { x: mcp.x + dx * 0.2 * s, y: mcp.y - 0.25 * s, z: 0 };
    const dip = { x: mcp.x + dx * 0.3 * s, y: mcp.y - 0.42 * s, z: 0 };
    const tip = extended ? { x: mcp.x + dx * 0.35 * s, y: mcp.y - 0.55 * s, z: 0 } : folded(mcp, pip);
    return [pip, dip, tip];
  };

  const [ip2, id2, it2] = finger(indexMcp, -0.2, fingers >= 1);
  const [mp, md, mt] = finger(middleMcp, 0, fingers >= 2);
  const [rp, rd, rt] = finger(ringMcp, 0.2, fingers >= 3);
  const [pp, pd, pt] = finger(pinkyMcp, 0.4, fingers >= 4);

  return [
    wrist,
    p(0.18, 0.34), p(0.3, 0.16), p(0.36, 0.02), thumbTip,
    indexMcp, ip2!, id2!, fingers >= 1 ? indexTip : it2!,
    middleMcp, mp!, md!, mt!,
    ringMcp, rp!, rd!, rt!,
    pinkyMcp, pp!, pd!, pt!,
  ] as Landmark[];
}

/**
 * Acerca la punta del pulgar a la del corazon, que es la senal del gesto de
 * grabar. `makeHand` solo modela la pinza pulgar-indice, y este gesto va por
 * otro lado: sin esto habria que escribir veintiun puntos a mano.
 *
 * @param ratio distancia pedida, normalizada por el tamano de la mano.
 */
export function withMiddlePinch(hand: readonly Landmark[], ratio: number): Landmark[] {
  const out = hand.map((p) => ({ ...p }));
  const wrist = hand[0]!;
  const middleMcp = hand[9]!;
  const middleTip = hand[12]!;
  const span = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
  // Se acerca por debajo de la punta, que es por donde el pulgar llega de
  // verdad: hacia la muneca.
  const dx = wrist.x - middleTip.x;
  const dy = wrist.y - middleTip.y;
  const length = Math.hypot(dx, dy) || 1;
  out[4] = {
    x: middleTip.x + (dx / length) * ratio * span,
    y: middleTip.y + (dy / length) * ratio * span,
    z: 0,
  };
  return out as Landmark[];
}

/** Anade ruido independiente a cada punto, como hace el detector real. */
export function jitter(hand: readonly Landmark[], sigma: number, rand: () => number): Landmark[] {
  return hand.map((p) => ({ x: p.x + gaussian(rand) * sigma, y: p.y + gaussian(rand) * sigma, z: p.z }));
}

export function cents(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}
