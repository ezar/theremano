import * as Tone from 'tone';
import { getPreset, type Preset, type PresetId } from './presets';

/**
 * Grafo de audio y aplicacion de parametros.
 *
 * Dos reglas gobiernan este fichero:
 *
 * 1. Ningun parametro se asigna directamente. Todo va por rampas. Una asignacion
 *    directa a una frecuencia o a una ganancia produce una discontinuidad en la
 *    senal, y una discontinuidad es un chasquido.
 * 2. `lookAhead` se baja a 10 ms. El valor por defecto de Tone.js es 100 ms, que
 *    por si solo destruye la sensacion de instrumento: el gesto y el sonido dejan
 *    de sentirse simultaneos.
 */

/** Latencia de planificacion de Tone.js, en segundos. */
const LOOK_AHEAD = 0.01;

/** Rampas de los parametros continuos, en segundos. */
const VOLUME_RAMP = 0.05;
const CUTOFF_RAMP = 0.03;

/** Zonas muertas: por debajo de esto no se reprograma nada. */
const FREQ_EPSILON_CENTS = 0.5;
const GAIN_EPSILON = 0.002;
const CUTOFF_EPSILON_RATIO = 0.01;

export class AudioEngine {
  private synth: Tone.Synth | null = null;
  private vibrato: Tone.Vibrato | null = null;
  private filter: Tone.Filter | null = null;
  private reverb: Tone.Freeverb | null = null;
  private master: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private loopBus: Tone.Gain | null = null;
  private captureTap: MediaStreamAudioDestinationNode | null = null;

  private preset: Preset = getPreset('theremin');
  private lastFreq = 0;
  private lastCutoff = 0;
  private lastGain = 0;
  private targetVolume = 0.75;
  private muted = false;
  private started = false;
  private gateOpen = false;

  get isStarted(): boolean {
    return this.started;
  }

  get currentPreset(): Preset {
    return this.preset;
  }

  /**
   * Latencia que anade la cadena de audio: lo que Tone.js planifica por delante
   * mas lo que el sistema tarda en sacar la muestra por el altavoz.
   */
  get outputLatencyMs(): number {
    if (!this.started) return 0;
    const context = Tone.getContext();
    const raw = context.rawContext;
    const base = 'baseLatency' in raw ? raw.baseLatency : 0;
    return (context.lookAhead + base) * 1000;
  }

