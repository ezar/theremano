import { describe, expect, it } from 'vitest';
import { HOLD_CLOSE, HOLD_OPEN, HOLD_SECONDS, HoldGesture } from '../src/mapping/holdGesture';
import { attackVelocity, depthFromSize } from '../src/mapping/features';
import { ClosingSpeed, VELOCITY_WINDOW } from '../src/mapping/closingSpeed';
import { handSpan, palmSize } from '../src/mapping/features';
import { makeHand } from './helpers';
import type { Landmark } from '../src/tracking/types';

/**
 * Los tres gestos nuevos, cada uno por su lado y sin manos.
 *
 * El del bucle es el unico de los tres que dispara una accion, y por eso es el
 * que mas se comprueba: un falso positivo aqui no es un pixel mal puesto, es una
 * grabacion que arranca sola en mitad de lo que estabas tocando.
 */

const FPS = 60;
const DT = 1 / FPS;

/**
 * Gira la mano en el mundo, no en el espacio normalizado.
 *
 * Que es lo que pasa de verdad: la mano gira delante de la camara y el
 * resultado se vuelve a normalizar por ancho y por alto, que son distintos.
 */
function rotateInFrame(hand: readonly Landmark[], angle: number, aspect: number): Landmark[] {
  const cx = 0.5;
  const cy = 0.5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return hand.map((p) => {
    // A unidades del mundo: la x normalizada cubre `aspect` veces mas que la y.
    const x = (p.x - cx) * aspect;
    const y = p.y - cy;
    return { x: cx + (x * cos - y * sin) / aspect, y: cy + (x * sin + y * cos), z: 0 };
  });
}

/**
 * Sostiene el gesto durante unos segundos. @returns los disparos.
 *
 * El indice se deja lejos por defecto, que es donde esta cuando el pulgar va de
 * verdad a por el corazon: el gesto exige que el corazon quede claramente mas
 * cerca que el indice.
 */
function hold(gesture: HoldGesture, middle: number, seconds: number, index = 1): number {
  let fires = 0;
  for (let i = 0; i < Math.round(seconds * FPS); i += 1) {
    if (gesture.update(middle, index, DT)) fires += 1;
  }
  return fires;
}

describe('gesto de grabar', () => {
  it('dispara una sola vez, y solo despues de mantenerlo', () => {
    const gesture = new HoldGesture();
    // Justo antes de cumplirse el tiempo todavia no.
    expect(hold(gesture, 0.1, HOLD_SECONDS * 0.9)).toBe(0);
    expect(gesture.progress).toBeGreaterThan(0.8);
    expect(gesture.progress).toBeLessThan(1);

    expect(hold(gesture, 0.1, 0.2)).toBe(1);
    // Y aunque se siga aguantando cinco segundos, no vuelve a dispararse.
    expect(hold(gesture, 0.1, 5)).toBe(0);
  });

  it('un roce al pasar entre dedos no cuenta', () => {
    const gesture = new HoldGesture();
    for (let i = 0; i < 6; i += 1) {
      expect(hold(gesture, 0.1, HOLD_SECONDS * 0.5)).toBe(0);
      hold(gesture, 1, 0.2);
    }
  });

  it('hay que abrir la mano para poder volver a pedir un bucle', () => {
    const gesture = new HoldGesture();
    expect(hold(gesture, 0.1, HOLD_SECONDS + 0.1)).toBe(1);
    // Aflojar hasta la banda muerta no rearma: eso es un temblor, no soltar.
    hold(gesture, (HOLD_CLOSE + HOLD_OPEN) / 2, 0.5);
    expect(hold(gesture, 0.1, HOLD_SECONDS + 0.1)).toBe(0);

    hold(gesture, HOLD_OPEN + 0.1, 0.1);
    expect(hold(gesture, 0.1, HOLD_SECONDS + 0.1)).toBe(1);
  });

  it('la banda muerta conserva lo que se lleva sostenido', () => {
    const gesture = new HoldGesture();
    hold(gesture, 0.1, HOLD_SECONDS * 0.8);
    const before = gesture.progress;
    // Un temblor en el umbral no puede obligar a empezar la cuenta de nuevo.
    hold(gesture, (HOLD_CLOSE + HOLD_OPEN) / 2, 0.3);
    expect(gesture.progress).toBe(before);
    expect(hold(gesture, 0.1, HOLD_SECONDS * 0.3)).toBe(1);
  });

  it('perder la mano cancela lo que llevara sostenido', () => {
    const gesture = new HoldGesture();
    hold(gesture, 0.1, HOLD_SECONDS * 0.9);
    gesture.reset();
    expect(gesture.progress).toBe(0);
    expect(gesture.engaged).toBe(false);
    expect(hold(gesture, 0.1, HOLD_SECONDS * 0.5)).toBe(0);
  });

  it('avisa de que esta en marcha antes de disparar', () => {
    // Es lo que mira el mapeador para no cambiar de timbre mientras tanto.
    const gesture = new HoldGesture();
    expect(gesture.engaged).toBe(false);
    hold(gesture, 0.1, 0.05);
    expect(gesture.engaged).toBe(true);
  });
});

