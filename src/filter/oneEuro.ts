/**
 * One Euro Filter (Casiez, Roussel, Vogel, 2012).
 *
 * La razon de usarlo en lugar de una media movil es que la media movil introduce
 * una latencia constante que en audio se percibe como retardo entre el gesto y el
 * sonido. One Euro adapta su corte a la velocidad de la senal: filtra fuerte en
 * reposo (donde el temblor es audible como vibrato sucio) y se abre en el
 * movimiento rapido (donde el retardo es lo que molesta).
 */
export interface OneEuroParams {
  /** Corte en reposo, en Hz. Mas bajo = mas quieto y mas perezoso. */
  minCutoff: number;
  /** Cuanto se abre el corte con la velocidad. Mas alto = mas respuesta y mas ruido. */
  beta: number;
  /** Corte del filtro de la derivada. 1.0 va bien casi siempre. */
  dCutoff: number;
}

export const DEFAULT_D_CUTOFF = 1.0;

class LowPass {
  private y: number | null = null;
  private s = 0;

  filter(value: number, alpha: number): number {
    this.s = this.y === null ? value : alpha * value + (1 - alpha) * this.s;
    this.y = value;
    return this.s;
  }

  reset(): void {
    this.y = null;
    this.s = 0;
  }

  get hasValue(): boolean {
    return this.y !== null;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private readonly xFilter = new LowPass();
  private readonly dxFilter = new LowPass();
  private lastTime: number | null = null;
  private lastValue = 0;

  constructor(private params: OneEuroParams) {}

  setParams(params: Partial<OneEuroParams>): void {
    this.params = { ...this.params, ...params };
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
    this.lastValue = 0;
  }

  /** @param timestamp en segundos. */
  filter(value: number, timestamp: number): number {
    if (!Number.isFinite(value)) return this.lastValue;

    let dt = 1 / 60;
    if (this.lastTime !== null) {
      const delta = timestamp - this.lastTime;
      // Protege contra fotogramas duplicados y contra saltos tras una pausa.
      if (delta > 1e-4 && delta < 0.5) dt = delta;
    }
    this.lastTime = timestamp;

    const dx = this.xFilter.hasValue ? (value - this.lastValue) / dt : 0;
    const edx = this.dxFilter.filter(dx, alpha(this.params.dCutoff, dt));
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(edx);

    this.lastValue = value;
    const out = this.xFilter.filter(value, alpha(cutoff, dt));
    return out;
  }
}
