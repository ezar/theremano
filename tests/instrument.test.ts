import { describe, expect, it } from 'vitest';

import { Mapper } from '../src/mapping/mapper';
import { RoleTracker } from '../src/tracking/handedness';
import { DEFAULT_SETTINGS, type Settings } from '../src/state/store';
import type { HandFrame } from '../src/tracking/types';
import { makeHand, withMiddlePinch } from './helpers';

/**
 * Recorrido completo: manos detectadas, asignacion de rol, mapeo y eventos de
 * gate. Es donde se comprueban los criterios de aceptacion que hablan del
 * instrumento entero y no de una pieza suelta.
 */

const FPS = 30;

function hand(cx: number, cy: number, options: Parameters<typeof makeHand>[2] = {}): HandFrame {
  return { landmarks: [], raw: makeHand(cx, cy, options) };
}

class Rig {
  readonly tracker = new RoleTracker();
  readonly mapper: Mapper;
  now = 0;
  readonly events: string[] = [];
  readonly presetChanges: string[] = [];
  private readonly stepMs: number;

  /** @param fps para poder comprobar que nada dependa del ritmo de fotogramas. */
  constructor(settings: Settings = { ...DEFAULT_SETTINGS }, fps = FPS) {
    this.mapper = new Mapper(settings);
    this.stepMs = 1000 / fps;
  }

  step(hands: HandFrame[], frames = 1) {
    let output = this.mapper.update(this.tracker.update(hands, this.now), this.now / 1000);
    this.record(output);
    for (let i = 1; i < frames; i += 1) {
      this.now += this.stepMs;
      output = this.mapper.update(this.tracker.update(hands, this.now), this.now / 1000);
      this.record(output);
    }
    this.now += this.stepMs;
    return output;
  }

  /** Segundos, no fotogramas: para gestos que duran lo que duran. */
  hold(hands: HandFrame[], seconds: number) {
    return this.step(hands, Math.max(1, Math.round((seconds * 1000) / this.stepMs)));
  }

  private record(output: ReturnType<Mapper['update']>): void {
    if (output.gateEvent) this.events.push(output.gateEvent);
    if (output.preset) this.presetChanges.push(output.preset.id);
  }
}

const pinched = (x: number) => hand(x, 0.5, { pinch: 0.15 });
const open = (x: number) => hand(x, 0.5, { pinch: 0.8 });

