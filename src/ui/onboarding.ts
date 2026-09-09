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
];

export type CoachEvent = 'advanced' | 'finished' | null;

export class Onboarding {
  private cursor = 0;
  private progress: StepProgress = blank();
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  get step(): OnboardingStep | null {
    return this.active ? (STEPS[this.cursor] ?? null) : null;
  }

  get index(): number {
    return this.cursor;
  }

  get total(): number {
    return STEPS.length;
  }

  start(): void {
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
    if (this.cursor >= STEPS.length) {
      this.active = false;
      this.cursor = STEPS.length;
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
  return { elapsed: 0, held: 0, min: Infinity, max: -Infinity, attacks: 0 };
}

function track(p: StepProgress, value: number): void {
  p.min = Math.min(p.min, value);
  p.max = Math.max(p.max, value);
}
