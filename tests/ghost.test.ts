import { describe, expect, it } from 'vitest';
import { DemoPerformance } from '../src/mapping/demo';
import { DrumDemoPerformance } from '../src/mapping/drumDemo';
import { TrackGhost } from '../src/mapping/ghost';
import { KIT } from '../src/mapping/kit';
import { getMelody } from '../src/mapping/melodies';
import { normalize, palmCenter } from '../src/mapping/features';
import { FALL_SECONDS } from '../src/mapping/strokes';
import { createLayout, pitchAt } from '../src/mapping/scales';
import { Mapper } from '../src/mapping/mapper';
import { LoopTake, type FinishedTake } from '../src/audio/loopTake';
import { CLOSED_PINCH, OPEN_PINCH, drawnScale, phantomHand, type HandPose } from '../src/tracking/phantom';
import { DEFAULT_SETTINGS, type Settings } from '../src/state/store';
import type { DrumPiece } from '../src/mapping/kit';
import type { Landmark } from '../src/tracking/types';

/**
 * El fantasma: la mano que grabo una capa, sacada de lo que la capa guarda.
 *
 * Lo que se comprueba aqui es una ida y una vuelta completas, con las dos piezas
 * de verdad en medio. Se toca -con una mano de mentira, pero por el mapeador de
 * verdad-, se graba en una toma de verdad, y despues se le pide al fantasma la
 * mano de vuelta y se compara con la que hubo. Si la conversion se torciera en
 * cualquiera de los dos sentidos, el fantasma senalaria un sitio donde no hay
 * que poner la mano, que es peor que no dibujar nada: una leccion equivocada se
 * sigue igual de bien que una correcta.
 */

const WIDE = 16 / 9;
const FPS = 60;

interface Truth {
  /** Segundos desde que empezo la grabacion. */
  t: number;
  /** Altura de la palma de verdad, en el encuadre entero. */
  y: number;
  /**
   * Zona que de verdad sono, que no es la misma que la de la palma cruda.
   *
   * El filtro del tono existe para que un temblor no cambie de nota, asi que en
   * el vibrato la palma cruza la frontera y la nota no. Lo que el fantasma
   * promete es "pon la mano aqui y sonara esto", y esto es esto.
   */
  zone: number;
  gateOpen: boolean;
}

function settingsFor(id: string): Settings {
  const melody = getMelody(id)!;
  return {
    ...DEFAULT_SETTINGS,
    scale: melody.suggestedScale,
    octaves: Math.max(DEFAULT_SETTINGS.octaves, melody.minOctaves),
  };
}

const hand = (pose: { x: number; y: number; pinch: number; tilt: number }) => {
  const landmarks: Landmark[] = phantomHand({ ...pose, aspect: WIDE, scale: drawnScale(WIDE) });
  return { hand: { landmarks, raw: landmarks }, held: false, heldFor: 0 };
};

/** Toca la demostracion melodica entera grabandola, y apunta lo que de verdad paso. */
function recordMelody(id: string): { take: FinishedTake; truth: Truth[]; settings: Settings } {
  const settings = settingsFor(id);
  const mapper = new Mapper(settings);
  const performance = new DemoPerformance(getMelody(id)!, mapper.currentLayout);
  const take = new LoopTake('theremin', 0, 0, false);
  const truth: Truth[] = [];

  for (let frame = 0; ; frame += 1) {
    const elapsed = frame / FPS;
    if (performance.finishedAt(elapsed)) {
      const finished = take.finish(elapsed);
      expect(finished, 'la toma tiene que dejar capa').not.toBeNull();
      return { take: finished!, truth, settings };
    }
    const pose = performance.poseAt(elapsed);
    const tracked = hand(pose);
    const output = mapper.update({ melody: tracked, expression: null }, elapsed);
    take.capture(elapsed, {
      gateEvent: output.gateEvent,
      gateOpen: output.gateOpen,
      freq: output.freq,
      cutoffNorm: output.cutoffNorm,
      gain: output.gain,
      strikes: [],
    });
    truth.push({
      t: elapsed,
      y: palmCenter(tracked.hand.raw).y,
      zone: output.zoneIndex,
      gateOpen: output.gateOpen,
    });
  }
}

/** Y lo mismo con la bateria, que graba golpes en vez de notas. */
function recordDrums(): { take: FinishedTake; truth: Truth[] } {
  const mapper = new Mapper({ ...DEFAULT_SETTINGS, drums: true });
  const performance = new DrumDemoPerformance(KIT);
  const take = new LoopTake('theremin', 0, 0, true);
  const truth: Truth[] = [];

  for (let frame = 0; ; frame += 1) {
    const elapsed = frame / FPS;
    if (performance.finishedAt(elapsed)) {
      const finished = take.finish(elapsed);
      expect(finished, 'la toma tiene que dejar capa').not.toBeNull();
      return { take: finished!, truth };
    }
    const pose = performance.poseAt(elapsed);
    const melody = hand(pose.melody);
    const output = mapper.update({ melody, expression: hand(pose.expression) }, elapsed);
    take.capture(elapsed, {
      gateEvent: output.gateEvent,
      gateOpen: output.gateOpen,
      freq: output.freq,
      cutoffNorm: output.cutoffNorm,
      gain: output.gain,
      strikes: output.strikes,
    });
    truth.push({
      t: elapsed,
      y: palmCenter(melody.hand.raw).y,
      zone: output.zoneIndex,
      gateOpen: output.gateOpen,
    });
  }
}

