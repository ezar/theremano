import { palmCenter, distance, type Vec2 } from '../mapping/features';
import type { HandFrame, TrackedHand } from './types';
import { HOLD_MS } from './handedness';

/**
 * Varias manos repartidas en huecos estables, una por persona.
 *
 * Es el mismo problema que resuelve el reparto de papeles -que cada mano siga
 * siendo de quien era aunque se crucen- y no es la misma pregunta, que es por lo
 * que esto vive aparte y no es un `RoleTracker` con un numero encima. Alli hay
 * dos huecos con nombre y con oficio: la melodia y la expresion no son
 * intercambiables, una lleva la nota y la otra el volumen, y hay reglas que solo
 * tienen sentido con esos nombres puestos -con una sola mano a la vista, la mano
 * es la de melodia, porque es lo que espera quien levanta una mano-. Aqui los
 * huecos no tienen oficio: son personas, todas hacen lo mismo y ninguna es la
 * principal. Meter las dos cosas en una clase con un `if` obligaria a leer cada
 * regla preguntandose para cual de los dos casos esta escrita.
 *
 * Lo que si se comparte es la idea que hace que el reparto aguante un cruce:
 * adelantar la posicion con la velocidad que trae la mano antes de buscarle
 * hueco. Sin eso, en el fotograma del cruce las dos estan en el mismo sitio, la
 * mas cercana a donde estaba cada una es la otra, y a partir de ahi se quedan
 * cambiadas para siempre. Con tres personas eso pasa mas a menudo que con dos,
 * simplemente porque hay mas maneras de cruzarse.
 */

/**
 * Cuanto se adelanta una mano antes de buscarle hueco.
 *
 * El mismo que usa el reparto de papeles y por la misma razon. No se importa de
 * alli porque alli es un detalle privado de esa clase; si algun dia uno de los
 * dos tiene que cambiar, tendra que ser porque su caso lo pida y no porque el
 * otro lo cambiara.
 */
const LOOK_AHEAD_MS = 60;

/** Lo que pesa el ultimo fotograma en la velocidad. */
const VELOCITY_MIX = 0.5;

const STILL: Vec2 = { x: 0, y: 0 };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Memory {
  hand: HandFrame;
  position: Vec2;
  /** Por donde iba, en unidades de encuadre por milisegundo. */
  velocity: Vec2;
  lastSeen: number;
}

interface Candidate {
  hand: HandFrame;
  position: Vec2;
}

export class SlotTracker {
  private slots: (Memory | null)[] = [];

  reset(): void {
    this.slots = [];
  }

  /**
   * @param count cuantas personas hay. Cambiarlo vacia el reparto: los huecos de
   * antes describen manos que ya no son de quien dicen.
   */
  update(hands: readonly HandFrame[], now: number, count: number): (TrackedHand | null)[] {
    const wanted = Math.max(1, Math.round(count));
    if (this.slots.length !== wanted) this.slots = new Array<Memory | null>(wanted).fill(null);

    const candidates: Candidate[] = hands.map((hand) => ({ hand, position: palmCenter(hand.raw) }));
    const free = this.claim(candidates, now);
    this.seat(free, now);

    return this.slots.map((memory) => resolve(memory, now));
  }

