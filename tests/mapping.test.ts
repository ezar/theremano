import { describe, expect, it } from 'vitest';

import { countExtendedFingers, palmCenter, pinchRatio } from '../src/mapping/features';
import { buildDegreeTable, createLayout, isContinuous, midiToName, pitchAt, zoneCenters } from '../src/mapping/scales';
import { es } from '../src/i18n/es';
import { en } from '../src/i18n/en';

/** Nombre de la nota en la notacion latina, que es la que usan estas pruebas. */
const nameOf = (midi: number) => midiToName(midi, es.notes);
import { presetForFingerCount, PRESETS } from '../src/audio/presets';
import { jitter, makeHand, mulberry32 } from './helpers';

describe('magnitudes de la mano', () => {
  it('la razon de la pinza no depende de lo lejos que este la mano', () => {
    const near = pinchRatio(makeHand(0.5, 0.5, { pinch: 0.25, scale: 0.34 }));
    const far = pinchRatio(makeHand(0.5, 0.5, { pinch: 0.25, scale: 0.11 }));
    expect(Math.abs(near - far)).toBeLessThan(0.01);
  });

  it('distingue la pinza cerrada de la abierta', () => {
    expect(pinchRatio(makeHand(0.5, 0.5, { pinch: 0.15 }))).toBeLessThan(0.3);
    expect(pinchRatio(makeHand(0.5, 0.5, { pinch: 0.7 }))).toBeGreaterThan(0.42);
  });

  it('cuenta los dedos extendidos de cero a cuatro', () => {
    for (let fingers = 0; fingers <= 4; fingers += 1) {
      expect(countExtendedFingers(makeHand(0.5, 0.5, { fingers })), `${fingers} dedos`).toBe(fingers);
    }
  });

  it('el centro de palma tiembla menos que la muneca sola', () => {
    // Es la razon de usar la media de los puntos 0, 5 y 17 en lugar del 0.
    const rand = mulberry32(99);
    const hand = makeHand(0.5, 0.5);
    const palms: number[] = [];
    const wrists: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      const noisy = jitter(hand, 0.004, rand);
      palms.push(palmCenter(noisy).x);
      wrists.push(noisy[0]!.x);
    }
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(palms)).toBeLessThan(spread(wrists) * 0.75);
  });
});

describe('escalas y cuantizacion', () => {
  it('la pentatonica menor cubre dos octavas cerrando en la tonica', () => {
    const table = buildDegreeTable('pentatonic', 2);
    expect(table).toEqual([0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24]);
  });

  it('los bordes del encuadre son la tonica grave y la tonica aguda', () => {
    const layout = createLayout('pentatonic', 9, 3, 2);
    expect(nameOf(pitchAt(layout, 0).midi)).toBe('La3');
    expect(nameOf(pitchAt(layout, 1).midi)).toBe('La5');
  });

  it('el modo continuo no cuantiza y recorre el rango entero', () => {
    const layout = createLayout('continuous', 9, 3, 2);
    expect(isContinuous('continuous')).toBe(true);
    expect(zoneCenters(layout)).toEqual([]);
    const low = pitchAt(layout, 0).freq;
    const high = pitchAt(layout, 1).freq;
    expect(high / low).toBeCloseTo(4, 5);
    // Entre dos posiciones vecinas hay diferencia real, no un salto de grado.
    expect(pitchAt(layout, 0.5001).freq).toBeGreaterThan(pitchAt(layout, 0.5).freq);
  });

  it('todas las escalas reparten el encuadre en zonas de igual anchura', () => {
    const layout = createLayout('major', 0, 3, 2);
    const centers = zoneCenters(layout);
    expect(centers).toHaveLength(15);
    for (let i = 1; i < centers.length; i += 1) {
      expect(centers[i]! - centers[i - 1]!).toBeCloseTo(1 / (centers.length - 1), 9);
    }
  });

  it('nombra las notas en la notacion de cada idioma', () => {
    expect(midiToName(69, es.notes)).toBe('La4');
    expect(midiToName(60, es.notes)).toBe('Do4');
    expect(midiToName(61, es.notes)).toBe('Do#4');
    // El mundo anglosajon lee C D E: ver la notacion equivocada convierte la
    // rejilla en ruido para quien sabe algo de musica.
    expect(midiToName(69, en.notes)).toBe('A4');
    expect(midiToName(60, en.notes)).toBe('C4');
    expect(midiToName(61, en.notes)).toBe('C#4');
  });

  it('una posicion fuera de rango se recorta en lugar de romper', () => {
    const layout = createLayout('blues', 4, 2, 3);
    expect(pitchAt(layout, -5).midi).toBe(pitchAt(layout, 0).midi);
    expect(pitchAt(layout, 9).midi).toBe(pitchAt(layout, 1).midi);
  });
});

describe('seleccion de timbre', () => {
  it('cada numero de dedos de uno a cuatro elige un timbre distinto', () => {
    const ids = [1, 2, 3, 4].map((n) => presetForFingerCount(n)?.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(PRESETS.map((p) => p.id));
  });

  it('el puno se ignora, para no cambiar de timbre al cerrar la mano', () => {
    expect(presetForFingerCount(0)).toBe(null);
  });
});
