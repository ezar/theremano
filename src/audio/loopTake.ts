import type { PresetId } from './presets';

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

export interface LiveSnapshot {
  gateEvent: 'attack' | 'release' | null;
  gateOpen: boolean;
  freq: number;
  cutoffNorm: number;
  gain: number;
}

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
  /** Duracion del ciclo tras cerrar la toma. */
  cycleSeconds: number;
}

export class LoopTake {
  private readonly events: LoopEvent[] = [];
  private lastParamAt = -Infinity;

  constructor(
    readonly presetId: PresetId,
    /** Posicion dentro del ciclo en que empezo la grabacion. */
    private readonly offset: number,
    /** Duracion del ciclo ya establecida, o 0 si esta es la primera capa. */
    private cycleSeconds: number,
  ) {}

  get isFirst(): boolean {
    return this.cycleSeconds === 0;
  }

  get hasNotes(): boolean {
    return this.events.some((e) => e.kind === 'attack');
  }

  /** true si la primera capa ha llegado al tope y hay que cerrarla. */
  overflowed(elapsed: number): boolean {
    return this.isFirst && elapsed >= MAX_CYCLE_SECONDS;
  }

  /** @param elapsed segundos desde que empezo la grabacion. */
  capture(elapsed: number, live: LiveSnapshot): void {
    const t = wrapTime(this.offset + elapsed, this.cycleSeconds);
    const base = { freq: live.freq, cutoffNorm: live.cutoffNorm, gain: live.gain };

    if (live.gateEvent === 'attack') {
      this.events.push({ t, kind: 'attack', ...base });
      this.lastParamAt = elapsed;
      return;
    }
    if (live.gateEvent === 'release') {
      this.events.push({ t, kind: 'release', ...base });
      return;
    }
    // Fuera de las notas no hay nada que guardar, y dentro basta con muestrear:
    // guardar los sesenta fotogramas por segundo multiplicaria el tamano sin
    // que se oyera la diferencia.
    if (!live.gateOpen) return;
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
    }

    // Una nota que sigue abierta al cortar sonaria para siempre en cada vuelta.
    const last = this.events[this.events.length - 1]!;
    if (last.kind !== 'release') {
      this.events.push({ ...last, kind: 'release', t: wrapTime(this.offset + elapsed, this.cycleSeconds) });
    }
    this.events.sort((a, b) => a.t - b.t);

    return { presetId: this.presetId, events: this.events, cycleSeconds: this.cycleSeconds };
  }
}
