import { denormalize } from './features';
import { ROSTER, bandCenter, bandOf, type DrumPiece, type KitLayout } from './kit';
import { freqToMidi, xForMidi, type PitchLayout } from './scales';
import { HARD_FORCE, lerp, liftForForce, strokePose, type Stroke } from './strokes';
import { CLOSED_PINCH, OPEN_PINCH, edgeLean, type HandPose } from '../tracking/phantom';
import type { DrumHitEvent, LoopEvent } from '../audio/loopTake';

/**
 * La mano que grabo una capa, reconstruida de lo que la capa guarda.
 *
 * Una capa de bucle no guarda sonido: guarda el gesto, ya convertido en lo que
 * el gesto significaba -una frecuencia, un corte de filtro, un golpe con su
 * fuerza-. Esa conversion tiene vuelta, y esto es la vuelta. Con ella, una capa
 * deja de ser algo que solo se oye y pasa a ser algo que se puede mirar: la mano
 * que la toco, dibujada donde estuvo, para poner la propia encima.
 *
 * Y como las capas viajan en el enlace, lo que se comparte deja de ser una
 * grabacion y pasa a ser una leccion: al otro lado no llega el sonido, llegan las
 * manos. Sin video, sin servidor y sin un solo byte de mas: todo esto ya estaba
 * guardado, solo que nadie lo estaba leyendo al reves.
 *
 * No es una reconstruccion exacta y no puede serlo. De la melodia se recupera la
 * posicion con la precision con la que se guardo -la nota, no el milimetro: en
 * cuantizado la mano aparece en el centro de su zona, que es donde habria que
 * ponerla- y el camino entre dos notas se inventa recto, porque la capa guardo
 * el cuando pero no el por donde. De la bateria se recupera el instante, el
 * sitio y la fuerza -esta relativa, porque la capa la guarda multiplicada por un
 * volumen que no guarda: hay que estimarlo-, y el viaje que lleva a cada golpe se
 * dibuja con la misma coreografia que usa la demostracion, leida al reves.
 */

/** Lo que el fantasma necesita de una capa. Una capa de verdad lo cumple. */
export interface GhostTrack {
  drums: boolean;
  events: readonly LoopEvent[];
  hits: readonly DrumHitEvent[];
}

/** Un golpe grabado, a falta de saber donde cae su pieza en el encuadre. */
interface DrumStroke extends Stroke {
  piece: DrumPiece;
}

/** Un instante de la melodia grabada, ya en magnitudes de mano. */
interface Moment {
  t: number;
  /** Nota que sonaba, en MIDI. La posicion depende de la escala de ahora. */
  midi: number;
  /** Altura de la palma en el encuadre entero. */
  y: number;
  /** Si la pinza estaba cerrada, o sea si habia nota sonando. */
  closed: boolean;
}

/**
 * El fantasma de una capa, preparado una vez.
 *
 * Se prepara y no se calcula al vuelo porque hay trabajo de verdad que hacer y
 * que no cambia nunca despues de grabar: deshacer la frecuencia de cada instante
 * hasta la nota, el corte hasta la altura, y resolver el gate -que no viene
 * dado, viene como dos clases de evento-. Son hasta seiscientos instantes por
 * capa, y hacerlo sesenta veces por segundo y por capa seria tirarlo.
 */
export class TrackGhost {
  private readonly moments: readonly Moment[] = [];
  /**
   * Los golpes repartidos en dos manos, porque dos manos fueron.
   *
   * Una capa de bateria guarda los golpes de las dos juntos y sin decir cual fue
   * cual: al golpear da igual, suena lo mismo. Al dibujarlo no da igual -bombo y
   * charles caen a la vez en casi cualquier compas, y una sola mano no puede
   * estar en dos sitios- y ademas seria la leccion equivocada: lo que hay que
   * ensenar es justo que son dos.
   *
   * Se reparten por mitades del encuadre, que es como esta pensado el kit: las
   * dos piezas graves a un lado y el pulso al otro, para que ninguna mano tenga
   * que cruzar. Es una suposicion, y la unica que se puede hacer sin inventarse
   * datos que nadie guardo.
   */
  private readonly beats: readonly DrumStroke[][] = [];
  /**
   * Los golpes con su sitio ya resuelto, y el reparto con el que se resolvio.
   *
   * El sitio de un golpe depende del reparto de bandas, que se puede cambiar
   * mientras la vuelta gira. Resolverlo en cada fotograma seria rehacer ochenta
   * objetos sesenta veces por segundo para nada: el reparto es el mismo hasta
   * que alguien lo toca, y cuando lo toca llega otra lista.
   */
  private placed: readonly Stroke[][] = [];
  private placedFor: KitLayout | null = null;

