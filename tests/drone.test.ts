import { describe, expect, it } from 'vitest';
import { Mapper } from '../src/mapping/mapper';
import { HOLD_SECONDS } from '../src/mapping/holdGesture';
import { handSpan, pinchRatio } from '../src/mapping/features';
import { DEFAULT_SETTINGS } from '../src/state/store';
import { makeHand, withMiddlePinch } from './helpers';
import type { Landmark, RoleAssignment } from '../src/tracking/types';

/**
 * La nota pedal: la misma pinza que abre una nota, pero en la otra mano.
 *
 * Es el primer sitio donde el instrumento deja de ser monofonico, asi que lo que
 * se comprueba es sobre todo lo que no debe pasar: que no se encienda sola al
 * pedir un bucle —el pulgar pasa cerca del indice de camino al corazon—, que no
 * cambie el timbre de paso, y que no se quede sonando cuando ya no hay mano que
 * la sostenga.
 */

const FPS = 60;
const DT = 1 / FPS;

interface Pose {
  /** Pinza de la mano que toca. Cerrada = suena. */
  melody?: number;
  /** Donde esta esa mano, para poder cambiar de nota. */
  melodyX?: number;
  /** Pinza de la mano de expresion: la que pone el pedal. */
  expression?: number;
  /** Dedos extendidos de esa mano, para el timbre. */
  fingers?: number;
  /** Sin mano de expresion. */
  alone?: boolean;
  /** La mano de expresion con el pulgar en el corazon: el gesto de grabar. */
  recording?: boolean;
}

class Session {
  readonly mapper = new Mapper(DEFAULT_SETTINGS);
  private seconds = 0;
  /** Cambios de timbre confirmados. Un cambio solo se anuncia en su fotograma. */
  presetChanges = 0;
  last = this.mapper.update({ melody: null, expression: null }, 0);

  advance(frames: number, pose: Pose): void {
    for (let frame = 0; frame < frames; frame += 1) {
      this.seconds += DT;
      const melody = makeHand(pose.melodyX ?? 0.6, 0.5, { pinch: pose.melody ?? 1 });
      let expression: Landmark[] | null = null;
      if (!pose.alone) {
        expression = makeHand(0.2, 0.5, { pinch: pose.expression ?? 1, fingers: pose.fingers ?? 4 });
        if (pose.recording) expression = reachingForTheMiddle(expression);
      }
      const assignment: RoleAssignment = {
        melody: { hand: { landmarks: melody, raw: melody }, held: false, heldFor: 0 },
        expression: expression
          ? { hand: { landmarks: expression, raw: expression }, held: false, heldFor: 0 }
          : null,
      };
      this.last = this.mapper.update(assignment, this.seconds);
      if (this.last.preset) this.presetChanges += 1;
    }
  }
}

/**
 * El pulgar yendo a por el corazon, con el indice todavia de paso.
 *
 * Es la postura que pasa de verdad al pedir un bucle, y la que podria encender
 * el pedal sin querer: las dos distancias quedan por debajo del umbral a la vez.
 */
function reachingForTheMiddle(hand: readonly Landmark[]): Landmark[] {
  const out = withMiddlePinch(hand, 0.1);
  const span = handSpan(out);
  const thumb = out[4]!;
  // El indice, a un cuarto de palmo del pulgar: pinza cerrada para el gate.
  out[8] = { x: thumb.x + span * 0.25, y: thumb.y, z: 0 };
  return out;
}

