import { palmCenter } from '../mapping/features';
import { FULL_LENS, type Lens } from '../mapping/features';
import { RoleTracker } from './handedness';
import { SlotTracker } from './slots';
import type { HandFrame, RoleAssignment } from './types';

/**
 * Dos personas delante de la misma camara.
 *
 * El instrumento es monofonico porque una persona tiene una voz. Con dos
 * personas deja de serlo, y eso no se consigue anadiendo voces a un instrumento
 * sino anadiendo instrumentos: cada una con su mapeador, su filtro, su gate y su
 * voz, sin compartir un solo campo. Lo unico que hay que resolver aqui es de
 * quien es cada mano, que es una pregunta que hoy no se hace nadie porque la
 * respuesta era siempre la misma.
 *
 * Hay dos maneras de repartirse, y no sobra ninguna:
 *
 * - **Por mitades**: cada una tiene media pantalla y dentro de ella toca con sus
 *   dos manos, igual que hoy. Es la que se parece al instrumento de siempre -hay
 *   mano de melodia y mano de expresion, con su volumen y su pedal- y la que
 *   admite estar de pie una al lado de la otra sin estorbarse. Dentro de su
 *   mitad cada una tiene la escala entera: media escala por cabeza no seria un
 *   duo, seria un instrumento partido.
 * - **Una mano cada una**: sobre el encuadre completo, cruzandose si quieren. Se
 *   pierde la mano de expresion -el volumen, el brillo, el pedal- y a cambio
 *   todas tocan el mismo rango, que es lo que hace falta para perseguirse,
 *   doblar una melodia o repartirse un acorde.
 *
 * Quien toca elige, porque las dos son buenas para cosas distintas.
 *
 * ## Y por que solo una de las dos pasa de dos personas
 *
 * A una mano cada una se puede ser mas de dos, y por mitades no. No es que
 * cueste mas programarlo -son otros numeros en la misma lente- es que lo que
 * sale no se toca: tres franjas reparten un tercio de encuadre a cada persona, y
 * dentro de ese tercio tiene que caber la escala entera. Con los toms ya se vio
 * donde esta el limite de estrechar bandas, y no es el temblor del detector
 * -cien veces mas pequeno- sino la punteria de una mano en el aire. Partir el
 * encuadre en tres es pedirle a tres personas esa punteria a la vez.
 *
 * A una mano cada una no se parte nada: todas tienen el encuadre entero, y lo
 * unico que crece es cuantas manos hay que buscar. Por eso esta es la que lleva
 * el numero y la otra se queda en dos.
 */

export type DuoMode = 'off' | 'halves' | 'hands';

export const DUO_MODES: readonly DuoMode[] = ['off', 'halves', 'hands'];

export function isDuoMode(value: unknown): value is DuoMode {
  return typeof value === 'string' && (DUO_MODES as readonly string[]).includes(value);
}

/** Lo que ve una persona: sus manos con su papel, y su trozo de encuadre. */
export interface Player {
  roles: RoleAssignment;
  lens: Lens;
}

const LEFT_LENS: Lens = { from: 0, to: 0.5 };
const RIGHT_LENS: Lens = { from: 0.5, to: 1 };

/**
 * De dos a cuatro personas a una mano cada una.
 *
 * El suelo es dos porque una persona a una mano es tocar solo sin la mano de
 * expresion, que ya se puede hacer sin encender nada. El techo es cuatro porque
 * es lo que ya cuesta hoy el modo de mitades -cuatro manos que buscar- y por ahi
 * tambien se acaban las capas del bucle: cuatro personas grabando llenan la
 * estacion en una sola vuelta.
 */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Saneado del tamano del grupo, para lo que venga de localStorage. */
export function normalizeGroup(value: unknown): number {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return MIN_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, size));
}

/**
 * Cuantas personas toca cada modo. Es fijo: el grupo no se encoge por que una se
 * quede sin manos delante de la camara.
 */
export function playerCount(mode: DuoMode, group = MIN_PLAYERS): number {
  if (mode === 'off') return 1;
  // Por mitades son dos y solo dos: media pantalla no se parte en tres.
  return mode === 'halves' ? 2 : normalizeGroup(group);
}

/**
 * Cuantas manos hay que buscar en cada modo.
 *
 * Buscar manos cuesta, y cuesta por mano: subirlo a cuatro y dejarlo ahi le
 * cobraria a quien toca solo el precio de un duo que no esta usando. Por eso
 * sube y baja con el modo, y por eso el modo de una mano cada una se queda en
 * dos: ahi tampoco hacen falta mas.
 */
