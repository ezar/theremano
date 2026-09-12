import { describe, expect, it } from 'vitest';
import { DemoPerformance, NOTE_SECONDS } from '../src/mapping/demo';
import { CLOSED_PINCH, OPEN_PINCH, drawnScale, phantomHand } from '../src/tracking/phantom';
import { depthFromSize, palmCenter, palmSize, pinchRatio } from '../src/mapping/features';
import { Mapper } from '../src/mapping/mapper';
import { PINCH_CLOSE, PINCH_OPEN } from '../src/mapping/gate';
import { MELODIES, getMelody, type Melody } from '../src/mapping/melodies';
import { createLayout } from '../src/mapping/scales';
import { DEFAULT_SETTINGS, type Settings } from '../src/state/store';
import { HAND_BONES, type Landmark } from '../src/tracking/types';

/**
 * La demostracion no tiene un motor propio: coloca una mano de mentira delante
 * del mapeador de verdad. Eso es justo lo que se comprueba aqui, y es lo unico
 * que puede fallar sin que se vea. Una mano bien dibujada que llegue tarde a la
 * zona toca la nota de al lado, y quien mira la demostracion aprende un gesto
 * que no es.
 */

const WIDE = 16 / 9;
const TALL = 0.46;

/**
 * Melodia de dos notas en los dos extremos del encuadre.
 *
 * Ninguna de las de verdad llega a la primera y a la ultima zona, y son las dos
 * posiciones donde la mano se sale. Se escribe aqui para poder comprobar el caso
 * peor sin depender de que alguna melodia lo visite por casualidad.
 */
const EDGES: Melody = {
  id: 'extremos',
  kind: 'exercise',
  notes: [0, 24],
  suggestedScale: 'pentatonic',
  minOctaves: 2,
};

function settingsFor(id: string): Settings {
  const melody = getMelody(id)!;
  return {
    ...DEFAULT_SETTINGS,
    scale: melody.suggestedScale,
    octaves: Math.max(DEFAULT_SETTINGS.octaves, melody.minOctaves),
  };
}

/** Toca la demostracion entera y devuelve las notas que sonaron, en MIDI. */
function play(id: string, fps: number, aspect = WIDE): number[] {
  const settings = settingsFor(id);
  const mapper = new Mapper(settings);
  const performance = new DemoPerformance(getMelody(id)!, mapper.currentLayout);
  const played: number[] = [];
  const dt = 1 / fps;
  for (let frame = 0; ; frame += 1) {
    const seconds = frame * dt;
    if (performance.finishedAt(seconds)) break;
    const pose = performance.poseAt(seconds);
    const landmarks = phantomHand({
      x: pose.x,
      y: pose.y,
      pinch: pose.pinch,
      tilt: pose.tilt,
      aspect,
    });
    const output = mapper.update(
      { melody: { hand: { landmarks, raw: landmarks }, held: false, heldFor: 0 }, expression: null },
      seconds,
    );
    if (output.gateEvent === 'attack') played.push(output.midi);
  }
  return played;
}

/** Las notas que la melodia pide, resueltas contra la escala que se va a usar. */
function expected(id: string): number[] {
  const settings = settingsFor(id);
  const layout = createLayout(settings.scale, settings.tonicPc, settings.baseOctave, settings.octaves);
  const performance = new DemoPerformance(getMelody(id)!, layout);
  const zones: number[] = [];
  for (let i = 0; i < performance.notes; i += 1) {
    const zone = performance.zoneAt(0.95 + i * NOTE_SECONDS);
    zones.push(layout.baseMidi + (layout.degrees[zone ?? 0] ?? 0));
  }
  return zones;
}

/** Los huesos de los dedos, sin los de la palma, que son largos por definicion. */
function fingerBones(landmarks: readonly Landmark[]): number[] {
  return HAND_BONES.filter((bone) => bone.finger !== 'palm').flatMap((bone) =>
    bone.pairs.map(([a, b]) => Math.hypot(landmarks[a]!.x - landmarks[b]!.x, landmarks[a]!.y - landmarks[b]!.y)),
  );
}

