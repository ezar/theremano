import { describe, expect, it } from 'vitest';
import { FULL, RATE_MAX, RATE_MIN, VibratoDetector, WINDOW } from '../src/mapping/vibrato';
import { Mapper } from '../src/mapping/mapper';
import { denormalize } from '../src/mapping/features';
import { pitchAt } from '../src/mapping/scales';
import { DEFAULT_SETTINGS } from '../src/state/store';
import { gaussian, makeHand, mulberry32 } from './helpers';
import type { RoleAssignment } from '../src/tracking/types';

/**
 * El temblor de la mano, convertido en vibrato.
 *
 * Lo que se comprueba no es que una oscilación se detecte —eso es lo fácil—,
 * sino que no se confunda con las otras dos cosas que hace la misma mano en el
 * mismo eje: viajar hasta la nota siguiente y temblar porque una mano en el aire
 * tiembla. Un falso positivo aquí no es un pixel mal puesto: es una nota que se
 * pone a ondular sola mientras alguien intenta sostenerla.
 */

const FPS = 60;

/** Oscila durante `seconds` y devuelve el detector, listo para preguntarle. */
function wobble(options: { amplitude: number; hz: number; seconds?: number; fps?: number }): VibratoDetector {
  const detector = new VibratoDetector();
  const fps = options.fps ?? FPS;
  const seconds = options.seconds ?? 1;
  for (let frame = 0; frame <= seconds * fps; frame += 1) {
    const t = frame / fps;
    detector.push(t, 0.5 + options.amplitude * Math.sin(2 * Math.PI * options.hz * t));
  }
  return detector;
}

describe('vibrato', () => {
  it('oscilar la mano lo enciende', () => {
    expect(wobble({ amplitude: 0.03, hz: 5 }).depth).toBeGreaterThan(0.3);
  });

  it('viajar a la nota siguiente no lo enciende', () => {
    // Es el caso que lo arruinaría: cada vez que la mano cambia de nota, un
    // temblor de propina. Un viaje no cruza el centro de la ventana.
    const detector = new VibratoDetector();
    for (let frame = 0; frame <= FPS; frame += 1) {
      const t = frame / FPS;
      detector.push(t, 0.2 + t * 0.6);
    }
    expect(detector.depth).toBe(0);

    // Y tampoco uno rápido, que es el que más se parece a una oscilación.
    const quick = new VibratoDetector();
    for (let frame = 0; frame <= FPS; frame += 1) {
      const t = frame / FPS;
      quick.push(t, 0.2 + Math.min(0.5, t * 3));
    }
    expect(quick.depth).toBe(0);
  });

  it('el temblor del detector no lo enciende', () => {
    // Ruido de una detección real: pequeño y mucho más rápido que una mano.
    const random = mulberry32(7);
    const detector = new VibratoDetector();
    for (let frame = 0; frame <= FPS * 2; frame += 1) {
      detector.push(frame / FPS, 0.5 + gaussian(random) * 0.004);
    }
    expect(detector.depth).toBe(0);
  });

  it('cuanto más se oscila, más vibrato, hasta saturar', () => {
    const small = wobble({ amplitude: 0.02, hz: 5 }).depth;
    const medium = wobble({ amplitude: 0.035, hz: 5 }).depth;
    const large = wobble({ amplitude: FULL * 1.5, hz: 5 }).depth;
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
    expect(large).toBeCloseTo(1, 1);
  });

  it('suena al ritmo al que se mueve la mano', () => {
    // No al que traiga el timbre: la gracia es oír el temblor que se está
    // haciendo, no uno parecido.
    expect(wobble({ amplitude: 0.04, hz: 4 }).rate).toBeGreaterThan(3.4);
    expect(wobble({ amplitude: 0.04, hz: 4 }).rate).toBeLessThan(4.6);
    expect(wobble({ amplitude: 0.04, hz: 7 }).rate).toBeGreaterThan(6);
    expect(wobble({ amplitude: 0.04, hz: 7 }).rate).toBeLessThan(8);
    for (const hz of [4, 5.5, 7]) {
      const rate = wobble({ amplitude: 0.04, hz }).rate;
      expect(rate).toBeGreaterThanOrEqual(RATE_MIN);
      expect(rate).toBeLessThanOrEqual(RATE_MAX);
    }
  });

  it('entra deprisa y se va despacio, y acaba yéndose del todo', () => {
    const detector = new VibratoDetector();
    let t = 0;
    for (; t <= 1; t += 1 / FPS) detector.push(t, 0.5 + 0.04 * Math.sin(2 * Math.PI * 5 * t));
    const sounding = detector.depth;
    expect(sounding).toBeGreaterThan(0.5);

    // La mano se queda quieta: el vibrato se apaga solo, sin cortarse en seco.
    const half = t + WINDOW / 2;
    for (; t <= half; t += 1 / FPS) detector.push(t, 0.5);
    expect(detector.depth, 'no se corta de golpe').toBeGreaterThan(0);
    for (; t <= half + 1; t += 1 / FPS) detector.push(t, 0.5);
    expect(detector.depth).toBeLessThan(0.02);
    expect(detector.rate).toBe(0);
  });

  it('perder la mano lo cancela', () => {
    const detector = wobble({ amplitude: 0.04, hz: 5 });
    expect(detector.depth).toBeGreaterThan(0.5);
    detector.reset();
    expect(detector.depth).toBe(0);
    expect(detector.rate).toBe(0);
  });

  it('mide lo mismo a treinta que a sesenta fotogramas', () => {
    const slow = wobble({ amplitude: 0.035, hz: 5, fps: 30 }).depth;
    const fast = wobble({ amplitude: 0.035, hz: 5, fps: 60 }).depth;
    expect(Math.abs(slow - fast)).toBeLessThan(0.2);
    expect(slow).toBeGreaterThan(0.2);
  });
});

