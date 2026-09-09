import { describe, expect, it } from 'vitest';
import { BEAT_SECONDS, COUNT_IN_BEATS, beatsLeft, isAccent, isDue, isMissed, planCountIn } from '../src/audio/countIn';

/**
 * La claqueta es aritmetica de instantes, y por eso se puede comprobar sin
 * contexto de audio. Lo que se vigila aqui es lo unico que puede salir mal sin
 * que se note hasta la tercera vuelta: que el primer pulso suene ya, que la
 * grabacion empiece en el pulso siguiente al ultimo y no medio pulso antes, y
 * que el contador diga el numero que pide entrar en el sitio correcto.
 */

describe('claqueta', () => {
  it('el primer pulso suena al instante y los demas van al compas', () => {
    const plan = planCountIn(10);
    expect(plan.clicks).toHaveLength(COUNT_IN_BEATS);
    // Practicamente al instante: solo el adelanto que hace falta para que el
    // hilo de audio no se lo encuentre ya pasado. Sin esto el boton pareceria no
    // responder durante dos tercios de segundo.
    expect(plan.clicks[0]).toBeGreaterThan(10);
    expect(plan.clicks[0]).toBeLessThan(10.05);
    for (let i = 1; i < plan.clicks.length; i += 1) {
      expect(plan.clicks[i]! - plan.clicks[i - 1]!).toBeCloseTo(BEAT_SECONDS, 10);
    }
  });

  it('la grabacion empieza un pulso despues del ultimo, no encima', () => {
    const plan = planCountIn(0);
    expect(plan.downbeat - plan.clicks[0]!).toBeCloseTo(COUNT_IN_BEATS * BEAT_SECONDS, 10);
    expect(plan.downbeat - plan.clicks.at(-1)!).toBeCloseTo(BEAT_SECONDS, 10);
  });

  /**
   * El numero que se ve es el del pulso que se esta oyendo, no el que ya paso.
   * Un contador que dijera 3 mientras suena el primero de cuatro pediria entrar
   * un pulso antes de tiempo, que es peor que no contar.
   */
  it('el contador va con el pulso que suena', () => {
    const plan = planCountIn(0);
    // Se mide desde los propios pulsos y no desde el instante del pulsado: lo
    // que tiene que cuadrar es lo que se ve con lo que se oye.
    expect(beatsLeft(plan, 0)).toBe(4);
    expect(beatsLeft(plan, plan.clicks[0]!)).toBe(4);
    expect(beatsLeft(plan, plan.clicks[1]!)).toBe(3);
    expect(beatsLeft(plan, plan.clicks[2]!)).toBe(2);
    expect(beatsLeft(plan, plan.clicks[3]!)).toBe(1);
    expect(beatsLeft(plan, plan.clicks[3]! + BEAT_SECONDS * 0.9)).toBe(1);
    // En el pulso de entrada ya no queda nada que contar.
    expect(beatsLeft(plan, plan.downbeat)).toBe(0);
    expect(beatsLeft(plan, plan.downbeat + 5)).toBe(0);
  });

  it('empezar mas tarde no cambia la cuenta, solo la desplaza', () => {
    const plan = planCountIn(1234.5);
    expect(beatsLeft(plan, plan.clicks[0]!)).toBe(4);
    expect(beatsLeft(plan, plan.clicks[2]!)).toBe(2);
    expect(isDue(plan, plan.downbeat - 0.001)).toBe(false);
    expect(isDue(plan, plan.downbeat)).toBe(true);
  });

  /**
   * Lo que pasa si el bucle de fotogramas se para en mitad de la cuenta: la
   * pestana se va al fondo, el movil se bloquea. Al volver, el pulso de entrada
   * quedo atras, y empezar ahi una toma con un inicio que ya paso la llenaria de
   * silencio por delante; con veinte segundos fuera, se descartaria sola nada
   * mas nacer.
   */
  it('una entrada que quedo atras se da por perdida', () => {
    const plan = planCountIn(0);
    expect(isMissed(plan, plan.downbeat)).toBe(false);
    // Llegar un poco tarde es normal: los fotogramas no caen en el instante.
    expect(isMissed(plan, plan.downbeat + BEAT_SECONDS * 0.9)).toBe(false);
    expect(isMissed(plan, plan.downbeat + BEAT_SECONDS * 1.1)).toBe(true);
    expect(isMissed(plan, plan.downbeat + 30)).toBe(true);
  });

  it('solo el primer pulso lleva acento: es el que marca donde cae el uno', () => {
    expect(isAccent(0)).toBe(true);
    for (let i = 1; i < COUNT_IN_BEATS; i += 1) expect(isAccent(i)).toBe(false);
  });

  it('el tiempo es comodo para colocar una mano en el aire', () => {
    // No es una comprobacion de gusto: por debajo de medio segundo por pulso no
    // da tiempo a levantar la mano y encontrar la nota, que es justo para lo que
    // existe esto. Si alguien acelera la claqueta, esta prueba lo pregunta.
    expect(BEAT_SECONDS).toBeGreaterThanOrEqual(0.5);
    expect(COUNT_IN_BEATS * BEAT_SECONDS).toBeLessThanOrEqual(4);
  });
});
