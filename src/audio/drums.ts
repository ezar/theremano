import * as Tone from 'tone';
import { KIT, type DrumPiece, type KitTrim, type PieceTrim } from '../mapping/kit';

/**
 * Las voces de la bateria.
 *
 * Ninguna cuelga de la cadena de la melodia —vibrato, filtro, eco,
 * reverberacion— porque nada de eso le conviene a un golpe: el filtro lo
 * apagaria segun donde este la mano y la reverberacion lo convertiria en un
 * charco. Van directas al limitador, cada una con su volumen.
 *
 * Tres de las cuatro son ruido filtrado y no un tono, que es lo que separa una
 * caja de un tambor de juguete: un parche golpeado no tiene altura, tiene una
 * zona del espectro donde vive su chasquido. Cambiar esa zona y lo que dura el
 * golpe basta para pasar de caja a charles a platillo.
 *
 * El bombo es la excepcion y tiene que serlo: si tuviera altura tambien seria
 * ruido, pero un bombo es justo lo contrario, un tono grave que cae en picado en
 * las primeras centesimas. Ese desplome es el golpe; sin el queda un pitido.
 */

/**
 * Donde vive cada pieza en el espectro, antes de afinarla.
 *
 * El bombo es el unico que es una altura de verdad: un do muy grave del que se
 * desploma. Los otros tres son el corte del filtro que recorta el ruido, que es
 * lo que separa una caja de un charles.
 */
const KICK_HZ = 32.7;
const SNARE_HZ = 1900;
const HAT_HZ = 8000;
const CRASH_HZ = 3800;

/** Lo que dura cada golpe. Es lo que mas separa una pieza de otra. */
const DECAY: Record<DrumPiece, number> = {
  kick: 0.34,
  // Mas largo suena a escoba, mas corto a chasquido.
  snare: 0.13,
  hat: 0.045,
  crash: 1.1,
};

/**
 * Lo que dura el charles abierto.
 *
 * Corto para lo que suena un charles abierto de verdad, y a proposito: aqui no
 * se cierra con el pie, se cierra dando el golpe siguiente. Si durase un segundo
 * y el golpe siguiente tardase, quedaria sonando solo demasiado tiempo.
 */
const OPEN_HAT_DECAY = 0.42;

/**
 * Lo que tarda en callarse al cerrarse.
 *
 * Corto, que es lo que hace el pedal, pero no instantaneo: cortar en seco una
 * chapa que esta sonando es una discontinuidad, y eso se oye como un chasquido.
 */
const OPEN_HAT_CHOKE = 0.05;

/**
 * Volumen de cada pieza.
 *
 * No estan igualadas a proposito, porque en una bateria de verdad tampoco lo
 * estan: el charles suena cien veces por minuto y al mismo volumen que la caja
 * seria insoportable, y el platillo dura un segundo entero, asi que aunque entre
 * mas bajo sigue siendo lo que mas se oye.
 *
 * Los numeros no se parecen entre si porque cada voz llega con una energia
 * distinta. La caja pide casi tres porque su campana estrecha tira casi todo el
 * ruido que entra, y el bombo pide menos de uno porque un seno grave entra
 * entero. Puestos a oido con los cuatro medidos en el altavoz, no a ojo sobre el
 * codigo: la primera version tenia el charles sonando al doble que la caja.
 */
const LEVEL: Record<DrumPiece, number> = {
  kick: 0.82,
  snare: 2.8,
  hat: 0.37,
  crash: 0.4,
};

/** Lo mas flojo que se deja sonar un golpe: cero seria un golpe que no entra. */
const MIN_VELOCITY = 0.05;

/**
 * Lo que tarda en llegar un retoque de afinacion o de volumen.
 *
 * No es instantaneo porque se puede mover el deslizador con la pieza sonando, y
 * saltar una ganancia o una frecuencia de corte en mitad de una cola es una
 * discontinuidad, que se oye como un chasquido. Dos centesimas no se perciben
 * como retraso al arrastrar y bastan para que el salto deje de ser un salto.
 */
const TRIM_RAMP = 0.02;

/** De semitonos a multiplicador de frecuencia. */
const ratio = (semitones: number): number => 2 ** (semitones / 12);

/** El retoque de fabrica: ni afinada ni subida. */
const NEUTRAL: PieceTrim = { tuning: 0, level: 1 };

interface Voice {
  hit(force: number, time?: number, open?: boolean): void;
  /** Afina la pieza y le pone su volumen. Se llama al cambiar los ajustes. */
  trim(trim: PieceTrim): void;
  dispose(): void;
}