const ghostOf = (take: FinishedTake): TrackGhost =>
  new TrackGhost({ drums: take.drums, events: take.events, hits: take.hits }, take.cycleSeconds);

describe('el fantasma de una capa de melodia', () => {
  it('senala la misma nota que se toco, en cada instante en que sono algo', () => {
    /*
     * Es la comprobacion que da sentido a todo lo demas: no que la mano quede
     * cerca, que quede en la MISMA zona. Media zona de error ya es la nota de al
     * lado, y quien ponga la mano encima tocara otra cosa.
     */
    const { take, truth, settings } = recordMelody('estrellita');
    const layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
    const ghost = ghostOf(take);

    let checked = 0;
    for (const moment of truth) {
      if (!moment.gateOpen) continue;
      const [pose] = ghost.posesAt(moment.t, layout, KIT);
      expect(pose, `en ${moment.t.toFixed(2)} s`).toBeDefined();
      const drawn = pitchAt(layout, normalize(pose!.x)).index;
      expect(drawn, `en ${moment.t.toFixed(2)} s`).toBe(moment.zone);
      checked += 1;
    }
    // Y que de verdad se haya mirado la melodia entera, no dos fotogramas.
    expect(checked).toBeGreaterThan(200);
  });

  it('cierra la pinza exactamente mientras hubo nota', () => {
    // La posicion se guarda a treinta por segundo y se interpola; el gate no: su
    // instante esta grabado tal cual. Es lo unico exacto que tiene el fantasma.
    const { take, truth, settings } = recordMelody('estrellita');
    const layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
    const ghost = ghostOf(take);

    let wrong = 0;
    for (const moment of truth) {
      const [pose] = ghost.posesAt(moment.t, layout, KIT);
      const closed = pose!.pinch === CLOSED_PINCH;
      if (closed !== moment.gateOpen) wrong += 1;
    }
    // Un fotograma de margen a cada lado de cada nota: el evento se guarda en el
    // fotograma en que el gate cambia y se lee en el instante exacto.
    expect(wrong).toBeLessThan(truth.length * 0.02);
  });

  it('pone la mano a la altura que tuvo', () => {
    // La altura es el corte del filtro leido al reves, y ese va filtrado: no
    // vuelve exacta, vuelve con el retraso del propio suavizado.
    const { take, truth, settings } = recordMelody('estrellita');
    const layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
    const ghost = ghostOf(take);

    let worst = 0;
    for (const moment of truth) {
      if (!moment.gateOpen) continue;
      const [pose] = ghost.posesAt(moment.t, layout, KIT);
      worst = Math.max(worst, Math.abs(pose!.y - moment.y));
    }
    expect(worst).toBeLessThan(0.08);
  });

  it('no se rompe al pasar por el cero de la vuelta', () => {
    // El cabezal cruza el final del ciclo una vez por vuelta y siempre por el
    // mismo sitio: si la mano desapareciera o saltara ahi, lo haria en cada
    // vuelta y para siempre.
    const { take, settings } = recordMelody('estrellita');
    const layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
    const ghost = ghostOf(take);
    const cycle = take.cycleSeconds;

    const [before] = ghost.posesAt(cycle - 0.001, layout, KIT);
    const [after] = ghost.posesAt(0, layout, KIT);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(0.05);
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(0.05);
  });

  it('una capa vacia no dibuja nada', () => {
    const ghost = new TrackGhost({ drums: false, events: [], hits: [] }, 4);
    expect(ghost.posesAt(1, createLayout('pentatonic', 9, 3, 2), KIT)).toEqual([]);
  });
});

