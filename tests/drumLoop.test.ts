import { describe, expect, it } from 'vitest';
import { LoopTake, type LiveSnapshot } from '../src/audio/loopTake';
import { decodePerformance, encodePerformance } from '../src/state/performance';
import { KIT } from '../src/mapping/kit';

/**
 * Una capa de bucle con golpes en lugar de notas.
 *
 * Es lo que faltaba para que la bateria sirviera de algo: grabar un ritmo,
 * pasar a la melodia y tocar encima. Lo que se comprueba aqui son las dos cosas
 * que no se ven al probarlo a mano: que la toma guarde golpes y no intente
 * fabricar notas con ellos, y que el enlace aguante un viaje de ida y vuelta sin
 * perder ni mover un golpe. Lo segundo importa mas de lo que parece, porque el
 * enlace lo escribe cualquiera: todo lo que no sea exactamente lo que escribio
 * el codificador tiene que rechazarse entero.
 */

const quiet: LiveSnapshot = { gateEvent: null, gateOpen: false, freq: 440, cutoffNorm: 0.5, gain: 0.8, strikes: [] };
const beat = (...pieces: string[]): LiveSnapshot => ({
  ...quiet,
  strikes: pieces.map((piece) => ({ piece: piece as (typeof KIT)[number], force: 0.7 })),
});