  /**
   * Cada hueco con memoria se queda con la mano mas cercana a donde iba.
   *
   * Por parejas y de la mas cercana a la mas lejana, no hueco por hueco en
   * orden. Lo que arregla no es el cruce -de eso se encarga adelantar con la
   * velocidad- sino la mano que falta: con tres personas y la de en medio con la
   * mano bajada, sirviendo en orden el primer hueco coge la suya, el segundo
   * coge la unica que queda -que es la de la tercera persona- y la tercera se
   * queda sin nada. Dos personas tocando el instrumento de otra a la vez.
   * Sirviendo primero la pareja que menos duda tiene, las dos manos que de
   * verdad son de alguien se asignan antes de que el hueco vacio pueda
   * quitarselas, y ese hueco se queda vacio, que es lo correcto.
   *
   * @returns las manos que no ha reclamado ningun hueco.
   */
  private claim(candidates: readonly Candidate[], now: number): Candidate[] {
    const pairs: { slot: number; candidate: number; gap: number }[] = [];
    this.slots.forEach((memory, slot) => {
      if (!memory) return;
      const expected = predict(memory, now);
      candidates.forEach((candidate, index) => {
        pairs.push({ slot, candidate: index, gap: distance(candidate.position, expected) });
      });
    });
    pairs.sort((a, b) => a.gap - b.gap);

    const takenSlots = new Set<number>();
    const takenHands = new Set<number>();
    for (const pair of pairs) {
      if (takenSlots.has(pair.slot) || takenHands.has(pair.candidate)) continue;
      takenSlots.add(pair.slot);
      takenHands.add(pair.candidate);
      this.slots[pair.slot] = remember(this.slots[pair.slot]!, candidates[pair.candidate]!, now);
    }
    return candidates.filter((_, index) => !takenHands.has(index));
  }

  /**
   * Las manos que no reclamo nadie se sientan en los huecos vacios.
   *
   * De izquierda a derecha, y ahi hay una decision: quien esta a la izquierda es
   * la primera persona. Podria ser al reves y daria igual para el sonido -cada
   * una tiene el encuadre entero-, pero no da igual para explicarlo: el panel
   * dice "timbre de la segunda persona" y quien lo lee tiene que poder saber
   * quien es esa sin probar. De izquierda a derecha es el unico orden que alguien
   * adivina a la primera.
   *
   * Un hueco cuya mano sigue viva no se ocupa aunque ahora mismo no se la vea:
   * es el medio segundo de gracia de siempre, y sin el, bajar la mano un momento
   * te daria el instrumento de otra persona al volver a subirla.
   */
  private seat(free: Candidate[], now: number): void {
    if (free.length === 0) return;
    const waiting = [...free].sort((a, b) => a.position.x - b.position.x);
    let next = 0;
    for (let slot = 0; slot < this.slots.length && next < waiting.length; slot += 1) {
      if (alive(this.slots[slot] ?? null, now)) continue;
      this.slots[slot] = remember(null, waiting[next]!, now);
      next += 1;
    }
  }
}

/** Donde estaria una mano ahora si hubiera seguido a lo suyo. */
function predict(memory: Memory, now: number): Vec2 {
  const ahead = Math.min(Math.max(now - memory.lastSeen, 0), LOOK_AHEAD_MS);
  return {
    x: memory.position.x + memory.velocity.x * ahead,
    y: memory.position.y + memory.velocity.y * ahead,
  };
}

function remember(previous: Memory | null, found: Candidate, now: number): Memory {
  const elapsed = previous ? now - previous.lastSeen : 0;
  // Dos fotogramas en el mismo milisegundo darian una velocidad infinita, y una
  // mano que vuelve despues de medio segundo no trae ninguna velocidad util: lo
  // que hizo mientras no se la veia no lo sabe nadie.
  const usable = previous !== null && elapsed > 0 && elapsed <= LOOK_AHEAD_MS;
  const velocity = usable
    ? {
        x: lerp(previous.velocity.x, (found.position.x - previous.position.x) / elapsed, VELOCITY_MIX),
        y: lerp(previous.velocity.y, (found.position.y - previous.position.y) / elapsed, VELOCITY_MIX),
      }
    : STILL;
  return { hand: found.hand, position: found.position, velocity, lastSeen: now };
}

function alive(memory: Memory | null, now: number): boolean {
  return memory !== null && now - memory.lastSeen <= HOLD_MS;
}

function resolve(memory: Memory | null, now: number): TrackedHand | null {
  if (!memory) return null;
  const heldFor = now - memory.lastSeen;
  if (heldFor > HOLD_MS) return null;
  return { hand: memory.hand, held: heldFor > 0, heldFor };
}
