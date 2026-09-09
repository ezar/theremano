import { describe, expect, it } from 'vitest';

import { Mapper } from '../src/mapping/mapper';
import { RoleTracker } from '../src/tracking/handedness';
import { DEFAULT_SETTINGS, type Settings } from '../src/state/store';
import type { HandFrame } from '../src/tracking/types';
import { makeHand } from './helpers';

/**
 * Recorrido completo: manos detectadas, asignacion de rol, mapeo y eventos de
 * gate. Es donde se comprueban los criterios de aceptacion que hablan del
 * instrumento entero y no de una pieza suelta.
 */

const FPS = 30;
const STEP_MS = 1000 / FPS;

function hand(cx: number, cy: number, options: Parameters<typeof makeHand>[2] = {}): HandFrame {
  return { landmarks: [], raw: makeHand(cx, cy, options) };
}

class Rig {
  readonly tracker = new RoleTracker();
  readonly mapper: Mapper;
  now = 0;
  readonly events: string[] = [];
  readonly presetChanges: string[] = [];

  constructor(settings: Settings = { ...DEFAULT_SETTINGS }) {
    this.mapper = new Mapper(settings);
  }

  step(hands: HandFrame[], frames = 1) {
    let output = this.mapper.update(this.tracker.update(hands, this.now), this.now / 1000);
    this.record(output);
    for (let i = 1; i < frames; i += 1) {
      this.now += STEP_MS;
      output = this.mapper.update(this.tracker.update(hands, this.now), this.now / 1000);
      this.record(output);
    }
    this.now += STEP_MS;
    return output;
  }

  private record(output: ReturnType<Mapper['update']>): void {
    if (output.gateEvent) this.events.push(output.gateEvent);
    if (output.preset) this.presetChanges.push(output.preset.id);
  }
}

const pinched = (x: number) => hand(x, 0.5, { pinch: 0.15 });
const open = (x: number) => hand(x, 0.5, { pinch: 0.8 });

