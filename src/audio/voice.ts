import * as Tone from 'tone';
import { type Preset } from './presets';

/**
 * Una voz en directo: el instrumento de una persona, entero.
 *
 * Vivia dentro del motor de audio y era la unica que habia, porque una persona
 * tiene una voz. Sale aqui para que pueda haber dos delante de la misma camara:
 * un duo no es un instrumento con mas voces, son dos instrumentos, y cada uno
 * tiene que traer lo suyo -su oscilador, su filtro, su espacio, su pedal y su
 * volumen- o lo que se oye es una sola voz peleada consigo misma.
 *
 * Es la hermana en directo de la voz de los bucles: la misma cadena de nodos y
 * el mismo orden, con la diferencia de que aquella programa por delante lo que
 * ya se grabo y esta responde a una mano que se esta moviendo ahora. De ahi las
 * bandas muertas de cada parametro: esto se llama sesenta veces por segundo, y
 * reprogramar una rampa que no cambia nada cuesta lo mismo que una que si.
 *
 * Las dos reglas del motor siguen valiendo aqui, que es donde se aplican: nada
 * se asigna directo, todo va por rampas, porque una discontinuidad es un
 * chasquido.
 */

/** Rampas de los parametros continuos, en segundos. */
const VOLUME_RAMP = 0.05;
const CUTOFF_RAMP = 0.03;
/*
 * El espacio va mucho mas lento que los demas. Una reverberacion que cambia en
 * treinta milisegundos no suena a moverse por una sala, suena a un mando que
 * alguien esta girando.
 */
const SPACE_RAMP = 0.25;
/*
 * El vibrato entra y sale rapido, pero no de golpe: un salto en la profundidad
 * de la modulacion se oye como un tropiezo en mitad de la nota.
 */
const VIBRATO_RAMP = 0.08;

/**
 * Lo mas que anade la mano a la profundidad del timbre.
 *
 * Por encima de esto deja de sonar a vibrato y empieza a sonar a sirena: la
 * modulacion se come el intervalo entero hasta la nota de al lado.
 */
const HAND_VIBRATO = 0.35;

/**
 * La nota pedal suena por debajo de la melodia.
 *
 * Es un acompanamiento, no una segunda melodia: si entrara al mismo volumen, las
 * dos voces se pelearian por la atencion y ademas sumarian hasta hacer trabajar
 * al limitador en cada nota.
 */
const DRONE_GAIN = 0.45;

/**
 * Entra y sale mas despacio que una nota.
 *
 * Un pedal que aparece de golpe suena a error; uno que entra en una decima y se
 * apaga en medio segundo suena a que alguien lo ha puesto ahi. Se toma lo mas
 * lento entre esto y lo que pida el timbre, para no acortar un timbre que ya sea
 * mas lento de por si.
 */
const DRONE_ATTACK = 0.12;
const DRONE_RELEASE = 0.5;

/** Zonas muertas: por debajo de esto no se reprograma nada. */
const FREQ_EPSILON_CENTS = 0.5;
export const GAIN_EPSILON = 0.002;
const CUTOFF_EPSILON_RATIO = 0.01;
const SPACE_EPSILON = 0.01;
const VIBRATO_EPSILON = 0.01;
const RATE_EPSILON = 0.15;

export class LiveVoice {
  private readonly synth: Tone.Synth;
  private readonly vibrato: Tone.Vibrato;
  private readonly filter: Tone.Filter;
  private readonly delay: Tone.FeedbackDelay;
  private readonly reverb: Tone.Freeverb;
  /** Volumen de esta voz, el que mueve su mano de expresion. */
  private readonly master: Tone.Gain;
  private readonly droneGain: Tone.Gain;
  private readonly drone: Tone.Synth;

  private lastFreq = 0;
  private lastCutoff = 0;
  private lastSpace = -1;
  private lastVibrato = -1;
  private lastVibratoRate = -1;
  private droneFreq = 0;
  private lastGain = 0;
  private targetVolume: number;
  private muted = false;
  private gateOpen = false;

