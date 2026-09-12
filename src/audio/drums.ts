import * as Tone from 'tone';
import { KIT, type DrumPiece } from '../mapping/kit';

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

/** Lo que dura cada golpe. Es lo que mas separa una pieza de otra. */
const DECAY: Record<DrumPiece, number> = {
  kick: 0.34,
  // Mas largo suena a escoba, mas corto a chasquido.
  snare: 0.13,
  // El charles va cerrado: abierto se comeria el pulso siguiente.
  hat: 0.045,
  crash: 1.1,
};

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

interface Voice {
  hit(force: number): void;
  dispose(): void;
}

/** Ruido con una ventana del espectro abierta. Caja, charles y platillo. */
class NoiseVoice implements Voice {
  private readonly noise: Tone.NoiseSynth;
  private readonly band: Tone.Filter;
  private readonly gain: Tone.Gain;

  constructor(
    output: Tone.InputNode,
    private readonly decay: number,
    level: number,
    filter: { type: 'bandpass' | 'highpass'; frequency: number; Q: number },
  ) {
    this.gain = new Tone.Gain(level).connect(output);
    this.band = new Tone.Filter(filter).connect(this.gain);
    this.noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: this.decay, sustain: 0, release: 0.02 },
    }).connect(this.band);
  }

  hit(force: number): void {
    this.noise.triggerAttackRelease(this.decay, undefined, velocity(force));
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

  hit(force: number): void {
    this.synth.triggerAttackRelease('C1', DECAY.kick, undefined, velocity(force));
  }

  dispose(): void {
    this.synth.dispose();
    this.gain.dispose();
  }
}

function velocity(force: number): number {
  return Math.min(1, Math.max(MIN_VELOCITY, force));
}

export class DrumKit {
  private readonly voices: Record<DrumPiece, Voice>;

  constructor(output: Tone.InputNode) {
    this.voices = {
      kick: new KickVoice(output),
      // La campana estrecha alrededor de dos kilohercios es donde vive el
      // chasquido de un parche.
      snare: new NoiseVoice(output, DECAY.snare, LEVEL.snare, { type: 'bandpass', frequency: 1900, Q: 0.9 }),
      // Del charles solo interesa lo que hay muy arriba: por debajo de ocho
      // kilohercios lo que queda es un siseo sin filo.
      hat: new NoiseVoice(output, DECAY.hat, LEVEL.hat, { type: 'highpass', frequency: 8000, Q: 1 }),
      crash: new NoiseVoice(output, DECAY.crash, LEVEL.crash, { type: 'highpass', frequency: 3800, Q: 1 }),
    };
  }

  /** @param force de 0 a 1, lo fuerte que ha bajado la mano. */
  hit(piece: DrumPiece, force: number): void {
    this.voices[piece].hit(force);
  }

  dispose(): void {
    for (const piece of KIT) this.voices[piece].dispose();
  }
}
