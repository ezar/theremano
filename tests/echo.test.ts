import { describe, expect, it } from 'vitest';
import { answer, answerHits, isEchoKind, type EchoKind } from '../src/audio/echo';
import { hasWholeNotes } from '../src/state/performance';
import { createLayout, freqToMidi, midiToFreq, pitchAt, xForMidi } from '../src/mapping/scales';
import type { DrumHitEvent, LoopEvent } from '../src/audio/loopTake';

/**
 * El eco contesta en vez de repetir, y eso lo puede estropear de dos formas que
 * no dan ningun error.
 *
 * La primera es desafinar: una inversion saca notas que no son grados de la
 * escala, y una respuesta desafinada contra su llamada es exactamente lo
 * contrario de lo que se busca. La segunda es dejar una nota abierta: al dar la
 * vuelta al tiempo, el final de una nota pasa a ser su principio, y sin cambiar
 * ataques por sueltas la capa sale con una nota que no se cierra en toda la
 * vuelta y se convierte en un bordon que ya no para.
 */

const CYCLE = 4;
const LAYOUT = createLayout('pentatonic', 9, 3, 2);

const note = (t: number, midi: number, seconds: number): LoopEvent[] => {
  const freq = midiToFreq(midi);
  return [
    { t, kind: 'attack', freq, cutoffNorm: 0.5, gain: 0.8 },
    { t: t + seconds / 2, kind: 'param', freq, cutoffNorm: 0.5, gain: 0.8 },
    { t: t + seconds, kind: 'release', freq, cutoffNorm: 0.5, gain: 0.8 },
  ];
};

/** Tres notas subiendo, que es lo que hace falta para que se note una inversion. */
const rising = [...note(0.5, 69, 0.5), ...note(1.5, 72, 0.5), ...note(2.5, 76, 0.5)];

const midisOf = (events: readonly LoopEvent[]): number[] =>
  events.filter((e) => e.kind === 'attack').map((e) => Math.round(freqToMidi(e.freq)));

describe('el eco que contesta', () => {
  it('invertida baja donde la llamada subia', () => {
    // Es lo que la hace una respuesta y no un doblaje: sale de la misma nota y
    // se va para el otro lado.
    const back = midisOf(answer(rising, 'invert', LAYOUT, CYCLE));
    const call = midisOf(rising);
    expect(back[0]).toBe(call[0]);
    expect(back[1]).toBeLessThan(back[0]!);
    expect(back[2]).toBeLessThan(back[1]!);
  });

  it('en quinta sube y se mantiene', () => {
    const back = midisOf(answer(rising, 'fifth', LAYOUT, CYCLE));
    for (let i = 0; i < back.length; i += 1) expect(back[i]).toBeGreaterThan(midisOf(rising)[i]!);
  });

  it('ninguna respuesta se sale de la escala', () => {
    /*
     * Una tercera menor invertida sobre una pentatonica cae en un hueco. Sin
     * ajustar, la respuesta suena desafinada contra la llamada; ajustando, cae
     * en notas que ademas se pueden tocar con la mano, que es de donde salen.
     */
    const tocables = new Set(LAYOUT.degrees.map((degree) => LAYOUT.baseMidi + degree));
    for (const kind of ['invert', 'fifth'] as EchoKind[]) {
      for (const midi of midisOf(answer(rising, kind, LAYOUT, CYCLE))) {
        expect(tocables.has(midi), `${kind} saca ${midi}`).toBe(true);
      }
    }
  });

  it('en espejo da la vuelta al tiempo sin dejar notas abiertas', () => {
    const back = answer(rising, 'mirror', LAYOUT, CYCLE);
    // La comprobacion de verdad es la misma que exige el enlace para no
    // reproducir una capa rota: ataques y sueltas alternandose al dar la vuelta.
    expect(hasWholeNotes(back)).toBe(true);
    expect(back[0]!.kind).toBe('attack');
    // La ultima nota de la llamada es la primera de la respuesta.
    expect(Math.round(freqToMidi(back[0]!.freq))).toBe(midisOf(rising)[2]);
    // Y en orden de tiempo, que es como lo programa el reproductor.
    for (let i = 1; i < back.length; i += 1) expect(back[i]!.t).toBeGreaterThanOrEqual(back[i - 1]!.t);
  });

  it('en espejo no toca las alturas, solo el tiempo', () => {
    // Dar la vuelta al tiempo ya es la respuesta: mover ademas las notas seria
    // dos transformaciones donde se pidio una, y lo que sale no se reconoce.
    const back = answer(rising, 'mirror', LAYOUT, CYCLE);
    expect(new Set(midisOf(back))).toEqual(new Set(midisOf(rising)));
  });

  it('una capa vacia no produce una respuesta fantasma', () => {
    expect(answer([], 'invert', LAYOUT, CYCLE)).toEqual([]);
    expect(answer([], 'mirror', LAYOUT, CYCLE)).toEqual([]);
  });

  it('un ritmo contesta del reves, que es lo unico que se le puede hacer', () => {
    // A un bombo no se le invierte el intervalo ni se le sube una quinta: un
    // golpe no tiene altura que dar la vuelta. Un ritmo si tiene derecho y reves.
    const hits: DrumHitEvent[] = [
      { t: 0, piece: 'kick', force: 0.9, open: false },
      { t: 1, piece: 'snare', force: 0.8, open: false },
      { t: 3.5, piece: 'hat', force: 0.5, open: false },
    ];
    const back = answerHits(hits, CYCLE);
    expect(back.map((h) => h.piece)).toEqual(['hat', 'snare', 'kick']);
    expect(back.map((h) => h.t)).toEqual([0.5, 3, 4]);
    // La fuerza y el charles abierto viajan con su golpe, no con su sitio.
    expect(back[0]!.force).toBe(0.5);
  });

  it('solo se reconocen las tres clases que existen', () => {
    // Lo que llega de unos ajustes guardados por una version anterior, o de una
    // direccion escrita a mano. Una clase inventada aqui no da un error: da una
    // respuesta que no es ninguna de las tres.
    expect(isEchoKind('invert')).toBe(true);
    expect(isEchoKind('mirror')).toBe(true);
    expect(isEchoKind('fifth')).toBe(true);
    expect(isEchoKind('retrograde')).toBe(false);
    expect(isEchoKind(null)).toBe(false);
  });

  it('la respuesta cae donde se puede poner la mano', () => {
    /*
     * Es lo que hace que el fantasma de la respuesta sirva para algo: si la nota
     * no fuera un grado de la escala, la mano dibujada senalaria un sitio donde
     * poniendo la mano suena otra cosa.
     */
    for (const event of answer(rising, 'invert', LAYOUT, CYCLE)) {
      const midi = freqToMidi(event.freq);
      expect(pitchAt(LAYOUT, xForMidi(LAYOUT, midi)).midi).toBeCloseTo(midi, 6);
    }
  });
});
