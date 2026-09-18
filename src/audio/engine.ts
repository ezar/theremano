import * as Tone from 'tone';
import { DrumKit } from './drums';
import type { DrumPiece, KitTrim } from '../mapping/kit';
import { getPreset, type Preset, type PresetId } from './presets';
import { GAIN_EPSILON, LiveVoice } from './voice';

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
 *
 * Lo que queda aqui es lo que se comparte: el contexto, el limitador, los buses
 * de bucles y bateria, el kit y la toma para grabar video. Las voces en directo
 * -una por persona- viven en `voice.ts`, porque un duo no es un instrumento con
 * mas voces sino dos instrumentos, y cada uno trae lo suyo. Casi todos los
 * metodos de aqui llevan un numero de persona que por defecto es la primera: sin
 * duo hay una sola y nadie tiene que enterarse de que existe la segunda.
 */

/** Latencia de planificacion de Tone.js, en segundos. */
const LOOK_AHEAD = 0.01;

/** Rampa del volumen, en segundos. */
const VOLUME_RAMP = 0.05;

export class AudioEngine {
  /**
   * Una voz por persona. Sin duo hay una, que es el caso de siempre.
   *
   * En orden: la primera es quien toca sola o quien tiene la mitad izquierda.
   * El orden importa porque la bateria y el volumen maestro cuelgan de ella.
   */
  private readonly voices: LiveVoice[] = [];
  private limiter: Tone.Limiter | null = null;
  private loopBus: Tone.Gain | null = null;
  private captureTap: MediaStreamAudioDestinationNode | null = null;

  private preset: Preset = getPreset('theremin');
  private drum: DrumKit | null = null;
  /**
   * La afinacion y el volumen de cada pieza, que sobreviven al kit.
   *
   * Se guardan aqui y no solo dentro del kit porque el kit se monta y se
   * desmonta al encender y apagar el modo: sin esto, salir a la melodia y volver
   * devolveria las cuatro piezas a como vienen de fabrica.
   */
  private kitTrim: KitTrim | null = null;
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
  /** El volumen que manda sobre la bateria: el de la primera persona. */
  private targetVolume = 0.75;
  private muted = false;
  private started = false;

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
    // Los bucles no pasan por el volumen maestro: si lo hicieran, bajar la mano
    // de expresion apagaria tambien lo ya grabado, que no es lo que hace un
    // pedal de bucles ni lo que espera nadie.
    this.loopBus = new Tone.Gain(1).connect(this.limiter);
    this.drumBus = new Tone.Gain(volume).connect(this.limiter);
    this.lastDrumGain = volume;

