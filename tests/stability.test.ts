import { describe, expect, it } from 'vitest';

import { OneEuroFilter, DEFAULT_D_CUTOFF } from '../src/filter/oneEuro';
import { melodyFeatures } from '../src/mapping/features';
import { createLayout, midiToName, pitchAt } from '../src/mapping/scales';
import { es } from '../src/i18n/es';
import { DEFAULT_SETTINGS } from '../src/state/store';
import { cents, jitter, makeHand, mulberry32 } from './helpers';

/**
 * Criterio de aceptacion de la SPEC: con la mano quieta y la pinza cerrada, la
 * frecuencia debe variar menos de tres cents durante cinco segundos.
 *
 * Se simula una mano inmovil con el temblor tipico de MediaPipe y se recorre la
 * cadena completa: centro de palma, normalizacion, One Euro y escala.
 *
 * El resultado tiene matiz, y conviene dejarlo escrito. En la configuracion por
 * defecto (cuantizada) el criterio se cumple de forma exacta: la nota no cambia
 * y la deriva es literalmente cero, porque el cuantizador absorbe el temblor.
 * En modo continuo el limite no lo pone el filtro sino el detector. Bajar
 * `minCutoff` de 0.80 a 0.20 solo reduce la deriva de 7.4 a 5.3 cents y a cambio
 * anade unos 80 ms de retardo: el filtro no elimina el ruido, lo desplaza a
 * frecuencias mas bajas, y una deriva lenta sigue siendo deriva. Por eso se
 * mantienen los parametros de partida de la SPEC y se documenta el limite real.
 */

const FPS = 30;
const SECONDS = 5;
const FRAMES = FPS * SECONDS;

/** Temblor por punto en una deteccion limpia: mano bien iluminada y quieta. */
const CLEAN_SIGMA = 0.0012;
/** Temblor por punto en condiciones malas: poca luz, mano lejos. */
const NOISY_SIGMA = 0.003;

function runStill(scale: 'pentatonic' | 'continuous', sigma: number, filtered = true) {
  const rand = mulberry32(20240909);
  const still = makeHand(0.5, 0.5, { pinch: 0.2 });
  const layout = createLayout(scale, DEFAULT_SETTINGS.tonicPc, DEFAULT_SETTINGS.baseOctave, DEFAULT_SETTINGS.octaves);
  const filter = new OneEuroFilter({
    minCutoff: DEFAULT_SETTINGS.pitchMinCutoff,
    beta: DEFAULT_SETTINGS.pitchBeta,
    dCutoff: DEFAULT_D_CUTOFF,
  });

  const freqs: number[] = [];
  const notes = new Set<string>();
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const t = frame / FPS;
    const raw = melodyFeatures(jitter(still, sigma, rand)).x;
    const x = filtered ? filter.filter(raw, t) : raw;
    // El primer medio segundo es la convergencia del filtro, no deriva.
    if (t < 0.5) continue;
    const pitch = pitchAt(layout, x);
    freqs.push(pitch.freq);
    notes.add(midiToName(pitch.midi, es.notes));
  }

  return { drift: cents(Math.max(...freqs), Math.min(...freqs)), notes };
}

describe('estabilidad del tono con la mano quieta', () => {
  it('en la configuracion por defecto no cambia de nota en cinco segundos', () => {
    const { drift, notes } = runStill('pentatonic', NOISY_SIGMA);
    expect([...notes], 'la nota deberia ser unica').toHaveLength(1);
    expect(drift).toBe(0);
  });

  it('en modo continuo y con deteccion limpia se queda por debajo de tres cents', () => {
    const { drift } = runStill('continuous', CLEAN_SIGMA);
    expect(drift, `deriva de ${drift.toFixed(2)} cents`).toBeLessThan(3);
  });

  it('en modo continuo y con deteccion ruidosa el limite lo pone el detector', () => {
    // No es un objetivo, es una constatacion: sirve para detectar regresiones
    // en el filtro sin fingir que el criterio de tres cents es alcanzable aqui.
    const { drift } = runStill('continuous', NOISY_SIGMA);
    expect(drift, `deriva de ${drift.toFixed(2)} cents`).toBeLessThan(10);
  });

  it('sin filtrar, el mismo temblor se sale del limite por mucho', () => {
    // Control: si esto no fallara, los tests anteriores no probarian nada.
    const { drift } = runStill('continuous', CLEAN_SIGMA, false);
    expect(drift).toBeGreaterThan(3);
  });
});
