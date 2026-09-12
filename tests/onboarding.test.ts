import { describe, expect, it } from 'vitest';
import { DRUM_STEPS, Onboarding, STEPS, type CoachSignals } from '../src/ui/onboarding';

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
  melodyHeld: false,
  expressionVisible: false,
  expressionHeld: false,
  gateOpen: false,
  attack: false,
  presetChanged: false,
  strikes: [],
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

function coachAt(stepId: string, drums = false): Onboarding {
  const coach = new Onboarding();
  coach.start(drums);
  while (coach.step && coach.step.id !== stepId) coach.skipStep();
  return coach;
}

/** Un golpe en esa pieza, en el fotograma que toque. */
const hit = (...pieces: string[]): Partial<CoachSignals> => ({ strikes: pieces.map((piece) => ({ piece })) });

/**
 * Un golpe y solo uno, cueste lo que cueste.
 *
 * Hace falta porque un "t < 0.02" abarca dos fotogramas a sesenta por segundo, y
 * dos golpes donde la prueba queria uno cierran dos pasos y la prueba miente
 * sobre lo que ha comprobado. Paso por ahi.
 */
function once(...pieces: string[]): (t: number) => Partial<CoachSignals> {
  let spent = false;
  return () => {
    if (spent) return {};
    spent = true;
    return hit(...pieces);
  };
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

  it('una mano recordada no cuenta como mano vista', () => {
    // El instrumento conserva 500 ms la ultima posicion de una mano perdida,
    // para que un fallo de deteccion no corte una nota. Ese margen no puede
    // valer para ensenar: una sola deteccion falsa daria medio segundo de mano
    // "visible" y cerraria el primer paso sin que nadie haya levantado nada.
    const coach = new Onboarding();
    coach.start();
    expect(feed(coach, { melodyVisible: true, melodyHeld: true }, 5)).toEqual([]);
    expect(coach.step?.id).toBe('hand');
    expect(feed(coach, { melodyVisible: true }, 1)).toEqual(['advanced']);
  });

  it('el paso del volumen tampoco acepta una segunda mano recordada', () => {
    const coach = coachAt('volume');
    expect(feed(coach, { expressionVisible: true, expressionHeld: true }, 3, (t) => ({ volume: t < 1.5 ? 0.05 : 0.95 }))).toEqual([]);
    expect(coach.step?.id).toBe('volume');
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

  it('el paso del volumen mide la segunda mano y pasa al siguiente', () => {
    const coach = coachAt('volume');
    expect(feed(coach, { expressionVisible: true, volume: 0.5 }, 4)).toEqual([]);
    const events = feed(coach, { expressionVisible: true }, 2, (t) => ({ volume: t < 1 ? 0.1 : 0.9 }));
    expect(events).toEqual(['advanced']);
    expect(coach.step?.id).toBe('timbre');
  });

  /**
   * El paso que hace visible el gesto del timbre.
   *
   * Solo puede cerrarse con un cambio confirmado de verdad. Contarlo por dedos
   * levantados lo cerraria en cuanto alguien abriera la mano, que es justo lo
   * que este paso quiere ensenar que no basta.
   */
  it('el ultimo paso solo se cierra al cambiar de timbre de verdad', () => {
    const coach = coachAt('timbre');
    // Con la segunda mano a la vista, moviendose y tocando, pero sin que el
    // timbre llegue a confirmarse, el paso no avanza.
    expect(
      feed(coach, { expressionVisible: true, gateOpen: true, attack: true, volume: 0.9, pitchX: 0.5 }, 4),
    ).toEqual([]);
    expect(coach.step?.id).toBe('timbre');

    expect(feed(coach, { expressionVisible: true, presetChanged: true }, 0.1)).toEqual(['finished']);
    expect(coach.isActive).toBe(false);
    expect(coach.step).toBe(null);
    // Ya terminado, seguir tocando no vuelve a disparar nada.
    expect(feed(coach, { expressionVisible: true, attack: true, presetChanged: true }, 1)).toEqual([]);
  });

  it('los dos pasos de la segunda mano son los opcionales', () => {
    // La marca vive en el dato para que la tarjeta pueda anunciarla antes de que
    // nadie lo intente. Si alguien anade un paso opcional sin querer, o quita
    // esta marca, el instrumento pasaria a exigir dos manos sin decirlo.
    const optional = STEPS.filter((step) => step.optional).map((step) => step.id);
    expect(optional).toEqual(['volume', 'timbre']);
  });

  it('los pasos opcionales se pueden completar igualmente si hay segunda mano', () => {
    const coach = coachAt('volume');
    expect(STEPS.find((s) => s.id === 'volume')?.optional).toBe(true);
    expect(feed(coach, { expressionVisible: true }, 2, (t) => ({ volume: t < 1 ? 0.1 : 0.9 }))).toEqual(['advanced']);
    expect(feed(coach, { expressionVisible: true, presetChanged: true }, 0.1)).toEqual(['finished']);
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

/**
 * El recorrido de la bateria.
 *
 * La trampa aqui no es que un paso no se cierre, es que se cierre por el motivo
 * equivocado. El paso del reparto se cerraria contando golpes, y entonces cuatro
 * porrazos seguidos en la caja lo darian por aprendido sin que nadie se haya
 * enterado de que hay cuatro piezas. Lo mismo el de las dos manos: dos golpes
 * seguidos no son dos manos, son una mano dos veces.
 */
describe('introduccion de la bateria', () => {
  it('es otro recorrido, no el de la melodia con otros textos', () => {
    const coach = new Onboarding();
    coach.start(true);
    const ids = [];
    while (coach.step) {
      ids.push(coach.step.id);
      coach.skipStep();
    }
    expect(ids).toEqual(DRUM_STEPS.map((s) => s.id));
    // Ni un solo paso de la pinza, que en bateria no hace nada.
    expect(ids).not.toContain('pinch');
    expect(ids).not.toContain('move');
    expect(coach.total).toBe(DRUM_STEPS.length);
  });

  it('y la melodia sigue teniendo el suyo', () => {
    const coach = new Onboarding();
    coach.start();
    expect(coach.total).toBe(STEPS.length);
    expect(coach.step?.id).toBe('hand');
  });

  it('el primer golpe cierra su paso, y sin golpe no se cierra', () => {
    const quieto = coachAt('drumHit', true);
    expect(feed(quieto, { melodyVisible: true }, 5)).toEqual([]);
    expect(quieto.step?.id).toBe('drumHit');

    const coach = coachAt('drumHit', true);
    expect(feed(coach, { melodyVisible: true }, 1, once('snare'))).toEqual(['advanced']);
    expect(coach.step?.id).toBe('drumPieces');
  });

  it('el reparto no se aprende dando mas golpes en el mismo sitio', () => {
    // Diez golpes en la caja: muchos golpes, ninguna pieza nueva.
    const terco = coachAt('drumPieces', true);
    expect(feed(terco, { melodyVisible: true }, 3, (t) => (Math.floor(t * 10) % 2 === 0 ? hit('snare') : {}))).toEqual([]);
    expect(terco.step?.id).toBe('drumPieces');

    const coach = coachAt('drumPieces', true);
    feed(coach, { melodyVisible: true }, 0.2, () => hit('snare'));
    expect(coach.step?.id, 'sigue esperando la segunda pieza').toBe('drumPieces');
    expect(feed(coach, { melodyVisible: true }, 0.2, once('hat'))).toEqual(['advanced']);
  });

  it('dos manos son dos golpes en el mismo fotograma, no dos golpes seguidos', () => {
    const alterno = coachAt('drumBoth', true);
    // Golpes de uno en uno, muchos y en piezas distintas: no es lo que se pide.
    expect(
      feed(alterno, { melodyVisible: true }, 3, (t) => {
        const tick = Math.floor(t * 8);
        return t * 8 - tick < 0.1 ? hit(tick % 2 === 0 ? 'kick' : 'hat') : {};
      }),
    ).toEqual([]);
    expect(alterno.step?.id).toBe('drumBoth');

    const coach = coachAt('drumBoth', true);
    expect(feed(coach, { melodyVisible: true }, 0.2, once('kick', 'hat'))).toEqual(['finished']);
    expect(coach.isActive).toBe(false);
  });

  it('el paso de las dos manos se puede saltar, y es el unico', () => {
    const optional = DRUM_STEPS.filter((step) => step.optional).map((step) => step.id);
    expect(optional).toEqual(['drumBoth']);
  });

  it('los golpes de un paso no cuentan para el siguiente', () => {
    // Cada paso reinicia su cuenta. Sin eso, los golpes del paso del reparto
    // arrastrarian al de las dos manos y se cerraria sin haberlas juntado.
    const coach = coachAt('drumHit', true);
    feed(coach, { melodyVisible: true }, 0.2, once('kick', 'snare'));
    expect(coach.step?.id, 'el golpe doble ha cerrado el primer paso').toBe('drumPieces');
    // Y ese mismo golpe doble no debe haber cerrado tambien los dos siguientes.
    expect(coach.isActive).toBe(true);
    expect(feed(coach, { melodyVisible: true }, 1)).toEqual([]);
    expect(coach.step?.id).toBe('drumPieces');
  });
});
