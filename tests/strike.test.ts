import { describe, expect, it } from 'vitest';
import { REFRACTORY, SOFTEST, StrikeDetector, TRIGGER } from '../src/mapping/strike';
import { gaussian, mulberry32 } from './helpers';

/**
 * El golpe en el aire.
 *
 * Lo que se mide aqui no es si detecta el golpe —eso es lo facil— sino cuando.
 * Una nota sostenida perdona ochenta milisegundos; un golpe de percusion no. La
 * prueba que importa es la del adelanto: el golpe tiene que sonar mientras la
 * mano todavia baja, no cuando llega abajo, porque ese trayecto que queda es
 * retraso que se suma al de la camara.
 */

const FPS = 60;

/**
 * Una mano que baja y vuelve a subir, como sobre un parche.
 *
 * @param depth cuanto recorre, en alturas de encuadre.
 * @param seconds lo que tarda en bajar y volver.
 * @returns los instantes en que sono un golpe, y con cuanta fuerza.
 */
function stroke(options: {
  depth?: number;
  seconds?: number;
  fps?: number;
  from?: number;
  strokes?: number;
  noise?: number;
}): { fired: Array<{ t: number; force: number }>; bottom: number; detector: StrikeDetector } {
  const depth = options.depth ?? 0.3;
  const seconds = options.seconds ?? 0.34;
  const fps = options.fps ?? FPS;
  const from = options.from ?? 0.35;
  const strokes = options.strokes ?? 1;
  const random = mulberry32(11);
  const detector = new StrikeDetector();
  const fired: Array<{ t: number; force: number }> = [];
  let bottom = 0;
  let lowest = -1;

  const total = seconds * strokes + 0.2;
  for (let frame = 0; frame <= total * fps; frame += 1) {
    const t = frame / fps;
    /*
     * Una mano que arranca parada, acelera, frena al llegar abajo y vuelve. La
     * primera version usaba media onda seno, que empieza ya a maxima velocidad:
     * el detector disparaba en el segundo fotograma y el adelanto que median las
     * pruebas era el de un movimiento que ninguna mano hace.
     */
    const phase = (t % seconds) / seconds;
    const swing = t < seconds * strokes ? (1 - Math.cos(phase * Math.PI * 2)) / 2 : 0;
    const noise = options.noise ? gaussian(random) * options.noise : 0;
    const y = from + depth * swing + noise;
    if (y > lowest && t < seconds) {
      lowest = y;
      bottom = t;
    }
    const force = detector.push(t, y);
    if (force > 0) fired.push({ t, force });
  }
  return { fired, bottom, detector };
}

