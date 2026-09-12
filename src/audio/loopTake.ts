import type { PresetId } from './presets';
import type { DrumPiece } from '../mapping/kit';

/**
 * La toma de una capa de bucle, sin nada de audio.
 *
 * Aqui vive lo unico de la estacion de bucles que puede estar mal de forma
 * silenciosa: donde cae cada evento dentro del ciclo, que pasa con una nota que
 * sigue abierta al cortar la grabacion, y cuanto se guarda. Separarlo del grafo
 * de Tone.js permite comprobarlo con un reloj falso, sin contexto de audio.
 */

export interface LoopEvent {
  /** Segundos desde el inicio del ciclo. */
  t: number;
  kind: 'attack' | 'release' | 'param';
  freq: number;
  /** 0 = oscuro, 1 = brillante. Se convierte a Hz con el preset de la capa. */
  cutoffNorm: number;
  gain: number;
}

/**
 * Un golpe dentro de una capa.
 *
 * No es un LoopEvent con otros campos y no puede serlo: un evento de melodia es
 * la mitad de una nota —hay un ataque y hay una suelta, y sin las dos la nota se
 * queda abierta para siempre— y un golpe es entero en si mismo. Meterlos en la
 * misma lista obligaria a inventar sueltas que no existen y a que todo lo que
 * valida notas enteras tuviera que mirar antes de que tipo es cada cosa.
 */
export interface DrumHitEvent {
  /** Segundos desde el inicio del ciclo. */
  t: number;
  piece: DrumPiece;
  /** 0 a 1. */
  force: number;
}

export interface LiveSnapshot {
  gateEvent: 'attack' | 'release' | null;
  gateOpen: boolean;
  freq: number;
  cutoffNorm: number;
  gain: number;
  /** Golpes de este fotograma. Casi siempre vacio, y siempre en melodia. */
  strikes: readonly { piece: DrumPiece; force: number }[];
}

/**
 * Capas simultaneas.
 *
 * Vive aqui, en el modulo sin audio, y no junto a la estacion de bucles, porque
 * el codificador de enlaces tambien tiene que conocer el limite: un enlace que
 * declare mas capas de las que se pueden reproducir hay que rechazarlo al leerlo
 * y no recortarlo en silencio al montarlo.
 */
export const MAX_TRACKS = 4;

export const MAX_CYCLE_SECONDS = 20;
export const MIN_CYCLE_SECONDS = 0.8;

/** Ritmo maximo al que se guardan instantaneas de parametros. */
export const PARAM_HZ = 30;

export function wrapTime(t: number, cycleSeconds: number): number {
  if (cycleSeconds <= 0) return t;
  const wrapped = t % cycleSeconds;
  return wrapped < 0 ? wrapped + cycleSeconds : wrapped;
}

export interface FinishedTake {
  presetId: PresetId;
  events: LoopEvent[];
  /** Golpes de la capa. Vacio si es de melodia; lo otro lo esta si es de bateria. */
  hits: DrumHitEvent[];
  drums: boolean;
  /** Duracion del ciclo tras cerrar la toma. */
  cycleSeconds: number;
}

export class LoopTake {
  private readonly events: LoopEvent[] = [];
  private readonly hits: DrumHitEvent[] = [];
  private lastParamAt = -Infinity;
  /** Si hay una nota abierta ahora mismo dentro de la toma. */
  private noteOpen = false;

  constructor(
    readonly presetId: PresetId,
    /** Posicion dentro del ciclo en que empezo la grabacion. */
    private readonly offset: number,
    /** Duracion del ciclo ya establecida, o 0 si esta es la primera capa. */
    private cycleSeconds: number,
    /** Capa de bateria: guarda golpes en lugar de notas. */
    readonly drums = false,
  ) {}

  get isFirst(): boolean {
    return this.cycleSeconds === 0;
  }

  get hasNotes(): boolean {
    return this.drums ? this.hits.length > 0 : this.events.some((e) => e.kind === 'attack');
  }

