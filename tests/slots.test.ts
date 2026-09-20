import { describe, expect, it } from 'vitest';
import { SlotTracker } from '../src/tracking/slots';
import { HOLD_MS } from '../src/tracking/handedness';
import { makeHand } from './helpers';
import type { HandFrame } from '../src/tracking/types';

/**
 * Varias personas a una mano cada una.
 *
 * Lo que se comprueba aqui es lo unico que esto anade y que puede estar mal en
 * silencio: de quien es cada mano. Si se tuerce no salta ningun error, sale una
 * nota -la mano de una persona empieza a mandar sobre el instrumento de otra- y
 * desde fuera eso no se distingue de un instrumento que va mal.
 *
 * Con tres personas importa mas que con dos, y no porque el codigo sea mas
 * dificil: hay mas maneras de cruzarse.
 */

const hand = (cx: number, cy = 0.5): HandFrame => {
  const raw = makeHand(cx, cy);
  return { landmarks: raw, raw };
};

/** Donde esta la mano que ha caido en cada hueco, para leerlo de un vistazo. */
const wheres = (slots: ReturnType<SlotTracker['update']>): (number | null)[] =>
  slots.map((slot) => (slot ? slot.hand.raw[0]!.x : null));

describe('el reparto de una mano por persona', () => {
  it('la primera vez se reparten de izquierda a derecha', () => {
    /*
     * Podria ser al reves y sonaria igual, porque cada persona tiene el encuadre
     * entero. No da igual para explicarlo: el panel habla de "la segunda
     * persona" y quien lo lee tiene que poder saber quien es esa sin probar.
     */
    const tracker = new SlotTracker();
    // Se entregan desordenadas a proposito: lo que manda es donde estan.
    const slots = tracker.update([hand(0.8), hand(0.2), hand(0.5)], 0, 3);

    expect(slots).toHaveLength(3);
    const [first, second, third] = wheres(slots) as [number, number, number];
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });

  it('tres manos que se cruzan no se cambian de instrumento', () => {
    /*
     * Es la razon de ser del modo: las tres sobre el encuadre entero, asi que
     * tarde o temprano una pasa por encima de otra. Aqui las de los extremos
     * intercambian el sitio pasando las dos por encima de la de en medio, que es
     * el cruce que de verdad puede liarla.
     */
    const tracker = new SlotTracker();
    tracker.update([hand(0.2), hand(0.5), hand(0.8)], 0, 3);

    let slots = tracker.update([], 0, 3);
    for (let step = 1; step <= 20; step += 1) {
      const t = step / 20;
      slots = tracker.update([hand(0.2 + 0.6 * t), hand(0.5), hand(0.8 - 0.6 * t)], step * 16, 3);
    }

    const [first, second, third] = wheres(slots) as [number, number, number];
    // Quien empezo a la izquierda acaba a la derecha y sigue siendo quien era.
    expect(first).toBeGreaterThan(0.7);
    expect(second).toBeCloseTo(0.5, 1);
    expect(third).toBeLessThan(0.3);
  });

  it('una mano que baja un momento no le da su instrumento a nadie', () => {
    const tracker = new SlotTracker();
    tracker.update([hand(0.2), hand(0.5), hand(0.8)], 0, 3);

    // La de en medio desaparece y las otras dos siguen ahi.
    const held = tracker.update([hand(0.2), hand(0.8)], 100, 3);
    expect(held[1], 'se sostiene medio segundo, como siempre').not.toBeNull();
    expect(held[1]!.held).toBe(true);
    expect(wheres(held)[1]).toBeCloseTo(0.5, 5);

    // Y al volver, vuelve a la suya y no a la de otra persona.
    const back = tracker.update([hand(0.2), hand(0.52), hand(0.8)], 200, 3);
    expect(wheres(back)[1]).toBeCloseTo(0.52, 5);
    expect(back[1]!.held).toBe(false);
  });

  it('y si no vuelve, el hueco se queda vacio en vez de robar una mano', () => {
    // Sin esto, perder una mano le daria a esa persona la mano de la de al lado
    // y sonarian las dos cosas en un instrumento solo.
    const tracker = new SlotTracker();
    tracker.update([hand(0.2), hand(0.5), hand(0.8)], 0, 3);
    const gone = tracker.update([hand(0.2), hand(0.8)], HOLD_MS + 50, 3);

    expect(gone[1]).toBeNull();
    expect(wheres(gone)[0]).toBeCloseTo(0.2, 5);
    expect(wheres(gone)[2]).toBeCloseTo(0.8, 5);
  });

  it('una cuarta mano no desaloja a nadie', () => {
    /*
     * Pasa solo: alguien levanta la segunda mano sin querer. Lo que no puede
     * pasar es que esa mano de mas le quite el instrumento a quien lo estaba
     * tocando, porque entonces la nota de esa persona se va con la mano que
     * levanto otra.
     */
    const tracker = new SlotTracker();
    tracker.update([hand(0.2), hand(0.5), hand(0.8)], 0, 3);
    const slots = tracker.update([hand(0.2), hand(0.5), hand(0.8), hand(0.35)], 16, 3);

    expect(wheres(slots)).toEqual([0.2, 0.5, 0.8].map((x) => expect.closeTo(x, 5)));
  });

  it('cambiar cuantas personas hay no hereda de quien era cada mano', () => {
    /*
     * Los huecos guardan donde estaba cada mano. Pasar de dos personas a tres
     * con esa memoria puesta le daria a la tercera la mano que hasta hace un
     * fotograma era de la segunda, y a la segunda la de la primera.
     */
    const tracker = new SlotTracker();
    tracker.update([hand(0.3), hand(0.7)], 0, 2);
    const slots = tracker.update([hand(0.2), hand(0.5), hand(0.8)], 16, 3);

    expect(slots).toHaveLength(3);
    expect(wheres(slots)).toEqual([0.2, 0.5, 0.8].map((x) => expect.closeTo(x, 5)));
  });

  it('con menos manos que personas, las plazas que sobran se quedan vacias', () => {
    // Tres personas puestas y solo dos delante: la tercera no se rellena con una
    // mano prestada, que sonaria como una nota que no toca nadie.
    const tracker = new SlotTracker();
    const slots = tracker.update([hand(0.3), hand(0.7)], 0, 3);

    expect(slots[0]).not.toBeNull();
    expect(slots[1]).not.toBeNull();
    expect(slots[2]).toBeNull();
  });
});
