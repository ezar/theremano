import { palmCenter } from '../mapping/features';
import { FULL_LENS, type Lens } from '../mapping/features';
import { RoleTracker } from './handedness';
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
 * - **Una mano cada una**: las dos sobre el encuadre completo, cruzandose si
 *   quieren. Se pierde la mano de expresion -el volumen, el brillo, el pedal- y
 *   a cambio las dos tocan el mismo rango, que es lo que hace falta para
 *   perseguirse, doblar una melodia o repartirse un acorde.
 *
 * Quien toca elige, porque las dos son buenas para cosas distintas.
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

/** Cuantas personas toca cada modo. Es fijo: el duo no se apaga por quedarse sola una. */
export function playerCount(mode: DuoMode): number {
  return mode === 'off' ? 1 : 2;
}

/**
 * Cuantas manos hay que buscar en cada modo.
 *
 * Buscar manos cuesta, y cuesta por mano: subirlo a cuatro y dejarlo ahi le
 * cobraria a quien toca solo el precio de un duo que no esta usando. Por eso
 * sube y baja con el modo, y por eso el modo de una mano cada una se queda en
 * dos: ahi tampoco hacen falta mas.
 */
export function handsNeeded(mode: DuoMode): number {
  return mode === 'halves' ? 4 : 2;
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
  private mode: DuoMode = 'off';

  update(hands: readonly HandFrame[], now: number, mode: DuoMode): Player[] {
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
       * Las dos manos de una persona son aqui las manos de dos personas, y el
       * reparto de siempre vale tal cual: lo que hace es asignar dos manos a dos
       * huecos estables por continuidad, que es justo esto. Cada una se queda
       * con la suya aunque se crucen, que es la gracia del modo.
       */
      const pair = this.duo[0]!.update(hands, now);
      return [
        { roles: { melody: pair.melody, expression: null }, lens: FULL_LENS },
        { roles: { melody: pair.expression, expression: null }, lens: FULL_LENS },
      ];
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
  }
}
