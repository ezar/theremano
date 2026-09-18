import { describe, expect, it } from 'vitest';
import { DuoTracker, handsNeeded, lensFor, playerCount } from '../src/tracking/duo';
import { FULL_LENS, melodyFeatures, normalizeIn } from '../src/mapping/features';
import { Mapper } from '../src/mapping/mapper';
import { createLayout, pitchAt } from '../src/mapping/scales';
import { DEFAULT_SETTINGS } from '../src/state/store';
import { makeHand } from './helpers';
import type { HandFrame } from '../src/tracking/types';

/**
 * Dos personas delante de la misma camara.
 *
 * Lo que se comprueba aqui es lo unico que el duo anade y que puede estar mal
 * en silencio: de quien es cada mano. Si eso se tuerce no salta ningun error,
 * sale una nota. La mano de una persona empieza a mandar sobre el instrumento de
 * la otra, y desde fuera eso no se distingue de un instrumento que va mal.
 */

const hand = (cx: number, cy: number, options: Parameters<typeof makeHand>[2] = {}): HandFrame => {
  const raw = makeHand(cx, cy, options);
  return { landmarks: raw, raw };
};

/** Las dos manos de quien esta a la izquierda, y las dos de quien esta a la derecha. */
const LEFT_PAIR = [hand(0.12, 0.5), hand(0.36, 0.5)];
const RIGHT_PAIR = [hand(0.64, 0.5), hand(0.88, 0.5)];

describe('el reparto entre dos personas', () => {
  it('a media pantalla, cada una toca con las manos de su lado', () => {
    const tracker = new DuoTracker();
    const players = tracker.update([...LEFT_PAIR, ...RIGHT_PAIR], 0, 'halves');

    expect(players).toHaveLength(2);
    for (const player of players) {
      expect(player.roles.melody, 'las dos tienen melodia').not.toBeNull();
      expect(player.roles.expression, 'y las dos tienen expresion').not.toBeNull();
    }
    // Y ninguna se ha llevado una mano del otro lado, que es lo que pasaria con
    // un solo reparto para las cuatro: las dos manos de en medio son vecinas.
    for (const tracked of [players[0]!.roles.melody, players[0]!.roles.expression]) {
      expect(tracked!.hand.raw[0]!.x).toBeLessThan(0.5);
    }
    for (const tracked of [players[1]!.roles.melody, players[1]!.roles.expression]) {
      expect(tracked!.hand.raw[0]!.x).toBeGreaterThan(0.5);
    }
  });

  it('a una mano cada una, las dos tocan sin mano de expresion', () => {
    const tracker = new DuoTracker();
    const players = tracker.update([hand(0.3, 0.5), hand(0.7, 0.5)], 0, 'hands');

    expect(players).toHaveLength(2);
    for (const player of players) {
      expect(player.roles.melody).not.toBeNull();
      // Sin ella no hay volumen ni pedal, y eso es justo el trato de este modo.
      expect(player.roles.expression).toBeNull();
    }
  });

  it('a una mano cada una se pueden cruzar sin cambiarse el instrumento', () => {
    /*
     * Es la razon de ser del modo: las dos sobre el encuadre entero, asi que
     * tarde o temprano una pasa por encima de la otra. Si al cruzarse se
     * cambiaran de instrumento, lo que oiria cada una es que su nota salta a
     * donde estaba la de la otra. El reparto va por continuidad, no por quien
     * esta mas a la izquierda, y esto es lo que lo comprueba.
     */
    const tracker = new DuoTracker();
    const first = tracker.update([hand(0.25, 0.5), hand(0.75, 0.5)], 0, 'hands');
    const startedLeft = first[0]!.roles.melody!.hand.raw[0]!.x < 0.5;

    // Se cruzan despacio, un paso por fotograma, hasta quedar al reves.
    let players = first;
    for (let step = 1; step <= 20; step += 1) {
      const t = step / 20;
      const a = 0.25 + 0.5 * t;
      const b = 0.75 - 0.5 * t;
      players = tracker.update([hand(a, 0.5), hand(b, 0.5)], step * 16, 'hands');
    }

    expect(players[0]!.roles.melody, 'nadie se queda sin mano al cruzarse').not.toBeNull();
    expect(players[1]!.roles.melody).not.toBeNull();
    // Quien empezo a la izquierda acaba a la derecha, y sigue siendo quien era.
    expect(players[0]!.roles.melody!.hand.raw[0]!.x > 0.5).toBe(startedLeft);
  });

  it('una persona sola no se convierte en dos por encender el duo', () => {
    // Con el duo puesto y una sola persona delante, la otra plaza esta vacia y
    // no se rellena con una mano prestada: sonaria una nota que nadie toca.
    const tracker = new DuoTracker();
    const players = tracker.update(LEFT_PAIR, 0, 'halves');
    expect(players[0]!.roles.melody).not.toBeNull();
    expect(players[1]!.roles.melody).toBeNull();
    expect(players[1]!.roles.expression).toBeNull();
  });

  it('cambiar de modo no hereda de quien era cada mano', () => {
    /*
     * Los dos repartos guardan memoria de donde estaba cada mano. Encender el
     * duo a mitad de tocar con esa memoria puesta le daria a la segunda persona
     * la mano que hasta hace un fotograma era la de expresion de la primera, con
     * su papel y su sitio. Se empieza de cero, que ademas es lo que se ve.
     */
    const tracker = new DuoTracker();
    tracker.update(LEFT_PAIR, 0, 'off');
    const players = tracker.update([...LEFT_PAIR, ...RIGHT_PAIR], 16, 'halves');
    expect(players).toHaveLength(2);
    expect(players[1]!.roles.melody, 'quien llega tiene sus propias manos').not.toBeNull();
    expect(players[1]!.roles.melody!.hand.raw[0]!.x).toBeGreaterThan(0.5);
  });

  it('sin duo sigue habiendo una sola persona con el encuadre entero', () => {
    const tracker = new DuoTracker();
    const players = tracker.update(LEFT_PAIR, 0, 'off');
    expect(players).toHaveLength(1);
    expect(players[0]!.lens).toEqual(FULL_LENS);
    expect(playerCount('off')).toBe(1);
    expect(playerCount('halves')).toBe(2);
    // Y no se le cobra a quien toca solo el detector de un duo que no usa.
    expect(handsNeeded('off')).toBe(2);
    expect(handsNeeded('hands')).toBe(2);
    expect(handsNeeded('halves')).toBe(4);
  });
});