describe('golpe en el aire', () => {
  it('un golpe suena una sola vez', () => {
    const { fired } = stroke({});
    expect(fired).toHaveLength(1);
  });

  it.each([
    { depth: 0.2, seconds: 0.5, nombre: 'flojo y largo' },
    { depth: 0.3, seconds: 0.34, nombre: 'normal' },
    { depth: 0.45, seconds: 0.24, nombre: 'seco' },
  ])('suena mientras la mano baja y no cuando llega abajo ($nombre)', ({ depth, seconds }) => {
    /*
     * Es la razon de ser del detector, y la unica cifra que decide si un modo
     * bateria es viable: lo que se adelanta aqui es lo que se le resta al
     * retraso de la camara, que ronda los sesenta milisegundos y no lo quita
     * ningun codigo. Por debajo de ese adelanto, el golpe se oye tarde.
     */
    const { fired, bottom } = stroke({ depth, seconds });
    expect(fired).toHaveLength(1);
    const anticipation = bottom - fired[0]!.t;
    expect(anticipation, 'adelanto sobre el final del trayecto').toBeGreaterThanOrEqual(0.06);
    expect(anticipation, 'pero no antes de empezar a bajar').toBeLessThan(bottom);
  });

  it('el golpe mas seco no es el que suena mas flojo', () => {
    // Lo que pasaba sin exigir un minimo de historia: un golpe fuerte cruza el
    // umbral en el segundo fotograma, cuando todavia no hay con que medirlo, y
    // salia con la fuerza minima. Al reves de lo que se acaba de hacer.
    const dry = stroke({ depth: 0.45, seconds: 0.24 }).fired[0]!.force;
    const gentle = stroke({ depth: 0.2, seconds: 0.5 }).fired[0]!.force;
    expect(dry).toBeGreaterThan(gentle + 0.2);
    expect(dry).toBeGreaterThan(0.85);
  });

  it('subir la mano no suena', () => {
    const detector = new StrikeDetector();
    let fired = 0;
    for (let frame = 0; frame <= FPS; frame += 1) {
      const t = frame / FPS;
      if (detector.push(t, 0.8 - t * 0.6) > 0) fired += 1;
    }
    expect(fired).toBe(0);
  });

  it('colocar la mano despacio no suena', () => {
    const detector = new StrikeDetector();
    let fired = 0;
    // Medio encuadre en un segundo: moverse, no golpear.
    for (let frame = 0; frame <= FPS; frame += 1) {
      const t = frame / FPS;
      if (detector.push(t, 0.2 + t * 0.5) > 0) fired += 1;
    }
    expect(fired).toBe(0);
  });

  it('el temblor de una mano quieta no suena', () => {
    const random = mulberry32(3);
    const detector = new StrikeDetector();
    let fired = 0;
    for (let frame = 0; frame <= FPS * 3; frame += 1) {
      const t = frame / FPS;
      if (detector.push(t, 0.5 + gaussian(random) * 0.004) > 0) fired += 1;
    }
    expect(fired).toBe(0);
  });

  it('tres golpes seguidos son tres', () => {
    const { fired } = stroke({ strokes: 3, seconds: 0.3 });
    expect(fired).toHaveLength(3);
    // Y ninguno cae encima del anterior: hay que volver a subir para el siguiente.
    for (let i = 1; i < fired.length; i += 1) {
      expect(fired[i]!.t - fired[i - 1]!.t).toBeGreaterThan(REFRACTORY);
    }
  });

  it('cuanto mas rapido baja, mas fuerte entra', () => {
    const soft = stroke({ depth: 0.2, seconds: 0.5 }).fired[0]!.force;
    const hard = stroke({ depth: 0.45, seconds: 0.2 }).fired[0]!.force;
    expect(soft).toBeGreaterThanOrEqual(SOFTEST);
    expect(soft).toBeLessThan(hard);
    expect(hard).toBeLessThanOrEqual(1);
  });

  it('un golpe flojo sigue siendo un golpe', () => {
    // El suelo no es cero: un golpe que no se oye se lee como un fallo.
    const { fired } = stroke({ depth: 0.16, seconds: 0.32 });
    expect(fired).toHaveLength(1);
    expect(fired[0]!.force).toBeGreaterThan(0.3);
  });

  it('suena igual a treinta que a sesenta fotogramas', () => {
    const slow = stroke({ fps: 30 });
    const fast = stroke({ fps: 60 });
    expect(slow.fired).toHaveLength(1);
    expect(fast.fired).toHaveLength(1);
    expect(Math.abs(slow.fired[0]!.t - fast.fired[0]!.t), 'el instante').toBeLessThan(0.04);
    expect(Math.abs(slow.fired[0]!.force - fast.fired[0]!.force), 'la fuerza').toBeLessThan(0.15);
  });

  it('con ruido de deteccion encima, sigue siendo un golpe y no cuatro', () => {
    const { fired } = stroke({ noise: 0.006 });
    expect(fired).toHaveLength(1);
  });

  it('perder la mano cancela lo que llevara', () => {
    const detector = new StrikeDetector();
    detector.push(0, 0.3);
    detector.push(0.05, 0.45);
    detector.reset();
    // Sin historia no hay velocidad que medir: el primer fotograma no dispara.
    expect(detector.push(0.1, 0.9)).toBe(0);
  });

  it('el umbral deja sitio a un golpe de verdad', () => {
    // No es una comprobacion de gusto: si alguien sube el umbral por encima de
    // lo que recorre una mano golpeando, el modo entero deja de responder.
    expect(TRIGGER).toBeLessThan(2);
    expect(TRIGGER).toBeGreaterThan(0.5);
  });
});