  constructor(private preset: Preset, volume: number, output: Tone.InputNode) {
    this.targetVolume = volume;
    this.master = new Tone.Gain(0).connect(output);
    this.reverb = new Tone.Freeverb({ roomSize: 0.7, dampening: 2600, wet: preset.reverbWet }).connect(this.master);
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
    // El pedal entra por el mismo sitio que la melodia: mismo vibrato, mismo
    // filtro, mismo espacio y mismo volumen maestro. Es la misma voz sostenida,
    // no otro instrumento pegado al lado.
    this.droneGain = new Tone.Gain(DRONE_GAIN).connect(this.vibrato);
    this.drone = new Tone.Synth({
      oscillator: preset.oscillator as Tone.SynthOptions['oscillator'],
      envelope: this.droneEnvelope(),
      portamento: 0,
    }).connect(this.droneGain);

    this.lastCutoff = 2000;
  }

  get currentPreset(): Preset {
    return this.preset;
  }

  setPreset(preset: Preset): void {
    if (preset.id === this.preset.id) return;
    this.preset = preset;

    // Cambiar el tipo de oscilador con la nota sonando produce un salto de fase.
    // Un hueco de unos milisegundos lo tapa por completo y es imperceptible.
    // El espacio se recalcula desde cero con el timbre nuevo: `apply()` devuelve
    // la reverberacion y el eco al valor seco del preset, y sin invalidar esto la
    // zona muerta de setSpace se tragaria la correccion. El gesto se quedaba sin
    // efecto hasta que la mano volvia a moverse en profundidad.
    this.lastSpace = -1;
    const dipping = this.gateOpen && !this.muted;
    if (dipping) this.master.gain.rampTo(0, 0.012);

    const apply = () => {
      this.synth.set({
        oscillator: preset.oscillator as Tone.SynthOptions['oscillator'],
        envelope: preset.envelope,
      });
      this.drone.set({
        oscillator: preset.oscillator as Tone.SynthOptions['oscillator'],
        envelope: this.droneEnvelope(),
      });
      this.filter.Q.rampTo(preset.filter.q, 0.05);
      this.reverb.wet.rampTo(preset.reverbWet, 0.05);
      this.delay.delayTime.rampTo(preset.delay.time, 0.08);
      this.delay.feedback.rampTo(preset.delay.feedback, 0.05);
      this.delay.wet.rampTo(preset.delay.wet, 0.05);
      this.vibrato.depth.rampTo(preset.vibrato.depth, 0.05);
      if (preset.vibrato.frequency > 0) this.vibrato.frequency.rampTo(preset.vibrato.frequency, 0.05);
      // El timbre acaba de pisar los dos valores: lo que recordaba el vibrato
      // de la mano ya no es lo que hay puesto, y sin esto se quedaria sin
      // volver a escribirlo hasta que cambiara de sitio.
      this.lastVibrato = -1;
      this.lastVibratoRate = -1;
      this.lastGain = -1;
      this.applyGain(0.03);
    };

    if (dipping) window.setTimeout(apply, 16);
    else apply();
  }

  /** @param glide portamento en segundos. */
  setFrequency(hz: number, glide: number): void {
    if (hz <= 0) return;
    const cents = this.lastFreq > 0 ? Math.abs(1200 * Math.log2(hz / this.lastFreq)) : Infinity;
    if (cents < FREQ_EPSILON_CENTS) return;
    this.lastFreq = hz;
    this.synth.frequency.rampTo(hz, Math.max(0.005, glide + this.preset.glide));
  }

  /** @param norm 0 = oscuro (mano abajo), 1 = brillante (mano arriba). */
  setCutoffNorm(norm: number): void {
    const { minHz, maxHz } = this.preset.filter;
    const clamped = Math.min(1, Math.max(0, norm));
    // Interpolacion logaritmica: el oido percibe el corte en octavas, no en Hz.
    const hz = minHz * (maxHz / minHz) ** clamped;
    if (this.lastCutoff > 0 && Math.abs(hz - this.lastCutoff) / this.lastCutoff < CUTOFF_EPSILON_RATIO) return;
    this.lastCutoff = hz;
    this.filter.frequency.rampTo(hz, CUTOFF_RAMP);
  }

  /**
   * Espacio, de 0 (cerca y seco) a 1 (lejos y grande).
   *
   * Mueve la reverberacion y el eco a la vez, porque lo que se busca no es "mas
   * reverb" sino la sensacion de alejarse: una sala grande tiene las dos cosas.
   * El minimo no queda seco del todo —una voz sola completamente seca suena a
   * ejercicio— y el maximo se queda por debajo de lo que emborrona la afinacion.
   *
   * El timbre manda: cada preset trae su cantidad de espacio y el gesto la
   * recorre alrededor, en vez de imponer la suya y borrar la diferencia entre
   * un theremin y un bajo.
   */
  setSpace(norm: number): void {
    const clamped = Math.min(1, Math.max(0, norm));
    if (Math.abs(clamped - this.lastSpace) < SPACE_EPSILON) return;
    this.lastSpace = clamped;
    this.reverb.wet.rampTo(Math.min(0.95, this.preset.reverbWet * (0.45 + 1.15 * clamped)), SPACE_RAMP);
    this.delay.wet.rampTo(Math.min(0.9, this.preset.delay.wet * (0.4 + 1.2 * clamped)), SPACE_RAMP);
  }

