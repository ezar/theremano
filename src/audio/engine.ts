import * as Tone from 'tone';
import { DrumKit } from './drums';
import type { DrumPiece } from '../mapping/kit';
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
const GAIN_EPSILON = 0.002;
const CUTOFF_EPSILON_RATIO = 0.01;
const SPACE_EPSILON = 0.01;
const VIBRATO_EPSILON = 0.01;
const RATE_EPSILON = 0.15;

export class AudioEngine {
  private synth: Tone.Synth | null = null;
  private vibrato: Tone.Vibrato | null = null;
  private filter: Tone.Filter | null = null;
  private delay: Tone.FeedbackDelay | null = null;
  private reverb: Tone.Freeverb | null = null;
  private master: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private loopBus: Tone.Gain | null = null;
  private captureTap: MediaStreamAudioDestinationNode | null = null;

  private preset: Preset = getPreset('theremin');
  private lastFreq = 0;
  private lastCutoff = 0;
  private lastSpace = -1;
  private droneGain: Tone.Gain | null = null;
  private lastVibrato = -1;
  private lastVibratoRate = -1;
  private drone: Tone.Synth | null = null;
  private droneFreq = 0;
  private drum: DrumKit | null = null;
  /**
   * Bus propio de la bateria, hermano del de los bucles y por el mismo motivo.
   *
   * No pasa por el maestro porque el maestro lo mueve la mano de expresion, y
   * en bateria esa mano golpea: cada golpe se bajaria a si mismo. Pero salirse
   * del maestro no puede significar salirse de todo, que es lo que pasaba antes
   * de existir este nodo: esconder la pestana dejaba la bateria viva, el corte
   * de emergencia no la cortaba, y el volumen de los ajustes -que ahi es el
   * unico que queda- no hacia nada.
   */
  private drumBus: Tone.Gain | null = null;
  private lastDrumGain = 0;
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
    this.drumBus = new Tone.Gain(volume).connect(this.limiter);
    this.lastDrumGain = volume;
    this.reverb = new Tone.Freeverb({ roomSize: 0.7, dampening: 2600, wet: this.preset.reverbWet }).connect(
      this.master,
    );
    this.delay = new Tone.FeedbackDelay({
      delayTime: this.preset.delay.time,
      feedback: this.preset.delay.feedback,
      wet: this.preset.delay.wet,
      maxDelay: 1,
    }).connect(this.reverb);
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 2000, Q: this.preset.filter.q }).connect(this.delay);
    this.vibrato = new Tone.Vibrato({
      frequency: this.preset.vibrato.frequency || 5,
      depth: this.preset.vibrato.depth,
    }).connect(this.filter);
    this.synth = new Tone.Synth({
      oscillator: this.preset.oscillator as Tone.SynthOptions['oscillator'],
      envelope: this.preset.envelope,
      portamento: 0,
    }).connect(this.vibrato);
    // El pedal entra por el mismo sitio que la melodia: mismo vibrato, mismo
    // filtro, mismo espacio y mismo volumen maestro. Es la misma voz sostenida,
    // no otro instrumento pegado al lado.
    this.droneGain = new Tone.Gain(DRONE_GAIN).connect(this.vibrato);
    this.drone = new Tone.Synth({
      oscillator: this.preset.oscillator as Tone.SynthOptions['oscillator'],
      envelope: this.droneEnvelope(),
      portamento: 0,
    }).connect(this.droneGain);

    this.lastCutoff = 2000;
    this.lastSpace = -1;
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
    // El espacio se recalcula desde cero con el timbre nuevo: `apply()` devuelve
    // la reverberacion y el eco al valor seco del preset, y sin invalidar esto la
    // zona muerta de setSpace se tragaria la correccion. El gesto se quedaba sin
    // efecto hasta que la mano volvia a moverse en profundidad.
    this.lastSpace = -1;
    const dipping = this.gateOpen && !this.muted;
    if (dipping) this.master?.gain.rampTo(0, 0.012);

    const apply = () => {
      this.synth?.set({
        oscillator: preset.oscillator as Tone.SynthOptions['oscillator'],
        envelope: preset.envelope,
      });
      this.drone?.set({
        oscillator: preset.oscillator as Tone.SynthOptions['oscillator'],
        envelope: this.droneEnvelope(),
      });
      this.filter?.Q.rampTo(preset.filter.q, 0.05);
      this.reverb?.wet.rampTo(preset.reverbWet, 0.05);
      if (this.delay) {
        this.delay.delayTime.rampTo(preset.delay.time, 0.08);
        this.delay.feedback.rampTo(preset.delay.feedback, 0.05);
        this.delay.wet.rampTo(preset.delay.wet, 0.05);
      }
      if (this.vibrato) {
        this.vibrato.depth.rampTo(preset.vibrato.depth, 0.05);
        if (preset.vibrato.frequency > 0) this.vibrato.frequency.rampTo(preset.vibrato.frequency, 0.05);
        // El timbre acaba de pisar los dos valores: lo que recordaba el vibrato
        // de la mano ya no es lo que hay puesto, y sin esto se quedaria sin
        // volver a escribirlo hasta que cambiara de sitio.
        this.lastVibrato = -1;
        this.lastVibratoRate = -1;
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
    this.reverb?.wet.rampTo(Math.min(0.95, this.preset.reverbWet * (0.45 + 1.15 * clamped)), SPACE_RAMP);
    this.delay?.wet.rampTo(Math.min(0.9, this.preset.delay.wet * (0.4 + 1.2 * clamped)), SPACE_RAMP);
  }

  /** @param volume 0..1 de la mano de expresion. */
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
    if (!this.vibrato) return;
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
    if (!this.drone || hz === this.droneFreq) return;
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

  /**
   * Monta o desmonta la bateria.
   *
   * No se monta en el arranque porque son siete nodos —cuatro voces, tres
   * filtros— que el navegador procesa en cada bloque aunque no suene nada, y
   * quien nunca toca la bateria no tiene por que pagarlos. Y no se monta en el
   * primer golpe, que seria lo comodo: construir cuatro sintetizadores es
   * justamente lo que no se puede hacer en el instante en que la latencia
   * importa. Se monta al encender el modo, que es cuando sobra tiempo.
   */
  setDrums(on: boolean): void {
    if (!this.started || !this.drumBus) return;
    if (on === (this.drum !== null)) return;
    if (on) {
      this.drum = new DrumKit(this.drumBus);
      return;
    }
    this.drum?.dispose();
    this.drum = null;
  }

  /** Un golpe de percusion. @param force de 0 a 1. */
  hit(piece: DrumPiece, force: number): void {
    this.drum?.hit(piece, force);
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
    this.setDrone(0);
    this.master?.gain.rampTo(0, 0.03);
    this.loopBus?.gain.rampTo(0, 0.03);
    this.drumBus?.gain.rampTo(0, 0.03);
    this.lastGain = 0;
    this.lastDrumGain = 0;
  }

  dispose(): void {
    this.panic();
    // La bateria tambien, y sobre todo poniendola a null: sin eso, un ciclo de
    // parada y arranque dejaba a setDrums creyendo que el kit seguia montado, y
    // la bateria muda para siempre.
    this.drum?.dispose();
    this.drum = null;
    for (const node of [this.synth, this.vibrato, this.filter, this.delay, this.reverb, this.master, this.loopBus, this.drumBus, this.limiter]) {
      node?.dispose();
    }
    this.synth = null;
    this.vibrato = null;
    this.filter = null;
    this.delay = null;
    this.reverb = null;
    this.master = null;
    this.loopBus = null;
    this.drumBus = null;
    this.limiter = null;
    this.captureTap = null;
    this.started = false;
  }

  private applyGain(ramp: number): void {
    this.applyDrumGain(ramp);
    if (!this.master) return;
    const target = this.muted ? 0 : this.targetVolume * this.preset.trim;
    if (Math.abs(target - this.lastGain) < GAIN_EPSILON) return;
    this.lastGain = target;
    this.master.gain.rampTo(target, ramp);
  }

  /**
   * El volumen de la bateria, que sigue al mismo mando pero no al mismo camino.
   *
   * Sin el ajuste del timbre: ese numero compensa lo que sube o baja cada
   * oscilador de la melodia y no tiene nada que ver con un golpe. Y con la misma
   * banda muerta que el maestro, porque esto se llama en cada fotograma.
   */
  private applyDrumGain(ramp: number): void {
    if (!this.drumBus) return;
    const target = this.muted ? 0 : this.targetVolume;
    if (Math.abs(target - this.lastDrumGain) < GAIN_EPSILON) return;
    this.lastDrumGain = target;
    this.drumBus.gain.rampTo(target, ramp);
  }
}