  /** Debe invocarse desde un gesto del usuario: el contexto de audio lo exige. */
  async start(presetId: PresetId, volume: number): Promise<void> {
    if (this.started) return;

    // latencyHint solo se puede fijar al construir el contexto, no despues.
    const context = new Tone.Context({ latencyHint: 'interactive', lookAhead: LOOK_AHEAD });
    Tone.setContext(context);
    await Tone.start();
    Tone.getContext().lookAhead = LOOK_AHEAD;

    this.preset = getPreset(presetId);
    this.targetVolume = volume;

    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Gain(0).connect(this.limiter);
    // Los bucles no pasan por el volumen maestro: si lo hicieran, bajar la mano
    // de expresion apagaria tambien lo ya grabado, que no es lo que hace un
    // pedal de bucles ni lo que espera nadie.
    this.loopBus = new Tone.Gain(1).connect(this.limiter);
    this.reverb = new Tone.Freeverb({ roomSize: 0.7, dampening: 2600, wet: this.preset.reverbWet }).connect(
      this.master,
    );
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 2000, Q: this.preset.filter.q }).connect(this.reverb);
    this.vibrato = new Tone.Vibrato({
      frequency: this.preset.vibrato.frequency || 5,
      depth: this.preset.vibrato.depth,
    }).connect(this.filter);
    this.synth = new Tone.Synth({
      oscillator: this.preset.oscillator as Tone.SynthOptions['oscillator'],
      envelope: this.preset.envelope,
      portamento: 0,
    }).connect(this.vibrato);

    this.lastCutoff = 2000;
    this.lastGain = 0;
    this.started = true;
  }

  /** Punto de conexion de las capas de bucle. */
  get loopOutput(): Tone.InputNode {
    if (!this.loopBus) throw new Error('El motor de audio no esta arrancado');
    return this.loopBus;
  }

  /**
   * Pista de audio de todo lo que suena, para grabar video.
   *
   * Se toma detras del limitador, que es lo que se oye de verdad: grabar antes
   * daria un fichero que suena distinto de lo que oyo quien lo grabo.
   */
  captureStream(): MediaStream | null {
    if (!this.limiter) return null;
    if (!this.captureTap) {
      const context = Tone.getContext().rawContext;
      // El contexto offline no puede grabar; en la practica nunca lo es aqui,
      // pero el tipo de Tone.js contempla ambos.
      if (!('createMediaStreamDestination' in context)) return null;
      const tap = context.createMediaStreamDestination();
      this.limiter.connect(tap);
      this.captureTap = tap;
    }
    return this.captureTap.stream;
  }

  setPreset(preset: Preset): void {
    if (!this.started || preset.id === this.preset.id) return;
    this.preset = preset;

    // Cambiar el tipo de oscilador con la nota sonando produce un salto de fase.
    // Un hueco de unos milisegundos lo tapa por completo y es imperceptible.
    const dipping = this.gateOpen && !this.muted;
    if (dipping) this.master?.gain.rampTo(0, 0.012);

    const apply = () => {
      this.synth?.set({
        oscillator: preset.oscillator as Tone.SynthOptions['oscillator'],
        envelope: preset.envelope,
      });
      this.filter?.Q.rampTo(preset.filter.q, 0.05);
      this.reverb?.wet.rampTo(preset.reverbWet, 0.05);
      if (this.vibrato) {
        this.vibrato.depth.rampTo(preset.vibrato.depth, 0.05);
        if (preset.vibrato.frequency > 0) this.vibrato.frequency.rampTo(preset.vibrato.frequency, 0.05);
      }
      this.lastGain = -1;
      this.applyGain(0.03);
    };

    if (dipping) window.setTimeout(apply, 16);
    else apply();
  }

  /** @param glide portamento en segundos. */
  setFrequency(hz: number, glide: number): void {
    if (!this.synth || hz <= 0) return;
    const cents = this.lastFreq > 0 ? Math.abs(1200 * Math.log2(hz / this.lastFreq)) : Infinity;
    if (cents < FREQ_EPSILON_CENTS) return;
    this.lastFreq = hz;
    this.synth.frequency.rampTo(hz, Math.max(0.005, glide + this.preset.glide));
  }

  /** @param norm 0 = oscuro (mano abajo), 1 = brillante (mano arriba). */
  setCutoffNorm(norm: number): void {
    if (!this.filter) return;
    const { minHz, maxHz } = this.preset.filter;
    const clamped = Math.min(1, Math.max(0, norm));
    // Interpolacion logaritmica: el oido percibe el corte en octavas, no en Hz.
    const hz = minHz * (maxHz / minHz) ** clamped;
    if (this.lastCutoff > 0 && Math.abs(hz - this.lastCutoff) / this.lastCutoff < CUTOFF_EPSILON_RATIO) return;
    this.lastCutoff = hz;
    this.filter.frequency.rampTo(hz, CUTOFF_RAMP);
  }

  /** @param volume 0..1 de la mano de expresion. */
  setVolume(volume: number): void {
    this.targetVolume = Math.min(1, Math.max(0, volume));
    this.applyGain(VOLUME_RAMP);
  }

  attack(hz: number): void {
    if (!this.synth) return;
    this.gateOpen = true;
    this.lastFreq = hz;
    this.synth.triggerAttack(hz, undefined, 1);
    this.applyGain(VOLUME_RAMP);
  }

  release(): void {
    if (!this.synth) return;
    this.gateOpen = false;
    this.synth.triggerRelease();
  }

  /**
   * Silencia sin soltar la envolvente. Se usa al perder visibilidad de la
   * pestana: el oscilador no debe seguir sonando de fondo.
   */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    this.applyGain(0.04);
    // Los bucles cuelgan de su propio bus, asi que silenciar el maestro no los
    // toca. Sin esta linea, esconder la pestana dejaria el bucle sonando de
    // fondo, que es justo lo que no debe pasar.
    this.loopBus?.gain.rampTo(muted ? 0 : 1, 0.04);
  }

  /** Corta todo de forma segura. */
  panic(): void {
    this.release();
    this.master?.gain.rampTo(0, 0.03);
    this.loopBus?.gain.rampTo(0, 0.03);
    this.lastGain = 0;
  }

  dispose(): void {
    this.panic();
    for (const node of [this.synth, this.vibrato, this.filter, this.reverb, this.master, this.loopBus, this.limiter]) {
      node?.dispose();
    }
    this.synth = null;
    this.vibrato = null;
    this.filter = null;
    this.reverb = null;
    this.master = null;
    this.loopBus = null;
    this.limiter = null;
    this.captureTap = null;
    this.started = false;
  }

  private applyGain(ramp: number): void {
    if (!this.master) return;
    const target = this.muted ? 0 : this.targetVolume * this.preset.trim;
    if (Math.abs(target - this.lastGain) < GAIN_EPSILON) return;
    this.lastGain = target;
    this.master.gain.rampTo(target, ramp);
  }
}
