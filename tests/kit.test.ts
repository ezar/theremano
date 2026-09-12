import { describe, expect, it } from 'vitest';
import { BAND, KIT, bandCenter, pieceAt, pieceIndexAt } from '../src/mapping/kit';

/**
 * El reparto de las piezas a lo ancho.
 *
 * Es aritmetica de tres lineas, y aun asi es donde se decide si golpear en el
 * sitio donde uno ve una banda hace sonar esa banda. Lo que se comprueba es
 * sobre todo los bordes: el centro de una banda no falla nunca, y el limite
 * entre dos y el extremo del encuadre fallan los dos por un uno de diferencia.
 */

describe('reparto de la bateria', () => {
  it('el centro de cada banda suena su pieza', () => {
    for (let i = 0; i < KIT.length; i += 1) {
      expect(pieceAt(bandCenter(i)), `banda ${i}`).toBe(KIT[i]);
    }
  });

  it('la mano pegada a cualquiera de los dos bordes sigue teniendo pieza', () => {
    // El uno exacto cae fuera al dividir, y es una postura normal: el encuadre
    // util ya viene recortado, asi que su borde no es el borde de la imagen.
    expect(pieceAt(0)).toBe(KIT[0]);
    expect(pieceAt(1)).toBe(KIT[KIT.length - 1]);
  });

  it('y fuera del rango no se sale de la lista', () => {
    // Nadie deberia llamar con esto, pero normalize() recorta a 0..1 y quien
    // recorta puede dejar de hacerlo: el precio de equivocarse aqui es un
    // undefined golpeando.
    expect(pieceAt(-3)).toBe(KIT[0]);
    expect(pieceAt(9)).toBe(KIT[KIT.length - 1]);
  });

  it('la frontera pertenece a la banda de la derecha, y solo a una', () => {
    for (let i = 1; i < KIT.length; i += 1) {
      const border = i * BAND;
      expect(pieceIndexAt(border), `frontera ${i}`).toBe(i);
      expect(pieceIndexAt(border - 1e-6), `justo antes de ${i}`).toBe(i - 1);
    }
  });

  it('las cuatro bandas miden lo mismo y cubren el encuadre entero', () => {
    // Si una banda fuera mas ancha que otra, la pieza de la banda estrecha
    // seria mas dificil de dar sin que nada en pantalla lo explicara.
    expect(BAND * KIT.length).toBeCloseTo(1, 10);
    const seen = new Set<string>();
    for (let x = 0; x <= 1; x += 0.001) seen.add(pieceAt(x));
    expect(seen.size).toBe(KIT.length);
  });

  it('bombo y caja caen en la mitad izquierda, charles y plato en la derecha', () => {
    // No es una preferencia estetica: una mano alterna bombo y caja mientras la
    // otra lleva el pulso en el charles, y eso solo funciona si cada pareja cabe
    // en la mitad de su mano.
    expect(pieceAt(0.2)).toBe('kick');
    expect(pieceAt(0.4)).toBe('snare');
    expect(pieceAt(0.6)).toBe('hat');
    expect(pieceAt(0.8)).toBe('crash');
  });

  it('el plato es el de la esquina, que es el que menos se usa', () => {
    expect(KIT[KIT.length - 1]).toBe('crash');
  });
});
