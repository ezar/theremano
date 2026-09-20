import { describe, expect, it } from 'vitest';
import { decodeGesture, encodeGesture, type GesturePacket } from '../src/net/packet';
import { midiToFreq } from '../src/mapping/scales';

/**
 * Lo que viaja entre dos dispositivos.
 *
 * Es el mismo trato que el enlace y por el mismo motivo: esto llega por una red
 * y lo puede escribir cualquiera, asi que se lee entero o se tira entero. Medio
 * paquete entendido no da un error -da una nota en una frecuencia que nadie ha
 * tocado, o un golpe en una pieza que no existe-, y por eso lo que se comprueba
 * aqui no es solo que la ida y la vuelta cuadren, sino que lo roto se rechaza.
 */

const silent: GesturePacket = {
  live: { gateEvent: null, gateOpen: false, freq: 440, cutoffNorm: 0.5, gain: 0.8, strikes: [] },
  pose: null,
};

describe('el paquete de un gesto', () => {
  it('lo que sale vuelve a entrar', () => {
    const packet: GesturePacket = {
      live: { gateEvent: 'attack', gateOpen: true, freq: midiToFreq(69), cutoffNorm: 0.25, gain: 0.7, strikes: [] },
      pose: { x: 0.3, y: 0.6, pinch: 0.14, tilt: -0.4 },
    };
    const back = decodeGesture(encodeGesture(packet))!;
    expect(back.live.gateEvent).toBe('attack');
    expect(back.live.gateOpen).toBe(true);
    expect(back.live.freq).toBeCloseTo(440, 1);
    // Un byte por parametro: vuelve con el redondeo de un byte y nada mas.
    expect(back.live.cutoffNorm).toBeCloseTo(0.25, 2);
    expect(back.live.gain).toBeCloseTo(0.7, 2);
    expect(back.pose!.x).toBeCloseTo(0.3, 2);
    expect(back.pose!.tilt).toBeCloseTo(-0.4, 2);
  });

  it('los golpes viajan con su pieza, su fuerza y su charles abierto', () => {
    const packet: GesturePacket = {
      ...silent,
      live: {
        ...silent.live,
        strikes: [
          { piece: 'kick', force: 0.9, open: false },
          { piece: 'tomHigh', force: 0.5, open: false },
          { piece: 'hat', force: 0.6, open: true },
        ],
      },
    };
    const back = decodeGesture(encodeGesture(packet))!;
    expect(back.live.strikes.map((s) => s.piece)).toEqual(['kick', 'tomHigh', 'hat']);
    expect(back.live.strikes[2]!.open).toBe(true);
    expect(back.live.strikes[0]!.force).toBeCloseTo(0.9, 2);
  });

  it('cabe en una docena de bytes, que es de lo que va todo esto', () => {
    /*
     * Es la razon de ser del formato: mandar gestos y no audio. Si esto creciera
     * sin que nadie mirase, dejaria de ser mas barato que mandar sonido y no
     * habria ningun motivo para no mandar sonido.
     */
    expect(encodeGesture(silent).length).toBe(5);
    const conMano = encodeGesture({ ...silent, pose: { x: 0.5, y: 0.5, pinch: 0.5, tilt: 0 } });
    expect(conMano.length).toBe(9);
    const conGolpe = encodeGesture({
      ...silent,
      live: { ...silent.live, strikes: [{ piece: 'snare', force: 0.8, open: false }] },
      pose: { x: 0.5, y: 0.5, pinch: 0.5, tilt: 0 },
    });
    expect(conGolpe.length).toBe(11);
  });

  it('sin mano no ocupa los bytes de la mano', () => {
    // Quien toca con el raton, o quien no tiene la mano en el encuadre en ese
    // fotograma. Mandar cuatro bytes de una mano que no existe seria mandar una
    // mano dibujada en una esquina.
    const back = decodeGesture(encodeGesture(silent))!;
    expect(back.pose).toBe(null);
  });

  it('un paquete a medias o con bytes de mas se tira entero', () => {
    const good = encodeGesture({
      ...silent,
      live: { ...silent.live, strikes: [{ piece: 'kick', force: 0.9, open: false }] },
    });
    expect(decodeGesture(good)).not.toBe(null);
    // Le falta el byte de la fuerza del golpe: sin esto, se leeria un cero y
    // sonaria un golpe que nadie dio.
    expect(decodeGesture(good.slice(0, good.length - 1))).toBe(null);
    // Y con uno de mas: esto no lo escribio esta version.
    expect(decodeGesture(new Uint8Array([...good, 0]))).toBe(null);
    expect(decodeGesture(new Uint8Array([]))).toBe(null);
    expect(decodeGesture(new Uint8Array([1, 2]))).toBe(null);
  });

  it('una pieza que no existe se rechaza en vez de golpear un undefined', () => {
    // Tres bits dan para ocho y hay seis piezas. Lo que llega por la red no
    // tiene tipos, asi que los dos valores que sobran hay que pararlos aqui.
    const good = encodeGesture({
      ...silent,
      live: { ...silent.live, strikes: [{ piece: 'kick', force: 0.9, open: false }] },
    });
    const broken = new Uint8Array(good);
    broken[5] = 7 << 1;
    expect(decodeGesture(broken)).toBe(null);
  });

  it('un gate que no es ni ataque ni suelta se rechaza', () => {
    // Dos bits dan para cuatro y solo hay tres estados. El cuarto no significa
    // nada, y adivinar cual queria decir es abrir o cerrar una nota al azar.
    const broken = new Uint8Array(encodeGesture(silent));
    broken[0] = (broken[0]! & ~0b11) | 0b11;
    expect(decodeGesture(broken)).toBe(null);
  });
});
