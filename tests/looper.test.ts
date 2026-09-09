import { describe, expect, it } from 'vitest';
import { LoopTake, MAX_CYCLE_SECONDS, MIN_CYCLE_SECONDS, PARAM_HZ, wrapTime } from '../src/audio/loopTake';
import type { LiveSnapshot } from '../src/audio/loopTake';

/**
 * La estacion de bucles, sin audio.
 *
 * Lo que se comprueba aqui son las tres formas en que una capa puede salir mal
 * sin que nadie se de cuenta hasta la tercera vuelta: un evento que cae fuera
 * del ciclo, una nota que se queda abierta y sigue sonando para siempre, y una
 * toma vacia que se cuela como capa fantasma.
 */

const FPS = 60;
const silent: LiveSnapshot = { gateEvent: null, gateOpen: false, freq: 440, cutoffNorm: 0.5, gain: 0.8 };
const holding: LiveSnapshot = { ...silent, gateOpen: true };

/** Reproduce una grabacion fotograma a fotograma. */
function play(take: LoopTake, script: Array<{ at: number; live: LiveSnapshot }>, seconds: number): void {
  let next = 0;
  for (let frame = 0; frame <= seconds * FPS; frame += 1) {
    const t = frame / FPS;
    const cue = script[next];
    if (cue && t >= cue.at) {
      take.capture(t, cue.live);
      next += 1;
      continue;
    }
    take.capture(t, script[next - 1]?.live.gateOpen ? holding : silent);
  }
}