describe('el instrumento de punta a punta', () => {
  it('suena al cerrar la pinza y calla al abrirla', () => {
    const rig = new Rig();
    rig.step([open(0.5)], 6);
    expect(rig.events).toEqual([]);
    rig.step([pinched(0.5)], 6);
    expect(rig.events).toEqual(['attack']);
    rig.step([open(0.5)], 6);
    expect(rig.events).toEqual(['attack', 'release']);
  });

  it('el ataque llega dentro del presupuesto de latencia', () => {
    // El gate exige dos fotogramas de confirmacion, asi que dos es el minimo
    // posible. Cualquier cosa por encima de tres significa que el suavizado se
    // ha comido el presupuesto.
    const rig = new Rig();
    rig.step([open(0.5)], 10);
    let frames = 0;
    while (frames < 30) {
      frames += 1;
      if (rig.step([pinched(0.5)]).gateEvent === 'attack') break;
    }
    expect(frames, `${frames} fotogramas hasta el ataque`).toBeLessThanOrEqual(3);
  });

  it('perder la mano 300 ms no corta el sonido', () => {
    const rig = new Rig();
    rig.step([pinched(0.5)], 5);
    expect(rig.events).toEqual(['attack']);

    // Nueve fotogramas a 30 fps son 300 ms sin ninguna deteccion.
    const during = rig.step([], 9);
    expect(during.gateOpen, 'la nota deberia seguir sonando').toBe(true);
    expect(rig.events).toEqual(['attack']);

    // Al recuperarse, sigue sonando sin un nuevo ataque.
    rig.step([pinched(0.5)], 3);
    expect(rig.events).toEqual(['attack']);
  });

  it('perder la mano del todo acaba soltando la nota', () => {
    const rig = new Rig();
    rig.step([pinched(0.5)], 5);
    rig.step([], 20); // mas de 500 ms
    expect(rig.events).toEqual(['attack', 'release']);
  });

  it('mover la mano a la derecha sube el tono', () => {
    const rig = new Rig();
    const low = rig.step([pinched(0.2)], 10);
    const high = rig.step([pinched(0.8)], 20);
    expect(high.freq).toBeGreaterThan(low.freq);
    expect(low.midi).not.toBe(high.midi);
  });

  it('subir la mano abre el filtro y bajarla lo cierra', () => {
    const rig = new Rig();
    const up = rig.step([hand(0.5, 0.15, { pinch: 0.15 })], 12);
    const down = rig.step([hand(0.5, 0.85, { pinch: 0.15 })], 24);
    expect(up.cutoffNorm).toBeGreaterThan(down.cutoffNorm);
  });

  it('la mano de expresion manda en el volumen', () => {
    const rig = new Rig();
    // Melodia a la derecha, expresion a la izquierda y arriba: volumen alto.
    const loud = rig.step([pinched(0.75), hand(0.25, 0.1)], 20);
    const quiet = rig.step([pinched(0.75), hand(0.25, 0.9)], 30);
    expect(loud.volume).toBeGreaterThan(0.7);
    expect(quiet.volume).toBeLessThan(0.3);
  });

  it('perder la mano de expresion conserva el ultimo volumen, no silencia', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.1)], 20);
    const before = rig.mapper.update(rig.tracker.update([pinched(0.75), hand(0.25, 0.1)], rig.now), rig.now / 1000);
    const after = rig.step([pinched(0.75)], 40);
    expect(after.volume).toBeCloseTo(before.volume, 5);
    expect(after.gateOpen, 'y desde luego no debe cortar la nota').toBe(true);
  });

  it('cambia de timbre con los dedos, pero no con el puno', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 12);
    expect(rig.presetChanges).toEqual(['flute']);

    // Cerrar la mano no debe deshacer la eleccion anterior.
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 0 })], 12);
    expect(rig.presetChanges).toEqual(['flute']);
  });

  /**
   * El candidato es lo unico que hace visible un gesto que nadie encontraba.
   * Tiene que aparecer en cuanto los dedos apuntan a otro timbre, crecer
   * mientras se sostiene, y desaparecer en el mismo momento en que se confirma:
   * un "va a cambiar" que sigue puesto despues de cambiar seria mentira.
   */
  it('anuncia el timbre al que apuntan los dedos antes de confirmarlo', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 1 })], 12);

    const first = rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 1);
    expect(first.presetCandidate, 'el nombre tiene que asomar al primer fotograma').toBe('flute');
    expect(first.presetProgress).toBeGreaterThan(0);
    expect(first.presetProgress).toBeLessThan(1);

    const halfway = rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 3);
    expect(halfway.presetCandidate).toBe('flute');
    expect(halfway.presetProgress).toBeGreaterThan(first.presetProgress);

    const confirmed = rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 4);
    expect(rig.presetChanges).toContain('flute');
    expect(confirmed.presetCandidate, 'ya no es candidato: es el timbre actual').toBe(null);
    expect(confirmed.presetProgress).toBe(0);
  });

  it('sin mano de expresion no hay candidato que ensenar', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 2);
    const alone = rig.step([pinched(0.75)], 2);
    expect(alone.presetCandidate).toBe(null);
    expect(alone.presetProgress).toBe(0);
  });

  it('no cambia de timbre por un parpadeo del recuento de dedos', () => {
    const rig = new Rig();
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 1 })], 12);
    const settled = [...rig.presetChanges];
    // Dos fotogramas sueltos con otro recuento estan por debajo de la racha.
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 3 })], 2);
    rig.step([pinched(0.75), hand(0.25, 0.5, { fingers: 1 })], 4);
    expect(rig.presetChanges).toEqual(settled);
  });

  /**
   * El gesto que completa la promesa de "sin contacto": grabar una capa sin
   * tocar nada. Lo que se comprueba de punta a punta es lo que no puede fallar:
   * que no dispare por rozar, que dispare una sola vez, y que no cambie el
   * timbre de paso.
   */
  describe('grabar con la mano', () => {
    const pinched = (x: number) => hand(x, 0.5, { pinch: 0.15 });
    const expression = (options: Parameters<typeof makeHand>[2] = {}) => hand(0.25, 0.5, options);
    const requesting = (options: Parameters<typeof makeHand>[2] = {}): HandFrame => ({
      landmarks: [],
      raw: withMiddlePinch(makeHand(0.25, 0.5, options), 0.12),
    });

    it('pide el bucle una sola vez, y solo si se mantiene', () => {
      const rig = new Rig();
      // Un roce corto: por debajo del tiempo que hay que aguantar.
      let fires = 0;
      for (let i = 0; i < 8; i += 1) {
        if (rig.step([pinched(0.75), requesting()], 1).loopGesture) fires += 1;
      }
      expect(fires, 'ocho fotogramas son un roce, no una peticion').toBe(0);

      for (let i = 0; i < 40; i += 1) {
        if (rig.step([pinched(0.75), requesting()], 1).loopGesture) fires += 1;
      }
      expect(fires, 'sostenido si').toBe(1);

      // Seguir aguantando no encadena bucles.
      for (let i = 0; i < 60; i += 1) {
        if (rig.step([pinched(0.75), requesting()], 1).loopGesture) fires += 1;
      }
      expect(fires).toBe(1);
    });

    it('no cambia de timbre mientras se pide un bucle', () => {
      // Al juntar pulgar y corazon el corazon se dobla, y el recuento de dedos
      // extendidos baja uno: sin la salvaguarda, pedir un bucle cambiaria el
      // instrumento de paso.
      const rig = new Rig();
      rig.step([pinched(0.75), expression({ fingers: 4 })], 12);
      const settled = [...rig.presetChanges];
      for (let i = 0; i < 40; i += 1) rig.step([pinched(0.75), requesting({ fingers: 3 })], 1);
      expect(rig.presetChanges).toEqual(settled);
    });

    /**
     * Un parpadeo del detector no puede completar un gesto que nadie sostuvo.
     *
     * Si lo acumulado sobreviviera a la ausencia, bastaria con que la mano
     * desapareciera y volviera —cosa que hace sola, y con el gesto ya hecho—
     * para que el bucle arrancara sin que se haya mantenido nada.
     */
    it('lo sostenido no sobrevive a perder la mano de vista', () => {
      const rig = new Rig();
      // Casi completo, pero no del todo.
      for (let i = 0; i < 12; i += 1) rig.step([pinched(0.75), requesting()], 1);

      // Parpadea, sin llegar a agotar el margen de gracia: durante esos
      // fotogramas la mano sigue "vista", pero sostenida, y sostenida no vale.
      let fires = 0;
      for (let i = 0; i < 10; i += 1) {
        if (rig.step([pinched(0.75)], 1).loopGesture) fires += 1;
      }
      expect(fires).toBe(0);

      // Y al volver, con el gesto ya hecho, la cuenta empieza de cero: unos
      // pocos fotogramas no pueden bastar.
      for (let i = 0; i < 6; i += 1) {
        if (rig.step([pinched(0.75), requesting()], 1).loopGesture) fires += 1;
      }
      expect(fires, 'volver con los dedos juntos no es haberlos mantenido').toBe(0);
    });
  });

  it('el ataque rapido entra mas fuerte que el lento', () => {
    const fast = new Rig();
    fast.step([hand(0.5, 0.5, { pinch: 0.9 })], 6);
    // De abierta a cerrada en un solo fotograma.
    const loud = fast.step([hand(0.5, 0.5, { pinch: 0.05 })], 6);

    const slow = new Rig();
    slow.step([hand(0.5, 0.5, { pinch: 0.9 })], 6);
    // La misma distancia, recorrida despacio.
    for (let i = 0; i < 20; i += 1) {
      slow.step([hand(0.5, 0.5, { pinch: 0.9 - i * 0.0425 })], 1);
    }
    const soft = slow.step([hand(0.5, 0.5, { pinch: 0.05 })], 3);

    expect(loud.gateOpen && soft.gateOpen, 'las dos tienen que sonar').toBe(true);
    expect(soft.gain).toBeLessThan(loud.gain);
    // Y la suave no puede quedarse en nada: eso se lee como un fallo.
    expect(soft.gain).toBeGreaterThan(loud.gain * 0.5);
    // El volumen que se ensena no lo toca: ese sigue a la mano de expresion.
    expect(soft.volume).toBeCloseTo(loud.volume, 5);
  });

  /**
   * El mismo gesto no puede dar dos fuerzas segun lo cargado que vaya el
   * telefono. Antes se medía entre dos fotogramas consecutivos, asi que a
   * treinta cubria el doble de tiempo que a sesenta y la nota entraba distinta.
   */
  it('la fuerza del ataque no depende de los fotogramas por segundo', () => {
    // Un cierre de golpe, que es donde se veia el fallo: el gate confirma dos
    // fotogramas despues, asi que medir entre dos consecutivos no medía el gesto
    // sino lo que le quedaba al filtro, y eso dura lo mismo en segundos pero
    // distinto en fotogramas.
    const gains = [30, 60, 120].map((fps) => {
      const rig = new Rig({ ...DEFAULT_SETTINGS }, fps);
      rig.hold([hand(0.5, 0.5, { pinch: 0.9 })], 0.5);
      return rig.hold([hand(0.5, 0.5, { pinch: 0.05 })], 0.3).gain;
    });
    /*
     * No sale identico y no puede salirlo: el gate confirma dos fotogramas
     * despues del cruce, y esos dos fotogramas caen en puntos algo distintos de
     * la trayectoria segun el ritmo. Lo que importa es el orden de magnitud:
     * medido entre dos fotogramas consecutivos la dispersion era del 27% —de
     * 0,59 a 0,75, que se oye—; con la ventana en segundos se queda por debajo
     * del 5%, que no.
     */
    const spread = Math.max(...gains) / Math.min(...gains);
    expect(spread).toBeLessThan(1.05);
  });

  it('acercar la mano a la camara abre el espacio', () => {
    const rig = new Rig();
    const far = rig.step([hand(0.5, 0.5, { pinch: 0.15, scale: 0.13 })], 40);
    const near = rig.step([hand(0.5, 0.5, { pinch: 0.15, scale: 0.34 })], 40);
    expect(near.space).toBeGreaterThan(far.space);
    expect(far.space).toBeGreaterThanOrEqual(0);
    expect(near.space).toBeLessThanOrEqual(1);
  });

  it('en modo continuo el portamento es mas largo que cuantizado', () => {
    const quantized = new Rig().step([pinched(0.5)], 3);
    const continuous = new Rig({ ...DEFAULT_SETTINGS, scale: 'continuous' }).step([pinched(0.5)], 3);
    expect(continuous.glide).toBeGreaterThan(quantized.glide);
  });
});
