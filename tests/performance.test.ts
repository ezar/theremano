import { describe, expect, it } from 'vitest';
import { decodePerformance, encodePerformance, hasWholeNotes, thin, type Performance } from '../src/state/performance';
import { LoopTake, type LoopEvent } from '../src/audio/loopTake';

/**
 * Lo que se comparte viaja por sitios donde el enlace se recorta, se reescribe y
 * se pega a mano. Aqui se comprueban las dos mitades de eso: que lo que sale
 * vuelve a entrar igual, y que lo que entra roto no llega a sonar.
 */

function note(t: number, midi: number, seconds: number, paramHz = 30): LoopEvent[] {
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const events: LoopEvent[] = [{ t, kind: 'attack', freq, cutoffNorm: 0.5, gain: 0.8 }];
  for (let at = t; at < t + seconds; at += 1 / paramHz) {
    events.push({ t: at, kind: 'param', freq, cutoffNorm: 0.5, gain: 0.8 });
  }
  events.push({ t: t + seconds, kind: 'release', freq, cutoffNorm: 0.5, gain: 0.8 });
  return events;
}

/**
 * Cuatro notas de theremin en un ciclo de 2,8 s, codificadas con la version 1.
 * La prueba de humo abre este mismo enlace en un navegador de verdad.
 */
const V1_LINK =
  'ARgBAQAcAAAA9BqMzAqA9BqMzBSA9BqMzB6A9BqMzCiA9BqMzCuA9BqMzC1A9BqMzEYAIByMzFCAIByMzFqAIByMzGSAIByMzG6AIByMzHGAIByMzHNAIByMzIwAsB2MzJaAsB2MzKCAsB2MzKqAsB2MzLSAsB2MzLeAsB2MzLlAsB2MzNIAIByMzNyAIByMzOaAIByMzPCAIByMzPqAIByMzP2AIByMzP9AIByMzA';

const simple: Performance = {
  cycleSeconds: 4,
  tracks: [{ presetId: 'theremin', events: note(0.5, 69, 1) }],
};

