import { OneEuroFilter, DEFAULT_D_CUTOFF, type OneEuroParams } from './oneEuro';
import type { Landmark } from '../tracking/types';

const LANDMARK_COUNT = 21;

/**
 * Aplica One Euro a los 21 puntos de una mano. Se mantiene una instancia por
 * coordenada porque el filtro es escalar y con estado; compartirlo entre ejes
 * mezclaria velocidades que no tienen nada que ver.
 */
export class LandmarkFilter {
  private readonly x: OneEuroFilter[] = [];
  private readonly y: OneEuroFilter[] = [];
  private readonly z: OneEuroFilter[] = [];

  constructor(params: Omit<OneEuroParams, 'dCutoff'>) {
    const full: OneEuroParams = { ...params, dCutoff: DEFAULT_D_CUTOFF };
    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      this.x.push(new OneEuroFilter(full));
      this.y.push(new OneEuroFilter(full));
      this.z.push(new OneEuroFilter(full));
    }
  }

  setParams(params: Partial<OneEuroParams>): void {
    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      this.x[i]?.setParams(params);
      this.y[i]?.setParams(params);
      this.z[i]?.setParams(params);
    }
  }

  reset(): void {
    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      this.x[i]?.reset();
      this.y[i]?.reset();
      this.z[i]?.reset();
    }
  }

  /** @param timestamp en segundos. */
  apply(landmarks: readonly Landmark[], timestamp: number): Landmark[] {
    const out: Landmark[] = new Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i += 1) {
      const p = landmarks[i];
      const fx = this.x[i];
      const fy = this.y[i];
      const fz = this.z[i];
      if (!p || !fx || !fy || !fz) continue;
      out[i] = {
        x: fx.filter(p.x, timestamp),
        y: fy.filter(p.y, timestamp),
        z: fz.filter(p.z, timestamp),
      };
    }
    return out;
  }
}
