import { describe, expect, it } from 'vitest';
import { decodePerformance, encodePerformance, thin, type Performance } from '../src/state/performance';
import type { LoopEvent } from '../src/audio/loopTake';

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
