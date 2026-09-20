import { describe, expect, it } from 'vitest';
import { KIT, type KitLayout, bandCenter, bandWidth, defaultLayout, growLayout, normalizeLayout, pieceAt, pieceIndexAt } from '../src/mapping/kit';

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
      expect(pieceAt(KIT, bandCenter(i, KIT.length)), `banda ${i}`).toBe(KIT[i]);
    }
  });

  it('la mano pegada a cualquiera de los dos bordes sigue teniendo pieza', () => {
    // El uno exacto cae fuera al dividir, y es una postura normal: el encuadre
    // util ya viene recortado, asi que su borde no es el borde de la imagen.
    expect(pieceAt(KIT, 0)).toBe(KIT[0]);
    expect(pieceAt(KIT, 1)).toBe(KIT[KIT.length - 1]);
  });

  it('y fuera del rango no se sale de la lista', () => {
    // Nadie deberia llamar con esto, pero normalize() recorta a 0..1 y quien
    // recorta puede dejar de hacerlo: el precio de equivocarse aqui es un
    // undefined golpeando.
    expect(pieceAt(KIT, -3)).toBe(KIT[0]);
    expect(pieceAt(KIT, 9)).toBe(KIT[KIT.length - 1]);
  });

  it('la frontera pertenece a la banda de la derecha, y solo a una', () => {
    for (let i = 1; i < KIT.length; i += 1) {
      const border = i * bandWidth(KIT.length);
      expect(pieceIndexAt(border, KIT.length), `frontera ${i}`).toBe(i);
      expect(pieceIndexAt(border - 1e-6, KIT.length), `justo antes de ${i}`).toBe(i - 1);
    }
  });

  it('las cuatro bandas miden lo mismo y cubren el encuadre entero', () => {
    // Si una banda fuera mas ancha que otra, la pieza de la banda estrecha
    // seria mas dificil de dar sin que nada en pantalla lo explicara.
    expect(bandWidth(KIT.length) * KIT.length).toBeCloseTo(1, 10);
    const seen = new Set<string>();
    for (let x = 0; x <= 1; x += 0.001) seen.add(pieceAt(KIT, x));
    expect(seen.size).toBe(KIT.length);
  });

  it('bombo y caja caen en la mitad izquierda, charles y plato en la derecha', () => {
    // No es una preferencia estetica: una mano alterna bombo y caja mientras la
    // otra lleva el pulso en el charles, y eso solo funciona si cada pareja cabe
    // en la mitad de su mano.
    expect(pieceAt(KIT, 0.2)).toBe('kick');
    expect(pieceAt(KIT, 0.4)).toBe('snare');
    expect(pieceAt(KIT, 0.6)).toBe('hat');
    expect(pieceAt(KIT, 0.8)).toBe('crash');
  });

  it('el plato es el de la esquina, que es el que menos se usa', () => {
    expect(KIT[KIT.length - 1]).toBe('crash');
  });
});

describe('un kit de mas de cuatro piezas', () => {
  it('los toms entran en medio y no reordenan lo que ya habia', () => {
    /*
     * Subir el numero de piezas no puede mover las que ya estaban: quien tiene
     * el charles donde su mano lo alcanza y anade un tom no espera encontrarse
     * el charles en otro sitio. Los toms van entre la caja y el charles, que es
     * donde estan en una bateria de verdad y donde la mano los alcanza sin
     * cruzar el encuadre.
     */
    expect(defaultLayout(4)).toEqual(['kick', 'snare', 'hat', 'crash']);
    expect(defaultLayout(5)).toEqual(['kick', 'snare', 'tomLow', 'hat', 'crash']);
    expect(defaultLayout(6)).toEqual(['kick', 'snare', 'tomLow', 'tomHigh', 'hat', 'crash']);
  });

  it('cada banda mide lo suyo y siguen cubriendo el encuadre entero', () => {
    for (const size of [4, 5, 6]) {
      const layout = defaultLayout(size);
      expect(bandWidth(size) * size, `${size} piezas`).toBeCloseTo(1, 10);
      const seen = new Set<string>();
      for (let x = 0; x <= 1; x += 0.0005) seen.add(pieceAt(layout, x));
      expect(seen.size, `${size} piezas`).toBe(size);
      // Y el centro de cada banda sigue sonando su pieza, que es lo unico que
      // de verdad se le pide a un reparto.
      for (let i = 0; i < size; i += 1) {
        expect(pieceAt(layout, bandCenter(i, size)), `${size} piezas, banda ${i}`).toBe(layout[i]);
      }
    }
  });

  it('el reparto guardado se recorta o se rellena al cambiar de tamano', () => {
    // Bajar de seis a cuatro deja fuera dos piezas, y subir de cuatro a seis
    // mete las que faltan. Lo que no puede salir nunca es un reparto con una
    // banda repetida o con menos bandas de las que dice tener.
    const six: KitLayout = ['crash', 'hat', 'tomHigh', 'tomLow', 'snare', 'kick'];
    expect(growLayout(six, 4)).toEqual(['crash', 'hat', 'snare', 'kick']);
    const grown = growLayout(['crash', 'hat', 'snare', 'kick'], 6);
    expect(grown).toHaveLength(6);
    expect(new Set(grown).size).toBe(6);
    // Lo que ya estaba, en el orden en que estaba.
    expect(grown.filter((piece) => !piece.startsWith('tom'))).toEqual(['crash', 'hat', 'snare', 'kick']);
  });

  it('las piezas nuevas entran en su sitio, no al final', () => {
    /*
     * Anadirlas al final es lo facil y deja los toms pasado el plato, que es el
     * peor sitio que hay: el extremo solo puede permitirselo una pieza que se
     * usa una vez por compas, y un tom no lo es. Lo caza un navegador antes que
     * una prueba, asi que aqui queda escrito.
     */
    expect(growLayout(['kick', 'snare', 'hat', 'crash'], 6)).toEqual([
      'kick', 'snare', 'tomLow', 'tomHigh', 'hat', 'crash',
    ]);
    expect(growLayout(['kick', 'snare', 'hat', 'crash'], 5)).toEqual([
      'kick', 'snare', 'tomLow', 'hat', 'crash',
    ]);
    // Y sanear sigue siendo otra cosa: ahi lo que falta va detras, porque no se
    // sabe si falta por que alguien lo quito o por un guardado a medias.
    expect(normalizeLayout(['crash'], 4)).toEqual(['crash', 'kick', 'snare', 'hat']);
  });

  it('un tamano imposible no deja un kit imposible', () => {
    // Llega de unos ajustes guardados o de un enlace escrito a mano. Un kit de
    // cero bandas no da un error: da una division por cero y un undefined
    // golpeando.
    for (const size of [0, -3, 1.5, 99, NaN]) {
      const layout = normalizeLayout(null, size);
      expect(layout.length, `${size}`).toBeGreaterThanOrEqual(4);
      expect(layout.length, `${size}`).toBeLessThanOrEqual(6);
      expect(new Set(layout).size).toBe(layout.length);
    }
  });
});
