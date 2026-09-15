import { describe, expect, it } from 'vitest';
import { BEAT_SECONDS, DrumDemoPerformance, LEAD_IN_SECONDS } from '../src/mapping/drumDemo';
import { drawnScale, phantomHand } from '../src/tracking/phantom';
import { KIT } from '../src/mapping/kit';
import { Mapper, type DrumHit } from '../src/mapping/mapper';
import { DEFAULT_SETTINGS } from '../src/state/store';

/**
 * La demostracion de bateria no tiene motor propio: pone dos manos de mentira
 * delante del mapeador de verdad, y el ritmo que se oye es el que salga del
 * detector de golpes. Eso es lo que se comprueba aqui, porque es lo unico que
 * puede romperse sin que se vea venir: una coreografia que levanta poco la mano
 * deja de disparar golpes y la demostracion se queda muda, con las dos manos
 * moviendose en silencio.
 */

const WIDE = 16 / 9;
const TALL = 0.46;

interface Played extends DrumHit {
  /** Cuando sono, en segundos desde el principio. */
  t: number;
}

/** Toca la demostracion entera y devuelve los golpes que sonaron. */
function play(fps: number, aspect = WIDE, bands = KIT): Played[] {
  const mapper = new Mapper({ ...DEFAULT_SETTINGS, drums: true, kitBands: [...bands] });
  const performance = new DrumDemoPerformance(bands);
  const played: Played[] = [];
  const dt = 1 / fps;
  const hand = (pose: { x: number; y: number; pinch: number; tilt: number }) => {
    const landmarks = phantomHand({ ...pose, aspect, scale: drawnScale(aspect) });
    return { hand: { landmarks, raw: landmarks }, held: false, heldFor: 0 };
  };
  for (let frame = 0; ; frame += 1) {
    const seconds = frame * dt;
    if (performance.finishedAt(seconds)) break;
    const pose = performance.poseAt(seconds);
    const output = mapper.update({ melody: hand(pose.melody), expression: hand(pose.expression) }, seconds);
    for (const hit of output.strikes) played.push({ ...hit, t: seconds });
  }
  return played;
}

/** El compas al que pertenece un golpe, contando desde cero. */
const beatOf = (hit: Played): number => (hit.t - LEAD_IN_SECONDS) / BEAT_SECONDS;

describe('la demostracion de bateria', () => {
  it('suena entera, y suena el ritmo que esta escrito', () => {
    const played = play(60);
    // Quince golpes de bombo y caja, veinticuatro de la otra mano.
    expect(played.length).toBe(39);
    expect(played.filter((h) => h.piece === 'kick').length).toBe(9);
    expect(played.filter((h) => h.piece === 'snare').length).toBe(6);
    expect(played.filter((h) => h.piece === 'hat').length).toBe(23);
    expect(played.filter((h) => h.piece === 'crash').length).toBe(1);
  });

  it('el plato es el ultimo y solo suena una vez', () => {
    const played = play(60);
    expect(played[played.length - 1]!.piece).toBe('crash');
  });

  it('el charles abierto es uno solo, y detras viene el cerrado que lo apaga', () => {
    // Si se abrieran todos, la demostracion ensenaria un charles emborronado; si
    // no se abriera ninguno, la funcion no se ensenaria en absoluto. Las dos
    // cosas se rompen solas al tocar el umbral de la pinza.
    const played = play(60);
    const open = played.filter((h) => h.open);
    expect(open.length).toBe(1);
    expect(open[0]!.piece).toBe('hat');
    const after = played.filter((h) => h.piece === 'hat' && h.t > open[0]!.t);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]!.open).toBe(false);
  });

  it('el ritmo cae donde esta escrito, sin correrse mas de una fraccion de tiempo', () => {
    // El golpe suena antes de que la mano aterrice -el detector dispara en la
    // bajada-, asi que lo que importa no es que caiga en el tiempo exacto sino
    // que todos se adelanten lo mismo: eso es lo que se oye recto.
    const played = play(60);
    const early = played.map((hit) => Math.round(beatOf(hit) * 2) / 2 - beatOf(hit));
    const min = Math.min(...early);
    const max = Math.max(...early);
    expect(min).toBeGreaterThan(0);
    expect(max - min).toBeLessThan(0.08);
  });

  it('la caja pega mas fuerte que el charles', () => {
    // La coreografia no tiene ningun parametro de fuerza: sale de la altura
    // desde la que cae cada mano. Si eso se pierde, el ritmo suena a maquina.
    const played = play(60);
    const average = (piece: string): number => {
      const hits = played.filter((h) => h.piece === piece);
      return hits.reduce((sum, h) => sum + h.force, 0) / hits.length;
    };
    expect(average('snare')).toBeGreaterThan(average('hat') + 0.2);
  });

  it('sigue al kit: el mismo ritmo con las piezas cambiadas de sitio', () => {
    /*
     * El ritmo esta escrito en piezas y no en bandas, asi que quien haya movido
     * el plato a la izquierda tiene que ver a la mano irse a la izquierda a
     * buscarlo y oir el mismo ritmo. Si la coreografia mirase el reparto de
     * fabrica, las manos golpearian en el mismo sitio de siempre y lo que
     * sonaria seria otra cosa: el ritmo del reves.
     */
    const bands = [...KIT].reverse();
    const moved = play(60, WIDE, bands);
    const factory = play(60);
    expect(moved.map((h) => h.piece)).toEqual(factory.map((h) => h.piece));
    // Y las manos han ido de verdad a otro sitio, o esto no probaria nada.
    expect(moved[0]!.x).not.toBeCloseTo(factory[0]!.x, 2);
  });

  it('tambien suena a treinta fotogramas y en vertical', () => {
    // Un movil que va a treinta no puede quedarse sin la mitad de los golpes, y
    // el encuadre vertical estrecha las bandas: es donde una mano se sale de la
    // suya.
    const slow = play(30);
    expect(slow.length).toBe(39);
    const tall = play(60, TALL);
    expect(tall.length).toBe(39);
    expect(tall.map((h) => h.piece)).toEqual(play(60).map((h) => h.piece));
  });
});
