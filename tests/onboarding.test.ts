import { describe, expect, it } from 'vitest';
import { Onboarding, STEPS, type CoachSignals } from '../src/ui/onboarding';

/**
 * Lo que se comprueba aqui es que ningun paso se cierre solo.
 *
 * Un tutorial que avanza sin que el gesto haya ocurrido es peor que no tener
 * tutorial: deja a quien llega convencido de que ya sabe algo que no sabe. Por
 * eso cada paso se prueba dos veces, con la senal que le toca y con todo lo
 * demas moviendose menos esa senal.
 */

const FPS = 60;
const idle: CoachSignals = {
  melodyVisible: false,
  expressionVisible: false,
  gateOpen: false,
  attack: false,
  pitchX: -1,
  volume: 0.5,
  dt: 1 / FPS,
};

/** Alimenta el entrenador durante unos segundos con la misma senal. */
function feed(coach: Onboarding, signals: Partial<CoachSignals>, seconds: number, vary?: (t: number) => Partial<CoachSignals>) {
  const events: string[] = [];
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i += 1) {
    const t = i / FPS;
    const event = coach.update({ ...idle, ...signals, ...(vary?.(t) ?? {}) });
    if (event) events.push(event);
  }
  return events;
}

function coachAt(stepId: string): Onboarding {
  const coach = new Onboarding();
  coach.start();
  while (coach.step && coach.step.id !== stepId) coach.skipStep();
  return coach;
}

describe('introduccion guiada', () => {
  it('no arranca hasta que se pide', () => {
    const coach = new Onboarding();
    expect(coach.isActive).toBe(false);
    expect(coach.step).toBe(null);
    expect(coach.update(idle)).toBe(null);
  });

  it('el primer paso pide una mano y no se cierra sin ella', () => {
    const coach = new Onboarding();
    coach.start();
    expect(coach.step?.id).toBe('hand');
    expect(feed(coach, {}, 5)).toEqual([]);
    expect(coach.step?.id).toBe('hand');
    expect(feed(coach, { melodyVisible: true }, 1)).toEqual(['advanced']);
    expect(coach.step?.id).toBe('move');
  });

  it('una deteccion parpadeante no cuenta como mano sostenida', () => {
    const coach = new Onboarding();
    coach.start();
    // Aparece y desaparece: el contador se reinicia y nunca llega al umbral.
    expect(feed(coach, {}, 6, (t) => ({ melodyVisible: Math.floor(t * 8) % 2 === 0 }))).toEqual([]);
    expect(coach.step?.id).toBe('hand');
  });

  it('el paso de mover exige recorrido, no solo presencia', () => {
    const coach = coachAt('move');
    // Mano quieta en el centro durante cinco segundos: no basta.
    expect(feed(coach, { melodyVisible: true, pitchX: 0.5 }, 5)).toEqual([]);
    // Un recorrido pequeno tampoco.
    expect(feed(coach, { melodyVisible: true }, 2, (t) => ({ pitchX: 0.5 + Math.sin(t * 4) * 0.05 }))).toEqual([]);
    expect(coach.step?.id).toBe('move');
    // Cruzar el encuadre, si.
    expect(feed(coach, { melodyVisible: true }, 2, (t) => ({ pitchX: t < 1 ? 0.1 : 0.9 }))).toEqual(['advanced']);
  });

  it('el paso de la pinza necesita un ataque real', () => {
    const coach = coachAt('pinch');
    // Moverse mucho no abre el gate.
    expect(feed(coach, { melodyVisible: true }, 4, (t) => ({ pitchX: (t % 1) }))).toEqual([]);
    expect(coach.step?.id).toBe('pinch');
    expect(feed(coach, { melodyVisible: true, attack: true, gateOpen: true }, 1 / FPS)).toEqual(['advanced']);
  });

  it('el paso de tocar exige sostener y moverse a la vez', () => {
    const quieto = coachAt('play');
    // Nota sostenida sin moverse: no ensena nada, no cuenta.
    expect(feed(quieto, { gateOpen: true, melodyVisible: true, pitchX: 0.5 }, 4)).toEqual([]);

    const suelto = coachAt('play');
    // Moverse mucho con el gate cerrado tampoco.
    expect(feed(suelto, { melodyVisible: true }, 4, (t) => ({ pitchX: t % 1 }))).toEqual([]);

    const bien = coachAt('play');
    expect(feed(bien, { gateOpen: true, melodyVisible: true }, 3, (t) => ({ pitchX: 0.3 + (t / 3) * 0.4 }))).toEqual(['advanced']);
  });

  it('el ultimo paso mide la segunda mano y termina el recorrido', () => {
    const coach = coachAt('volume');
    expect(feed(coach, { expressionVisible: true, volume: 0.5 }, 4)).toEqual([]);
    const events = feed(coach, { expressionVisible: true }, 2, (t) => ({ volume: t < 1 ? 0.1 : 0.9 }));
    expect(events).toEqual(['finished']);
    expect(coach.isActive).toBe(false);
    expect(coach.step).toBe(null);
    // Ya terminado, seguir tocando no vuelve a disparar nada.
    expect(feed(coach, { expressionVisible: true, attack: true }, 1)).toEqual([]);
  });

  it('se puede saltar paso a paso hasta el final', () => {
    const coach = new Onboarding();
    coach.start();
    for (let i = 0; i < STEPS.length - 1; i += 1) expect(coach.skipStep()).toBe('advanced');
    expect(coach.skipStep()).toBe('finished');
    expect(coach.isActive).toBe(false);
    expect(coach.skipStep()).toBe(null);
  });

  it('se puede repetir desde el principio', () => {
    const coach = new Onboarding();
    coach.start();
    coach.skipStep();
    coach.start();
    expect(coach.index).toBe(0);
    expect(coach.step?.id).toBe(STEPS[0]!.id);
  });

  it('el progreso de un paso no se arrastra al siguiente', () => {
    // El recorrido acumulado moviendo la mano no debe cerrar por si solo el
    // paso del volumen, que mide otra senal distinta.
    const coach = new Onboarding();
    coach.start();
    feed(coach, { melodyVisible: true }, 1);
    feed(coach, { melodyVisible: true }, 2, (t) => ({ pitchX: t < 1 ? 0 : 1 }));
    expect(coach.step?.id).toBe('pinch');
    coach.skipStep();
    coach.skipStep();
    expect(coach.step?.id).toBe('volume');
    expect(feed(coach, { expressionVisible: true, volume: 0.5 }, 2)).toEqual([]);
  });
});
