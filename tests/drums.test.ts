import { describe, expect, it } from 'vitest';
import { Mapper, type DrumHit } from '../src/mapping/mapper';
import { normalize, palmCenter } from '../src/mapping/features';
import { pieceAt } from '../src/mapping/kit';
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
  return pieceAt(normalize(palmCenter(makeHand(x, 0.35)).x));
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
