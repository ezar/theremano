import { describe, expect, it } from 'vitest';
import { swingTime } from '../src/audio/swing';

/**
 * El swing decide donde cae cada golpe, asi que puede estropear un ritmo de
 * formas que no dan ningun error: dos golpes en el mismo instante, dos golpes
 * cambiados de orden, o el uno movido de sitio. Aqui se comprueban justo esas
 * tres, porque las tres suenan a que el instrumento va mal y ninguna se ve.
 */

const BEAT = 0.5;

describe('el swing', () => {
  it('a cero devuelve exactamente lo que se toco', () => {
    // Es lo que permite subirlo y bajarlo con la vuelta girando: el original no
    // se pierde, porque esto se aplica al reproducir y no al grabar.
    for (const t of [0, 0.13, 0.25, 0.5, 1.37, 4]) {
      expect(swingTime(t, BEAT, 0)).toBe(t);
    }
  });

  it('no mueve los golpes que caen en el pulso', () => {
    // Son los que llevan el compas. Moverlos no seria darle swing al ritmo,
    // seria cambiarlo de sitio entero.
    for (const beat of [0, 1, 2, 7]) {
      expect(swingTime(beat * BEAT, BEAT, 1)).toBeCloseTo(beat * BEAT, 9);
    }
  });

  it('retrasa la corchea de en medio, y mas cuanto mas swing', () => {
    const straight = swingTime(BEAT / 2, BEAT, 0);
    const some = swingTime(BEAT / 2, BEAT, 0.5);
    const full = swingTime(BEAT / 2, BEAT, 1);
    expect(some).toBeGreaterThan(straight);
    expect(full).toBeGreaterThan(some);
    // Dos contra uno, que es el swing de libro: la corchea al 66% del pulso.
    expect(full).toBeCloseTo(BEAT * 0.66, 9);
  });

  it('nunca cruza dos golpes de orden', () => {
    /*
     * Es lo unico que no se puede permitir. Si el reparto no fuera siempre
     * creciente, un ritmo con swing sonaria con los golpes cambiados de orden:
     * el charles antes que el bombo que iba delante. Se barre el ciclo entero a
     * milesimas y con todos los valores de swing.
     */
    for (const amount of [0.1, 0.35, 0.5, 0.8, 1]) {
      let previous = -Infinity;
      for (let t = 0; t < 4; t += 0.001) {
        const moved = swingTime(t, BEAT, amount);
        expect(moved, `swing ${amount} en ${t.toFixed(3)}`).toBeGreaterThanOrEqual(previous);
        previous = moved;
      }
    }
  });

  it('se traga lo que no es un pulso en lugar de escupir un NaN', () => {
    // Un ciclo sin compas, o un golpe que llega roto de un enlace. Un NaN aqui
    // no da un error: programa un golpe en un instante imposible y la vuelta
    // entera deja de sonar.
    expect(swingTime(1, 0, 1)).toBe(1);
    expect(swingTime(1, -2, 1)).toBe(1);
    expect(Number.isFinite(swingTime(0.3, BEAT, 1))).toBe(true);
  });
});
