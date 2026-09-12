import { resolveTargets, type Melody } from './melodies';
import { zoneCenters, type PitchLayout } from './scales';
import { CLOSED_PINCH, OPEN_PINCH, edgeLean, type HandPose } from '../tracking/phantom';
import { denormalize } from './features';

/**
 * La coreografia de la demostracion: donde esta la mano en cada instante.
 *
 * Aqui no suena nada ni se dibuja nada. Lo unico que sale de este fichero es una
 * pose —posicion, pinza y ladeo—, y con eso se fabrica una mano sintetica que
 * entra en el mapeador por la misma puerta que una mano de verdad. Todo lo
 * demas, el gate, la cuantizacion a la escala, el portamento y la fuerza del
 * ataque, ocurre solo. Esa es la gracia: la demostracion no simula el
 * instrumento, lo toca.
 *
 * Cada nota se toca en cinco tiempos, que son los mismos cinco que hace una
 * mano: se viaja hasta la zona con la pinza abierta —moverse no suena—, se
 * espera un momento a que el suavizado llegue, se cierra la pinza —ahi entra la
 * nota—, se sostiene y se abre. Sin la espera, la nota entraria mientras el
 * filtro del tono todavia viene de camino y sonaria la zona de al lado: el
 * filtro es el mismo que lima el temblor de una mano real, y no distingue entre
 * un temblor y un viaje.
 */

/** Tiempo de mano quieta antes de la primera nota, para verla entera. */
export const LEAD_IN_SECONDS = 0.9;
/** Viaje hasta la zona de la nota siguiente. */
export const REACH_SECONDS = 0.34;
/**
 * Espera con la mano ya puesta: lo que tarda el suavizado en llegar.
 *
 * No es una pausa de adorno. El filtro del tono tiene una constante de tiempo de
 * dos decimas con la mano quieta, asi que despues de un salto grande todavia
 * queda error suficiente para caer en la zona de al lado. Con menos de esto, la
 * tercera nota de "Estrellita" —que sube una quinta de golpe— sonaba un grado
 * por debajo.
 */
export const SETTLE_SECONDS = 0.34;
/** Cierre de la pinza. Cuanto mas corto, mas fuerte entra la nota. */
export const CLOSE_SECONDS = 0.08;
/** Nota sonando. */
export const SUSTAIN_SECONDS = 0.24;
/** Apertura de la pinza, que es la suelta. */
export const RELEASE_SECONDS = 0.1;
/**
 * Lo que dura la ondulacion con la que acaba la demostracion.
 *
 * La ultima nota no se suelta: se queda sonando y la mano la ondula. Es la unica
 * forma de ensenar el vibrato, que es un gesto que no se deduce mirando tocar
 * —las notas se ven llegar, el temblor no— y que sin esto solo esta escrito en
 * la ayuda.
 */
export const CODA_SECONDS = 1.6;
/** A que ritmo y con cuanto recorrido ondula. Un vibrato comodo de imitar. */
const CODA_HZ = 5.5;
const CODA_SWING = 0.03;

/** Silencio final, para no cortar la ultima nota en seco. */
export const TAIL_SECONDS = 0.9;

export const NOTE_SECONDS = REACH_SECONDS + SETTLE_SECONDS + CLOSE_SECONDS + SUSTAIN_SECONDS + RELEASE_SECONDS;

/** Altura de reposo de la mano y cuanto pasea arriba y abajo. */
const HEIGHT = 0.46;
const HEIGHT_SWING = 0.16;
const HEIGHT_PERIOD = 8.5;
/** Ladeo, en radianes. Una mano que no se ladea nunca parece una pegatina. */
export const TILT_SWING = 0.09;
const TILT_PERIOD = 6.1;

