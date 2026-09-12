/**
 * Introduccion guiada para quien abre esto por primera vez.
 *
 * La premisa es que un instrumento que se toca con gestos no se aprende
 * leyendo. "Junta el pulgar y el indice" en una lista de la pantalla inicial se
 * salta sin leer, y quien lo lee tampoco sabe todavia si lo esta haciendo bien.
 *
 * Por eso cada paso se cierra cuando el gesto ocurre de verdad, medido sobre las
 * mismas senales que mueven el instrumento. No hay boton de "siguiente": el
 * boton es la mano. Y no bloquea nada, porque la unica forma de practicar un
 * gesto es teniendo el instrumento vivo mientras se practica.
 */

export interface CoachSignals {
  melodyVisible: boolean;
  /**
   * true cuando la mano no se ve ahora mismo y se esta sosteniendo su ultimo
   * estado. El instrumento la conserva 500 ms para que un fallo puntual de
   * deteccion no corte una nota, pero para ensenar no vale: una sola deteccion
   * falsa daria medio segundo de mano "visible" y cerraria el primer paso sola.
   */
  melodyHeld: boolean;
  expressionVisible: boolean;
  expressionHeld: boolean;
  gateOpen: boolean;
  /** true solo en el fotograma en que se abre el gate. */
  attack: boolean;
  /** Posicion horizontal de la mano de melodia, o -1 si no hay. */
  pitchX: number;
  /** Volumen que dicta la mano de expresion, de 0 a 1. */
  volume: number;
  /** true solo en el fotograma en que se confirma un cambio de timbre. */
  presetChanged: boolean;
  /**
   * Golpes entrados en este fotograma, y sobre que pieza. Casi siempre vacio.
   *
   * Se pide en lugar de un simple contador porque los pasos de bateria no
   * preguntan cuantos golpes van, sino sobre cuantas piezas distintas y si dos
   * han caido juntos: eso es lo que ensena el reparto y las dos manos.
   */
  strikes: readonly { piece: string }[];
  /** Segundos transcurridos desde el fotograma anterior. */
  dt: number;
}

/** Estado acumulado dentro de un paso. Se reinicia al entrar en el. */
interface StepProgress {
  elapsed: number;
  held: number;
  min: number;
  max: number;
  attacks: number;
  changes: number;
  /** Golpes dados en el paso. */
  hits: number;
  /** Piezas distintas golpeadas en el paso. */
  pieces: Set<string>;
  /** Veces que han caido dos golpes juntos, uno por mano. */
  pairs: number;
  /** Cuando entro el ultimo golpe, para medir si el siguiente viene con el. */
  lastHitAt: number;
}

export interface OnboardingStep {
  /** Tambien la clave con la que la vista busca su texto. */
  id: string;
  /**
   * Un paso opcional ensena algo que el instrumento no necesita para funcionar.
   * Se marca como tal en el dato y no solo en el texto, porque quien no pueda o
   * no quiera hacerlo tiene que verlo antes de intentarlo: un paso que se queda
   * esperando sin decir que se puede saltar parece un paso roto.
   */
  optional?: boolean;
  /** Se cierra cuando esto devuelve true. */
  isDone: (progress: Readonly<StepProgress>, signals: CoachSignals) => boolean;
}

/**
 * Lo que separa dos golpes para seguir siendo uno de cada mano.
 *
 * Por debajo del tiempo muerto del detector de golpe, que son noventa
 * milisegundos: una sola mano no puede dar dos golpes tan seguidos, asi que dos
 * dentro de esta ventana vienen por fuerza de manos distintas.
 */
const TOGETHER = 0.08;

/** Recorrido de un valor durante el paso. Mide "muevete", no "estate quieto". */
const span = (p: Readonly<StepProgress>): number => (p.max >= p.min ? p.max - p.min : 0);

export const STEPS: readonly OnboardingStep[] = [
  {
    id: 'hand',
    isDone: (p) => p.held >= 0.5,
  },
  {
    id: 'move',
    isDone: (p) => span(p) >= 0.4,
  },
  {
    id: 'pinch',
    isDone: (p) => p.attacks >= 1,
  },
  {
    id: 'play',
    isDone: (p) => p.held >= 1 && span(p) >= 0.12,
  },
  {
    id: 'volume',
    optional: true,
    isDone: (p) => span(p) >= 0.3,
  },
  /*
   * El cambio de timbre existia desde el principio y no lo encontraba nadie.
   * Un paso que se cierra al conseguirlo es la unica forma de que se descubra
   * sin leer la ayuda, y va el ultimo y opcional porque el instrumento entero
   * funciona sin el.
   */
  {
    id: 'timbre',
    optional: true,
    isDone: (p) => p.changes >= 1,
  },
];

