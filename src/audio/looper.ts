import * as Tone from 'tone';
import { getPreset, type Preset, type PresetId } from './presets';
import { LoopTake, MAX_TRACKS, type DrumHitEvent, type LiveSnapshot, type LoopEvent } from './loopTake';
import { DrumKit } from './drums';
import type { KitTrim } from '../mapping/kit';
import { beatsInCycle, beatsLeft, isAccent, isDue, isMissed, planCountIn, type CountInPlan } from './countIn';
import { swingTime } from './swing';
import { answer, answerHits, type EchoKind } from './echo';
import type { PitchLayout } from '../mapping/scales';

export type { DrumHitEvent, LoopEvent } from './loopTake';
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
  /** Golpes, si la capa es de bateria. */
  hits: DrumHitEvent[];
  drums: boolean;
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
 * Una capa de bateria reproduciendose: su propio kit.
 *
 * Propio y no compartido entre capas porque silenciar una capa tiene que
 * silenciarla sola, y el mando esta antes del kit. Con un kit compartido no
 * habria donde poner ese mando sin callar tambien a las demas.
 *
 * No hay rampas ni parametros que seguir: un golpe se programa en su instante y
 * ya esta. Toda la diferencia con la voz de melodia es esa.
 */
class DrumLoopVoice {
  private readonly kit: DrumKit;
  private readonly gain: Tone.Gain;

  constructor(output: Tone.InputNode, trim: KitTrim | null, space = 0) {
    this.gain = new Tone.Gain(1).connect(output);
    this.kit = new DrumKit(this.gain, trim ?? undefined, space);
  }

  setSpace(space: number): void {
    this.kit.setSpace(space);
  }

  trim(trim: KitTrim): void {
    this.kit.trim(trim);
  }

  schedule(hits: readonly DrumHitEvent[], cycleStart: number): void {
    this.gain.gain.cancelScheduledValues(cycleStart);
    // Devuelve el volumen al empezar la vuelta: es lo que hace que quitar el
    // silencio de una capa se note en la vuelta siguiente y no haya que tocar
    // nada mas.
    this.gain.gain.setValueAtTime(1, cycleStart);
    for (const hit of hits) this.kit.hit(hit.piece, hit.force, cycleStart + hit.t, hit.open);
  }

  silence(): void {
    this.gain.gain.cancelScheduledValues(Tone.now());
    this.gain.gain.rampTo(0, 0.02);
  }