  constructor(track: GhostTrack, private readonly cycleSeconds: number) {
    if (track.drums) this.beats = drumStrokes(track.hits, cycleSeconds);
    else this.moments = melodyMoments(track.events);
  }

  /**
   * Donde estaba la mano en este punto de la vuelta.
   *
   * @param cycleTime segundos desde el principio del ciclo.
   * @param layout la escala de AHORA, no la de la grabacion, y lo mismo el
   * reparto: lo que se dibuja es donde hay que poner la mano para que suene eso,
   * y eso depende de como este repartido el encuadre en este momento.
   */
  posesAt(cycleTime: number, layout: PitchLayout, bands: KitLayout): HandPose[] {
    if (this.beats.length > 0) {
      const out: HandPose[] = [];
      for (const strokes of this.place(bands)) {
        const pose = strokePose(strokes, cycleTime);
        if (pose) out.push(pose);
      }
      return out;
    }
    const melody = this.melodyPoseAt(cycleTime, layout);
    return melody ? [melody] : [];
  }

  private place(bands: KitLayout): readonly Stroke[][] {
    if (this.placedFor === bands) return this.placed;
    this.placedFor = bands;
    this.placed = this.beats.map((hand) =>
      hand.map((beat) => ({ ...beat, x: bandCenter(bandOf(bands, beat.piece), bands.length) })),
    );
    return this.placed;
  }

  private melodyPoseAt(cycleTime: number, layout: PitchLayout): HandPose | null {
    const moments = this.moments;
    if (moments.length === 0) return null;

    let next = 0;
    while (next < moments.length && moments[next]!.t <= cycleTime) next += 1;
    /*
     * El ciclo da vueltas, asi que antes del primer instante no hay silencio:
     * hay el ultimo. Sin esto, la mano desapareceria o daria un salto cada vez
     * que el cabezal pasa por el cero, que es una vez por vuelta y siempre en el
     * mismo sitio.
     */
    const from = moments[(next - 1 + moments.length) % moments.length]!;
    const to = moments[next % moments.length]!;
    const span = to.t - from.t;
    // Entre el ultimo y el primero el hueco cruza el final de la vuelta.
    const wrapped = span >= 0 ? span : span + this.cycleSeconds;
    const since = cycleTime >= from.t ? cycleTime - from.t : cycleTime - from.t + this.cycleSeconds;
    const u = wrapped > 0 ? Math.min(1, Math.max(0, since / wrapped)) : 0;

    /*
     * El camino entre dos instantes se dibuja recto, y es lo unico inventado que
     * hay aqui. La capa guarda treinta instantes por segundo: sabe CUANDO cambio
     * la nota, que es lo que importa, pero no por donde paso la mano entre una y
     * otra. Sin unir los puntos la mano daria saltos de zona en zona; uniendolos
     * se desliza, que es lo que hizo, aunque no exactamente asi.
     */
    const x = lerp(xForMidi(layout, from.midi), xForMidi(layout, to.midi), u);
    const y = lerp(from.y, to.y, u);
    return {
      x: denormalize(x),
      y,
      // La pinza no se interpola: el gate se abre y se cierra en un instante, y
      // ese instante esta guardado. Suavizarlo seria borrar lo unico exacto.
      pinch: from.closed ? CLOSED_PINCH : OPEN_PINCH,
      tilt: edgeLean(x),
    };
  }
}

/**
 * Los instantes de una capa de melodia, ordenados y con el gate resuelto.
 *
 * El gate no viene dado en cada instante: viene como dos clases de evento, y lo
 * que sonaba en un momento cualquiera es el ultimo ataque o suelta que quedo
 * detras. Se resuelve una vez aqui, dando la vuelta al ciclo para saber con que
 * se entra: una nota que empezo antes del final de la vuelta sigue sonando al
 * principio de la siguiente.
 */
function melodyMoments(events: readonly LoopEvent[]): Moment[] {
  if (events.length === 0) return [];
  // Ordenar es de sobra hoy -tanto cerrar una toma como leer un enlace los dejan
  // en orden- y cuesta una vez por capa. Lo que sale mal si algun dia deja de
  // serlo no da un error: da una mano que va y viene sin sentido.
  const sorted = [...events].sort((a, b) => a.t - b.t);

  // Con que se entra en la vuelta: lo que dijera el ultimo ataque o suelta.
  let closed = false;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const kind = sorted[i]!.kind;
    if (kind === 'attack' || kind === 'release') {
      closed = kind === 'attack';
      break;
    }
  }

  return sorted.map((event) => {
    if (event.kind === 'attack') closed = true;
    else if (event.kind === 'release') closed = false;
    return {
      t: event.t,
      midi: freqToMidi(event.freq),
      // El corte va invertido respecto a la Y de la imagen: arriba es brillante.
      y: denormalize(1 - event.cutoffNorm),
      closed,
    };
  });
}