describe('mano de mentira', () => {
  it.each([WIDE, TALL, 1])('cae donde se le pide y la pinza mide lo que dice (proporcion %f)', (aspect) => {
    for (const pinch of [0.12, 0.3, 0.62, 0.9]) {
      const hand = phantomHand({ x: 0.37, y: 0.62, pinch, aspect });
      expect(hand).toHaveLength(21);
      const center = palmCenter(hand);
      expect(center.x).toBeCloseTo(0.37, 6);
      expect(center.y).toBeCloseTo(0.62, 6);
      // Exacta, no parecida: es el numero que decide si la nota entra o no.
      expect(pinchRatio(hand)).toBeCloseTo(pinch, 6);
    }
  });

  it.each([WIDE, TALL])('tiene el tamano de una mano a distancia de trabajo (proporcion %f)', (aspect) => {
    // Si saliera pegada a un extremo, el espacio del sonido de la demostracion
    // estaria saturado de reverberacion o completamente seco. Se mide con el
    // tamano que usa la demostracion, que no es el natural.
    const hand = phantomHand({ x: 0.5, y: 0.5, pinch: 0.5, aspect, scale: drawnScale(aspect) });
    const depth = depthFromSize(palmSize(hand));
    expect(depth).toBeGreaterThan(0.2);
    expect(depth).toBeLessThan(0.8);
  });

  it('ladearla no cambia ni su tamano ni su pinza', () => {
    const flat = phantomHand({ x: 0.5, y: 0.5, pinch: 0.4, aspect: WIDE });
    const tilted = phantomHand({ x: 0.5, y: 0.5, pinch: 0.4, aspect: WIDE, tilt: 0.3 });
    expect(palmSize(tilted)).toBeCloseTo(palmSize(flat), 6);
    expect(pinchRatio(tilted)).toBeCloseTo(0.4, 6);
  });

  it('no se le estira ningun hueso al abrir y cerrar la pinza', () => {
    // La punta del pulgar y la del indice se colocan de antemano y los nudillos
    // de en medio se resuelven despues: si esa resolucion se pasa de largo, el
    // dedo se dibuja como una antena.
    for (const pinch of [0.1, 0.2, 0.3, 0.45, 0.52, 0.8, 0.9]) {
      const hand = phantomHand({ x: 0.5, y: 0.5, pinch, aspect: WIDE });
      const span = Math.hypot(hand[0]!.x - hand[9]!.x, hand[0]!.y - hand[9]!.y);
      for (const bone of fingerBones(hand)) {
        expect(bone / span, `pinza ${pinch}`).toBeGreaterThan(0.04);
        expect(bone / span, `pinza ${pinch}`).toBeLessThan(0.6);
      }
    }
  });

  it.each([WIDE, TALL])('no se sale del encuadre de punta a punta (proporcion %f)', (aspect) => {
    // Con la mano de frente, la palma en la nota mas grave dejaba el pulgar y el
    // indice fuera del encuadre —justo los dos que hay que mirar—, y en vertical
    // se salia media mano. Se recorre la demostracion entera, con su vaiven y su
    // ladeo, y se mira cada punto.
    const performance = new DemoPerformance(EDGES, createLayout('pentatonic', 9, 3, 2));
    const scale = drawnScale(aspect);
    // Lo que no puede salirse: la pinza y la palma. Del resto se admite que un
    // nudillo asome por el borde, que es lo que le pasa a una mano de verdad
    // tocando la nota del extremo.
    const ESSENTIAL = [0, 4, 5, 8, 9, 13, 17];
    const SLACK = 0.04;
    for (let frame = 0; frame * (1 / 60) < performance.seconds; frame += 1) {
      const seconds = frame / 60;
      const pose = performance.poseAt(seconds);
      const hand = phantomHand({
        x: pose.x,
        y: pose.y,
        pinch: pose.pinch,
        tilt: pose.tilt,
        aspect,
        scale,
      });
      for (const index of ESSENTIAL) {
        expect(hand[index]!.x, `punto ${index} en ${seconds.toFixed(2)}s`).toBeGreaterThanOrEqual(0);
        expect(hand[index]!.x, `punto ${index} en ${seconds.toFixed(2)}s`).toBeLessThanOrEqual(1);
      }
      for (const point of hand) {
        expect(point.x).toBeGreaterThan(-SLACK);
        expect(point.x).toBeLessThan(1 + SLACK);
      }
    }
  });

});

describe('demostracion', () => {
  it('las dos aperturas caen a los dos lados de la banda muerta del gate', () => {
    expect(CLOSED_PINCH).toBeLessThan(PINCH_CLOSE);
    expect(OPEN_PINCH).toBeGreaterThan(PINCH_OPEN);
  });

  it.each(MELODIES.map((melody) => melody.id))('toca %s entera y en orden', (id) => {
    // Nota a nota, no "suena algo": el fallo que esto vigila no es el silencio,
    // es la nota de al lado, que se oye perfectamente y esta mal.
    expect(play(id, 60)).toEqual(expected(id));
  });

  it('toca lo mismo a treinta fotogramas que a sesenta', () => {
    // La coreografia va en segundos, no en fotogramas, y el movil que va justo
    // es justo donde la demostracion tiene que verse bien.
    expect(play('estrellita', 30)).toEqual(play('estrellita', 60));
  });

  it('toca lo mismo en una pantalla vertical', () => {
    expect(play('estrellita', 60, TALL)).toEqual(expected('estrellita'));
  });

  it('la marca de la rejilla va por delante de la mano', () => {
    const melody = getMelody('estrellita')!;
    const layout = createLayout('major', 9, 3, 2);
    const performance = new DemoPerformance(melody, layout);
    // En pleno viaje hacia la segunda nota, la marca ya senala la segunda.
    const travelling = 0.95 + NOTE_SECONDS;
    expect(performance.zoneAt(travelling)).toBe(performance.zoneAt(travelling + NOTE_SECONDS * 0.6));
    expect(performance.poseAt(travelling).pinch).toBe(OPEN_PINCH);
  });

  it('en modo continuo no se inventa una melodia que no se puede tocar', () => {
    // Sin zonas no hay donde apuntar. Es mejor no tener notas que tenerlas todas
    // en el mismo sitio.
    const performance = new DemoPerformance(getMelody('estrellita')!, createLayout('continuous', 9, 3, 2));
    expect(performance.notes).toBe(0);
    expect(performance.zoneAt(2)).toBeNull();
    expect(performance.poseAt(2).pinch).toBe(OPEN_PINCH);
  });

  it('dura lo que dura una melodia, no lo que dura una pelicula', () => {
    const performance = new DemoPerformance(getMelody('estrellita')!, createLayout('major', 9, 3, 2));
    expect(performance.notes).toBe(14);
    expect(performance.seconds).toBeLessThan(30);
    expect(performance.finishedAt(performance.seconds)).toBe(true);
  });
});