  dispose(): void {
    this.kit.dispose();
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

/**
 * Una toma por persona: una vuelta, dos capas.
 *
 * En duo hay dos instrumentos tocando a la vez y una capa es monofonica, asi que
 * grabar "lo que suena" no cabe en una capa. La alternativa -grabar solo a la
 * primera- deja a la segunda tocando para nadie, que es exactamente lo que se
 * nota al probarlo entre dos. Se abren dos tomas en el mismo instante y se
 * cierran en el mismo instante, de modo que las dos capas comparten ciclo por
 * construccion y no por que cuadren los numeros.
 *
 * Una toma sin una sola nota se descarta sola al cerrarse, asi que si solo toca
 * una persona sale una capa y no una capa y un silencio.
 */
type Takes = Recording[];

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
  private readonly voices = new Map<number, LoopVoice | DrumLoopVoice>();
  private recordingTakes: Takes = [];
  private cycleSeconds = 0;
  private repeatId: number | null = null;
  private nextId = 1;
  private countIn: { plan: CountInPlan; presets: readonly PresetId[]; drums: boolean } | null = null;
  private click: ClickVoice | null = null;
  private metronome = false;
  private beatId: number | null = null;
  private kitTrim: KitTrim | null = null;
  private kitSpace = 0;
  private swing = 0;

  attach(output: Tone.InputNode): void {
    this.output = output;
  }

  get isRecording(): boolean {
    return this.recordingTakes.length > 0;
  }

  get isEmpty(): boolean {
    return this.tracks.length === 0;
  }

  get state(): LoopState {
    const transport = this.cycleSeconds > 0 ? Tone.getTransport() : null;
    const position = transport ? (transport.seconds % this.cycleSeconds) / this.cycleSeconds : -1;
    return {
      recording: this.recordingTakes.length > 0,
      countInBeats: this.countIn ? beatsLeft(this.countIn.plan, Tone.now()) : 0,
      recordedSeconds: this.recordingTakes[0] ? Math.max(0, Tone.now() - this.recordingTakes[0].startedAt) : 0,
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
  /** @param drums graba golpes en lugar de notas. */
  /**
   * @param presets un timbre por persona que este tocando. Uno normalmente; dos
   * en duo, y entonces se abren dos tomas a la vez.
   */
  toggle(
    presets: readonly PresetId[],
    drums = false,
  ): 'started' | 'counting' | 'cancelled' | 'saved' | 'partial' | 'discarded' | 'rejected' {
    if (this.recordingTakes.length > 0) {
      const { saved, dropped } = this.finish();
      // Con una capa fuera hay que decirlo aunque se haya guardado la otra:
      // alguien acaba de tocar algo que no esta. Callarlo y anunciar "capa
      // guardada" seria mentir sobre la mitad.
      if (dropped > 0) return 'partial';
      return saved > 0 ? 'saved' : 'discarded';
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
      this.startCountIn(presets, drums);
      return 'counting';
    }

    this.startTake(presets, drums, Tone.now());
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

  private startCountIn(presets: readonly PresetId[], drums: boolean): void {
    if (!this.output) return;
    const plan = planCountIn(Tone.now());
    this.countIn = { plan, presets, drums };
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

  private startTake(presets: readonly PresetId[], drums: boolean, startedAt: number): void {
    const transport = Tone.getTransport();
    // La primera capa arranca en cero y define el ciclo. Las siguientes se
    // colocan donde este el cabezal, para poder grabar encima sin esperar a que
    // la vuelta termine.
    const offset = this.cycleSeconds > 0 ? transport.seconds % this.cycleSeconds : 0;
    // El mismo offset y el mismo instante de arranque para las dos: es lo que
    // hace que las capas de un duo caigan una encima de otra y no una detras.
    this.recordingTakes = presets.map((presetId) => ({
      take: new LoopTake(presetId, offset, this.cycleSeconds, drums),
      startedAt,
    }));
  }

  private stopCountIn(): void {
    this.countIn = null;
    this.releaseClick();
  }

  /**
   * Se llama en cada fotograma con el estado en directo. Solo guarda algo si hay
   * una toma abierta.
   */
  /**
   * @param others lo que toca cada persona a partir de la segunda. Vacio sin duo.
   */
  capture(live: LiveSnapshot, ...others: LiveSnapshot[]): void {
    /*
     * La claqueta termina aqui, en el bucle de fotogramas, y no en un
     * temporizador. Un temporizador seria una pieza mas que cancelar, que
     * limpiar y que podria dispararse sobre una estacion ya vaciada; y no daria
     * mas precision, porque el instante que cuenta no es cuando se ejecuta el
     * codigo sino el que se guarda en startedAt, que es el del pulso.
     */
    if (this.countIn && isDue(this.countIn.plan, Tone.now())) {
      const { plan, presets, drums } = this.countIn;
      this.stopCountIn();
      /*
       * Si el pulso de entrada quedo muy atras, la entrada se perdio y no hay
       * nada que empezar. Pasa cuando el bucle de fotogramas se para en mitad de
       * la cuenta: la pestana se va al fondo, el movil se bloquea. Arrancar ahi
       * la toma con un inicio que ya paso la llenaria de silencio por delante, y
       * con veinte segundos de ausencia se descartaria sola nada mas nacer.
       */
      if (!isMissed(plan, Tone.now())) this.startTake(presets, drums, plan.downbeat);
    }

    const takes = this.recordingTakes;
    if (takes.length === 0) return;

    const elapsed = Tone.now() - takes[0]!.startedAt;
    // Con claqueta, la toma se crea en el pulso, y el fotograma que la ve nacer
    // puede llegar unos milisegundos antes de ese instante. Un tiempo negativo
    // colocaria el evento al final de la vuelta en lugar de al principio.
    if (elapsed < 0) return;
    // La primera capa define el ciclo, asi que no puede crecer sin limite. Se
    // mira la primera toma y se cierran las dos: comparten instante de arranque,
    // asi que desbordan a la vez, y cerrar una sola dejaria dos capas de
    // duraciones distintas que ya no encajan.
    if (takes[0]!.take.overflowed(elapsed)) {
      this.finish();
      return;
    }
    // A cada persona lo suyo. La segunda instantanea solo llega en duo, y sin
    // ella la segunda toma no existe.
    for (let player = 0; player < takes.length; player += 1) {
      const snapshot = player === 0 ? live : others[player - 1];
      if (snapshot) takes[player]!.take.capture(elapsed, snapshot);
    }
  }

  /** Silencia o reactiva una capa. */
  setMuted(id: number, muted: boolean): void {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    track.muted = muted;
    if (muted) this.voices.get(id)?.silence();
  }

  /** Quita la ultima capa grabada. */
  /**
   * Anade una capa que CONTESTA a la ultima, en vez de repetirla.
   *
   * Aditiva: la llamada se queda donde estaba y la respuesta es una capa mas,
   * con su carril, su color y su silencio. Sin la llamada no hay respuesta, hay
   * otra melodia.
   *
   * Y lo que sale es una capa normal y corriente: viaja en el enlace, se puede
   * deshacer sola y se le dibuja su mano fantasma. Nadie mas tiene que saber que
   * esa capa salio de otra.
   *
   * @param layout la escala de ahora, que es donde tienen que caer las notas de
   * la respuesta para que se puedan tocar con la mano.
   * @returns 'answered', o por que no se ha podido.
   */
  echo(kind: EchoKind, layout: PitchLayout): 'answered' | 'empty' | 'full' {
    if (!this.output || this.tracks.length === 0) return 'empty';
    if (this.tracks.length >= MAX_TRACKS) return 'full';
    const source = this.tracks[this.tracks.length - 1]!;

    const track: LoopTrack = {
      id: this.nextId++,
      presetId: source.presetId,
      events: source.drums ? [] : answer(source.events, kind, layout, this.cycleSeconds),
      hits: source.drums ? answerHits(source.hits, this.cycleSeconds) : [],
      drums: source.drums,
      muted: false,
      hue: TRACK_HUES[this.tracks.length % TRACK_HUES.length]!,
    };
    // Una capa sin nada dentro no es una respuesta: es un carril vacio que
    // ocupa sitio, se ve en el anillo y hay que deshacer a mano.
    if (track.events.length === 0 && track.hits.length === 0) return 'empty';

    this.tracks.push(track);
    this.voices.set(track.id, this.makeVoice(track));
    // Desde el principio de la vuelta siguiente, que es cuando entra: la que ya
    // esta programada no la lleva.
    this.startTransport();
    return 'answered';
  }

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
  load(
    tracks: ReadonlyArray<{ presetId: PresetId; events: LoopEvent[]; hits?: DrumHitEvent[]; drums?: boolean }>,
    cycleSeconds: number,
  ): boolean {
    if (!this.output || cycleSeconds <= 0) return false;
    const usable = tracks
      .filter((track) => (track.drums ? (track.hits?.length ?? 0) > 0 : track.events.length > 0))
      .slice(0, MAX_TRACKS);
    if (usable.length === 0) return false;

    this.clear();
    this.cycleSeconds = cycleSeconds;
    for (const incoming of usable) {
      const track: LoopTrack = {
        id: this.nextId++,
        presetId: incoming.presetId,
        events: incoming.events,
        hits: incoming.hits ?? [],
        drums: incoming.drums ?? false,
        muted: false,
        hue: TRACK_HUES[this.tracks.length % TRACK_HUES.length]!,
      };
      this.tracks.push(track);
      this.voices.set(track.id, this.makeVoice(track));
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
    this.recordingTakes = [];
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

  /**
   * Cierra las tomas abiertas y las convierte en capas.
   *
   * @returns cuantas se han guardado y cuantas se han quedado fuera por falta de
   * sitio. Lo segundo solo puede pasar en duo -dos capas de golpe con tres ya
   * grabadas- y se devuelve en vez de tragarselo: perder una capa que alguien
   * acaba de tocar sin decirlo es lo peor que puede hacer aqui.
   */
  private finish(): { saved: number; dropped: number } {
    const takes = this.recordingTakes;
    this.recordingTakes = [];
    if (takes.length === 0 || !this.output) return { saved: 0, dropped: 0 };

    const closedAt = Tone.now();
    let saved = 0;
    let dropped = 0;
    for (const recording of takes) {
      const finished = recording.take.finish(closedAt - recording.startedAt);
      // Una toma sin una sola nota es un doble pulsado sin querer, o la persona
      // que no toco nada en esta vuelta. Ni una cosa ni la otra es una capa.
      if (!finished) continue;
      if (this.tracks.length >= MAX_TRACKS) {
        dropped += 1;
        continue;
      }
      // El ciclo lo fija la primera capa que se cierre, y las de un duo se
      // cierran en el mismo instante: la segunda encuentra el ciclo ya puesto y
      // se coloca dentro, que es justo lo que hace falta.
      this.cycleSeconds = finished.cycleSeconds;
      const track: LoopTrack = {
        id: this.nextId++,
        presetId: finished.presetId,
        events: finished.events,
        hits: finished.hits,
        drums: finished.drums,
        muted: false,
        hue: TRACK_HUES[this.tracks.length % TRACK_HUES.length]!,
      };
      this.tracks.push(track);
      this.voices.set(track.id, this.makeVoice(track));
      saved += 1;
    }
    if (saved > 0) this.startTransport();
    return { saved, dropped };
  }

  /**
   * Los golpes de una capa, corridos por el swing.
   *
   * Sobre el mismo pulso que la claqueta, que es el que se oye: si el swing
   * contara los pulsos de otra manera, lo que suena como el uno y lo que el
   * swing cree que es el uno serian dos cosas distintas.
   *
   * Y se corren al programar, no al guardar: la capa sigue teniendo el instante
   * en que alguien golpeo de verdad, asi que esto se sube y se baja con la
   * vuelta girando y volver a cero devuelve lo que se toco.
   */
  private swung(hits: readonly DrumHitEvent[]): readonly DrumHitEvent[] {
    if (this.swing <= 0 || this.cycleSeconds <= 0) return hits;
    const beatSeconds = this.cycleSeconds / beatsInCycle(this.cycleSeconds);
    return hits.map((hit) => ({ ...hit, t: swingTime(hit.t, beatSeconds, this.swing) }));
  }

  /** @param swing de 0 (recto) a 1. Solo toca las capas de ritmo. */
  setSwing(swing: number): void {
    const wanted = Math.min(1, Math.max(0, swing));
    if (wanted === this.swing) return;
    this.swing = wanted;
    // La vuelta que ya esta programada lleva los instantes de antes: se vuelve
    // a programar desde el principio de la siguiente, que es cuando se nota.
    this.startTransport();
  }

  /** @param space sala de los kits de las capas, de 0 (seco) a 1. */
  setKitSpace(space: number): void {
    this.kitSpace = space;
    for (const voice of this.voices.values()) {
      if (voice instanceof DrumLoopVoice) voice.setSpace(space);
    }
  }

  private makeVoice(track: LoopTrack): LoopVoice | DrumLoopVoice {
    const output = this.output!;
    // Con la sala ya puesta: una capa que se monta a mitad de vuelta no puede
    // sonar seca hasta que alguien toque el mando, igual que con la afinacion.
    return track.drums
      ? new DrumLoopVoice(output, this.kitTrim, this.kitSpace)
      : new LoopVoice(getPreset(track.presetId), output);
  }

  /**
   * Afina tambien lo grabado.
   *
   * Cada capa de bateria tiene su propio kit -hace falta para poder silenciarla
   * sola- y eso significa cuatro voces mas por capa que nadie afinaria. Sin esto,
   * mover la afinacion con una vuelta girando dejaria la mano sonando de una
   * forma y lo grabado de otra, que es justo lo que uno esta comparando mientras
   * mueve el mando.
   */
  setKitTrim(trim: KitTrim): void {
    this.kitTrim = trim;
    for (const voice of this.voices.values()) {
      if (voice instanceof DrumLoopVoice) voice.trim(trim);
    }
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
        const voice = this.voices.get(track.id);
        if (voice instanceof DrumLoopVoice) voice.schedule(this.swung(track.hits), time);
        else voice?.schedule(track.events, time);
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
