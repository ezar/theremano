import { describe, expect, it } from 'vitest';
import { RoleTracker, HOLD_MS } from '../src/tracking/handedness';
import type { HandFrame } from '../src/tracking/types';
import { makeHand } from './helpers';

function frame(cx: number, cy: number): HandFrame {
  return { landmarks: [], raw: makeHand(cx, cy) };
}

/** Distancia entre el centro de palma asignado y una posicion esperada. */
function nearX(hand: HandFrame | undefined, expected: number): boolean {
  if (!hand) return false;
  const wrist = hand.raw[0]!;
  return Math.abs(wrist.x - makeHand(expected, 0.5)[0]!.x) < 0.02;
}

describe('asignacion de roles', () => {
  it('con una sola mano, esa mano es la de melodia', () => {
    const tracker = new RoleTracker();
    const result = tracker.update([frame(0.4, 0.5)], 0);
    expect(result.melody).not.toBe(null);
    expect(result.expression).toBe(null);
  });

  it('mantiene el rol de cada mano mientras se mueven', () => {
    const tracker = new RoleTracker();
    let now = 0;
    tracker.update([frame(0.7, 0.5), frame(0.3, 0.5)], now);

    // La mano de melodia se desplaza; la de expresion apenas se mueve.
    for (let i = 1; i <= 20; i += 1) {
      now += 33;
      const melodyX = 0.7 - i * 0.012;
      const result = tracker.update([frame(0.3, 0.5), frame(melodyX, 0.5)], now);
      expect(nearX(result.melody?.hand, melodyX), `fotograma ${i}`).toBe(true);
      expect(nearX(result.expression?.hand, 0.3), `fotograma ${i}`).toBe(true);
    }
  });

  it('no cambia de rol por el orden en que llegan las manos', () => {
    const tracker = new RoleTracker();
    tracker.update([frame(0.7, 0.5), frame(0.3, 0.5)], 0);
    // MediaPipe no garantiza el orden del array entre fotogramas.
    const swapped = tracker.update([frame(0.3, 0.5), frame(0.7, 0.5)], 33);
    expect(nearX(swapped.melody?.hand, 0.7)).toBe(true);
  });

  it('conserva una mano perdida 300 ms y la suelta pasados los 500', () => {
    const tracker = new RoleTracker();
    tracker.update([frame(0.6, 0.5)], 0);

    const at300 = tracker.update([], 300);
    expect(at300.melody, 'a los 300 ms la nota no debe cortarse').not.toBe(null);
    expect(at300.melody?.held).toBe(true);

    const atLimit = tracker.update([], HOLD_MS);
    expect(atLimit.melody).not.toBe(null);

    const after = tracker.update([], HOLD_MS + 1);
    expect(after.melody).toBe(null);
  });

  it('si desaparece la melodia, la mano que queda no se apropia del rol', () => {
    const tracker = new RoleTracker();
    tracker.update([frame(0.75, 0.5), frame(0.25, 0.5)], 0);
    // Solo sigue visible la mano de expresion, en su sitio de siempre.
    const result = tracker.update([frame(0.25, 0.5)], 60);
    expect(nearX(result.expression?.hand, 0.25)).toBe(true);
    expect(result.expression?.held).toBe(false);
    expect(result.melody?.held, 'la melodia debe estar en el margen de gracia').toBe(true);
  });

  it('arranca dando la melodia a la mano mas a la derecha del encuadre', () => {
    const tracker = new RoleTracker();
    const result = tracker.update([frame(0.2, 0.5), frame(0.8, 0.5)], 0);
    expect(nearX(result.melody?.hand, 0.8)).toBe(true);
  });

  it('el reparto inicial se corrige cruzando las manos', () => {
    // Solo depende de la posicion, no de la anatomia. Es lo que permite que un
    // zurdo que levanta las dos manos a la vez pueda elegir cual toca la
    // melodia, en lugar de recibir un reparto fijo que no puede cambiar.
    const tracker = new RoleTracker();
    const result = tracker.update([frame(0.75, 0.5), frame(0.25, 0.5)], 0);
    expect(nearX(result.melody?.hand, 0.75)).toBe(true);

    const cruzado = new RoleTracker();
    const swapped = cruzado.update([frame(0.25, 0.5), frame(0.75, 0.5)], 0);
    expect(nearX(swapped.melody?.hand, 0.75), 'el orden del array no debe influir').toBe(true);
  });
});