  /**
   * Vibrato de la mano, por encima del que trae el timbre.
   *
   * Se suma al del timbre en lugar de sustituirlo: el theremin ya vibra un poco
   * solo, y quitarselo para poner el de la mano lo dejaria mas plano que antes
   * mientras la mano esta quieta. El ritmo, en cambio, si lo manda la mano
   * cuando la mano manda: que se oiga el temblor que se esta haciendo, y no uno
   * parecido.
   *
   * @param depth de 0 a 1, lo que pide la mano.
   * @param hz a que ritmo, o 0 para dejar el del timbre.
   */
  setVibrato(depth: number, hz: number): void {
    const target = Math.min(1, this.preset.vibrato.depth + depth * HAND_VIBRATO);
    if (Math.abs(target - this.lastVibrato) > VIBRATO_EPSILON) {
      this.lastVibrato = target;
      this.vibrato.depth.rampTo(target, VIBRATO_RAMP);
    }
    const rate = hz > 0 ? hz : this.preset.vibrato.frequency;
    if (rate > 0 && Math.abs(rate - this.lastVibratoRate) > RATE_EPSILON) {
      this.lastVibratoRate = rate;
      this.vibrato.frequency.rampTo(rate, VIBRATO_RAMP);
    }
  }

  /**
   * La nota pedal: una segunda voz que se queda sonando.
   *
   * Es lo que convierte el instrumento de monofonico a "una melodia encima de
   * algo". La sostiene la mano, no el bucle, asi que no hay nada que arrancar ni
   * que parar: mientras se pida, suena.
   *
   * @param hz la nota que se sostiene, o 0 para soltarla.
   */
  setDrone(hz: number): void {
    if (hz === this.droneFreq) return;
    if (hz <= 0) {
      this.droneFreq = 0;
      this.drone.triggerRelease();
      return;
    }
    // Cambiar de nota con la voz abierta suena a glissando de sirena: se suelta
    // y se vuelve a atacar, que es lo que hace una mano al cambiar de pedal.
    if (this.droneFreq > 0) this.drone.triggerRelease();
    this.droneFreq = hz;
    this.drone.triggerAttack(hz, undefined, 1);
  }

  /** Envolvente del pedal: la del timbre, pero nunca mas rapida que esto. */
  private droneEnvelope(): Tone.SynthOptions['envelope'] {
    const envelope = this.preset.envelope;
    return {
      ...envelope,
      attack: Math.max(envelope.attack as number, DRONE_ATTACK),
      release: Math.max(envelope.release as number, DRONE_RELEASE),
    } as Tone.SynthOptions['envelope'];
  }

  /** @param volume 0..1 de la mano de expresion. */
  setVolume(volume: number): void {
    this.targetVolume = Math.min(1, Math.max(0, volume));
    this.applyGain(VOLUME_RAMP);
  }

  /** Lo que pide la mano ahora mismo, que la bateria sigue por su cuenta. */
  get volume(): number {
    return this.targetVolume;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  attack(hz: number): void {
    this.gateOpen = true;
    this.lastFreq = hz;
    this.synth.triggerAttack(hz, undefined, 1);
    this.applyGain(VOLUME_RAMP);
  }

  release(): void {
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
  }

  /** Corta esta voz de forma segura, pedal incluido. */
  panic(): void {
    this.release();
    this.setDrone(0);
    this.master.gain.rampTo(0, 0.03);
    this.lastGain = 0;
  }

  private applyGain(ramp: number): void {
    const target = this.muted ? 0 : this.targetVolume * this.preset.trim;
    if (Math.abs(target - this.lastGain) < GAIN_EPSILON) return;
    this.lastGain = target;
    this.master.gain.rampTo(target, ramp);
  }

  dispose(): void {
    this.panic();
    for (const node of [this.synth, this.drone, this.droneGain, this.vibrato, this.filter, this.delay, this.reverb, this.master]) {
      node.dispose();
    }
  }
}