/** Ruido con una ventana del espectro abierta. Caja, charles y platillo. */
class NoiseVoice implements Voice {
  private readonly noise: Tone.NoiseSynth;
  private readonly band: Tone.Filter;
  private readonly gain: Tone.Gain;
  private readonly baseFrequency: number;
  private readonly baseLevel: number;

  constructor(
    output: Tone.InputNode,
    private readonly decay: number,
    level: number,
    filter: { type: 'bandpass' | 'highpass'; frequency: number; Q: number },
  ) {
    this.baseLevel = level;
    this.baseFrequency = filter.frequency;
    this.gain = new Tone.Gain(level).connect(output);
    this.band = new Tone.Filter(filter).connect(this.gain);
    this.noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: this.decay, sustain: 0, release: 0.02 },
    }).connect(this.band);
  }

  hit(force: number, time?: number): void {
    this.noise.triggerAttackRelease(this.decay, time, velocity(force));
  }

  /*
   * Afinar aqui es mover la ventana del espectro, no cambiar una altura: estas
   * tres voces son ruido y no tienen ninguna. Es lo mismo que hace tensar un
   * parche de verdad, que no sube una nota, sube donde vive el chasquido.
   */
  trim(trim: PieceTrim): void {
    this.band.frequency.rampTo(this.baseFrequency * ratio(trim.tuning), TRIM_RAMP);
    this.gain.gain.rampTo(this.baseLevel * trim.level, TRIM_RAMP);
  }

  dispose(): void {
    this.noise.dispose();
    this.band.dispose();
    this.gain.dispose();
  }
}

/** El bombo: un tono que se desploma. */
class KickVoice implements Voice {
  private readonly synth: Tone.MembraneSynth;
  private readonly gain: Tone.Gain;

  constructor(output: Tone.InputNode) {
    this.gain = new Tone.Gain(LEVEL.kick).connect(output);
    this.synth = new Tone.MembraneSynth({
      // Lo rapido que cae la altura. Es todo el bombo: mas lento suena a tom,
      // mas rapido deja de tener cuerpo y queda un chasquido sordo.
      pitchDecay: 0.03,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: DECAY.kick, sustain: 0, release: 0.08 },
    }).connect(this.gain);
  }

  hit(force: number, time?: number): void {
    this.synth.triggerAttackRelease(KICK_HZ, DECAY.kick, time, velocity(force));
  }

  /*
   * La afinacion del bombo es la unica que de verdad es una altura, y aun asi va
   * por el desafinado y no por la nota que se le pasa al golpe. La diferencia
   * esta en los golpes ya programados: una capa de bucle programa la vuelta
   * entera por delante, asi que con la nota metida en el golpe, mover el mando
   * con una vuelta girando dejaria el bombo grabado en la altura anterior hasta
   * la vuelta siguiente -que puede ser veinte segundos- mientras la mano ya suena
   * en la nueva. El desafinado es una senal continua y los alcanza a todos.
   */
  trim(trim: PieceTrim): void {
    this.synth.detune.rampTo(trim.tuning * 100, TRIM_RAMP);
    this.gain.gain.rampTo(LEVEL.kick * trim.level, TRIM_RAMP);
  }

  dispose(): void {
    this.synth.dispose();
    this.gain.dispose();
  }
}

/**
 * El charles, que es la unica pieza con dos sonidos y un vinculo entre ellos.
 *
 * Abierto y cerrado no son dos piezas que dan la casualidad de sonar parecido:
 * son el mismo par de chapas separadas o juntas, y golpear con el pie abajo
 * APAGA lo que estuviera sonando abierto. Eso es lo que hace que un charles
 * suene a charles y no a dos ruidos distintos, y es lo que aqui sustituye al
 * pedal: el golpe cerrado siguiente es el que cierra el anterior.
 *
 * Por eso las dos envolventes viven en la misma voz y no en dos sueltas: hace
 * falta que una pueda cortar a la otra.
 */
class HatVoice implements Voice {
  private readonly closed: Tone.NoiseSynth;
  private readonly open: Tone.NoiseSynth;
  /**
   * Mando propio de lo abierto, y aqui esta el cierre.
   *
   * Cerrar con la envolvente -un triggerRelease sobre la voz abierta- no
   * funciono: la suelta ya estaba programada por el propio golpe y lo que se
   * oia era un desvanecimiento largo en vez de un corte. Medido, la cola seguia
   * sonando casi setecientos milisegundos despues de cerrar. Con una ganancia
   * propia el cierre es lo que tiene que ser: una bajada rapida, en su instante,
   * pase lo que pase con la envolvente.
   */
  private readonly openGain: Tone.Gain;
  private readonly band: Tone.Filter;
  private readonly gain: Tone.Gain;