describe('el fantasma de una capa de bateria', () => {
  const layout = createLayout('pentatonic', 9, 3, 2);

  /**
   * La mano que esta sobre una pieza en un instante, si hay alguna.
   *
   * Son dos manos y solo una de las dos esta a lo suyo en cada golpe, asi que
   * mirar las dos y quedarse con la que este encima es lo mismo que el ojo hace
   * solo. La banda se saca de la x igual que la saca el mapeador.
   */
  const handOver = (ghost: TrackGhost, piece: DrumPiece, t: number): HandPose | undefined =>
    ghost
      .posesAt(t, layout, KIT)
      .find((pose) => Math.min(KIT.length - 1, Math.floor(normalize(pose.x) * KIT.length)) === KIT.indexOf(piece));

  it('son dos manos, porque dos manos fueron', () => {
    /*
     * Una capa guarda los golpes de las dos manos en la misma lista y sin decir
     * cual fue cual. Dibujarlas como una sola no seria solo raro: bombo y
     * charles caen a la vez en casi cualquier compas, y una mano no puede estar
     * en dos sitios. Se reparten por mitades del kit, que es como esta pensado.
     */
    const { take } = recordDrums();
    const ghost = ghostOf(take);
    const together = take.hits.filter((hit) => take.hits.some((other) => other !== hit && other.t === hit.t));
    expect(together.length, 'la demostracion tiene golpes simultaneos').toBeGreaterThan(0);
    expect(ghost.posesAt(together[0]!.t, layout, KIT)).toHaveLength(2);
  });

  it('alguna de las dos manos esta sobre la pieza justo cuando suena', () => {
    // Si no estuviera, lo que se ensenaria es golpear en el sitio equivocado.
    const { take } = recordDrums();
    const ghost = ghostOf(take);

    for (const hit of take.hits) {
      expect(handOver(ghost, hit.piece, hit.t), `golpe de ${hit.piece} en ${hit.t.toFixed(2)} s`).toBeDefined();
    }
    expect(take.hits.length).toBeGreaterThan(20);
  });

  it('la mano que pega fuerte se levanta mas que la que lleva el pulso', () => {
    /*
     * La fuerza vuelve a ser altura, que es de donde salio. En este ritmo el
     * charles va suave y sin parar y la caja va fuerte, asi que la mano del
     * charles tiene que verse claramente mas baja. Sin esto todos los golpes se
     * verian iguales y el fantasma no ensenaria la dinamica.
     *
     * Se mira justo antes de la caida, que es cuando la mano esta arriba del
     * todo y ya sobre su pieza: esa altura ES la fuerza del golpe, y mirarla
     * golpe a golpe distingue una pieza de otra, que es lo que se quiere probar.
     * Mirar en cambio lo mas alto que llega cada mano en toda la vuelta mediria
     * otra cosa -en esta la del charles lleva tambien el plato, que es un golpe
     * fuerte- y pasaria o fallaria por un accidente del ritmo.
     */
    const { take } = recordDrums();
    const ghost = ghostOf(take);

    const tops = (piece: DrumPiece): number[] =>
      take.hits
        .filter((hit) => hit.piece === piece)
        .map((hit) => {
          const pose = handOver(ghost, piece, hit.t - FALL_SECONDS);
          expect(pose, `golpe de ${piece} en ${hit.t.toFixed(2)} s`).toBeDefined();
          return pose!.y;
        });
    const average = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

    const hat = tops('hat');
    const snare = tops('snare');
    // Arriba es menos: la caja se levanta claramente por encima del charles.
    expect(average(snare)).toBeLessThan(average(hat) - 0.05);
    /*
     * Y el charles no es plano consigo mismo. Es la parte que se pierde sola: la
     * capa guarda la fuerza ya multiplicada por el volumen, asi que al volumen
     * de fabrica sus golpes -de 0,46 a 0,54- caen enteros por debajo del golpe
     * flojo de referencia y se recortan todos al mismo minimo. El ritmo seguiria
     * viendose, pero con las corcheas a la misma altura exacta, que es la
     * definicion de una maquina.
     */
    expect(Math.max(...hat) - Math.min(...hat)).toBeGreaterThan(0.01);
  });

  it('el charles abierto se golpea con la pinza cerrada, y el cerrado no', () => {
    // Las dos mitades, porque una sola no dice nada: si el fantasma cerrara
    // siempre la pinza, la primera pasaria igual y lo que se ensenaria es que el
    // charles suena abierto siempre.
    const { take } = recordDrums();
    const ghost = ghostOf(take);
    const open = take.hits.find((hit) => hit.open);
    const shut = take.hits.find((hit) => hit.piece === 'hat' && !hit.open);
    expect(open, 'la demostracion tiene un charles abierto').toBeDefined();
    expect(shut, 'y tambien cerrados').toBeDefined();
    expect(handOver(ghost, 'hat', open!.t)?.pinch).toBe(CLOSED_PINCH);
    expect(handOver(ghost, 'hat', shut!.t)?.pinch).toBe(OPEN_PINCH);
  });

  it('entre el ultimo golpe y el primero las manos viajan, no desaparecen', () => {
    // El cabezal cruza el final del ciclo una vez por vuelta y siempre por el
    // mismo sitio: si una mano desapareciera ahi, lo haria en cada vuelta.
    const { take } = recordDrums();
    const ghost = ghostOf(take);
    for (const t of [0, take.cycleSeconds * 0.5, take.cycleSeconds - 0.01]) {
      const poses = ghost.posesAt(t, layout, KIT);
      expect(poses, `en ${t.toFixed(2)} s`).toHaveLength(2);
      for (const pose of poses) {
        expect(pose.y).toBeGreaterThan(0);
        expect(pose.y).toBeLessThan(1);
        expect(pose.pinch).toBeGreaterThan(0);
      }
    }
  });

  it('una capa de bateria vacia no dibuja nada', () => {
    const ghost = new TrackGhost({ drums: true, events: [], hits: [] }, 4);
    expect(ghost.posesAt(1, layout, KIT)).toEqual([]);
  });
});
