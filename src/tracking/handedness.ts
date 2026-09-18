import { palmCenter, distance, type Vec2 } from '../mapping/features';
import type { HandFrame, RoleAssignment, TrackedHand } from './types';

/**
 * Asignacion estable de rol a cada mano.
 *
 * La etiqueta de lateralidad de MediaPipe se ignora salvo para arrancar: es
 * inestable cuando la mano rota o sale parcialmente del encuadre, y un cambio
 * de rol a mitad de una nota es una catastrofe musical. El criterio real es la
 * continuidad espacial entre fotogramas.
 */

/** Cuanto se conserva el ultimo estado de una mano perdida. */
export const HOLD_MS = 500;

interface Memory {
  hand: HandFrame;
  position: Vec2;
  /** Por donde iba, en unidades de encuadre por milisegundo. */
  velocity: Vec2;
  lastSeen: number;
}

/**
 * Cuanto se adelanta la posicion de una mano antes de buscarle pareja.
 *
 * Sin adelantarla, dos manos que se cruzan se intercambian el papel: en el
 * fotograma del cruce estan las dos en el mismo sitio, la mas cercana a donde
 * estaba cada una es la otra, y a partir de ahi se quedan cambiadas. Con dos
 * personas a una mano cada una eso es lo peor que puede pasar -la nota de cada
 * una salta a la de la otra y ninguna entiende por que- y tocando solo tampoco
 * es gracioso, porque la mano que llevaba la nota pasa a llevar el volumen.
 *
 * Adelantarla lo arregla porque una mano que cruza SIGUE, y donde va a estar ya
 * no es donde va a estar la otra. No hay que adivinar nada: la velocidad es la
 * que trae, medida entre fotogramas.
 */
const LOOK_AHEAD_MS = 60;

/** Lo que pesa el ultimo fotograma en la velocidad. */
const VELOCITY_MIX = 0.5;

const STILL: Vec2 = { x: 0, y: 0 };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class RoleTracker {
  private melody: Memory | null = null;
  private expression: Memory | null = null;

  reset(): void {
    this.melody = null;
    this.expression = null;
  }

  update(hands: readonly HandFrame[], now: number): RoleAssignment {
    const candidates = hands.map((hand) => ({ hand, position: palmCenter(hand.raw) }));

    if (candidates.length >= 2) {
      this.assignTwo(candidates, now);
    } else if (candidates.length === 1) {
      this.assignOne(candidates[0]!, now);
    }

    return { melody: this.resolve(this.melody, now), expression: this.resolve(this.expression, now) };
  }

  private assignTwo(candidates: Array<{ hand: HandFrame; position: Vec2 }>, now: number): void {
    const [a, b] = candidates as [(typeof candidates)[number], (typeof candidates)[number]];

    let melodyIsA: boolean;
    const previous = this.melody ? this.predict(this.melody, now) : null;
    if (previous) {
      // La mano de melodia es la que esta mas cerca de donde iba ella misma.
      melodyIsA = distance(a.position, previous) <= distance(b.position, previous);
    } else {
      melodyIsA = this.bootstrapPrefers(a, b);
    }

    const melody = melodyIsA ? a : b;
    const expression = melodyIsA ? b : a;
    this.melody = this.remember(this.melody, melody, now);
    this.expression = this.remember(this.expression, expression, now);
  }

  /** Donde estaria una mano ahora si hubiera seguido a lo suyo. */
  private predict(memory: Memory, now: number): Vec2 {
    const ahead = Math.min(Math.max(now - memory.lastSeen, 0), LOOK_AHEAD_MS);
    return {
      x: memory.position.x + memory.velocity.x * ahead,
      y: memory.position.y + memory.velocity.y * ahead,
    };
  }

  private remember(
    previous: Memory | null,
    found: { hand: HandFrame; position: Vec2 },
    now: number,
  ): Memory {
    const elapsed = previous ? now - previous.lastSeen : 0;
    // Dos fotogramas en el mismo milisegundo darian una velocidad infinita, y
    // una mano que vuelve despues de medio segundo no trae ninguna velocidad
    // util: lo que hizo mientras no se la veia no lo sabe nadie.
    const usable = previous !== null && elapsed > 0 && elapsed <= LOOK_AHEAD_MS;
    const velocity = usable
      ? {
          x: lerp(previous!.velocity.x, (found.position.x - previous!.position.x) / elapsed, VELOCITY_MIX),
          y: lerp(previous!.velocity.y, (found.position.y - previous!.position.y) / elapsed, VELOCITY_MIX),
        }
      : STILL;
    return { hand: found.hand, position: found.position, velocity, lastSeen: now };
  }

  private assignOne(candidate: { hand: HandFrame; position: Vec2 }, now: number): void {
    const melodyAlive = this.alive(this.melody, now);
    const expressionAlive = this.alive(this.expression, now);

    // Con memoria viva de ambas manos hay que decidir cual acaba de desaparecer.
    // Sin esta comprobacion, bajar la mano de melodia convertiria a la de
    // expresion en melodica y empezaria a disparar notas sin motivo.
    if (melodyAlive && expressionAlive && this.melody && this.expression) {
      const toMelody = distance(candidate.position, this.predict(this.melody, now));
      const toExpression = distance(candidate.position, this.predict(this.expression, now));
      if (toExpression < toMelody) {
        this.expression = this.remember(this.expression, candidate, now);
        return;
      }
      this.melody = this.remember(this.melody, candidate, now);
      return;
    }

    // Con una sola mano y sin ambiguedad, es la de melodia: es lo que espera
    // quien levanta una mano por primera vez.
    this.melody = this.remember(this.melody, candidate, now);
  }

  /**
   * Primer fotograma con dos manos: toca la melodia la que este mas a la
   * derecha del encuadre, que en espacio de vista es la derecha del interprete.
   *
   * Se decide solo por posicion, sin mirar la lateralidad que reporta
   * MediaPipe. Esa etiqueta es inestable cuando la mano gira o se sale del
   * encuadre, y ademas describe anatomia: usarla haria que un zurdo que levanta
   * las dos manos a la vez recibiera la melodia en la mano derecha sin poder
   * cambiarlo. Por posicion, en cambio, el reparto siempre se corrige moviendo
   * las manos, que es algo que el interprete controla.
   */
  private bootstrapPrefers(
    a: { position: Vec2 },
    b: { position: Vec2 },
  ): boolean {
    return a.position.x >= b.position.x;
  }

  private alive(memory: Memory | null, now: number): boolean {
    return memory !== null && now - memory.lastSeen <= HOLD_MS;
  }

  private resolve(memory: Memory | null, now: number): TrackedHand | null {
    if (!memory) return null;
    const heldFor = now - memory.lastSeen;
    if (heldFor > HOLD_MS) return null;
    return { hand: memory.hand, held: heldFor > 0, heldFor };
  }
}