describe('la franja de cada persona', () => {
  it('cada mitad da la escala entera, no media escala', () => {
    /*
     * Es lo que separa un duo de un instrumento partido por la mitad. Dentro de
     * su lado, cada persona tiene desde la nota mas grave hasta la mas aguda: si
     * la franja no reescalara, las dos tocarian media escala y ademas distinta.
     */
    const layout = createLayout('pentatonic', 9, 3, 2);
    const lowest = pitchAt(layout, 0).midi;
    const highest = pitchAt(layout, 1).midi;
    expect(highest).toBeGreaterThan(lowest);

    for (const player of [0, 1]) {
      const lens = lensFor('halves', player);
      const at = (fraction: number): number =>
        pitchAt(layout, normalizeIn(lens.from + fraction * (lens.to - lens.from), lens)).midi;
      expect(at(0.02), `persona ${player}`).toBe(lowest);
      expect(at(0.98), `persona ${player}`).toBe(highest);
    }
  });

  it('en medio hay tierra de nadie, que es lo que separa a las dos', () => {
    // Los margenes de dentro de las dos franjas se juntan en el centro. Sin
    // ellos, acercarse al centro seria tocar la nota mas aguda de tu mitad
    // mientras la otra persona toca la mas grave de la suya a un dedo.
    const left = lensFor('halves', 0);
    const right = lensFor('halves', 1);
    expect(normalizeIn(0.49, left)).toBe(1);
    expect(normalizeIn(0.51, right)).toBe(0);
  });

  it('la lente llega hasta la nota que suena, no solo hasta la posicion', () => {
    /*
     * La prueba de verdad: dos mapeadores de verdad, uno por franja, con la
     * misma mano en el mismo sitio de su propia mitad. Tienen que dar la MISMA
     * nota. Si la lente no llegara hasta el mapeador -si se quedara en un
     * numero que nadie mira- esto saldria distinto y el duo seria un
     * instrumento partido sin que nada fallara.
     */
    const notes = [0, 1].map((player) => {
      const mapper = new Mapper(DEFAULT_SETTINGS);
      mapper.setLens(lensFor('halves', player));
      const lens = lensFor('halves', player);
      const x = lens.from + 0.5 * (lens.to - lens.from);
      let midi = 0;
      // Varios fotogramas: el tono va filtrado y el primero todavia viene de cero.
      for (let frame = 0; frame < 30; frame += 1) {
        midi = mapper.update({ melody: { hand: hand(x, 0.5), held: false, heldFor: 0 }, expression: null }, frame / 30).midi;
      }
      return midi;
    });
    expect(notes[0]).toBe(notes[1]);
  });

  it('y sin lente todo sigue midiendo lo de siempre', () => {
    // La lente por defecto es el encuadre entero: quien toca solo no se entera
    // de que esto existe, y esa es la condicion para que el duo no cueste nada.
    const landmarks = makeHand(0.3, 0.5);
    expect(melodyFeatures(landmarks).x).toBe(melodyFeatures(landmarks, FULL_LENS).x);
  });
});
