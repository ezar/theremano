import { describe, expect, it } from 'vitest';
import { PinchGate, PINCH_CLOSE, PINCH_OPEN } from '../src/mapping/gate';
import { OneEuroFilter, DEFAULT_D_CUTOFF } from '../src/filter/oneEuro';
import { pinchRatio } from '../src/mapping/features';
import { DEFAULT_SETTINGS } from '../src/state/store';
import { gaussian, jitter, makeHand, mulberry32 } from './helpers';

describe('histeresis de la pinza', () => {
  it('abre al cerrar la pinza y cierra al abrirla', () => {
    const gate = new PinchGate();
    // Hacen falta dos fotogramas consecutivos para confirmar.
    expect(gate.update(0.2)).toBe(null);
    expect(gate.update(0.2)).toBe('attack');
    expect(gate.isOpen).toBe(true);
    expect(gate.update(0.6)).toBe(null);
    expect(gate.update(0.6)).toBe('release');
    expect(gate.isOpen).toBe(false);
  });

  it('ignora un fotograma suelto fuera de rango', () => {
    const gate = new PinchGate();
    gate.update(0.2);
    gate.update(0.2);
    // Un unico fotograma con la pinza abierta es un fallo de deteccion, no un
    // gesto: la nota no debe cortarse.
    expect(gate.update(0.9)).toBe(null);
    expect(gate.update(0.2)).toBe(null);
    expect(gate.isOpen).toBe(true);
  });

  it('no traquetea con la mano parada justo en la banda muerta', () => {
    const gate = new PinchGate();
    const rand = mulberry32(11);
    const middle = (PINCH_CLOSE + PINCH_OPEN) / 2;
    let transitions = 0;
    for (let i = 0; i < 600; i += 1) {
      if (gate.update(middle + gaussian(rand) * 0.02) !== null) transitions += 1;
    }
    expect(transitions, 'la banda muerta deberia absorber el temblor').toBe(0);
  });

  it('tampoco traquetea recorriendo la cadena real de deteccion', () => {
    // Mano inmovil con la pinza justo en el peor sitio posible, con el temblor
    // de MediaPipe y el suavizado que lleva la senal de verdad. Es la prueba que
    // importa: la banda muerta sola no basta si la entrada llega sucia.
    const gate = new PinchGate();
    const rand = mulberry32(4242);
    const filter = new OneEuroFilter({
      minCutoff: DEFAULT_SETTINGS.controlMinCutoff,
      beta: DEFAULT_SETTINGS.controlBeta,
      dCutoff: DEFAULT_D_CUTOFF,
    });
    const hand = makeHand(0.5, 0.5, { pinch: (PINCH_CLOSE + PINCH_OPEN) / 2 });

    let transitions = 0;
    for (let i = 0; i < 600; i += 1) {
      const ratio = filter.filter(pinchRatio(jitter(hand, 0.003, rand)), i / 30);
      if (gate.update(ratio) !== null) transitions += 1;
    }
    expect(transitions, 'veinte segundos sin un solo corte espurio').toBe(0);
  });

  it('sigue una pinza que cruza los umbrales de verdad', () => {
    const gate = new PinchGate();
    const events: string[] = [];
    for (const ratio of [0.8, 0.8, 0.5, 0.35, 0.25, 0.2, 0.2, 0.35, 0.5, 0.5, 0.6, 0.6]) {
      const event = gate.update(ratio);
      if (event) events.push(event);
    }
    expect(events).toEqual(['attack', 'release']);
  });

  it('forceClose corta sin esperar confirmacion, y solo si sonaba', () => {
    const gate = new PinchGate();
    expect(gate.forceClose()).toBe(null);
    gate.update(0.2);
    gate.update(0.2);
    expect(gate.forceClose()).toBe('release');
    expect(gate.isOpen).toBe(false);
  });
});