export function handsNeeded(mode: DuoMode, group = MIN_PLAYERS): number {
  if (mode === 'halves') return 4;
  // A una mano cada una, una por persona; tocando solo, las dos de siempre.
  return mode === 'hands' ? normalizeGroup(group) : 2;
}

/** La franja de cada persona en cada modo. */
export function lensFor(mode: DuoMode, player: number): Lens {
  if (mode !== 'halves') return FULL_LENS;
  return player === 0 ? LEFT_LENS : RIGHT_LENS;
}

/**
 * Reparte las manos detectadas entre quienes tocan.
 *
 * Guarda un `RoleTracker` por persona y no uno global, y ahi esta todo el
 * asunto: el de siempre reparte melodia y expresion por continuidad entre
 * fotogramas, que es exactamente lo que hace falta DENTRO de una persona y
 * exactamente lo que no vale ENTRE dos. Con uno solo, la mano derecha de quien
 * esta a la izquierda y la izquierda de quien esta a la derecha son vecinas en
 * pantalla, asi que acabarian siendo la melodia y la expresion de un mismo
 * instrumento fantasma que no toca nadie.
 */
export class DuoTracker {
  /**
   * Un reparto de papeles por persona, y uno aparte para cuando se toca sola.
   *
   * Aparte y no reutilizando el primero porque los dos guardan memoria de donde
   * estaba cada mano: encender el duo a mitad de una nota heredaria la posicion
   * de la mano de quien estaba tocando sola, y con ella el papel. Empezar de
   * cero es lo correcto, y es ademas lo que se ve: las manos se vuelven a
   * asignar en el primer fotograma.
   */
  private readonly solo = new RoleTracker();
  private readonly duo = [new RoleTracker(), new RoleTracker()];
  /**
   * Y el reparto de una mano por persona, que no tiene papeles que repartir.
   *
   * Vive aparte del de papeles porque no responde a la misma pregunta: alli hay
   * dos huecos con oficio -la melodia lleva la nota, la expresion el volumen- y
   * aqui hay personas, que hacen todas lo mismo. Ver `slots.ts`.
   */
  private readonly group = new SlotTracker();
  private mode: DuoMode = 'off';

  update(hands: readonly HandFrame[], now: number, mode: DuoMode, group = MIN_PLAYERS): Player[] {
    if (mode !== this.mode) {
      // Cambiar de modo reparte de otra forma lo mismo, asi que la memoria de
      // antes no vale: describe manos que ya no son de quien dice.
      this.reset();
      this.mode = mode;
    }

    if (mode === 'off') {
      return [{ roles: this.solo.update(hands, now), lens: FULL_LENS }];
    }

    if (mode === 'hands') {
      /*
       * Una mano por persona, en huecos estables por continuidad: cada una se
       * queda con la suya aunque se crucen, que es la gracia del modo.
       *
       * Y ninguna tiene mano de expresion, que no es una carencia del reparto
       * sino el trato: a cambio de poder ser mas y de tener todas el encuadre
       * entero, nadie tiene volumen ni pedal propios.
       */
      return this.group.update(hands, now, playerCount('hands', group)).map((melody) => ({
        roles: { melody, expression: null },
        lens: FULL_LENS,
      }));
    }

    /*
     * Por mitades: la mano es de quien tiene esa mitad de pantalla.
     *
     * La palma decide, no los dedos: una mano estirada cerca del centro tiene
     * dedos a los dos lados y la palma solo esta en uno. Y se mira en espacio de
     * vista, ya volteado si hay espejo, asi que la mitad izquierda es la que se
     * ve a la izquierda, que es lo unico que puede significar para quien toca.
     *
     * Una mano que cruza el centro cambia de persona, y durante medio segundo
     * las dos la dan por suya: la de antes la sostiene con su margen de gracia y
     * la de ahora ya la tiene. Suena a las dos y se arregla solo. La alternativa
     * -que nadie la sostenga- es peor: es exactamente el parpadeo que ese margen
     * existe para tapar, y apareceria cada vez que alguien se acerca al centro.
     */
    const sides: HandFrame[][] = [[], []];
    for (const hand of hands) {
      sides[palmCenter(hand.raw).x < 0.5 ? 0 : 1]!.push(hand);
    }
    return sides.map((own, player) => ({
      roles: this.duo[player]!.update(own, now),
      lens: lensFor('halves', player),
    }));
  }

  reset(): void {
    this.solo.reset();
    for (const tracker of this.duo) tracker.reset();
    this.group.reset();
  }
}