describe('nota pedal', () => {
  it('la pinza de la otra mano sostiene la nota que suena', () => {
    const session = new Session();
    session.advance(10, { melody: 0.12 });
    const playing = session.last.freq;
    expect(session.last.gateOpen).toBe(true);
    expect(session.last.drone).toBe(0);

    session.advance(10, { melody: 0.12, expression: 0.12 });
    expect(session.last.drone).toBe(playing);
    expect(session.last.droneMidi).toBe(session.last.midi);
  });

  it('y la sigue sosteniendo cuando la melodia se va a otra nota', () => {
    // Es para lo que existe: tocar una melodia encima de algo.
    const session = new Session();
    session.advance(10, { melody: 0.12, melodyX: 0.3 });
    const pedal = session.last.freq;
    session.advance(10, { melody: 0.12, melodyX: 0.3, expression: 0.12 });
    expect(session.last.drone).toBe(pedal);

    session.advance(40, { melody: 0.12, melodyX: 0.8, expression: 0.12 });
    expect(session.last.freq, 'la melodia se ha movido').not.toBe(pedal);
    expect(session.last.drone, 'el pedal se queda donde estaba').toBe(pedal);
  });

  it('sin nota que sostener no hace nada', () => {
    const session = new Session();
    session.advance(10, { melody: 1 });
    session.advance(10, { melody: 1, expression: 0.12 });
    expect(session.last.gateOpen).toBe(false);
    expect(session.last.drone).toBe(0);
  });

  it('soltar la pinza suelta el pedal', () => {
    const session = new Session();
    session.advance(10, { melody: 0.12 });
    session.advance(10, { melody: 0.12, expression: 0.12 });
    expect(session.last.drone).toBeGreaterThan(0);
    session.advance(10, { melody: 0.12, expression: 1 });
    expect(session.last.drone).toBe(0);
  });

  it('perder la mano que lo sostiene tambien lo suelta', () => {
    const session = new Session();
    session.advance(10, { melody: 0.12 });
    session.advance(10, { melody: 0.12, expression: 0.12 });
    expect(session.last.drone).toBeGreaterThan(0);
    session.advance(5, { melody: 0.12, alone: true });
    expect(session.last.drone).toBe(0);
  });

  it('irse de la pestana lo suelta', () => {
    const session = new Session();
    session.advance(10, { melody: 0.12 });
    session.advance(10, { melody: 0.12, expression: 0.12 });
    expect(session.mapper.silence()).toBe('release');
    session.advance(1, { melody: 1, alone: true });
    expect(session.last.drone).toBe(0);
  });

  it('ponerlo no cambia el timbre de paso', () => {
    // Al juntar pulgar e indice, el indice se dobla y el recuento de dedos baja
    // uno. Sin la guarda, poner un pedal cambiaria tambien el instrumento.
    const session = new Session();
    session.advance(20, { melody: 0.12, fingers: 4 });
    const before = session.presetChanges;
    session.advance(40, { melody: 0.12, expression: 0.12, fingers: 3 });
    expect(session.last.drone).toBeGreaterThan(0);
    expect(session.presetChanges - before, 'el timbre no se toca mientras el pedal esta puesto').toBe(0);
    expect(session.last.presetCandidate).toBeNull();
  });

  it('pedir un bucle no lo enciende de paso', () => {
    /*
     * El caso que de verdad podia romperlo: el pulgar yendo a por el corazon
     * pasa cerca del indice, y la pinza que pone el pedal es esa. Aqui las dos
     * distancias estan por debajo del umbral a la vez, que es lo peor que puede
     * pasar, y aun asi el pedal no se enciende.
     */
    const session = new Session();
    session.advance(10, { melody: 0.12 });
    const hand = reachingForTheMiddle(makeHand(0.2, 0.5, { pinch: 1 }));
    expect(pinchRatio(hand), 'la mano de la prueba tiene la pinza cerrada').toBeLessThan(0.3);

    session.advance(Math.round((HOLD_SECONDS + 0.2) * FPS), { melody: 0.12, recording: true });
    expect(session.last.drone, 'el pedal no se enciende').toBe(0);
  });

  it('un solo fotograma no basta, igual que para abrir una nota', () => {
    const session = new Session();
    session.advance(10, { melody: 0.12 });
    session.advance(1, { melody: 0.12, expression: 0.12 });
    expect(session.last.drone, 'la pinza se confirma antes de sostener nada').toBe(0);
    session.advance(2, { melody: 0.12, expression: 0.12 });
    expect(session.last.drone).toBeGreaterThan(0);
  });
});
