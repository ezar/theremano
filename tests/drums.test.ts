import { describe, expect, it } from 'vitest';
import { Mapper, type DrumHit } from '../src/mapping/mapper';
import { normalize, palmCenter } from '../src/mapping/features';
import { KIT, pieceAt } from '../src/mapping/kit';
import { DEFAULT_SETTINGS } from '../src/state/store';
import { makeHand } from './helpers';
import type { Landmark, RoleAssignment } from '../src/tracking/types';

/**
 * El modo bateria visto desde el mapeador.
 *
 * El detector de golpe ya tiene sus propias pruebas y ahi se mide el cuando.
 * Aqui se mira lo otro: que golpee la mano que ha bajado y no la otra, que suene
 * la pieza que hay debajo, y sobre todo lo que tiene que DEJAR de pasar. Entrar
 * en bateria apaga medio instrumento —la nota sostenida, el pedal, el timbre por
 * dedos, el volumen por altura— y cada una de esas cosas, si se queda encendida,
 * no da un error: da una nota de sintetizador debajo de un ritmo, o un volumen
 * que sube solo en cada golpe.
 */

const FPS = 60;
const DT = 1 / FPS;
const SETTINGS = { ...DEFAULT_SETTINGS, drums: true };

interface HandPose {
  x: number;
  /** Altura de reposo, arriba. */
  y: number;
  pinch?: number;
  fingers?: number;
}

/** Una mano golpeando: baja, frena abajo y vuelve, arrancando y acabando quieta. */
function swing(pose: HandPose, phase: number, depth = 0.3): Landmark[] {
  const drop = (1 - Math.cos(phase * Math.PI * 2)) / 2;
  return makeHand(pose.x, pose.y + depth * drop, { pinch: pose.pinch ?? 1, fingers: pose.fingers ?? 4 });
}

class Session {
  readonly mapper: Mapper;
  private seconds = 0;
  readonly hits: Array<DrumHit & { t: number }> = [];
  /** Cambios de timbre confirmados. Un cambio solo se anuncia en su fotograma. */
  presetChanges = 0;
  last;

  constructor(settings: Readonly<typeof DEFAULT_SETTINGS> = SETTINGS) {
    this.mapper = new Mapper(settings);
    this.last = this.mapper.update({ melody: null, expression: null }, 0);
  }

  /** @param seconds lo que dura cada golpe, de arriba a abajo y vuelta. */
  strikes(count: number, melody: HandPose | null, expression: HandPose | null, seconds = 0.34): void {
    const frames = Math.round(seconds * count * FPS);
    for (let frame = 0; frame <= frames; frame += 1) {
      this.seconds += DT;
      const phase = ((frame / FPS) % seconds) / seconds;
      const assignment: RoleAssignment = {
        melody: melody ? tracked(swing(melody, phase)) : null,
        expression: expression ? tracked(swing(expression, phase)) : null,
      };
      this.last = this.mapper.update(assignment, this.seconds);
      this.collect();
    }
  }

  /** Las dos manos quietas donde esten, sin golpear. */
  still(frames: number, melody: HandPose | null, expression: HandPose | null): void {
    for (let frame = 0; frame < frames; frame += 1) {
      this.seconds += DT;
      this.last = this.mapper.update(
        {
          melody: melody ? tracked(swing(melody, 0)) : null,
          expression: expression ? tracked(swing(expression, 0)) : null,
        },
        this.seconds,
      );
      this.collect();
    }
  }

  /**
   * La mano que el seguimiento ya no ve y sigue sirviendo congelada.
   *
   * No es lo mismo que no haber mano: el asignador de roles la recuerda medio
   * segundo con los ultimos puntos que vio, asi que al mapeador le sigue
   * llegando una mano, con los mismos puntos fotograma tras fotograma.
   */
  held(frames: number, melody: HandPose | null): void {
    for (let frame = 0; frame < frames; frame += 1) {
      this.seconds += DT;
      const hand = melody ? swing(melody, 0) : null;
      this.last = this.mapper.update(
        { melody: hand ? { hand: { landmarks: hand, raw: hand }, held: true, heldFor: 100 } : null, expression: null },
        this.seconds,
      );
      this.collect();
    }
  }

  /** Un fotograma con la mano de expresion recordada y la otra ausente. */
  heldExpression(pose: HandPose): void {
    this.seconds += DT;
    const hand = swing(pose, 0);
    this.last = this.mapper.update(
      { melody: null, expression: { hand: { landmarks: hand, raw: hand }, held: true, heldFor: 100 } },
      this.seconds,
    );
    this.collect();
  }