/**
 * Los pasos de la bateria. No se parecen a los de la melodia porque no hay nada
 * en comun que ensenar mas alla de ensenar la mano.
 *
 * Lo unico que no se puede adivinar es el reparto: que golpear a la izquierda y
 * golpear a la derecha son dos piezas distintas. Por eso el tercer paso no pide
 * mas golpes, pide golpes en DOS sitios: contar golpes se cerraria con cuatro
 * seguidos en la caja sin haber aprendido nada.
 *
 * Y el ultimo es el que convierte esto en una bateria: dos manos cayendo juntas.
 * Va opcional porque con una se toca, y porque quien tenga una mano ocupada
 * tiene que poder pasar de largo sin que parezca que la introduccion se ha roto.
 */
export const DRUM_STEPS: readonly OnboardingStep[] = [
  {
    id: 'hand',
    isDone: (p) => p.held >= 0.5,
  },
  {
    id: 'drumHit',
    isDone: (p) => p.hits >= 1,
  },
  {
    id: 'drumPieces',
    isDone: (p) => p.pieces.size >= 2,
  },
  {
    id: 'drumBoth',
    optional: true,
    isDone: (p) => p.pairs >= 1,
  },
];

export type CoachEvent = 'advanced' | 'finished' | null;

export class Onboarding {
  private cursor = 0;
  private progress: StepProgress = blank();
  private active = false;
  private steps: readonly OnboardingStep[] = STEPS;

  get isActive(): boolean {
    return this.active;
  }

  get step(): OnboardingStep | null {
    return this.active ? (this.steps[this.cursor] ?? null) : null;
  }

  get index(): number {
    return this.cursor;
  }

  get total(): number {
    return this.steps.length;
  }

  /** @param drums cual de los dos recorridos. Se fija al empezar y no cambia. */
  start(drums = false): void {
    this.steps = drums ? DRUM_STEPS : STEPS;
    this.active = true;
    this.cursor = 0;
    this.progress = blank();
  }

  stop(): void {
    this.active = false;
  }

  /** Salta el paso actual. Si era el ultimo, termina. */
  skipStep(): CoachEvent {
    if (!this.active) return null;
    return this.advance();
  }

  update(signals: CoachSignals): CoachEvent {
    const step = this.step;
    if (!step) return null;

    const p = this.progress;
    p.elapsed += signals.dt;
    if (signals.attack) p.attacks += 1;
    if (signals.presetChanged) p.changes += 1;
    // Los golpes se acumulan siempre, como los ataques: en modo melodia la lista
    // llega vacia en todos los fotogramas y esto no cuesta nada.
    for (const strike of signals.strikes) {
      p.hits += 1;
      p.pieces.add(strike.piece);
      /*
       * Dos golpes juntos, no dos golpes en el mismo fotograma.
       *
       * La primera version exigia el mismo fotograma, y eso es algo que casi no
       * pasa: cada mano tiene su propio detector, y cada uno dispara cuando su
       * mano lleva sus centesimas de caida. Dos manos que un humano baja "a la
       * vez" cruzan el umbral uno o dos fotogramas apartadas, asi que el paso se
       * quedaba esperando algo que se estaba haciendo bien.
       *
       * La ventana es mas corta que el tiempo muerto del detector, asi que dos
       * golpes dentro de ella no pueden ser de la misma mano: son dos manos.
       */
      if (p.lastHitAt >= 0 && p.elapsed - p.lastHitAt <= TOGETHER) p.pairs += 1;
      p.lastHitAt = p.elapsed;
    }

    // Cada paso mide lo suyo. Meter todas las medidas en el mismo acumulador
    // haria que el recorrido de la mano contase para el paso del volumen.
    switch (step.id) {
      case 'hand':
        p.held = seesMelody(signals) ? p.held + signals.dt : 0;
        break;
      case 'move':
        if (seesMelody(signals) && signals.pitchX >= 0) track(p, signals.pitchX);
        break;
      case 'play':
        if (signals.gateOpen) {
          p.held += signals.dt;
          if (signals.pitchX >= 0) track(p, signals.pitchX);
        }
        break;
      case 'volume':
        if (signals.expressionVisible && !signals.expressionHeld) track(p, signals.volume);
        break;
      default:
        break;
    }

    if (!step.isDone(p, signals)) return null;
    return this.advance();
  }

  private advance(): CoachEvent {
    this.cursor += 1;
    this.progress = blank();
    if (this.cursor >= this.steps.length) {
      this.active = false;
      this.cursor = this.steps.length;
      return 'finished';
    }
    return 'advanced';
  }
}

/** Mano de melodia detectada ahora mismo, no recordada. */
function seesMelody(signals: CoachSignals): boolean {
  return signals.melodyVisible && !signals.melodyHeld;
}

function blank(): StepProgress {
  return {
    elapsed: 0,
    held: 0,
    min: Infinity,
    max: -Infinity,
    attacks: 0,
    changes: 0,
    hits: 0,
    pieces: new Set(),
    pairs: 0,
    lastHitAt: -1,
  };
}

function track(p: StepProgress, value: number): void {
  p.min = Math.min(p.min, value);
  p.max = Math.max(p.max, value);
}
