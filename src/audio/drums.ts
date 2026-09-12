import * as Tone from 'tone';

/**
 * Una voz de percusion. Por ahora una sola, para ver si el gesto llega a tiempo.
 *
 * No cuelga de la cadena de la melodia —vibrato, filtro, eco, reverberacion—
 * porque nada de eso le conviene a un golpe: el filtro lo apagaria segun donde
 * este la mano y la reverberacion lo convertiria en un charco. Va directa al
 * limitador, con su propio volumen.
 *
 * Ruido filtrado en vez de un tono: es lo que separa una caja de un tambor de
 * juguete. La campana estrecha alrededor de dos kilohercios es donde vive el
 * chasquido de un parche.
 */

/** Lo que dura el golpe. Mas largo suena a escoba, mas corto a chasquido. */
const DECAY = 0.13;

export class DrumVoice {
  private readonly noise: Tone.NoiseSynth;
  private readonly band: Tone.Filter;
  private readonly gain: Tone.Gain;

  constructor(output: Tone.InputNode) {
    // El ruido reparte su energia por todo el espectro, asi que para sonar tan
    // presente como una nota necesita mas ganancia de la que parece.
    this.gain = new Tone.Gain(1.4).connect(output);
    this.band = new Tone.Filter({ type: 'bandpass', frequency: 1900, Q: 0.9 }).connect(this.gain);
    this.noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: DECAY, sustain: 0, release: 0.02 },
    }).connect(this.band);
  }

  /** @param force de 0 a 1, lo fuerte que ha bajado la mano. */
  hit(force: number): void {
    this.noise.triggerAttackRelease(DECAY, undefined, Math.min(1, Math.max(0.05, force)));
  }

  dispose(): void {
    this.noise.dispose();
    this.band.dispose();
    this.gain.dispose();
  }
}