  /**
   * true cuando la toma ha dado todo lo que puede dar y hay que cerrarla.
   *
   * La primera capa se corta al llegar al tope absoluto. Una sobregrabacion se
   * corta al completar una vuelta: si siguiera, la segunda pasada se plegaria
   * sobre los mismos instantes que la primera y los ataques, sueltas y
   * parametros de ambas chocarian sobre una voz que es monofonica. El resultado
   * no seria una capa mas larga, seria una capa corrompida.
   */
  overflowed(elapsed: number): boolean {
    return elapsed >= (this.isFirst ? MAX_CYCLE_SECONDS : this.cycleSeconds);
  }

  /** @param elapsed segundos desde que empezo la grabacion. */
  capture(elapsed: number, live: LiveSnapshot): void {
    const t = wrapTime(this.offset + elapsed, this.cycleSeconds);

    /*
     * Una capa de bateria no tiene nada que muestrear entre golpe y golpe: el
     * golpe es un instante y lo que hay en medio es silencio. Ni ataques, ni
     * sueltas, ni instantaneas de parametros: eso es lo que la hace pesar tres
     * bytes por golpe en un enlace en vez de seis por evento.
     */
    if (this.drums) {
      for (const strike of live.strikes) this.hits.push({ t, piece: strike.piece, force: strike.force });
      return;
    }

    const base = { freq: live.freq, cutoffNorm: live.cutoffNorm, gain: live.gain };

    if (live.gateEvent === 'attack') {
      this.events.push({ t, kind: 'attack', ...base });
      this.noteOpen = true;
      this.lastParamAt = elapsed;
      return;
    }
    if (live.gateEvent === 'release') {
      this.events.push({ t, kind: 'release', ...base });
      this.noteOpen = false;
      return;
    }
    if (!live.gateOpen) return;

    // Empezar a grabar con una nota ya sonando es lo normal: se esta tocando
    // algo, gusta, y se pulsa grabar sin soltar. Sin este ataque sintetico la
    // toma solo tendria parametros, se daria por vacia y se descartaria entera.
    if (!this.noteOpen) {
      this.events.push({ t, kind: 'attack', ...base });
      this.noteOpen = true;
      this.lastParamAt = elapsed;
      return;
    }

    // Dentro de la nota basta con muestrear: guardar los sesenta fotogramas por
    // segundo multiplicaria el tamano sin que se oyera la diferencia.
    if (elapsed - this.lastParamAt < 1 / PARAM_HZ) return;
    this.lastParamAt = elapsed;
    this.events.push({ t, kind: 'param', ...base });
  }

  /**
   * Cierra la toma. Devuelve null si no vale la pena guardarla, que en la
   * practica es un doble pulsado sin haber tocado nada.
   */
  finish(elapsed: number): FinishedTake | null {
    if (!this.hasNotes) return null;

    if (this.isFirst) {
      // La primera capa define el compas de todo lo que venga despues.
      this.cycleSeconds = Math.min(MAX_CYCLE_SECONDS, Math.max(MIN_CYCLE_SECONDS, elapsed));
      for (const event of this.events) event.t = wrapTime(event.t, this.cycleSeconds);
      for (const hit of this.hits) hit.t = wrapTime(hit.t, this.cycleSeconds);
    }

    if (this.drums) {
      // Sin nota abierta que cerrar: un golpe no deja nada sonando que haya que
      // apagar al cortar la toma.
      this.hits.sort((a, b) => a.t - b.t);
      return { presetId: this.presetId, events: [], hits: this.hits, drums: true, cycleSeconds: this.cycleSeconds };
    }

    // Una nota que sigue abierta al cortar sonaria para siempre en cada vuelta.
    if (this.noteOpen) {
      const last = this.events[this.events.length - 1]!;
      this.events.push({ ...last, kind: 'release', t: wrapTime(this.offset + elapsed, this.cycleSeconds) });
      this.noteOpen = false;
    }
    this.events.sort((a, b) => a.t - b.t);

    return { presetId: this.presetId, events: this.events, hits: [], drums: false, cycleSeconds: this.cycleSeconds };
  }
}