describe('interpretacion en el enlace', () => {
  it('lo que sale vuelve a entrar', () => {
    const encoded = encodePerformance(simple);
    expect(encoded).not.toBe(null);
    const back = decodePerformance(encoded!.encoded)!;
    expect(back.cycleSeconds).toBeCloseTo(4, 2);
    expect(back.tracks).toHaveLength(1);
    expect(back.tracks[0]!.presetId).toBe('theremin');

    const attack = back.tracks[0]!.events[0]!;
    expect(attack.kind).toBe('attack');
    expect(attack.t).toBeCloseTo(0.5, 2);
    // Un centesimo de semitono de resolucion: muy por debajo de lo que se oye.
    expect(attack.freq).toBeCloseTo(440, 0);
    expect(attack.gain).toBeCloseTo(0.8, 2);
    expect(back.tracks[0]!.events.at(-1)!.kind).toBe('release');
  });

  it('conserva el orden y la altura de una melodia entera', () => {
    const midis = [69, 72, 76, 72, 69];
    const events = midis.flatMap((midi, i) => note(i * 0.6, midi, 0.4));
    const back = decodePerformance(encodePerformance({ cycleSeconds: 3.2, tracks: [{ presetId: 'flute', events }] })!.encoded)!;
    const attacks = back.tracks[0]!.events.filter((e) => e.kind === 'attack');
    expect(attacks).toHaveLength(midis.length);
    for (let i = 0; i < midis.length; i += 1) {
      const midi = 69 + 12 * Math.log2(attacks[i]!.freq / 440);
      expect(midi, `nota ${i}`).toBeCloseTo(midis[i]!, 1);
      expect(attacks[i]!.t, `nota ${i}`).toBeCloseTo(i * 0.6, 2);
    }
  });

  it('varias capas conservan su timbre', () => {
    const performance: Performance = {
      cycleSeconds: 4,
      tracks: [
        { presetId: 'bass', events: note(0, 45, 1) },
        { presetId: 'strings', events: note(1, 60, 1) },
      ],
    };
    const back = decodePerformance(encodePerformance(performance)!.encoded)!;
    expect(back.tracks.map((track) => track.presetId)).toEqual(['bass', 'strings']);
  });

  /**
   * El caso que decide si esto se puede compartir: cuatro capas de veinte
   * segundos tocando sin parar, que es el maximo que la aplicacion puede
   * producir. Tiene que salir un enlace, aunque sea a costa de capas.
   */
  it('lo mas grande que se puede grabar cabe en un enlace', () => {
    const full = (): LoopEvent[] => {
      const events: LoopEvent[] = [];
      for (let i = 0; i < 20; i += 1) events.push(...note(i, 60 + (i % 12), 0.9));
      return events;
    };
    const performance: Performance = {
      cycleSeconds: 20,
      tracks: (['theremin', 'strings', 'flute', 'bass'] as const).map((presetId) => ({ presetId, events: full() })),
    };
    const result = encodePerformance(performance)!;
    expect(result).not.toBe(null);
    // 1400 bytes en base64: el enlace entero se queda por debajo de 2000
    // caracteres, que es donde empiezan a recortar los clientes de mensajeria.
    expect(result.encoded.length).toBeLessThanOrEqual(1900);
    expect(result.tracks).toBeGreaterThanOrEqual(1);
    const back = decodePerformance(result.encoded)!;
    expect(back.tracks).toHaveLength(result.tracks);
  });

  it('el remuestreo respeta el ritmo pedido y no pierde ataques ni sueltas', () => {
    const events = note(0, 69, 2);
    const kept = thin(events, 10);
    const params = kept.filter((e) => e.kind === 'param');
    expect(kept.filter((e) => e.kind === 'attack')).toHaveLength(1);
    expect(kept.filter((e) => e.kind === 'release')).toHaveLength(1);
    // Dos segundos a 10 Hz: veinte parametros, mas el ultimo de la nota.
    expect(params.length).toBeLessThanOrEqual(22);
    for (let i = 1; i < params.length - 1; i += 1) {
      expect(params[i]!.t - params[i - 1]!.t).toBeGreaterThanOrEqual(0.099);
    }
  });

  /**
   * Un enlace de la version 1, guardado tal cual salio.
   *
   * Se comprueba que se puede leer, no que el codificador siga produciendo estos
   * mismos bytes: cambiar el remuestreo por dentro es legitimo, romper los
   * enlaces que ya se han mandado por ahi no lo es. El dia que haya que cambiar
   * el formato, esto obliga a subir la version y a seguir leyendo la anterior.
   */
  it('un enlace ya compartido se sigue pudiendo leer', () => {
    const back = decodePerformance(V1_LINK);
    expect(back).not.toBe(null);
    expect(back!.cycleSeconds).toBeCloseTo(2.8, 2);
    expect(back!.tracks).toHaveLength(1);
    expect(back!.tracks[0]!.presetId).toBe('theremin');
    const attacks = back!.tracks[0]!.events.filter((e) => e.kind === 'attack');
    const midis = attacks.map((e) => Math.round(69 + 12 * Math.log2(e.freq / 440)));
    expect(midis).toEqual([69, 72, 76, 72]);
    expect(attacks.map((e) => Number(e.t.toFixed(1)))).toEqual([0, 0.7, 1.4, 2.1]);
  });

  /**
   * El caso que casi se cuela.
   *
   * Una sobregrabacion que empieza a mitad de vuelta tiene la suelta antes que
   * su ataque en el array, porque `LoopTake.finish()` ordena por tiempo y la
   * nota cruza el final del ciclo. La capa se construye aqui con el propio
   * LoopTake, y no a mano, precisamente para que sea la de verdad.
   */
  it('una capa cuya nota cruza el final del ciclo es valida', () => {
    const take = new LoopTake('theremin', 3.4, 4);
    const live = { freq: 440, cutoffNorm: 0.5, gain: 0.8, strikes: [] };
    take.capture(0.1, { ...live, gateEvent: 'attack', gateOpen: true });
    for (let at = 0.15; at < 0.9; at += 0.05) {
      take.capture(at, { ...live, gateEvent: null, gateOpen: true });
    }
    take.capture(0.95, { ...live, gateEvent: 'release', gateOpen: false });
    const finished = take.finish(1)!;

    const gates = finished.events.filter((e) => e.kind !== 'param');
    expect(gates[0]!.kind, 'la suelta queda antes que el ataque al ordenar').toBe('release');
    expect(gates.at(-1)!.kind).toBe('attack');

    expect(hasWholeNotes(finished.events)).toBe(true);
    const back = decodePerformance(
      encodePerformance({ cycleSeconds: finished.cycleSeconds, tracks: [{ presetId: 'theremin', events: finished.events }] })!.encoded,
    );
    expect(back, 'y por tanto el enlace tiene que aceptarse').not.toBe(null);
  });

  describe('notas enteras', () => {
    const at = (t: number, kind: LoopEvent['kind']): LoopEvent => ({ t, kind, freq: 440, cutoffNorm: 0.5, gain: 0.8 });

    it('acepta una nota normal y una que da la vuelta', () => {
      expect(hasWholeNotes([at(0, 'attack'), at(0.5, 'param'), at(1, 'release')])).toBe(true);
      expect(hasWholeNotes([at(0.2, 'release'), at(3, 'attack')])).toBe(true);
      expect(hasWholeNotes([at(0, 'attack'), at(1, 'release'), at(2, 'attack'), at(3, 'release')])).toBe(true);
    });

    it('rechaza una capa que no llega a atacar: diria que suena sin sonar', () => {
      expect(hasWholeNotes([at(0, 'param'), at(1, 'param')])).toBe(false);
      expect(hasWholeNotes([at(0, 'param'), at(1, 'release')])).toBe(false);
    });

    it('rechaza un ataque sin suelta: se quedaria sonando en cada vuelta', () => {
      expect(hasWholeNotes([at(0, 'attack')])).toBe(false);
      expect(hasWholeNotes([at(0, 'attack'), at(1, 'param')])).toBe(false);
      expect(hasWholeNotes([at(0, 'attack'), at(1, 'attack'), at(2, 'release')])).toBe(false);
    });
  });

  it('no se codifican mas capas de las que se pueden reproducir', () => {
    const five: Performance = {
      cycleSeconds: 4,
      tracks: Array.from({ length: 5 }, () => ({ presetId: 'theremin' as const, events: note(0.5, 69, 1) })),
    };
    const result = encodePerformance(five)!;
    expect(result.tracks).toBe(4);
    expect(decodePerformance(result.encoded)!.tracks).toHaveLength(4);
  });

  it('sin capas, o sin ciclo, no hay nada que compartir', () => {
    expect(encodePerformance({ cycleSeconds: 4, tracks: [] })).toBe(null);
    expect(encodePerformance({ cycleSeconds: 4, tracks: [{ presetId: 'flute', events: [] }] })).toBe(null);
    expect(encodePerformance({ cycleSeconds: 0, tracks: [{ presetId: 'flute', events: note(0, 69, 1) }] })).toBe(null);
  });

  describe('un enlace manipulado no llega a sonar', () => {
    const good = encodePerformance(simple)!.encoded;

    it('rechaza lo que ni siquiera es base64 de direccion', () => {
      expect(decodePerformance('')).toBe(null);
      expect(decodePerformance('no es base64!!')).toBe(null);
      expect(decodePerformance('++//')).toBe(null);
    });

    it('rechaza una version que no es la suya', () => {
      const bytes = bytesOf(good);
      bytes[0] = 9;
      expect(decodePerformance(toUrl(bytes))).toBe(null);
    });

    it('rechaza un ciclo imposible, que dejaria el repetidor girando en vacio', () => {
      const zero = bytesOf(good);
      zero[1] = 0;
      zero[2] = 0;
      expect(decodePerformance(toUrl(zero))).toBe(null);

      const huge = bytesOf(good);
      huge[1] = 0xff;
      huge[2] = 0xff;
      expect(decodePerformance(toUrl(huge))).toBe(null);
    });

    /**
     * Cinco capas bien formadas, no cinco declaradas sobre los bytes de una.
     *
     * La primera version de esta prueba hacia lo segundo, y pasaba por el motivo
     * equivocado: el recorrido se quedaba sin bytes antes de llegar a ninguna
     * comprobacion de limite. Aqui se repite el bloque de una capa entero cinco
     * veces, asi que lo unico que puede rechazarlo es el limite.
     */
    it('rechaza cinco capas aunque esten bien formadas', () => {
      const one = bytesOf(good);
      const block = one.slice(4);
      const five = new Uint8Array(4 + block.length * 5);
      five.set(one.slice(0, 4));
      five[3] = 5;
      for (let i = 0; i < 5; i += 1) five.set(block, 4 + i * block.length);
      expect(decodePerformance(toUrl(five))).toBe(null);

      // Y con cuatro, el mismo montaje se acepta: lo que se rechaza es pasarse.
      const four = new Uint8Array(4 + block.length * 4);
      four.set(one.slice(0, 4));
      four[3] = 4;
      for (let i = 0; i < 4; i += 1) four.set(block, 4 + i * block.length);
      expect(decodePerformance(toUrl(four))?.tracks).toHaveLength(4);
    });

    it('rechaza una capa vacia', () => {
      const bytes = bytesOf(good);
      bytes[5] = 0;
      bytes[6] = 0;
      expect(decodePerformance(toUrl(bytes))).toBe(null);
    });

    it('rechaza por bytes una capa cuyas notas no cuadran', () => {
      // La misma comprobacion, pero por el camino real: se convierte la suelta
      // final en un segundo ataque y el enlace tiene que caerse entero.
      const bytes = bytesOf(good);
      const count = bytes[5]! | (bytes[6]! << 8);
      const last = 7 + (count - 1) * 6;
      bytes[last + 1] = bytes[last + 1]! & 0x3f;
      expect(decodePerformance(toUrl(bytes))).toBe(null);
    });

    /**
     * El caso que se cuela por la puerta de atras.
     *
     * El reproductor recorre los eventos en orden de array pero los programa en
     * su instante, y Web Audio los ejecuta por instante. Un enlace con los
     * tiempos desordenados puede alternar ataques y sueltas en el array y sonar
     * como dos ataques seguidos, que es exactamente la nota atascada que la
     * comprobacion de notas enteras existe para evitar.
     */
    it('rechaza eventos desordenados en el tiempo', () => {
      const twoNotes = encodePerformance({
        cycleSeconds: 4,
        tracks: [{ presetId: 'theremin', events: [...note(0, 69, 0.5), ...note(1, 72, 0.5)] }],
      })!.encoded;
      const bytes = bytesOf(twoNotes);

      // Se adelanta el segundo ataque por delante de la primera suelta sin
      // tocar el orden del array: las clases siguen alternando.
      const gates = [];
      const count = bytes[5]! | (bytes[6]! << 8);
      for (let e = 0; e < count; e += 1) {
        const at = 7 + e * 6;
        const packed = bytes[at]! | (bytes[at + 1]! << 8);
        if (packed >> 14 !== 2) gates.push({ at, kind: packed >> 14, t: packed & 0x3fff });
      }
      expect(gates.map((g) => g.kind), 'ataque, suelta, ataque, suelta').toEqual([0, 1, 0, 1]);

      const release = gates[1]!;
      const units = gates[2]!.t + 10;
      bytes[release.at] = units & 0xff;
      bytes[release.at + 1] = ((units >> 8) & 0x3f) | (1 << 6);
      expect(decodePerformance(toUrl(bytes))).toBe(null);
    });

    it('rechaza un timbre que no existe', () => {
      const bytes = bytesOf(good);
      bytes[4] = 200;
      expect(decodePerformance(toUrl(bytes))).toBe(null);
    });

    it('rechaza un recuento de eventos que no cuadra con lo que hay', () => {
      const bytes = bytesOf(good);
      bytes[5] = 0xff;
      bytes[6] = 0x0f;
      expect(decodePerformance(toUrl(bytes))).toBe(null);
    });

    it('rechaza que sobren o falten bytes al final', () => {
      expect(decodePerformance(toUrl(bytesOf(good).slice(0, -3)))).toBe(null);
      const extra = new Uint8Array([...bytesOf(good), 7, 7]);
      expect(decodePerformance(toUrl(extra))).toBe(null);
    });

    it('rechaza un evento fuera del ciclo que declara', () => {
      const bytes = bytesOf(good);
      // El primer evento empieza en el byte 7: se le pone un tiempo de 100 s.
      const units = 100 * 100;
      bytes[7] = units & 0xff;
      bytes[8] = ((units >> 8) & 0x3f) | (bytes[8]! & 0xc0);
      expect(decodePerformance(toUrl(bytes))).toBe(null);
    });
  });
});

function bytesOf(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toUrl(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