    this.voices.push(new LiveVoice(this.preset, volume, this.limiter));
    this.started = true;
  }

  /**
   * Cuantas personas tocan. Monta o desmonta voces para que cuadre.
   *
   * Una voz son siete nodos que el navegador procesa en cada bloque suene o no,
   * asi que la segunda se monta al encender el duo y se tira al apagarlo, igual
   * que la bateria y por lo mismo. Y se monta ahi y no en el primer gesto: crear
   * un sintetizador es justo lo que no se puede hacer en el instante en que la
   * latencia importa.
   */
  setPlayers(count: number): void {
    if (!this.started || !this.limiter) return;
    const wanted = Math.max(1, Math.round(count));
    while (this.voices.length > wanted) {
      // Al tirarla, lo que estuviera sonando en ella se va con ella: sin el
      // panic de dispose, apagar el duo dejaria la nota de la segunda persona
      // sonando para siempre sin nadie que pudiera soltarla.
      this.voices.pop()?.dispose();
    }
    while (this.voices.length < wanted) {
      const voice = new LiveVoice(this.preset, this.targetVolume, this.limiter);
      voice.setMuted(this.muted);
      this.voices.push(voice);
    }
  }

  get playerCount(): number {
    return this.voices.length;
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

  /**
   * El timbre es de los dos.
   *
   * Un solo ajuste, asi que un solo timbre: dejar que cada persona eligiera el
   * suyo pide un sitio donde elegirlo, y ese sitio no existe todavia. Se lo come
   * cada voz por su cuenta, que es donde esta el salto de fase que hay que tapar.
   */
  setPreset(preset: Preset): void {
    if (!this.started || preset.id === this.preset.id) return;
    this.preset = preset;
    for (const voice of this.voices) voice.setPreset(preset);
  }

  /** @param glide portamento en segundos. */
  setFrequency(hz: number, glide: number, player = 0): void {
    this.voices[player]?.setFrequency(hz, glide);
  }

  /** @param norm 0 = oscuro (mano abajo), 1 = brillante (mano arriba). */
  setCutoffNorm(norm: number, player = 0): void {
    this.voices[player]?.setCutoffNorm(norm);
  }

  /** Espacio, de 0 (cerca y seco) a 1 (lejos y grande). */
  setSpace(norm: number, player = 0): void {
    this.voices[player]?.setSpace(norm);
  }

  /** Vibrato de la mano, por encima del que trae el timbre. */
  setVibrato(depth: number, hz: number, player = 0): void {
    this.voices[player]?.setVibrato(depth, hz);
  }

  /** La nota pedal: una segunda voz que se queda sonando. */
  setDrone(hz: number, player = 0): void {
    this.voices[player]?.setDrone(hz);
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
      this.drum = new DrumKit(this.drumBus, this.kitTrim ?? undefined);
      return;
    }
    this.drum?.dispose();
    this.drum = null;
  }

  /** Afina el kit y le pone el volumen de cada pieza. */
  setKitTrim(trim: KitTrim): void {
    this.kitTrim = trim;
    this.drum?.trim(trim);
  }

  /**
   * Un golpe de percusion.
   *
   * @param force de 0 a 1.
   * @param open charles abierto. Las demas piezas lo ignoran.
   */
  hit(piece: DrumPiece, force: number, open = false): void {
    this.drum?.hit(piece, force, undefined, open);
  }

  /**
   * @param volume 0..1 de la mano de expresion.
   *
   * La bateria sigue a la primera persona y no a la suma de las dos: es un mando
   * de volumen, y dos manos tirando de el en direcciones distintas no dan un
   * volumen, dan un temblor. En duo a media pantalla cada una tiene ademas su
   * propia mano de expresion para su propia voz, que es donde ese gesto significa
   * algo sin ambiguedad.
   */
  setVolume(volume: number, player = 0): void {
    this.voices[player]?.setVolume(volume);
    if (player !== 0) return;
    this.targetVolume = Math.min(1, Math.max(0, volume));
    this.applyDrumGain(VOLUME_RAMP);
  }

  attack(hz: number, player = 0): void {
    this.voices[player]?.attack(hz);
  }

  release(player = 0): void {
    this.voices[player]?.release();
  }

  /**
   * Silencia sin soltar la envolvente. Se usa al perder visibilidad de la
   * pestana: el oscilador no debe seguir sonando de fondo.
   */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    for (const voice of this.voices) voice.setMuted(muted);
    this.applyDrumGain(0.04);
    // Los bucles cuelgan de su propio bus, asi que silenciar las voces no los
    // toca. Sin esta linea, esconder la pestana dejaria el bucle sonando de
    // fondo, que es justo lo que no debe pasar.
    this.loopBus?.gain.rampTo(muted ? 0 : 1, 0.04);
  }

  /** Corta todo de forma segura. */
  panic(): void {
    for (const voice of this.voices) voice.panic();
    this.loopBus?.gain.rampTo(0, 0.03);
    this.drumBus?.gain.rampTo(0, 0.03);
    this.lastDrumGain = 0;
  }

  dispose(): void {
    this.panic();
    // La bateria tambien, y sobre todo poniendola a null: sin eso, un ciclo de
    // parada y arranque dejaba a setDrums creyendo que el kit seguia montado, y
    // la bateria muda para siempre.
    this.drum?.dispose();
    this.drum = null;
    for (const voice of this.voices) voice.dispose();
    this.voices.length = 0;
    for (const node of [this.loopBus, this.drumBus, this.limiter]) {
      node?.dispose();
    }
    this.loopBus = null;
    this.drumBus = null;
    this.limiter = null;
    this.captureTap = null;
    this.started = false;
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
