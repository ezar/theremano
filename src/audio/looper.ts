import * as Tone from 'tone';
import { getPreset, type Preset, type PresetId } from './presets';
import { LoopTake, MAX_TRACKS, type LiveSnapshot, type LoopEvent } from './loopTake';
import { beatsInCycle, beatsLeft, isAccent, isDue, isMissed, planCountIn, type CountInPlan } from './countIn';

export type { LoopEvent } from './loopTake';
export { MAX_CYCLE_SECONDS, MAX_TRACKS, MIN_CYCLE_SECONDS } from './loopTake';
export { COUNT_IN_BEATS } from './countIn';

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

/**
 * La voz de la claqueta.
 *
 * Se crea al empezar la cuenta y se destruye al terminarla o al cancelarla.
 * Destruir el nodo es la forma limpia de cancelar pulsos ya programados: no hay
 * que perseguir envolventes agendadas en el futuro. Antes de destruirlo se baja
 * la ganancia, porque cortar en seco un nodo que esta sonando es una
 * discontinuidad, y eso se oye como un chasquido.
 */
class ClickVoice {
  private readonly synth: Tone.Synth;
  private readonly gain: Tone.Gain;

  constructor(output: Tone.InputNode) {
    this.gain = new Tone.Gain(0.5).connect(output);
    this.synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
    }).connect(this.gain);
  }

  /** @param accent el pulso que marca donde cae el uno, mas agudo. */
  at(time: number, accent: boolean): void {
    this.synth.triggerAttackRelease(accent ? 1600 : 1050, 0.03, time);
  }

  dispose(): void {
    this.gain.gain.cancelScheduledValues(Tone.now());
    this.gain.gain.rampTo(0, 0.02);
    window.setTimeout(() => {
      this.synth.dispose();
      this.gain.dispose();
    }, 80);
  }
}

interface Recording {
  take: LoopTake;
  /** Tiempo del contexto de audio al pulsar grabar. */
  startedAt: number;
}

export interface LoopState {
  recording: boolean;
  /** Pulsos que quedan de claqueta, o 0 si no hay ninguna en marcha. */
  countInBeats: number;
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
  private countIn: { plan: CountInPlan; presetId: PresetId } | null = null;
  private click: ClickVoice | null = null;
  private metronome = false;
  private beatId: number | null = null;

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
      countInBeats: this.countIn ? beatsLeft(this.countIn.plan, Tone.now()) : 0,
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
  toggle(presetId: PresetId): 'started' | 'counting' | 'cancelled' | 'saved' | 'discarded' | 'rejected' {
    if (this.recordingTake) {
      return this.finish() ? 'saved' : 'discarded';
    }
    // Volver a pulsar durante la cuenta la cancela. Sin esto, quien se arrepiente
    // o pulsa sin querer se queda esperando a que termine para poder deshacerlo.
    if (this.countIn) {
      this.stopCountIn();
      return 'cancelled';
    }
    if (!this.output || this.tracks.length >= MAX_TRACKS) return 'rejected';

    // Solo la primera capa lleva claqueta: es la que define el compas partiendo
    // de la nada. En una sobregrabacion el ciclo ya existe y la toma entra donde
    // este el cabezal, asi que contar por delante solo desplazaria la capa.
    if (this.cycleSeconds <= 0) {
      this.startCountIn(presetId);
      return 'counting';
    }

    this.startTake(presetId, Tone.now());
    return 'started';
  }

  /**
   * Claqueta continua mientras hay bucle.
   *
   * Es lo que falta para grabar una segunda capa encima de la primera: sin un
   * pulso que oir, entrar a tiempo es adivinar. Solo suena si hay vuelta; sin
   * bucle no hay compas que marcar.
   */
  setMetronome(on: boolean): void {
    if (this.metronome === on) return;
    this.metronome = on;
    if (on) this.scheduleBeats();
    else {
      const transport = Tone.getTransport();
      if (this.beatId !== null) transport.clear(this.beatId);
      this.beatId = null;
      this.releaseClick();
    }
  }

  private startCountIn(presetId: PresetId): void {
    if (!this.output) return;
    const plan = planCountIn(Tone.now());
    this.countIn = { plan, presetId };
    const click = this.ensureClick();
    for (let i = 0; i < plan.clicks.length; i += 1) click?.at(plan.clicks[i]!, isAccent(i));
  }

  /**
   * El pulso va enganchado al mismo transporte que las capas y arranca en cero,
   * asi que el uno cae donde empieza la vuelta sin tener que sincronizar nada.
   * El acento se decide por la posicion del propio transporte y no contando
   * pulsos: encender la claqueta a mitad de vuelta pondria el acento donde no va.
   */
  private scheduleBeats(): void {
    if (!this.metronome || this.beatId !== null || this.cycleSeconds <= 0) return;
    if (!this.ensureClick()) return;
    const cycle = this.cycleSeconds;
    const beats = beatsInCycle(cycle);
    const beatSeconds = cycle / beats;
    const transport = Tone.getTransport();
    this.beatId = transport.scheduleRepeat((time) => {
      const position = transport.getSecondsAtTime(time) % cycle;
      this.click?.at(time, Math.round(position / beatSeconds) % beats === 0);
    }, beatSeconds, 0);
  }

