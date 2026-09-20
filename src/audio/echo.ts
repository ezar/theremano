import { midiToFreq, pitchAt, xForMidi, type PitchLayout } from '../mapping/scales';
import { freqToMidi } from '../mapping/scales';
import type { DrumHitEvent, LoopEvent } from './loopTake';

/**
 * El eco que contesta: una capa que RESPONDE a lo que tocaste.
 *
 * La estacion de bucles repite. Esto no repite: da la vuelta a lo que hay y lo
 * pone a sonar al lado del original, de modo que lo que se oye es una llamada y
 * una respuesta y no una nota doblada. Es la diferencia entre un bucle y un
 * duo consigo mismo.
 *
 * Es aditivo a proposito, y ahi esta todo. Transformar la capa en su sitio seria
 * mas barato y no serviria: sin la llamada no hay respuesta, hay otra melodia.
 * La capa original se queda como estaba y la respuesta es una capa nueva, con su
 * carril, su color y su boton de silencio, que se puede deshacer sola.
 *
 * Lo que sale de aqui es una capa normal y corriente: viaja en el enlace como
 * cualquier otra, se puede silenciar, se le dibuja su mano fantasma. Nadie mas
 * en la aplicacion tiene que saber que esa capa es una respuesta.
 */

export type EchoKind = 'invert' | 'mirror' | 'fifth';

export const ECHO_KINDS: readonly EchoKind[] = ['invert', 'mirror', 'fifth'];

export function isEchoKind(value: unknown): value is EchoKind {
  return typeof value === 'string' && (ECHO_KINDS as readonly string[]).includes(value);
}

/** Lo que sube una quinta, en semitonos. */
const FIFTH = 7;

/**
 * Ajusta una nota a la escala de ahora.
 *
 * Invertir o transponer saca notas que no son grados de la escala: una tercera
 * menor invertida sobre una pentatonica cae en un hueco. Sin ajustar, la
 * respuesta suena desafinada contra la llamada, que es justo lo contrario de lo
 * que se busca; ajustando, la respuesta es la de un instrumento cuantizado, que
 * es lo que este es.
 *
 * Va por el mismo camino que usa el fantasma para saber donde poner la mano: la
 * posicion de esa nota en el encuadre, y la nota que de verdad suena ahi. Asi la
 * respuesta cae exactamente en notas que se pueden tocar con la mano.
 */
function toScale(midi: number, layout: PitchLayout): number {
  return pitchAt(layout, xForMidi(layout, midi)).midi;
}

/**
 * La nota sobre la que gira una inversion.
 *
 * La primera que sono, porque es la que el oido toma como referencia: lo que se
 * oye es que la respuesta sale del mismo sitio que la llamada y se va para el
 * otro lado. Con un pivote en el centro del rango, en cambio, la respuesta
 * empieza en otra nota y suena a una melodia distinta que ademas va al reves.
 */
function pivotOf(events: readonly LoopEvent[]): number {
  const first = events.find((event) => event.kind === 'attack') ?? events[0];
  return first ? freqToMidi(first.freq) : 0;
}

/**
 * La respuesta a una capa de melodia.
 *
 * @param layout la escala de AHORA. La capa guarda frecuencias y la respuesta
 * tiene que caer en notas tocables, que es lo que depende de la escala puesta.
 */
export function answer(events: readonly LoopEvent[], kind: EchoKind, layout: PitchLayout, cycleSeconds: number): LoopEvent[] {
  if (events.length === 0) return [];
  if (kind === 'mirror') return mirrored(events, cycleSeconds);

  const pivot = pivotOf(events);
  return events.map((event) => {
    const midi = freqToMidi(event.freq);
    // Invertida gira alrededor de la primera nota: lo que subia baja lo mismo.
    // En quinta sube y ya esta, que es la respuesta mas consonante que hay.
    const moved = kind === 'invert' ? 2 * pivot - midi : midi + FIFTH;
    return { ...event, freq: midiToFreq(toScale(moved, layout)) };
  });
}

/**
 * La capa del reves en el tiempo.
 *
 * Y con los ataques y las sueltas cambiados, que es lo que casi siempre se
 * olvida: al dar la vuelta al tiempo, el final de una nota pasa a ser su
 * principio. Sin cambiarlos, la capa sale con las sueltas por delante y los
 * ataques por detras, no pasa la comprobacion de notas enteras -ni la del enlace
 * ni la del sentido comun- y lo que suena es una nota abierta que no se cierra
 * en toda la vuelta.
 */
function mirrored(events: readonly LoopEvent[], cycleSeconds: number): LoopEvent[] {
  return events
    .map((event) => ({
      ...event,
      t: cycleSeconds - event.t,
      kind: event.kind === 'attack' ? ('release' as const) : event.kind === 'release' ? ('attack' as const) : event.kind,
    }))
    .sort((a, b) => a.t - b.t);
}

/**
 * La respuesta a una capa de ritmo: siempre del reves en el tiempo.
 *
 * Sin mirar que clase de eco se haya elegido, porque a un bombo no se le puede
 * invertir el intervalo ni subirlo una quinta: un golpe no tiene altura que dar
 * la vuelta. Lo que si tiene un ritmo es un derecho y un reves, y tocarlo del
 * reves es una respuesta de verdad -el patron sale con los acentos donde habia
 * huecos-, asi que eso es lo que se hace.
 */
export function answerHits(hits: readonly DrumHitEvent[], cycleSeconds: number): DrumHitEvent[] {
  return hits.map((hit) => ({ ...hit, t: cycleSeconds - hit.t })).sort((a, b) => a.t - b.t);
}
