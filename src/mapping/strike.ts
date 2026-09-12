/**
 * El golpe: la mano que baja de golpe y se para, como sobre un parche.
 *
 * Es el gesto de una bateria, y no se parece en nada a los demas del
 * instrumento. Los otros son posturas —la pinza esta abierta o cerrada, los
 * dedos son tres o cuatro— y este es un movimiento: existe mientras ocurre y
 * despues no queda nada que mirar.
 *
 * Todo lo delicado esta en CUANDO se dispara, y por una razon que no es de
 * gusto sino de oido. Una nota sostenida perdona ochenta milisegundos de
 * retraso; un golpe de percusion no, se oye tarde y se acabo. La camara ya pone
 * unos sesenta que no quita ningun codigo, asi que esperar a que la mano llegue
 * abajo para disparar seria sumarle el tiempo de todo el trayecto que queda.
 *
 * Por eso el golpe se dispara en la bajada, no en el frenazo: en cuanto la mano
 * supera cierta velocidad hacia abajo, el golpe ya es inevitable —nadie frena
 * una mano a media caida— y suena. Se adelanta asi la mayor parte del trayecto,
 * que es donde estaba el retraso evitable.
 */

/** Cuanto se mira hacia atras para medir la velocidad de caida. */
export const WINDOW = 0.07;

/**
 * Historia minima antes de dar un golpe por bueno.
 *
 * Va en tiempo y no en fotogramas para que un movil que va a treinta no se
 * quede sin golpes. Y no es solo prudencia contra un fotograma mal detectado:
 * un golpe fuerte cruza el umbral tan pronto que, sin esta espera, se dispara
 * cuando todavia no hay con que medir su fuerza y sale sonando flojo, que es
 * justo al reves de lo que se ha hecho. Cuesta unas centesimas de adelanto en
 * los golpes mas secos y a cambio la dinamica existe.
 */
export const MIN_SPAN = 0.045;

/**
 * Velocidad a la que un movimiento hacia abajo se considera un golpe, en
 * alturas de encuadre por segundo.
 *
 * Por debajo de esto, mover la mano hacia abajo es colocarse. Un golpe de
 * verdad recorre un cuarto del encuadre en poco mas de una decima, asi que va
 * muy por encima.
 */
export const TRIGGER = 1.1;

/**
 * Velocidad a la que el golpe ya suena todo lo fuerte que puede sonar.
 *
 * Se compara contra la velocidad ESTIMADA del golpe, no contra la que hay en el
 * instante de disparar. Disparar pronto tiene un precio: cuando el golpe suena,
 * la mano apenas ha superado el umbral y todavia va acelerando, asi que medir la
 * fuerza ahi da lo mismo para un golpe flojo que para uno fuerte. Lo que
 * distingue a los dos en ese momento no es la velocidad, es cuanto esta
 * subiendo: se compara la primera mitad de la ventana con la segunda y se
 * prolonga esa subida una ventana mas. Es una prediccion, y como tal se
 * equivoca; pero se equivoca en la fuerza, que es un matiz, y no en el instante,
 * que es lo que se oye.
 */
export const LOUD = 4.5;

/**
 * Cuanto se prolonga la aceleracion al estimar la fuerza.
 *
 * Uno entero seria suponer que el golpe va a seguir acelerando otra ventana
 * entera, y ahi la estimacion se vuelve tan nerviosa como el ruido del detector:
 * dos golpes iguales sonarian distinto. Con algo menos, la diferencia entre un
 * golpe flojo y uno fuerte se mantiene y el temblor no se cuela como fuerza.
 */
const LOOKAHEAD = 0.7;

/** Lo mas flojo que entra un golpe. Cero seria un golpe que no se oye. */
export const SOFTEST = 0.35;

/**
 * Lo que hay que esperar entre dos golpes.
 *
 * No es un limite de velocidad de redoble, es lo que tarda un golpe en
 * terminar: sin esto, una sola bajada dispara varias veces por el camino. Un
 * redoble de verdad son unos ciento veinte milisegundos entre golpes, asi que
 * esto queda por debajo y no estorba.
 */
export const REFRACTORY = 0.09;

/** Y ademas hay que volver a subir: dos golpes seguidos son dos bajadas. */
export const REARM = 0.35;

interface Sample {
  t: number;
  y: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class StrikeDetector {
  private samples: Sample[] = [];
  private firedAt = -1;
  /** true mientras la mano no haya vuelto a frenar o a subir. */
  private spent = false;

  /**
   * @param t en segundos.
   * @param y altura de la palma, sin filtrar. 0 arriba, 1 abajo.
   * @returns la fuerza del golpe, de 0 a 1, o 0 si no hay golpe.
   */
  push(t: number, y: number): number {
    this.samples.push({ t, y });
    while (this.samples.length > 1 && this.samples[0]!.t < t - WINDOW) this.samples.shift();

    const speed = this.speed();
    // La mano ha frenado o ha vuelto a subir: el siguiente golpe ya puede entrar.
    if (this.spent && speed < REARM) this.spent = false;
    if (this.spent || speed < TRIGGER) return 0;
    if (this.span() < MIN_SPAN) return 0;
    if (this.firedAt >= 0 && t - this.firedAt < REFRACTORY) return 0;

    this.firedAt = t;
    this.spent = true;
    return SOFTEST + (1 - SOFTEST) * clamp01((this.predict() - TRIGGER) / (LOUD - TRIGGER));
  }

  private span(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    return first && last ? last.t - first.t : 0;
  }

  /** Alturas de encuadre por segundo, positivo hacia abajo. */
  private speed(): number {
    return this.slope(0, this.samples.length - 1);
  }

  /** A cuanto va a llegar este golpe, prolongando lo que lleva acelerado. */
  private predict(): number {
    const half = Math.floor(this.samples.length / 2);
    // Con dos o tres muestras no hay dos mitades que comparar. Pasa justo en los
    // golpes mas fuertes, que cruzan el umbral en el segundo fotograma: ahi la
    // velocidad de ese momento ya es alta de por si y vale como medida.
    if (this.samples.length < 3) return this.speed();
    const early = this.slope(0, half);
    const late = this.slope(half, this.samples.length - 1);
    // Nunca por debajo de lo que ya va: un golpe que frena justo al disparar
    // sigue siendo el golpe que se ha dado.
    return Math.max(late, late + (late - early) * LOOKAHEAD);
  }

  private slope(from: number, to: number): number {
    const first = this.samples[from];
    const last = this.samples[to];
    if (!first || !last || last.t <= first.t) return 0;
    return (last.y - first.y) / (last.t - first.t);
  }

  /** Al perder la mano: un golpe a medio camino no sobrevive a la ausencia. */
  reset(): void {
    this.samples = [];
    this.firedAt = -1;
    this.spent = false;
  }
}
