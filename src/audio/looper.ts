import * as Tone from 'tone';
import { getPreset, type Preset, type PresetId } from './presets';
import { LoopTake, type LiveSnapshot, type LoopEvent } from './loopTake';

export type { LoopEvent } from './loopTake';
export { MAX_CYCLE_SECONDS, MIN_CYCLE_SECONDS } from './loopTake';

/**
 * Estacion de bucles.
 *
 * No graba audio: graba los gestos. Cada capa es una lista de eventos de
 * control (ataque, suelta, y una instantanea de tono, brillo y volumen) que se
 * reproducen sobre una voz propia del sintetizador.
 *
 * La alternativa habitual, grabar el audio con MediaRecorder y reproducirlo en
 * bucle, tiene tres problemas que aqui no existen: el codec mete un silencio al
 * principio y al final que se oye como un hueco en cada vuelta, la memoria
 * crece con la duracion, y una capa grabada es una foto muerta. Con eventos, el
 * bucle se vuelve a sintetizar cada vuelta, empalma exacto y pesa unos pocos
 * kilobytes.
 *
 * El precio es que esto introduce polifonia, que la v1 dejaba fuera a
 * proposito. Pero la voz en directo sigue siendo una sola: lo que suena a la vez
 * son grabaciones del propio interprete, que es justo lo que hace un pedal de
 * bucles.
 */

export const MAX_TRACKS = 4;

/** Colores de las capas, en grados de tono. Se reparten para distinguirlas. */
const TRACK_HUES = [46, 165, 275, 200];

export interface LoopTrack {
  id: number;
  presetId: PresetId;
  events: LoopEvent[];
  muted: boolean;
  hue: number;
}

/** Una voz de reproduccion: sintetizador propio por capa. */
class LoopVoice {
  private readonly synth: Tone.Synth;
  private readonly vibrato: Tone.Vibrato;
  private readonly filter: Tone.Filter;
  private readonly delay: Tone.FeedbackDelay;
  private readonly reverb: Tone.Freeverb;
  private readonly gain: Tone.Gain;
  private readonly preset: Preset;

  constructor(preset: Preset, output: Tone.InputNode) {
    this.preset = preset;
    this.gain = new Tone.Gain(0).connect(output);
    // La cadena de la capa replica la de la voz en directo, reverberacion
    // incluida. Sin ella, una capa de cuerdas se reproduce seca y suena a otro
    // instrumento distinto del que se acaba de grabar.
    this.reverb = new Tone.Freeverb({ roomSize: 0.7, dampening: 2600, wet: preset.reverbWet }).connect(this.gain);
    this.delay = new Tone.FeedbackDelay({
      delayTime: preset.delay.time,
      feedback: preset.delay.feedback,
      wet: preset.delay.wet,
      maxDelay: 1,
    }).connect(this.reverb);
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 2000, Q: preset.filter.q }).connect(this.delay);
    this.vibrato = new Tone.Vibrato({
      frequency: preset.vibrato.frequency || 5,
      depth: preset.vibrato.depth,
    }).connect(this.filter);
    this.synth = new Tone.Synth({
      oscillator: preset.oscillator as Tone.SynthOptions['oscillator'],
      envelope: preset.envelope,
      portamento: 0,
    }).connect(this.vibrato);
  }

  /** @param cycleStart tiempo del contexto de audio en que empieza la vuelta. */
  schedule(events: readonly LoopEvent[], cycleStart: number): void {
    // Sin esto, las rampas de la vuelta anterior se solapan con las de esta y
    // los parametros derivan vuelta a vuelta.
    this.filter.frequency.cancelScheduledValues(cycleStart);
    this.gain.gain.cancelScheduledValues(cycleStart);
    this.synth.frequency.cancelScheduledValues(cycleStart);

    const { minHz, maxHz } = this.preset.filter;
    for (const event of events) {
      const at = cycleStart + event.t;
      const cutoff = minHz * (maxHz / minHz) ** Math.min(1, Math.max(0, event.cutoffNorm));
      const gain = event.gain * this.preset.trim;

      switch (event.kind) {
        case 'attack':
          this.synth.frequency.setValueAtTime(event.freq, at);
          this.gain.gain.setValueAtTime(gain, at);
          this.filter.frequency.setValueAtTime(cutoff, at);
          this.synth.triggerAttack(event.freq, at);
          break;
        case 'release':
          this.synth.triggerRelease(at);
          break;
        case 'param':
          // Rampas cortas en lugar de saltos: un salto en una frecuencia o en
          // una ganancia es una discontinuidad, y eso es un chasquido.
          this.synth.frequency.exponentialRampToValueAtTime(event.freq, at);
          this.filter.frequency.exponentialRampToValueAtTime(cutoff, at);
          this.gain.gain.linearRampToValueAtTime(gain, at);
          break;
      }
    }
  }

  silence(): void {
    this.synth.triggerRelease();
    this.gain.gain.cancelScheduledValues(Tone.now());
    this.gain.gain.rampTo(0, 0.02);
  }

  dispose(): void {
    this.synth.dispose();
    this.vibrato.dispose();
    this.filter.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.gain.dispose();
  }
}

interface Recording {
  take: LoopTake;
  /** Tiempo del contexto de audio al pulsar grabar. */
  startedAt: number;
}