  private collect(): void {
    for (const hit of this.last.strikes) this.hits.push({ ...hit, t: this.seconds });
    if (this.last.preset) this.presetChanges += 1;
  }
}

function tracked(landmarks: Landmark[]) {
  return { hand: { landmarks, raw: landmarks }, held: false, heldFor: 0 };
}

/** Que pieza hay de verdad debajo de una mano puesta en esa x. */
function pieceUnder(x: number): string {
  return pieceAt(KIT, normalize(palmCenter(makeHand(x, 0.35)).x));
}

describe('modo bateria', () => {
  it('cada mano golpea la pieza que tiene debajo', () => {
    const session = new Session();
    session.strikes(3, { x: 0.12, y: 0.3 }, { x: 0.62, y: 0.3 });

    const left = session.hits.filter((h) => h.x < 0.4).map((h) => h.piece);
    const right = session.hits.filter((h) => h.x > 0.4).map((h) => h.piece);
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(right.length).toBeGreaterThanOrEqual(2);
    expect(new Set(left)).toEqual(new Set([pieceUnder(0.12)]));
    expect(new Set(right)).toEqual(new Set([pieceUnder(0.62)]));
    // Y no es la misma pieza dos veces: si lo fuera, la prueba no diria nada.
    expect(pieceUnder(0.12)).not.toBe(pieceUnder(0.62));
  });

  it('golpea la pieza que el reparto haya puesto debajo, no la de fabrica', () => {
    /*
     * El reparto se puede cambiar, y cambiarlo tiene que cambiar lo que suena en
     * cada sitio: es la unica razon para poder cambiarlo. Con el reparto dado la
     * vuelta, la mano de la izquierda -que de fabrica da al bombo- tiene que dar
     * al plato, y la de la derecha al reves.
     */
    const bands = [...KIT].reverse();
    const session = new Session({ ...SETTINGS, kitBands: bands });
    session.strikes(3, { x: 0.12, y: 0.3 }, { x: 0.62, y: 0.3 });

    const left = new Set(session.hits.filter((h) => h.x < 0.4).map((h) => h.piece));
    const right = new Set(session.hits.filter((h) => h.x > 0.4).map((h) => h.piece));
    expect(left).toEqual(new Set([pieceAt(bands, normalize(palmCenter(makeHand(0.12, 0.35)).x))]));
    expect(right).toEqual(new Set([pieceAt(bands, normalize(palmCenter(makeHand(0.62, 0.35)).x))]));
    // Y de verdad ha cambiado algo: con el reparto de fabrica eran otras dos.
    expect(left).not.toEqual(new Set([pieceUnder(0.12)]));
    expect(right).not.toEqual(new Set([pieceUnder(0.62)]));
  });

  it('el reparto que reparte es el mismo que se dibuja', () => {
    /*
     * Tres sitios tienen que estar de acuerdo sobre que pieza hay en cada banda:
     * el que suena, las bandas que se pintan y la mano de la demostracion. Si
     * cada uno arreglase un reparto incompleto por su cuenta, arreglarian
     * distinto y saldrian unas bandas que dicen una pieza y suenan otra. Por eso
     * los tres leen esto, y por eso esto sale entero pase lo que pase.
     */
    const mapper = new Mapper({ ...SETTINGS, kitBands: ['crash'] as never });
    expect(mapper.currentBands).toHaveLength(KIT.length);
    expect(new Set(mapper.currentBands)).toEqual(new Set(KIT));
    expect(mapper.currentBands[0]).toBe('crash');
  });

  it('un reparto imposible no deja ninguna banda muda', () => {
    // Nadie escribe esto a mano, pero sale de un almacenamiento de otra version.
    // Una banda sin pieza detras no da un error: da un golpe que no suena.
    const session = new Session({ ...SETTINGS, kitBands: [] });
    session.strikes(3, { x: 0.12, y: 0.3 }, { x: 0.62, y: 0.3 });
    expect(session.hits.length).toBeGreaterThanOrEqual(4);
    for (const hit of session.hits) expect(KIT).toContain(hit.piece);
  });

  it('las dos manos pueden caer en el mismo fotograma', () => {
    // No es un caso raro: bombo y charles a la vez es como empieza casi
    // cualquier compas. Con un solo golpe por fotograma se perderia uno.
    const session = new Session();
    session.strikes(3, { x: 0.12, y: 0.3 }, { x: 0.62, y: 0.3 });

    const together = countBy(session.hits, (h) => h.t.toFixed(4));
    expect(Math.max(...together.values())).toBe(2);
  });

  it('mover una mano de banda cambia la pieza sin tocar nada mas', () => {
    const session = new Session();
    session.strikes(2, { x: 0.12, y: 0.3 }, null);
    const first = session.hits.map((h) => h.piece);
    session.strikes(2, { x: 0.86, y: 0.3 }, null);
    const later = session.hits.slice(first.length).map((h) => h.piece);

    expect(first.length).toBeGreaterThan(0);
    expect(later.length).toBeGreaterThan(0);
    expect(new Set(first)).toEqual(new Set([pieceUnder(0.12)]));
    expect(new Set(later)).toEqual(new Set([pieceUnder(0.86)]));
  });

  it('golpear mas fuerte entra mas fuerte', () => {
    const soft = new Session();
    soft.strikes(2, { x: 0.5, y: 0.3 }, null, 0.6);
    const hard = new Session();
    hard.strikes(2, { x: 0.5, y: 0.3 }, null, 0.22);

    expect(soft.hits.length).toBeGreaterThan(0);
    expect(hard.hits.length).toBeGreaterThan(0);
    const loudest = (hits: DrumHit[]) => Math.max(...hits.map((h) => h.force));
    expect(loudest(hard.hits)).toBeGreaterThan(loudest(soft.hits) + 0.1);
  });

  it('la pinza no abre ninguna nota', () => {
    // Es lo mas importante de todo: una nota de sintetizador sostenida debajo
    // del ritmo es una segunda cosa sonando que nadie ha pedido.
    const session = new Session();
    session.still(20, { x: 0.5, y: 0.3, pinch: 0.1 }, null);
    expect(session.last.gateOpen).toBe(false);
    session.strikes(3, { x: 0.5, y: 0.3, pinch: 0.1 }, null);
    expect(session.last.gateOpen).toBe(false);
  });

  it('la altura de la otra mano ya no manda el volumen', () => {
    // Esa mano ahora golpea, y golpear es bajarla: sin esto, cada golpe subiria
    // el volumen de todo lo demas.
    const session = new Session();
    session.still(10, null, { x: 0.62, y: 0.2 });
    const high = session.last.volume;
    session.still(60, null, { x: 0.62, y: 0.7 });
    expect(session.last.volume).toBeCloseTo(high, 6);
    expect(session.last.volume).toBeCloseTo(DEFAULT_SETTINGS.masterVolume, 6);
  });

  it('ni el pedal ni el timbre se encienden mientras se golpea', () => {
    const session = new Session();
    // Pinza cerrada y tres dedos: las dos cosas que en melodia harian algo. Y
    // con los ajustes por defecto el timbre es otro, asi que tres dedos serian
    // un cambio de verdad y no una confirmacion de lo que ya hay.
    session.strikes(4, { x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3, pinch: 0.1, fingers: 3 });

    expect(session.hits.length).toBeGreaterThan(0);
    expect(session.last.drone).toBe(0);
    expect(session.last.droneMidi).toBe(0);
    // A lo largo de toda la fase, no solo en el ultimo fotograma: un cambio se
    // anuncia una vez y mirar solo el final no veria ninguno.
    expect(session.presetChanges).toBe(0);
    expect(session.last.presetCandidate).toBe(null);
  });

  it('una mano recordada no golpea al reaparecer en otro sitio', () => {
    /*
     * El caso que de verdad pasa con una camara. Cuando el modelo pierde la
     * mano, el asignador de roles no la borra: la recuerda medio segundo con los
     * ultimos puntos que vio. Asi que al mapeador le llega una mano quieta, y
     * cuando la de verdad reaparece —normalmente en otro sitio, porque se ha
     * movido mientras no se la veia— ese salto se lee como una caida
     * instantanea. Es un golpe que nadie ha dado, y suena solo.
     *
     * Distinto del caso de perder la mano del todo: ahi el mapeador recibe null
     * y reinicia. Aqui nunca recibe null.
     */
    const session = new Session();
    session.still(10, { x: 0.5, y: 0.3 }, null);
    const before = session.hits.length;
    session.held(6, { x: 0.5, y: 0.3 });
    session.still(4, { x: 0.5, y: 0.75 }, null);
    expect(session.hits.length).toBe(before);
  });

  it('y tampoco la otra mano', () => {
    const session = new Session();
    session.still(10, null, { x: 0.7, y: 0.3 });
    const before = session.hits.length;
    for (let frame = 0; frame < 6; frame += 1) {
      session.heldExpression({ x: 0.7, y: 0.3 });
    }
    session.still(4, null, { x: 0.7, y: 0.75 });
    expect(session.hits.length).toBe(before);
  });

  it('la fuerza de la ultima nota de melodia no se cuela en el volumen', () => {
    /*
     * La fuerza se fija en el ataque de una nota y dura toda la nota. En bateria
     * no hay ataques, asi que se quedaria la de la ultima nota que se toco antes
     * de cambiar de modo: los golpes sonarian mas o menos fuertes segun lo
     * deprisa que uno cerrase la pinza hace un rato. Ahi el volumen lo pone el
     * ajuste y la dinamica la pone el golpe.
     */
    const melodic = new Mapper(DEFAULT_SETTINGS);
    let seconds = 0;
    // Una nota entrada muy despacio: fuerza baja, y se queda puesta.
    for (let frame = 0; frame < 40; frame += 1) {
      seconds += DT;
      const pinch = Math.max(0.1, 1 - frame * 0.03);
      const hand = makeHand(0.5, 0.4, { pinch });
      melodic.update({ melody: tracked(hand), expression: tracked(makeHand(0.2, 0.5)) }, seconds);
    }
    const soft = melodic.update(
      { melody: tracked(makeHand(0.5, 0.4, { pinch: 0.1 })), expression: tracked(makeHand(0.2, 0.5)) },
      (seconds += DT),
    );
    expect(soft.gain, 'la nota ha entrado floja').toBeLessThan(soft.volume);

    melodic.syncSettings(SETTINGS);
    const drumming = melodic.update(
      { melody: tracked(makeHand(0.5, 0.4)), expression: null },
      (seconds += DT),
    );
    expect(drumming.gain).toBeCloseTo(drumming.volume, 6);
  });

  it('el charles solo se abre con la pinza cerrada', () => {
    /*
     * El gesto que se probo primero eran los dedos estirados, y estaba mal: una
     * mano que baja a golpear los lleva extendidos casi siempre, de modo que
     * abierto era lo que salia sin querer. Lo que tiene que salir sin pensar es
     * el cerrado, que es el que suena cien veces por minuto.
     */
    const normal = new Session();
    normal.strikes(3, { x: 0.62, y: 0.3 }, null);
    expect(normal.hits.length).toBeGreaterThan(0);
    expect(normal.hits.map((h) => h.piece)).toEqual(normal.hits.map(() => 'hat'));
    expect(normal.hits.some((h) => h.open), 'la mano abierta no abre el charles').toBe(false);

    const pinzado = new Session();
    pinzado.strikes(3, { x: 0.62, y: 0.3, pinch: 0.1 }, null);
    expect(pinzado.hits.length).toBeGreaterThan(0);
    expect(pinzado.hits.every((h) => h.open), 'con la pinza cerrada, abierto').toBe(true);
  });

  it('y la pinza no cambia de pieza ni abre ninguna nota', () => {
    // Lo que hace la pinza en bateria es esto y solo esto: ni elige pieza, que
    // la elige la banda, ni reabre el gate, que sigue cerrado a la fuerza.
    const session = new Session();
    session.strikes(3, { x: 0.2, y: 0.3, pinch: 0.1 }, null);
    expect(session.hits.map((h) => h.piece)).toEqual(session.hits.map(() => 'kick'));
    expect(session.last.gateOpen).toBe(false);
  });

  it('sin modo bateria no hay golpes por mucho que se baje la mano', () => {
    const session = new Session(DEFAULT_SETTINGS);
    session.strikes(4, { x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 });
    expect(session.hits).toHaveLength(0);
  });

  it('perder la mano no deja un golpe a medias esperando', () => {
    /*
     * La mano desaparece un solo fotograma y reaparece mucho mas abajo, que es
     * lo que pasa de verdad cuando el modelo la pierde a media bajada. El hueco
     * es mas corto que la ventana del detector a proposito: si fuera mas largo,
     * las muestras viejas caducarian solas y la prueba pasaria sin comprobar
     * nada. Sin el reinicio, ese salto se lee como una caida instantanea y
     * dispara un golpe que nadie ha dado.
     */
    const session = new Session();
    session.still(10, { x: 0.5, y: 0.3 }, null);
    const before = session.hits.length;
    session.still(1, null, null);
    session.still(3, { x: 0.5, y: 0.75 }, null);
    expect(session.hits.length).toBe(before);
  });
});

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}
