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
  lastSeen: number;
}

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
    const previous = this.melody?.position;
    if (previous) {
      // La mano de melodia es la que estaba mas cerca de donde estaba ella misma.
      melodyIsA = distance(a.position, previous) <= distance(b.position, previous);
    } else {
      melodyIsA = this.bootstrapPrefers(a, b);
    }

    const melody = melodyIsA ? a : b;
    const expression = melodyIsA ? b : a;
    this.melody = { hand: melody.hand, position: melody.position, lastSeen: now };
    this.expression = { hand: expression.hand, position: expression.position, lastSeen: now };
  }

  private assignOne(candidate: { hand: HandFrame; position: Vec2 }, now: number): void {
    const melodyAlive = this.alive(this.melody, now);
    const expressionAlive = this.alive(this.expression, now);

    // Con memoria viva de ambas manos hay que decidir cual acaba de desaparecer.
    // Sin esta comprobacion, bajar la mano de melodia convertiria a la de
    // expresion en melodica y empezaria a disparar notas sin motivo.
    if (melodyAlive && expressionAlive && this.melody && this.expression) {
      const toMelody = distance(candidate.position, this.melody.position);
      const toExpression = distance(candidate.position, this.expression.position);
      if (toExpression < toMelody) {
        this.expression = { hand: candidate.hand, position: candidate.position, lastSeen: now };
        return;
      }
      this.melody = { hand: candidate.hand, position: candidate.position, lastSeen: now };
      return;
    }

    // Con una sola mano y sin ambiguedad, es la de melodia: es lo que espera
    // quien levanta una mano por primera vez.
    this.melody = { hand: candidate.hand, position: candidate.position, lastSeen: now };
  }

  /**
   * Primer fotograma con dos manos: la melodica deberia ser la derecha del
   * interprete. Se prueba con la etiqueta de MediaPipe y, si no la hay, con la
   * posicion en pantalla, que en espacio de vista ya coincide con la del
   * interprete.
   */
  private bootstrapPrefers(
    a: { hand: HandFrame; position: Vec2 },
    b: { hand: HandFrame; position: Vec2 },
  ): boolean {
    const aRight = a.hand.label === 'Right';
    const bRight = b.hand.label === 'Right';
    if (aRight !== bRight) return aRight;
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