/** Entrada y salida suaves: una mano no arranca ni frena de golpe. */
function smooth(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

export class DemoPerformance {
  /** Zona de la escala de cada nota. */
  private readonly zones: readonly number[];
  /** Donde cae cada zona en el encuadre. */
  private readonly positions: readonly number[];

  constructor(melody: Melody, layout: PitchLayout) {
    const centers = zoneCenters(layout);
    this.zones = centers.length === 0 ? [] : resolveTargets(melody, layout);
    this.positions = this.zones.map((zone) => centers[zone] ?? 0.5);
  }

  /**
   * Cuantas notas se van a tocar.
   *
   * Vale cero en modo continuo, que no reparte el encuadre en zonas y por tanto
   * no tiene donde apuntar. Quien lo llama decide que hacer con eso; aqui no se
   * inventa una melodia que no se puede tocar.
   */
  get notes(): number {
    return this.zones.length;
  }

  get seconds(): number {
    return LEAD_IN_SECONDS + this.notes * NOTE_SECONDS + CODA_SECONDS + TAIL_SECONDS;
  }

  finishedAt(seconds: number): boolean {
    return seconds >= this.seconds;
  }

  /** Cuantas notas se llevan tocadas del todo. */
  playedAt(seconds: number): number {
    const index = Math.floor((seconds - LEAD_IN_SECONDS) / NOTE_SECONDS);
    return Math.min(this.notes, Math.max(0, index));
  }

  /**
   * La zona a la que va la mano ahora, para marcarla en la rejilla.
   *
   * Es la misma marca que guia a quien toca una melodia, y aqui ensena lo que
   * vale: se ve el objetivo antes de que la mano llegue.
   */
  zoneAt(seconds: number): number | null {
    if (this.notes === 0) return null;
    const index = Math.floor(Math.max(0, seconds - LEAD_IN_SECONDS) / NOTE_SECONDS);
    return this.zones[Math.min(index, this.notes - 1)] ?? null;
  }

  poseAt(seconds: number): HandPose {
    const y = HEIGHT + HEIGHT_SWING * Math.sin((seconds / HEIGHT_PERIOD) * Math.PI * 2);
    const sway = TILT_SWING * Math.sin((seconds / TILT_PERIOD) * Math.PI * 2);
    // El ladeo acompana a la mano: se calcula sobre la posicion que se acaba de
    // devolver, no sobre la nota, para que gire mientras viaja y no a saltos.
    // Las zonas viven en el encuadre util, que es el que recorta los bordes; la
    // pose sale ya en el encuadre entero, que es donde vive una mano.
    const pose = (x: number, pinch: number): HandPose => ({
      x: denormalize(x),
      y: denormalize(y),
      pinch,
      tilt: sway + edgeLean(x),
    });
    const first = this.positions[0] ?? 0.5;
    if (this.notes === 0) return pose(0.5, OPEN_PINCH);

    const elapsed = seconds - LEAD_IN_SECONDS;
    if (elapsed <= 0) return pose(first, OPEN_PINCH);

    const index = Math.floor(elapsed / NOTE_SECONDS);
    if (index >= this.notes) {
      // La coda: la ultima nota sigue sonando y la mano la ondula. Viene sin
      // corte desde el sostenido, para que sea la misma nota y no otra.
      const last = this.positions[this.notes - 1] ?? first;
      const since = elapsed - this.notes * NOTE_SECONDS;
      if (since < CODA_SECONDS) {
        // La ondulacion se centra hacia dentro si la nota esta en un extremo.
        // Contra el borde, el encuadre corta la mitad de abajo de la onda y lo
        // que llega al detector es media oscilacion: casi nada de vibrato. El
        // desplazamiento es menor que media zona, asi que sigue siendo la misma
        // nota, y es lo que haria cualquiera tocando la nota mas grave.
        const center = Math.min(1 - CODA_SWING, Math.max(CODA_SWING, last));
        return pose(center + CODA_SWING * Math.sin(since * CODA_HZ * Math.PI * 2), CLOSED_PINCH);
      }
      const opening = (since - CODA_SECONDS) / RELEASE_SECONDS;
      return pose(last, CLOSED_PINCH + (OPEN_PINCH - CLOSED_PINCH) * smooth(opening));
    }

    const from = index === 0 ? first : (this.positions[index - 1] ?? first);
    const to = this.positions[index] ?? first;
    let local = elapsed - index * NOTE_SECONDS;

    if (local < REACH_SECONDS) {
      return pose(from + (to - from) * smooth(local / REACH_SECONDS), OPEN_PINCH);
    }
    local -= REACH_SECONDS;
    if (local < SETTLE_SECONDS) return pose(to, OPEN_PINCH);
    local -= SETTLE_SECONDS;
    if (local < CLOSE_SECONDS) {
      return pose(to, OPEN_PINCH + (CLOSED_PINCH - OPEN_PINCH) * smooth(local / CLOSE_SECONDS));
    }
    local -= CLOSE_SECONDS;
    if (local < SUSTAIN_SECONDS) return pose(to, CLOSED_PINCH);
    local -= SUSTAIN_SECONDS;
    // La ultima no se suelta aqui: se queda sonando y la recoge la coda.
    if (index === this.notes - 1) return pose(to, CLOSED_PINCH);
    return pose(to, CLOSED_PINCH + (OPEN_PINCH - CLOSED_PINCH) * smooth(local / RELEASE_SECONDS));
  }
}
