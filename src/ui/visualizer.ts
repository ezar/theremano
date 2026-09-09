import { coverRect, pitchHue, type RenderTarget } from './target';

/**
 * Los efectos que hacen que valga la pena mirar y, sobre todo, grabar.
 *
 * La simulacion avanza una vez por fotograma y se pinta tantas veces como
 * destinos haya. Separarlo asi es lo que permite que el video grabado tenga
 * exactamente los mismos efectos que la pantalla, en otra proporcion, sin que
 * las particulas se muevan al doble de velocidad por pintarse dos veces.
 */

interface Particle {
  /** Coordenadas normalizadas del encuadre, no pixeles: el destino puede cambiar. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
}

interface Ripple {
  x: number;
  y: number;
  life: number;
  hue: number;
}

const MAX_PARTICLES = 140;
const PARTICLE_LIFE = 1.1;
const RIPPLE_LIFE = 0.85;

export interface VisualState {
  gateOpen: boolean;
  midi: number;
  volume: number;
  /** Punto de la pinza en coordenadas normalizadas, o null. */
  source: { x: number; y: number } | null;
}

export class Visualizer {
  private readonly particles: Particle[] = [];
  private readonly ripples: Ripple[] = [];
  private spawnDebt = 0;
  private glow = 0;
  private hue = 46;

  /** Avanza la simulacion. @param dt en segundos. */
  update(state: VisualState, dt: number): void {
    const step = Math.min(dt, 1 / 20);

    if (state.gateOpen) this.hue = pitchHue(state.midi);
    // El brillo sube rapido al atacar y baja despacio: sin la caida lenta, el
    // fondo parpadea en cada nota corta y marea.
    const target = state.gateOpen ? 0.35 + state.volume * 0.65 : 0;
    this.glow += (target - this.glow) * Math.min(1, step * (state.gateOpen ? 12 : 3));

    if (state.gateOpen && state.source && this.particles.length < MAX_PARTICLES) {
      this.spawnDebt += step * (26 + state.volume * 34);
      while (this.spawnDebt >= 1 && this.particles.length < MAX_PARTICLES) {
        this.spawnDebt -= 1;
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.012 + Math.random() * 0.05;
        this.particles.push({
          x: state.source.x,
          y: state.source.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.05,
          life: PARTICLE_LIFE,
          maxLife: PARTICLE_LIFE,
          hue: this.hue + (Math.random() * 40 - 20),
          size: 1.5 + Math.random() * 3.2,
        });
      }
    } else {
      this.spawnDebt = 0;
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i]!;
      p.life -= step;
      if (p.life <= 0) {
        // Intercambiar con el ultimo evita reindexar el array entero.
        this.particles[i] = this.particles[this.particles.length - 1]!;
        this.particles.pop();
        continue;
      }
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vy -= 0.055 * step;
      p.vx *= 1 - 0.9 * step;
    }

    for (let i = this.ripples.length - 1; i >= 0; i -= 1) {
      const r = this.ripples[i]!;
      r.life -= step;
      if (r.life <= 0) {
        this.ripples[i] = this.ripples[this.ripples.length - 1]!;
        this.ripples.pop();
      }
    }
  }

  /** Se llama al abrir el gate: una onda que sale del punto de la pinza. */
  attack(source: { x: number; y: number } | null, midi: number): void {
    if (!source) return;
    this.hue = pitchHue(midi);
    this.ripples.push({ x: source.x, y: source.y, life: RIPPLE_LIFE, hue: this.hue });
  }

  reset(): void {
    this.particles.length = 0;
    this.ripples.length = 0;
    this.glow = 0;
  }

  /** Tinte de fondo. Se pinta antes que nada, debajo de la mano. */
  paintBackground(target: RenderTarget): void {
    if (this.glow <= 0.01) return;
    const { ctx, width, height } = target;
    const gradient = ctx.createRadialGradient(
      width / 2,
      height * 0.55,
      Math.min(width, height) * 0.1,
      width / 2,
      height * 0.55,
      Math.max(width, height) * 0.75,
    );
    gradient.addColorStop(0, `hsla(${this.hue}, 90%, 60%, 0)`);
    gradient.addColorStop(1, `hsla(${this.hue}, 90%, 45%, ${0.3 * this.glow})`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** Particulas y ondas. Se pinta encima del esqueleto. */
  paintForeground(target: RenderTarget, videoWidth: number, videoHeight: number): void {
    if (this.particles.length === 0 && this.ripples.length === 0) return;
    const rect = coverRect(target, videoWidth, videoHeight);
    const { ctx } = target;

    ctx.save();
    // Composicion aditiva: donde se cruzan varias particulas el color se
    // satura hacia el blanco, que es lo que da la sensacion de brasa.
    ctx.globalCompositeOperation = 'lighter';

    for (const r of this.ripples) {
      const progress = 1 - r.life / RIPPLE_LIFE;
      const radius = (0.02 + progress * 0.22) * rect.w;
      ctx.strokeStyle = `hsla(${r.hue}, 95%, 68%, ${(1 - progress) * 0.55})`;
      ctx.lineWidth = (1 - progress) * 3.5 * target.unit;
      ctx.beginPath();
      ctx.arc(rect.x + r.x * rect.w, rect.y + r.y * rect.h, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const p of this.particles) {
      const alpha = (p.life / p.maxLife) ** 1.5;
      ctx.fillStyle = `hsla(${p.hue}, 95%, 68%, ${alpha * 0.75})`;
      ctx.beginPath();
      ctx.arc(rect.x + p.x * rect.w, rect.y + p.y * rect.h, p.size * target.unit * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  get currentHue(): number {
    return this.hue;
  }

  get intensity(): number {
    return this.glow;
  }
}