  constructor(output: Tone.InputNode) {
    this.gain = new Tone.Gain(LEVEL.hat).connect(output);
    // Del charles solo interesa lo que hay muy arriba: por debajo de ocho
    // kilohercios lo que queda es un siseo sin filo.
    this.band = new Tone.Filter({ type: 'highpass', frequency: HAT_HZ, Q: 1 }).connect(this.gain);
    this.closed = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: DECAY.hat, sustain: 0, release: 0.02 },
    }).connect(this.band);
    this.openGain = new Tone.Gain(1).connect(this.band);
    this.open = new Tone.NoiseSynth({
      noise: { type: 'white' },
      // Cola sostenida en vez de caida seca: es lo que se oye como "abierto".
      envelope: { attack: 0.001, decay: 0.05, sustain: 0.35, release: OPEN_HAT_CHOKE },
    }).connect(this.openGain);
  }

  // Un solo corte y una sola ganancia para las dos envolventes: abierto y
  // cerrado son las mismas chapas, y afinar una sin la otra las convertiria en
  // dos piezas distintas.
  trim(trim: PieceTrim): void {
    this.band.frequency.rampTo(HAT_HZ * ratio(trim.tuning), TRIM_RAMP);
    this.gain.gain.rampTo(LEVEL.hat * trim.level, TRIM_RAMP);
  }

  hit(force: number, time?: number, open = false): void {
    const at = time ?? Tone.now();
    this.openGain.gain.cancelScheduledValues(at);
    if (open) {
      this.openGain.gain.setValueAtTime(1, at);
      this.open.triggerAttackRelease(OPEN_HAT_DECAY, at, velocity(force));
      return;
    }
    // El pie baja: lo que sonaba abierto se apaga en el mismo instante.
    this.openGain.gain.setTargetAtTime(0, at, OPEN_HAT_CHOKE / 3);
    this.closed.triggerAttackRelease(DECAY.hat, at, velocity(force));
  }

  dispose(): void {
    this.closed.dispose();
    this.open.dispose();
    this.openGain.dispose();
    this.band.dispose();
    this.gain.dispose();
  }
}

function velocity(force: number): number {
  return Math.min(1, Math.max(MIN_VELOCITY, force));
}

export class DrumKit {
  private readonly voices: Record<DrumPiece, Voice>;

  /** @param trim afinacion y volumen de cada pieza, o nada para el de fabrica. */
  constructor(output: Tone.InputNode, trim?: KitTrim) {
    this.voices = {
      kick: new KickVoice(output),
      // La campana estrecha alrededor de dos kilohercios es donde vive el
      // chasquido de un parche.
      snare: new NoiseVoice(output, DECAY.snare, LEVEL.snare, { type: 'bandpass', frequency: SNARE_HZ, Q: 0.9 }),
      // Del charles solo interesa lo que hay muy arriba: por debajo de ocho
      // kilohercios lo que queda es un siseo sin filo.
      hat: new HatVoice(output),
      crash: new NoiseVoice(output, DECAY.crash, LEVEL.crash, { type: 'highpass', frequency: CRASH_HZ, Q: 1 }),
    };
    // Las voces nacen con lo de fabrica, asi que solo hay que tocarlas si lo que
    // llega no lo es. Una capa de bucle se monta a mitad de una vuelta: no puede
    // sonar la primera con el kit sin afinar.
    if (trim) this.trim(trim);
  }

  trim(trim: KitTrim): void {
    for (const piece of KIT) this.voices[piece].trim(trim[piece] ?? NEUTRAL);
  }

  /**
   * @param force de 0 a 1, lo fuerte que ha bajado la mano.
   * @param time instante del contexto de audio, o nada para ya mismo. Lo usan
   * las capas de bucle, que programan la vuelta entera por delante; en directo
   * no se pasa, porque ahi el instante es este.
   * @param open solo lo mira el charles. Las demas piezas no tienen dos formas
   * de sonar y lo ignoran.
   */
  hit(piece: DrumPiece, force: number, time?: number, open = false): void {
    this.voices[piece].hit(force, time, open);
  }

  dispose(): void {
    for (const piece of KIT) this.voices[piece].dispose();
  }
}