describe('capa de bateria', () => {
  it('guarda golpes y ninguna nota', () => {
    const take = new LoopTake('theremin', 0, 0, true);
    take.capture(0.1, beat('kick'));
    take.capture(0.5, beat('snare'));
    const finished = take.finish(1)!;

    expect(finished.drums).toBe(true);
    expect(finished.events, 'una capa de bateria no tiene eventos de nota').toEqual([]);
    expect(finished.hits.map((h) => h.piece)).toEqual(['kick', 'snare']);
    expect(finished.hits[0]!.t).toBeCloseTo(0.1, 5);
  });

  it('una pinza cerrada durante la grabacion no deja notas dentro', () => {
    // La pinza ya no abre nada en bateria, pero la instantanea sigue trayendo
    // gateOpen. Si la toma la mirara, la capa saldria con notas fantasma debajo
    // del ritmo: dos cosas sonando donde se grabo una.
    const take = new LoopTake('theremin', 0, 0, true);
    take.capture(0.1, { ...beat('kick'), gateEvent: 'attack', gateOpen: true });
    for (let at = 0.2; at < 0.9; at += 0.05) take.capture(at, { ...quiet, gateOpen: true });
    const finished = take.finish(1)!;

    expect(finished.events).toEqual([]);
    expect(finished.hits).toHaveLength(1);
  });

  it('una toma sin un solo golpe se descarta', () => {
    const take = new LoopTake('theremin', 0, 0, true);
    for (let at = 0; at < 1; at += 0.05) take.capture(at, quiet);
    expect(take.finish(1)).toBe(null);
  });

  it('dos manos a la vez son dos golpes, no uno', () => {
    const take = new LoopTake('theremin', 0, 0, true);
    take.capture(0.25, beat('kick', 'hat'));
    const finished = take.finish(1)!;
    expect(finished.hits).toHaveLength(2);
    expect(finished.hits.map((h) => h.piece).sort()).toEqual(['hat', 'kick']);
  });

  it('los golpes salen ordenados por tiempo aunque la toma cruce la vuelta', () => {
    // Una sobregrabacion que empieza a mitad de ciclo: lo que se golpea primero
    // cae al final de la vuelta, y lo siguiente al principio.
    const take = new LoopTake('theremin', 3.5, 4, true);
    take.capture(0.1, beat('snare'));
    take.capture(0.9, beat('kick'));
    const finished = take.finish(1)!;
    const times = finished.hits.map((h) => h.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(finished.hits.map((h) => h.piece)).toEqual(['kick', 'snare']);
  });
});

describe('la bateria dentro de un enlace', () => {
  const hits = [
    { t: 0, piece: 'kick' as const, force: 1 },
    { t: 0.5, piece: 'hat' as const, force: 0.4 },
    { t: 1, piece: 'snare' as const, force: 0.75 },
    { t: 1.5, piece: 'crash' as const, force: 0.2 },
  ];

  it('va y vuelve sin perder ni mover un golpe', () => {
    const encoded = encodePerformance({ cycleSeconds: 2, tracks: [{ presetId: 'theremin', events: [], hits, drums: true }] });
    expect(encoded).not.toBe(null);
    const back = decodePerformance(encoded!.encoded)!;

    expect(back.cycleSeconds).toBeCloseTo(2, 2);
    expect(back.tracks).toHaveLength(1);
    expect(back.tracks[0]!.drums).toBe(true);
    expect(back.tracks[0]!.hits!.map((h) => h.piece)).toEqual(hits.map((h) => h.piece));
    for (let i = 0; i < hits.length; i += 1) {
      expect(back.tracks[0]!.hits![i]!.t).toBeCloseTo(hits[i]!.t, 2);
      // La fuerza viaja en un byte: menos de media centesima de error.
      expect(back.tracks[0]!.hits![i]!.force).toBeCloseTo(hits[i]!.force, 2);
    }
  });

  it('un ritmo cabe en muchos menos bytes que una melodia', () => {
    // Tres bytes por golpe contra seis por evento, y sin instantaneas de
    // parametros en medio: es lo que permite compartir un compas entero.
    const many = Array.from({ length: 64 }, (_, i) => ({
      t: i * 0.05,
      piece: KIT[i % KIT.length]!,
      force: 0.5,
    }));
    const encoded = encodePerformance({ cycleSeconds: 3.2, tracks: [{ presetId: 'theremin', events: [], hits: many, drums: true }] });
    expect(encoded?.tracks, 'sesenta y cuatro golpes entran de sobra').toBe(1);
    expect(decodePerformance(encoded!.encoded)!.tracks[0]!.hits).toHaveLength(64);
  });

  it('conviven capas de bateria y de melodia en el mismo enlace', () => {
    const melody = [
      { t: 0, kind: 'attack' as const, freq: 440, cutoffNorm: 0.5, gain: 0.8 },
      { t: 1, kind: 'release' as const, freq: 440, cutoffNorm: 0.5, gain: 0.8 },
    ];
    const encoded = encodePerformance({
      cycleSeconds: 2,
      tracks: [
        { presetId: 'theremin', events: [], hits, drums: true },
        { presetId: 'flute', events: melody },
      ],
    });
    const back = decodePerformance(encoded!.encoded)!;
    expect(back.tracks).toHaveLength(2);
    expect(back.tracks[0]!.drums).toBe(true);
    expect(back.tracks[1]!.drums, 'la de melodia no se marca como bateria').toBeFalsy();
    expect(back.tracks[1]!.presetId).toBe('flute');
  });

  it('un enlace de solo melodia sigue leyendose igual que antes', () => {
    // La marca de bateria ocupa un valor que no puede ser un indice de timbre,
    // asi que no se ha subido la version del formato y los enlaces que ya andan
    // por ahi siguen valiendo. Si esto se rompe, se rompen enlaces compartidos.
    const melody = [
      { t: 0, kind: 'attack' as const, freq: 440, cutoffNorm: 0.5, gain: 0.8 },
      { t: 1, kind: 'release' as const, freq: 440, cutoffNorm: 0.5, gain: 0.8 },
    ];
    const encoded = encodePerformance({ cycleSeconds: 2, tracks: [{ presetId: 'theremin', events: melody }] });
    const back = decodePerformance(encoded!.encoded)!;
    expect(back.tracks[0]!.presetId).toBe('theremin');
    expect(back.tracks[0]!.events).toHaveLength(2);
    expect(back.tracks[0]!.hits ?? []).toEqual([]);
  });

  it('una capa de bateria sin golpes no se codifica', () => {
    expect(encodePerformance({ cycleSeconds: 2, tracks: [{ presetId: 'theremin', events: [], hits: [], drums: true }] })).toBe(null);
  });

  it('golpes desordenados en un enlace manipulado se rechazan enteros', () => {
    /*
     * El reproductor programa cada golpe en su instante, no en el orden de la
     * lista, asi que un enlace con los tiempos cruzados no suena como se lee. El
     * codificador nunca los escribe asi -finish() ordena-, de modo que exigirlo
     * no rechaza nada legitimo y si ataja un enlace escrito a mano.
     */
    const encoded = encodePerformance({
      cycleSeconds: 2,
      tracks: [
        {
          presetId: 'theremin',
          events: [],
          drums: true,
          hits: [
            { t: 1.5, piece: 'kick', force: 1 },
            { t: 0.2, piece: 'snare', force: 1 },
          ],
        },
      ],
    });
    expect(encoded).not.toBe(null);
    expect(decodePerformance(encoded!.encoded)).toBe(null);
  });

  it('un golpe fuera del ciclo se rechaza', () => {
    const encoded = encodePerformance({
      cycleSeconds: 2,
      tracks: [{ presetId: 'theremin', events: [], drums: true, hits: [{ t: 9, piece: 'kick', force: 1 }] }],
    });
    expect(decodePerformance(encoded!.encoded)).toBe(null);
  });
});
