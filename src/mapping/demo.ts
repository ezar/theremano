import { resolveTargets, type Melody } from './melodies';
import { zoneCenters, type PitchLayout } from './scales';

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
/** Silencio final, para no cortar la ultima nota en seco. */
export const TAIL_SECONDS = 0.9;

export const NOTE_SECONDS = REACH_SECONDS + SETTLE_SECONDS + CLOSE_SECONDS + SUSTAIN_SECONDS + RELEASE_SECONDS;

/**
 * Las dos aperturas de la pinza.
 *
 * Con margen a los dos lados de la banda muerta del gate: la abierta por encima
 * del umbral que calla y la cerrada por debajo del que suena. Si alguien
 * estrechara esa banda, estos dos numeros seguirian estando fuera.
 */
export const POSE_OPEN = 0.52;
export const POSE_CLOSED = 0.14;

/**
 * Lo que se encoge la mano de la demostracion respecto a una a distancia de
 * trabajo.
 *
 * Con el tamano natural, la mano puesta en la nota mas grave se sale del
 * encuadre por la izquierda, y lo que se sale es justo lo que hay que mirar: el
 * pulgar y el indice. Un palmo mas pequeno es una mano un poco mas lejos de la
 * camara, que es una postura tan valida como la otra y cabe entera. El precio lo
 * paga el espacio del sonido, que sale algo mas seco.
 */
export const HAND_SCALE = 0.84;

/** Altura de reposo de la mano y cuanto pasea arriba y abajo. */
const HEIGHT = 0.46;
const HEIGHT_SWING = 0.16;
const HEIGHT_PERIOD = 8.5;
/** Ladeo, en radianes. Una mano que no se ladea nunca parece una pegatina. */
export const TILT_SWING = 0.09;
const TILT_PERIOD = 6.1;

/**
 * Cuanto se ladea la mano hacia dentro en los extremos del recorrido.
 *
 * No es un adorno, resuelve un problema real en vertical. Una mano a distancia
 * de trabajo ocupa buena parte del ancho de un movil, asi que con la palma en la
 * nota mas grave el pulgar y el indice se quedan fuera del encuadre, y son justo
 * los dos que hay que mirar. Ladearla mete la mano entera dentro sin mover la
 * palma, que es la que decide la nota. Y es lo que hace cualquiera que toque
 * esto con el telefono delante: angular la mano hacia el centro al llegar a los
 * bordes.
 */
export const EDGE_LEAN = 0.5;

export interface DemoPose {
  /** Posicion en el encuadre util, 0 a 1. La misma que lee el mapeador. */
  x: number;
  y: number;
  /** Distancia pulgar-indice normalizada. */
  pinch: number;
  tilt: number;
}

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
    return LEAD_IN_SECONDS + this.notes * NOTE_SECONDS + TAIL_SECONDS;
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

  poseAt(seconds: number): DemoPose {
    const y = HEIGHT + HEIGHT_SWING * Math.sin((seconds / HEIGHT_PERIOD) * Math.PI * 2);
    const sway = TILT_SWING * Math.sin((seconds / TILT_PERIOD) * Math.PI * 2);
    // El ladeo acompana a la mano: se calcula sobre la posicion que se acaba de
    // devolver, no sobre la nota, para que gire mientras viaja y no a saltos.
    const pose = (x: number, pinch: number): DemoPose => ({
      x,
      y,
      pinch,
      // Al cubo, no en linea recta: asi la mano va derecha por todo el centro
      // del recorrido y solo se angula en los ultimos pasos, que es donde hace
      // falta y donde alguien lo haria de verdad.
      tilt: sway + EDGE_LEAN * (2 * x - 1) ** 3,
    });
    const first = this.positions[0] ?? 0.5;
    if (this.notes === 0) return pose(0.5, POSE_OPEN);

    const elapsed = seconds - LEAD_IN_SECONDS;
    if (elapsed <= 0) return pose(first, POSE_OPEN);

    const index = Math.floor(elapsed / NOTE_SECONDS);
    if (index >= this.notes) {
      return pose(this.positions[this.notes - 1] ?? first, POSE_OPEN);
    }

    const from = index === 0 ? first : (this.positions[index - 1] ?? first);
    const to = this.positions[index] ?? first;
    let local = elapsed - index * NOTE_SECONDS;

    if (local < REACH_SECONDS) {
      return pose(from + (to - from) * smooth(local / REACH_SECONDS), POSE_OPEN);
    }
    local -= REACH_SECONDS;
    if (local < SETTLE_SECONDS) return pose(to, POSE_OPEN);
    local -= SETTLE_SECONDS;
    if (local < CLOSE_SECONDS) {
      return pose(to, POSE_OPEN + (POSE_CLOSED - POSE_OPEN) * smooth(local / CLOSE_SECONDS));
    }
    local -= CLOSE_SECONDS;
    if (local < SUSTAIN_SECONDS) return pose(to, POSE_CLOSED);
    local -= SUSTAIN_SECONDS;
    return pose(to, POSE_CLOSED + (POSE_OPEN - POSE_CLOSED) * smooth(local / RELEASE_SECONDS));
  }
}