describe('vibrato con una mano de verdad', () => {
  it('ondula la nota sin cambiarla de zona', () => {
    /*
     * El riesgo de todo esto: oscilar la mano justo en el borde entre dos zonas
     * y que la nota se ponga a saltar de una a otra. No pasa, y no por suerte:
     * el filtro del tono deja pasar menos de la sexta parte de lo que oscila a
     * cinco hercios. Lo que aqui se comprueba es esa frontera, con la mano
     * puesta a proposito en el peor sitio.
     */
    const mapper = new Mapper(DEFAULT_SETTINGS);
    const notes = new Set<number>();
    let lowRaw = 1;
    let highRaw = 0;
    let vibrato = 0;

    for (let frame = 0; frame <= FPS * 1.5; frame += 1) {
      const t = frame / FPS;
      // Pinza cerrada —la nota suena— y la palma oscilando a cinco hercios.
      // A caballo entre dos zonas a proposito: con once zonas, el borde entre
      // la cuarta y la quinta cae en 0,45 del encuadre util.
      const hand = makeHand(denormalize(0.45) + 0.03 * Math.sin(2 * Math.PI * 5 * t), 0.5, { pinch: 0.12 });
      const assignment: RoleAssignment = {
        melody: { hand: { landmarks: hand, raw: hand }, held: false, heldFor: 0 },
        expression: null,
      };
      const output = mapper.update(assignment, t);
      if (output.gateOpen) {
        notes.add(output.midi);
        vibrato = output.vibrato;
      }
      if (t > 0.4) {
        lowRaw = Math.min(lowRaw, output.pitchXRaw);
        highRaw = Math.max(highRaw, output.pitchXRaw);
      }
    }

    expect(vibrato, 'la mano pide vibrato').toBeGreaterThan(0.4);
    expect(notes.size, 'y la nota no se mueve de zona').toBe(1);
    // Y no es que la mano oscilara dentro de una zona holgada: en crudo cruza el
    // borde en cada ciclo. Si el tono no fuera por el filtro, la nota saltaria
    // cinco veces por segundo.
    const layout = mapper.currentLayout;
    const crossed = new Set([pitchAt(layout, lowRaw).index, pitchAt(layout, highRaw).index]);
    expect(crossed.size, 'la mano cruza de verdad el borde entre dos zonas').toBe(2);
  });
});