describe('una pinza normal no pide un bucle', () => {
  /**
   * El caso que se colaba. En una mano de verdad, las puntas del indice y del
   * corazon estan a un quinto del tamano de la mano una de otra, asi que el
   * pulgar posado en el indice queda tambien por debajo del umbral del corazon.
   * Sin el margen, tocar con la mano de expresion grababa una capa sola.
   */
  it('el pulgar en el indice no cuenta, aunque el corazon quede cerca', () => {
    const gesture = new HoldGesture();
    // Pulgar pegado al indice; el corazon, al lado, queda a 0,2 del pulgar.
    expect(hold(gesture, 0.2, 3, 0.12)).toBe(0);
    expect(gesture.engaged, 'ni siquiera se pone en marcha').toBe(false);
  });

  it('el pulgar en el corazon si cuenta, con el indice donde suele estar', () => {
    const gesture = new HoldGesture();
    expect(hold(gesture, 0.12, HOLD_SECONDS + 0.1, 0.55)).toBe(1);
  });

  it('un pulgar a medio camino entre los dos no decide nada', () => {
    const gesture = new HoldGesture();
    expect(hold(gesture, 0.25, 3, 0.3)).toBe(0);
  });
});

describe('velocidad de cierre', () => {
  it('mide lo mismo a treinta que a sesenta fotogramas', () => {
    // Es la razon de medir en una ventana de tiempo y no entre dos fotogramas:
    // el mismo gesto no puede dar dos fuerzas segun lo cargado que vaya el
    // telefono.
    const speeds = [30, 60, 120].map((fps) => {
      const meter = new ClosingSpeed();
      for (let i = 0; i <= fps * 0.4; i += 1) {
        const t = i / fps;
        meter.push(t, Math.max(0.1, 0.9 - t * 2));
      }
      return meter.speed;
    });
    for (const speed of speeds) expect(speed).toBeCloseTo(speeds[0]!, 2);
    expect(speeds[0]).toBeCloseTo(2, 1);
  });

  it('no le afecta lo que pasara antes de la ventana', () => {
    const meter = new ClosingSpeed();
    // Un cierre rapidisimo, y luego medio segundo quieto: el ataque llega
    // despues, y lo que se mide es lo que hay dentro de la ventana.
    meter.push(0, 1);
    meter.push(0.02, 0.1);
    for (let t = 0.04; t <= 0.6; t += 0.02) meter.push(t, 0.1);
    expect(meter.speed).toBeCloseTo(0, 1);
  });

  it('sin dos muestras separadas no opina', () => {
    const meter = new ClosingSpeed();
    expect(meter.speed).toBe(0);
    meter.push(1, 0.5);
    expect(meter.speed).toBe(0);
    meter.push(1, 0.1);
    expect(meter.speed, 'dos muestras en el mismo instante no son velocidad').toBe(0);
  });

  it('la ventana se poda pero nunca se queda sin ancla', () => {
    const meter = new ClosingSpeed();
    for (let t = 0; t <= 5; t += 1 / 60) meter.push(t, 0.5);
    expect(meter.speed).toBe(0);
    // Y sigue midiendo despues de podar cinco segundos de muestras.
    for (let t = 5; t <= 5.2; t += 1 / 60) meter.push(t, 0.5 - (t - 5));
    expect(meter.speed).toBeGreaterThan(0.5);
    expect(VELOCITY_WINDOW).toBeGreaterThan(0.05);
  });
});