export interface LoopState {
  recording: boolean;
  /** Segundos grabados en la toma actual. */
  recordedSeconds: number;
  cycleSeconds: number;
  /** Posicion del cabezal dentro del ciclo, de 0 a 1. Vale -1 si no hay bucles. */
  playhead: number;
  tracks: readonly LoopTrack[];
  full: boolean;
}

export class Looper {
  private output: Tone.InputNode | null = null;
  private readonly tracks: LoopTrack[] = [];
  private readonly voices = new Map<number, LoopVoice>();
  private recordingTake: Recording | null = null;
  private cycleSeconds = 0;
  private repeatId: number | null = null;
  private nextId = 1;

  attach(output: Tone.InputNode): void {
    this.output = output;
  }

  get isRecording(): boolean {
    return this.recordingTake !== null;
  }

  get isEmpty(): boolean {
    return this.tracks.length === 0;
  }

  get state(): LoopState {
    const transport = this.cycleSeconds > 0 ? Tone.getTransport() : null;
    const position = transport ? (transport.seconds % this.cycleSeconds) / this.cycleSeconds : -1;
    return {
      recording: this.recordingTake !== null,
      recordedSeconds: this.recordingTake ? Math.max(0, Tone.now() - this.recordingTake.startedAt) : 0,
      cycleSeconds: this.cycleSeconds,
      playhead: position,
      tracks: this.tracks,
      full: this.tracks.length >= MAX_TRACKS,
    };
  }

  /**
   * Alterna grabacion.
   *
   * Distingue una toma que ha dejado capa de una que se ha descartado por estar
   * vacia: son cosas distintas y decirle al interprete que ha grabado algo
   * cuando no hay nada es peor que no decir nada.
   */
  toggle(presetId: PresetId): 'started' | 'saved' | 'discarded' | 'rejected' {
    if (this.recordingTake) {
      return this.finish() ? 'saved' : 'discarded';
    }
    if (!this.output || this.tracks.length >= MAX_TRACKS) return 'rejected';

    const transport = Tone.getTransport();
    // La primera capa arranca en cero y define el ciclo. Las siguientes se
    // colocan donde este el cabezal, para poder grabar encima sin esperar a que
    // la vuelta termine.
    const offset = this.cycleSeconds > 0 ? transport.seconds % this.cycleSeconds : 0;
    this.recordingTake = { take: new LoopTake(presetId, offset, this.cycleSeconds), startedAt: Tone.now() };
    return 'started';
  }

  /**
   * Se llama en cada fotograma con el estado en directo. Solo guarda algo si hay
   * una toma abierta.
   */
  capture(live: LiveSnapshot): void {
    const recording = this.recordingTake;
    if (!recording) return;

    const elapsed = Tone.now() - recording.startedAt;
    // La primera capa define el ciclo, asi que no puede crecer sin limite.
    if (recording.take.overflowed(elapsed)) {
      this.finish();
      return;
    }
    recording.take.capture(elapsed, live);
  }

  /** Silencia o reactiva una capa. */
  setMuted(id: number, muted: boolean): void {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    track.muted = muted;
    if (muted) this.voices.get(id)?.silence();
  }

  /** Quita la ultima capa grabada. */
  undo(): void {
    const track = this.tracks.pop();
    if (!track) return;
    this.voices.get(track.id)?.silence();
    this.voices.get(track.id)?.dispose();
    this.voices.delete(track.id);
    if (this.tracks.length === 0) this.stopTransport();
  }

  clear(): void {
    this.recordingTake = null;
    for (const voice of this.voices.values()) {
      voice.silence();
      voice.dispose();
    }
    this.voices.clear();
    this.tracks.length = 0;
    this.stopTransport();
  }

  dispose(): void {
    this.clear();
    this.output = null;
  }

  /** @returns true si la toma ha llegado a convertirse en capa. */
  private finish(): boolean {
    const recording = this.recordingTake;
    this.recordingTake = null;
    if (!recording || !this.output) return false;

    const finished = recording.take.finish(Tone.now() - recording.startedAt);
    // Una toma sin una sola nota es un doble pulsado sin querer.
    if (!finished) return false;
    this.cycleSeconds = finished.cycleSeconds;

    const track: LoopTrack = {
      id: this.nextId++,
      presetId: finished.presetId,
      events: finished.events,
      muted: false,
      hue: TRACK_HUES[this.tracks.length % TRACK_HUES.length]!,
    };
    this.tracks.push(track);
    this.voices.set(track.id, new LoopVoice(getPreset(track.presetId), this.output));
    this.startTransport();
    return true;
  }

  private startTransport(): void {
    const transport = Tone.getTransport();
    if (this.repeatId !== null) return;
    transport.stop();
    transport.seconds = 0;
    // Un unico scheduleRepeat programa todas las capas de la vuelta. Con esto no
    // hace falta Transport.loop: el propio repetidor marca el ciclo.
    this.repeatId = transport.scheduleRepeat((time) => {
      for (const track of this.tracks) {
        if (track.muted) continue;
        this.voices.get(track.id)?.schedule(track.events, time);
      }
    }, this.cycleSeconds, 0);
    transport.start();
  }

  private stopTransport(): void {
    const transport = Tone.getTransport();
    if (this.repeatId !== null) transport.clear(this.repeatId);
    this.repeatId = null;
    transport.stop();
    transport.seconds = 0;
    this.cycleSeconds = 0;
  }
}
