import { describe, expect, it } from 'vitest';
import { HOLD_CLOSE, HOLD_OPEN, HOLD_SECONDS, HoldGesture } from '../src/mapping/holdGesture';
import { attackVelocity, depthFromSpan } from '../src/mapping/features';

/**
 * Los tres gestos nuevos, cada uno por su lado y sin manos.
 *
 * El del bucle es el unico de los tres que dispara una accion, y por eso es el
 * que mas se comprueba: un falso positivo aqui no es un pixel mal puesto, es una
 * grabacion que arranca sola en mitad de lo que estabas tocando.
 */

const FPS = 60;
const DT = 1 / FPS;

/** Sostiene una razon durante unos segundos. @returns los disparos. */
function hold(gesture: HoldGesture, ratio: number, seconds: number): number {
  let fires = 0;
  for (let i = 0; i < Math.round(seconds * FPS); i += 1) {
    if (gesture.update(ratio, DT)) fires += 1;
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

describe('distancia a la camara', () => {
  it('crece al acercarse y se queda en los bordes', () => {
    const near = depthFromSpan(0.26);
    const far = depthFromSpan(0.09);
    expect(far).toBe(0);
    expect(near).toBe(1);
    expect(depthFromSpan(0.4)).toBe(1);
    expect(depthFromSpan(0.01)).toBe(0);
    expect(depthFromSpan(0.175)).toBeGreaterThan(far);
    expect(depthFromSpan(0.175)).toBeLessThan(near);
  });

  it('una mano a distancia de trabajo deja sitio para los dos lados', () => {
    // Si el valor de reposo quedara pegado a un extremo, la mitad del gesto no
    // existiria: solo se podria acercar, o solo alejar.
    const resting = depthFromSpan(0.154);
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