describe('tamano de la mano', () => {
  /**
   * El fallo que tenia la primera version: medir la distancia muneca-nudillo.
   *
   * Los puntos vienen normalizados por ancho en x y por alto en y, que en 16:9
   * no son la misma unidad. Una distancia en ese espacio cambia al girar la
   * mano aunque la mano no se haya movido ni un centimetro, y girar la muneca
   * bastaba para recorrer el rango entero de la profundidad. Un area no: esa
   * normalizacion multiplica todas las areas por el mismo factor, gire lo que
   * gire.
   */
  it('no cambia al girar la muneca, aunque la distancia si', () => {
    const hand = makeHand(0.5, 0.5);
    const turned = rotateInFrame(hand, Math.PI / 2, 16 / 9);

    const sizeBefore = palmSize(hand);
    const sizeAfter = palmSize(turned);
    expect(sizeAfter / sizeBefore).toBeCloseTo(1, 2);

    // Y la medida vieja, para que quede constancia de por que se cambio.
    const spanRatio = handSpan(turned) / handSpan(hand);
    expect(Math.abs(spanRatio - 1)).toBeGreaterThan(0.3);
  });

  it('crece con la mano, que es para lo que sirve', () => {
    const small = palmSize(makeHand(0.5, 0.5, { scale: 0.12 }));
    const big = palmSize(makeHand(0.5, 0.5, { scale: 0.3 }));
    expect(big).toBeGreaterThan(small * 2);
  });
});

describe('distancia a la camara', () => {
  it('crece al acercarse y se queda en los bordes', () => {
    const near = depthFromSize(0.17);
    const far = depthFromSize(0.06);
    expect(far).toBe(0);
    expect(near).toBe(1);
    expect(depthFromSize(0.3)).toBe(1);
    expect(depthFromSize(0.01)).toBe(0);
    expect(depthFromSize(0.11)).toBeGreaterThan(far);
    expect(depthFromSize(0.11)).toBeLessThan(near);
  });

  it('una mano a distancia de trabajo deja sitio para los dos lados', () => {
    // Si el valor de reposo quedara pegado a un extremo, la mitad del gesto no
    // existiria: solo se podria acercar, o solo alejar.
    const resting = depthFromSize(0.102);
    expect(resting).toBeGreaterThan(0.2);
    expect(resting).toBeLessThan(0.8);
  });
});

describe('fuerza del ataque', () => {
  it('cuanto mas rapido se cierra la pinza, mas entra la nota', () => {
    const slow = attackVelocity(0.5);
    const medium = attackVelocity(3);
    const fast = attackVelocity(8);
    expect(slow).toBeLessThan(medium);
    expect(medium).toBeLessThan(fast);
    expect(fast).toBe(1);
  });

  it('una nota suave sigue siendo una nota', () => {
    // El suelo no es cero: una nota que no suena porque se cerro despacio se lee
    // como un fallo del instrumento, no como un matiz.
    expect(attackVelocity(0)).toBeGreaterThan(0.5);
    expect(attackVelocity(-5)).toBe(attackVelocity(0));
  });

  it('nunca se pasa de uno, pase lo que pase con el detector', () => {
    for (const speed of [0, 1, 10, 100, 1e6]) {
      expect(attackVelocity(speed)).toBeLessThanOrEqual(1);
      expect(attackVelocity(speed)).toBeGreaterThan(0);
    }
  });
});