describe('el instrumento de punta a punta', () => {
  it('suena al cerrar la pinza y calla al abrirla', () => {
    const rig = new Rig();
    rig.step([open(0.5)], 6);
    expect(rig.events).toEqual([]);
    rig.step([pinched(0.5)], 6);
    expect(rig.events).toEqual(['attack']);
    rig.step([open(0.5)], 6);
    expect(rig.events).toEqual(['attack', 'release']);
  });

  it('el ataque llega dentro del presupuesto de latencia', () => {
    // El gate exige dos fotogramas de confirmacion, asi que dos es el minimo
    // posible. Cualquier cosa por encima de tres significa que el suavizado se
    // ha comido el presupuesto.
    const rig = new Rig();
    rig.step([open(0.5)], 10);
    let frames = 0;
    while (frames < 30) {
      frames += 1;
      if (rig.step([pinched(0.5)]).gateEvent === 'attack') break;
    }
    expect(frames, `${frames} fotogramas hasta el ataque`).toBeLessThanOrEqual(3);
  });

  it('perder la mano 300 ms no corta el sonido', () => {
    const rig = new Rig();
    rig.step([pinched(0.5)], 5);
    expect(rig.events).toEqual(['attack']);

    // Nueve fotogramas a 30 fps son 300 ms sin ninguna deteccion.
    const during = rig.step([], 9);
    expect(during.gateOpen, 'la nota deberia seguir sonando').toBe(true);
    expect(rig.events).toEqual(['attack']);

    // Al recuperarse, sigue sonando sin un nuevo ataque.
    rig.step([pinched(0.5)], 3);
    expect(rig.events).toEqual(['attack']);
  });

  it('perder la mano del todo acaba soltando la nota', () => {
    const rig = new Rig();
    rig.step([pinched(0.5)], 5);
    rig.step([], 20); // mas de 500 ms
    expect(rig.events).toEqual(['attack', 'release']);
  });

  it('mover la mano a la derecha sube el tono', () => {
    const rig = new Rig();
    const low = rig.step([pinched(0.2)], 10);
    const high = rig.step([pinched(0.8)], 20);
    expect(high.freq).toBeGreaterThan(low.freq);
    expect(low.midi).not.toBe(high.midi);
  });

  it('subir la mano abre el filtro y bajarla lo cierra', () => {
    const rig = new Rig();
    const up = rig.step([hand(0.5, 0.15, { pinch: 0.15 })], 12);
    const down = rig.step([hand(0.5, 0.85, { pinch: 0.15 })], 24);
    expect(up.cutoffNorm).toBeGreaterThan(down.cutoffNorm);
  });

  it('la mano de expresion manda en el volumen', () => {
    const rig = new Rig();
    // Melodia a la derecha, expresion a la izquierda y arriba: volumen alto.
    const loud = rig.step([pinched(0.75), hand(0.25, 0.1)], 20);
    const quiet = rig.step([pinched(0.75), hand(0.25, 0.9)], 30);
    expect(loud.volume).toBeGreaterThan(0.7);
    expect(quiet.volume).toBeLessThan(0.3);
  });

  it('perder la mano de expresion conserva el ultimo volumen, no silencia', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.1)], 20);
    const before = rig.mapper.update(rig.tracker.update([pinched(0.75), hand(0.25, 0.1)], rig.now), rig.now / 1000);
    const after = rig.step([pinched(0.75)], 40);
    expect(after.volume).toBeCloseTo(before.volume, 5);
    expect(after.gateOpen, 'y desde luego no debe cortar la nota').toBe(true);
  });

  it('cambia de timbre con los dedos, pero no con el puno', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 12);
    expect(rig.presetChanges).toEqual(['flute']);

    // Cerrar la mano no debe deshacer la eleccion anterior.
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 0 })], 12);
    expect(rig.presetChanges).toEqual(['flute']);
  });

  /**
   * El candidato es lo unico que hace visible un gesto que nadie encontraba.
   * Tiene que aparecer en cuanto los dedos apuntan a otro timbre, crecer
   * mientras se sostiene, y desaparecer en el mismo momento en que se confirma:
   * un "va a cambiar" que sigue puesto despues de cambiar seria mentira.
   */
  it('anuncia el timbre al que apuntan los dedos antes de confirmarlo', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 1 })], 12);

    const first = rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 1);
    expect(first.presetCandidate, 'el nombre tiene que asomar al primer fotograma').toBe('flute');
    expect(first.presetProgress).toBeGreaterThan(0);
    expect(first.presetProgress).toBeLessThan(1);

    const halfway = rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 3);
    expect(halfway.presetCandidate).toBe('flute');
    expect(halfway.presetProgress).toBeGreaterThan(first.presetProgress);

    const confirmed = rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 4);
    expect(rig.presetChanges).toContain('flute');
    expect(confirmed.presetCandidate, 'ya no es candidato: es el timbre actual').toBe(null);
    expect(confirmed.presetProgress).toBe(0);
  });

  it('sin mano de expresion no hay candidato que ensenar', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 2);
    const alone = rig.step([pinched(0.75)], 2);
    expect(alone.presetCandidate).toBe(null);
    expect(alone.presetProgress).toBe(0);
  });

  it('no cambia de timbre por un parpadeo del recuento de dedos', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 1 })], 12);
    const settled = [...rig.presetChanges];
    // Dos fotogramas sueltos con otro recuento estan por debajo de la racha.
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 2);
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 1 })], 4);
    expect(rig.presetChanges).toEqual(settled);
  });

  it('en modo continuo el portamento es mas largo que cuantizado', () => {
    const quantized = new Rig().step([pinched(0.5)], 3);
    const continuous = new Rig({ ...DEFAULT_SETTINGS, scale: 'continuous' }).step([pinched(0.5)], 3);
    expect(continuous.glide).toBeGreaterThan(quantized.glide);
  });
});