  private ensureClick(): ClickVoice | null {
    if (!this.click && this.output) this.click = new ClickVoice(this.output);
    return this.click;
  }

  /** La voz del chasquido la comparten claqueta y cuenta atras. */
  private releaseClick(): void {
    if (this.countIn || this.metronome) return;
    this.click?.dispose();
    this.click = null;
  }

  private startTake(presetId: PresetId, startedAt: number): void {
    const transport = Tone.getTransport();
    // La primera capa arranca en cero y define el ciclo. Las siguientes se
    // colocan donde este el cabezal, para poder grabar encima sin esperar a que
    // la vuelta termine.
    const offset = this.cycleSeconds > 0 ? transport.seconds % this.cycleSeconds : 0;
    this.recordingTake = { take: new LoopTake(presetId, offset, this.cycleSeconds), startedAt };
  }

  private stopCountIn(): void {
    this.countIn = null;
    this.releaseClick();
  }

  /**
   * Se llama en cada fotograma con el estado en directo. Solo guarda algo si hay
   * una toma abierta.
   */
  capture(live: LiveSnapshot): void {
    /*
     * La claqueta termina aqui, en el bucle de fotogramas, y no en un
     * temporizador. Un temporizador seria una pieza mas que cancelar, que
     * limpiar y que podria dispararse sobre una estacion ya vaciada; y no daria
     * mas precision, porque el instante que cuenta no es cuando se ejecuta el
     * codigo sino el que se guarda en startedAt, que es el del pulso.
     */
    if (this.countIn && isDue(this.countIn.plan, Tone.now())) {
      const { plan, presetId } = this.countIn;
      this.stopCountIn();
      /*
       * Si el pulso de entrada quedo muy atras, la entrada se perdio y no hay
       * nada que empezar. Pasa cuando el bucle de fotogramas se para en mitad de
       * la cuenta: la pestana se va al fondo, el movil se bloquea. Arrancar ahi
       * la toma con un inicio que ya paso la llenaria de silencio por delante, y
       * con veinte segundos de ausencia se descartaria sola nada mas nacer.
       */
      if (!isMissed(plan, Tone.now())) this.startTake(presetId, plan.downbeat);
    }

    const recording = this.recordingTake;
    if (!recording) return;

    const elapsed = Tone.now() - recording.startedAt;
    // Con claqueta, la toma se crea en el pulso, y el fotograma que la ve nacer
    // puede llegar unos milisegundos antes de ese instante. Un tiempo negativo
    // colocaria el evento al final de la vuelta en lugar de al principio.
    if (elapsed < 0) return;
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

  /**
   * Instala capas que no se han grabado aqui: las que llegan en un enlace.
   *
   * Reemplaza lo que hubiera, porque mezclar lo que uno estaba tocando con lo
   * que le acaban de mandar produce una vuelta que no es de nadie. Devuelve
   * false si no hay salida de audio todavia o si no llega ninguna capa con
   * eventos: el resto de la aplicacion decide entonces que contar.
   */
  load(tracks: ReadonlyArray<{ presetId: PresetId; events: LoopEvent[] }>, cycleSeconds: number): boolean {
    if (!this.output || cycleSeconds <= 0) return false;
    const usable = tracks.filter((track) => track.events.length > 0).slice(0, MAX_TRACKS);
    if (usable.length === 0) return false;

    this.clear();
    this.cycleSeconds = cycleSeconds;
    for (const incoming of usable) {
      const track: LoopTrack = {
        id: this.nextId++,
        presetId: incoming.presetId,
        events: incoming.events,
        muted: false,
        hue: TRACK_HUES[this.tracks.length % TRACK_HUES.length]!,
      };
      this.tracks.push(track);
      this.voices.set(track.id, new LoopVoice(getPreset(track.presetId), this.output));
    }
    this.startTransport();
    return true;
  }

  /**
   * Cancela una claqueta en marcha sin tocar lo demas.
   *
   * La llama la aplicacion al suspenderse. Irse de la pestana en mitad de la
   * cuenta es abandonarla: al volver, los pulsos ya no suenan y el momento de
   * entrar paso hace rato.
   */
  abortCountIn(): void {
    this.stopCountIn();
  }

  clear(): void {
    this.stopCountIn();
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
    this.scheduleBeats();
    transport.start();
  }

  private stopTransport(): void {
    const transport = Tone.getTransport();
    if (this.repeatId !== null) transport.clear(this.repeatId);
    this.repeatId = null;
    if (this.beatId !== null) transport.clear(this.beatId);
    this.beatId = null;
    transport.stop();
    transport.seconds = 0;
    this.cycleSeconds = 0;
  }
}