describe('toma de una capa de bucle', () => {
  it('la primera capa fija el ciclo con su propia duracion', () => {
    const take = new LoopTake('theremin', 0, 0);
    play(take, [{ at: 0.2, live: { ...silent, gateEvent: 'attack', gateOpen: true } }, { at: 2.4, live: { ...silent, gateEvent: 'release' } }], 3);
    const finished = take.finish(3);
    expect(finished).not.toBe(null);
    expect(finished!.cycleSeconds).toBeCloseTo(3, 5);
  });

  it('nunca coloca un evento fuera del ciclo', () => {
    // Se graba encima, empezando cerca del final de la vuelta: los eventos
    // tienen que dar la vuelta y caer al principio, no salirse por arriba.
    const cycle = 4;
    const take = new LoopTake('bass', 3.5, cycle);
    play(take, [{ at: 0.1, live: { ...silent, gateEvent: 'attack', gateOpen: true } }, { at: 1.9, live: { ...silent, gateEvent: 'release' } }], 2);
    const finished = take.finish(2)!;
    expect(finished.events.length).toBeGreaterThan(2);
    for (const event of finished.events) {
      expect(event.t).toBeGreaterThanOrEqual(0);
      expect(event.t).toBeLessThan(cycle);
    }
    // Y tienen que quedar ordenados, porque asi se programan en cada vuelta.
    const times = finished.events.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('cierra una nota que seguia abierta al parar', () => {
    const take = new LoopTake('flute', 0, 0);
    // Se ataca y no se suelta nunca: sin arreglo, esa nota sonaria para siempre.
    play(take, [{ at: 0.2, live: { ...silent, gateEvent: 'attack', gateOpen: true } }], 2);
    const finished = take.finish(2)!;

    // La propiedad que importa es el equilibrio, no que la suelta sea el ultimo
    // evento de la lista. Una nota que se sostiene hasta el final del ciclo
    // suelta al principio de la vuelta siguiente, y ahi su evento queda el
    // primero tras ordenar. Eso es correcto: es una nota que cruza la frontera
    // del bucle, igual que las de una capa grabada a caballo entre dos vueltas.
    const attacks = finished.events.filter((e) => e.kind === 'attack').length;
    const releases = finished.events.filter((e) => e.kind === 'release').length;
    expect(attacks).toBeGreaterThan(0);
    expect(releases).toBe(attacks);
  });

  it('equilibra ataques y sueltas tambien grabando a caballo entre dos vueltas', () => {
    const take = new LoopTake('bass', 3.6, 4);
    play(take, [{ at: 0.1, live: { ...silent, gateEvent: 'attack', gateOpen: true } }], 1.5);
    const finished = take.finish(1.5)!;
    expect(finished.events.filter((e) => e.kind === 'release')).toHaveLength(1);
    // La suelta queda antes que el ataque dentro del ciclo: la nota empieza
    // cerca del final de una vuelta y termina al principio de la siguiente.
    const attack = finished.events.find((e) => e.kind === 'attack')!;
    const release = finished.events.find((e) => e.kind === 'release')!;
    expect(release.t).toBeLessThan(attack.t);
  });

  it('descarta una toma en la que no se ha tocado nada', () => {
    const take = new LoopTake('theremin', 0, 0);
    play(take, [], 2);
    expect(take.finish(2)).toBe(null);
  });

  it('muestrea los parametros en lugar de guardar cada fotograma', () => {
    const take = new LoopTake('strings', 0, 0);
    play(take, [{ at: 0, live: { ...silent, gateEvent: 'attack', gateOpen: true } }, { at: 4, live: { ...silent, gateEvent: 'release' } }], 4);
    const finished = take.finish(4)!;
    const params = finished.events.filter((e) => e.kind === 'param').length;
    // Cuatro segundos a 60 fps son 240 fotogramas; el limite son 30 por segundo.
    expect(params).toBeLessThanOrEqual(4 * PARAM_HZ + 2);
    expect(params).toBeGreaterThan(4 * PARAM_HZ * 0.7);
  });

  it('no guarda parametros mientras no suena nada', () => {
    const take = new LoopTake('theremin', 0, 0);
    play(take, [{ at: 0.5, live: { ...silent, gateEvent: 'attack', gateOpen: true } }, { at: 1, live: { ...silent, gateEvent: 'release' } }], 4);
    const finished = take.finish(4)!;
    // Tres segundos de silencio al final no deben dejar rastro.
    const lastParam = Math.max(...finished.events.filter((e) => e.kind === 'param').map((e) => e.t));
    expect(lastParam).toBeLessThan(1.2);
  });

  it('recorta la primera capa a los limites de duracion', () => {
    const short = new LoopTake('theremin', 0, 0);
    play(short, [{ at: 0, live: { ...silent, gateEvent: 'attack', gateOpen: true } }, { at: 0.2, live: { ...silent, gateEvent: 'release' } }], 0.3);
    expect(short.finish(0.3)!.cycleSeconds).toBe(MIN_CYCLE_SECONDS);

    const long = new LoopTake('theremin', 0, 0);
    play(long, [{ at: 0, live: { ...silent, gateEvent: 'attack', gateOpen: true } }, { at: 1, live: { ...silent, gateEvent: 'release' } }], 2);
    // Una toma abierta avisa de que ha llegado al tope; una ya cerrada no,
    // porque su ciclo ya esta fijado.
    expect(long.overflowed(MAX_CYCLE_SECONDS)).toBe(true);
    expect(long.overflowed(5)).toBe(false);
    expect(long.finish(999)!.cycleSeconds).toBe(MAX_CYCLE_SECONDS);
  });

  it('una sobregrabacion se corta al completar una vuelta', () => {
    // Sin tope, la segunda pasada se pliega sobre los mismos instantes que la
    // primera y los eventos de ambas chocan sobre una voz monofonica: la capa
    // no sale mas larga, sale corrompida.
    const cycle = 3;
    const overdub = new LoopTake('bass', 0, cycle);
    expect(overdub.overflowed(cycle - 0.1)).toBe(false);
    expect(overdub.overflowed(cycle)).toBe(true);

    // La primera capa, en cambio, puede crecer hasta el tope absoluto.
    const first = new LoopTake('bass', 0, 0);
    expect(first.overflowed(cycle)).toBe(false);
    expect(first.overflowed(MAX_CYCLE_SECONDS)).toBe(true);
  });

  it('graba una nota que ya sonaba al pulsar grabar', () => {
    // Se esta tocando, gusta como suena, y se pulsa grabar sin soltar la pinza.
    // No llega ningun evento de ataque, solo fotogramas con el gate abierto.
    const take = new LoopTake('theremin', 0, 0);
    for (let frame = 0; frame <= 2 * FPS; frame += 1) {
      take.capture(frame / FPS, { ...silent, gateOpen: true });
    }
    const finished = take.finish(2);
    expect(finished, 'la toma no deberia descartarse').not.toBe(null);
    const attacks = finished!.events.filter((e) => e.kind === 'attack');
    expect(attacks).toHaveLength(1);
    expect(finished!.events.filter((e) => e.kind === 'release')).toHaveLength(1);
  });

  it('wrapTime devuelve siempre algo dentro del ciclo', () => {
    for (const t of [-9.5, -0.1, 0, 3.9, 4, 12.3]) {
      const w = wrapTime(t, 4);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(4);
    }
    expect(wrapTime(7, 0)).toBe(7);
  });
});