/**
 * El volumen deshecho, para que la fuerza vuelva a ser la del brazo.
 *
 * Una capa no guarda la fuerza del golpe: guarda la fuerza por el volumen que
 * habia al grabar, porque una capa suena para siempre al volumen con el que se
 * toco. Eso es lo que hay que oir y es lo contrario de lo que hay que ver: la
 * mano se levanto lo que se levanto.
 *
 * Lo que pasa sin esto, medido con el ritmo de la demostracion al volumen de
 * fabrica: los golpes del charles se guardan entre 0,46 y 0,54, o sea enteros
 * por debajo del golpe flojo de referencia, asi que todos se recortan a la misma
 * altura minima y esa mano se dibuja plana. El bombo y la caja se salvan a
 * medias, que es lo peor de los dos mundos: queda algo de dinamica, la justa
 * para que no se note que la otra mano la ha perdido entera.
 *
 * El volumen no se guarda en ninguna parte, asi que se estima: el golpe mas
 * fuerte de la capa se toma por un golpe fuerte. No sale clavado -el detector da
 * algo mas de 0,9 cuando se pega de verdad, asi que la estimacion se queda corta
 * en torno a un diez por ciento-, pero eso mueve todas las alturas a la vez y lo
 * que separa un golpe de otro no se toca. Cuando la capa no trae ningun golpe
 * fuerte, se dibuja entera mas alta de lo que se toco; lo que no cambia nunca es
 * cual de los golpes fue mas fuerte que cual, que es lo que se ensena.
 *
 * Nunca hacia abajo: una capa grabada a todo volumen ya viene con su fuerza
 * intacta, y apretarla porque su golpe mas fuerte no llego al maximo seria
 * inventar al reves.
 */
function undoVolume(hits: readonly DrumHitEvent[]): number {
  let loudest = 0;
  for (const hit of hits) if (hit.force > loudest) loudest = hit.force;
  if (loudest <= 0) return 1;
  return Math.max(1, HARD_FORCE / loudest);
}

/** Los golpes de una capa de bateria, repartidos en las dos manos que fueron. */
function drumStrokes(hits: readonly DrumHitEvent[], cycleSeconds: number): DrumStroke[][] {
  if (hits.length === 0) return [];
  const sorted = [...hits].sort((a, b) => a.t - b.t);
  const volume = undoVolume(sorted);
  const hands: DrumStroke[][] = [[], []];
  for (const hit of sorted) {
    // La mitad del kit en la que vive la pieza, en el orden de fabrica: es el
    // reparto para el que esta pensado, y el que alguien haya movido una pieza
    // no cambia de mano lo que se grabo con la otra.
    const side = ROSTER.indexOf(hit.piece) < ROSTER.length / 2 ? 0 : 1;
    hands[side]!.push({
      at: hit.t,
      // El sitio lo pone el reparto de ahora, asi que aqui todavia no se sabe.
      x: 0,
      lift: liftForForce(hit.force * volume),
      pinch: hit.open ? CLOSED_PINCH : OPEN_PINCH,
      piece: hit.piece,
    });
  }
  return hands.filter((hand) => hand.length > 0).map((hand) => ring(hand, cycleSeconds));
}

/**
 * Cose el ciclo por los dos extremos.
 *
 * La coreografia que dibuja el viaje hasta un golpe es una linea recta de
 * tiempo: mira el golpe anterior y el siguiente. Aqui el tiempo es un circulo,
 * asi que se le da la lista con una copia del ultimo golpe una vuelta antes y
 * una del primero una vuelta despues. Con eso, lo que hay antes del primer golpe
 * es el viaje que viene del ultimo -que es la verdad- y la coreografia no se
 * entera de que el tiempo da vueltas.
 */
function ring(strokes: DrumStroke[], cycleSeconds: number): DrumStroke[] {
  const first = strokes[0]!;
  const last = strokes[strokes.length - 1]!;
  return [
    { ...last, at: last.at - cycleSeconds },
    ...strokes,
    { ...first, at: first.at + cycleSeconds },
  ];
}
