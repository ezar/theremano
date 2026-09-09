/**
 * Claqueta antes de la primera capa de bucle.
 *
 * La primera capa define el compas de todo lo que venga despues, y hasta ahora
 * ese compas empezaba en el instante del pulsado. Con las manos en el aire eso
 * es una carrera: hay que estar ya colocado, con la pinza donde toca y la nota
 * pensada, antes de tocar el boton. Cuatro pulsos por delante convierten esa
 * carrera en una entrada.
 *
 * Solo para la primera. En una sobregrabacion el ciclo ya existe y la toma
 * entra donde este el cabezal: una claqueta ahi retrasaria el pinchazo y
 * desplazaria la capa entera.
 *
 * El tiempo lo pone la aplicacion porque no hay ninguno todavia: nadie ha
 * marcado un compas aun. Noventa por minuto es lento a proposito; con una mano
 * en el aire, un pulso rapido no da tiempo a colocarse, que es justo lo que la
 * claqueta viene a resolver.
 *
 * Aqui no hay audio: solo los instantes. Asi se puede comprobar con numeros en
 * lugar de con un contexto de audio y un cronometro.
 */

export const COUNT_IN_BEATS = 4;
export const COUNT_IN_BPM = 90;
export const BEAT_SECONDS = 60 / COUNT_IN_BPM;

/**
 * Adelanto con el que se programa el primer pulso.
 *
 * No se puede programar en el instante exacto en que se pulsa: para cuando el
 * hilo de audio llega a atenderlo, ese instante ya ha pasado, y un evento en el
 * pasado se descarta sin avisar. Se vio en la prueba de humo, con la claqueta
 * contando en pantalla y sin sonar. Veinte milisegundos bastan y no se oyen.
 */
const SCHEDULE_LEAD = 0.02;

export interface CountInPlan {
  /** Instante de cada pulso, en segundos del contexto de audio. */
  clicks: readonly number[];
  /** Instante en que empieza la grabacion: el pulso siguiente al ultimo. */
  downbeat: number;
}

export function planCountIn(now: number): CountInPlan {
  const clicks: number[] = [];
  // El primer pulso suena ya, sin esperar: el boton tiene que responder al
  // instante o parece que no se ha pulsado.
  const first = now + SCHEDULE_LEAD;
  for (let i = 0; i < COUNT_IN_BEATS; i += 1) clicks.push(first + i * BEAT_SECONDS);
  return { clicks, downbeat: first + COUNT_IN_BEATS * BEAT_SECONDS };
}

/**
 * Pulsos que quedan, de COUNT_IN_BEATS a 0, para el rotulo del boton.
 *
 * Cuenta hacia abajo el pulso que se esta oyendo, no el que ya paso: mientras
 * suena el primero de cuatro, el rotulo dice 4. Un contador que dijera 3 durante
 * el primer pulso pediria entrar un pulso antes de tiempo.
 */
export function beatsLeft(plan: CountInPlan, now: number): number {
  const remaining = plan.downbeat - now;
  if (remaining <= 0) return 0;
  // El margen es contra la coma flotante, no contra el oido. Justo en el borde
  // de un pulso, `downbeat - now` sale una milesima de nada por encima del
  // multiplo exacto y el redondeo hacia arriba devolvia un pulso de mas.
  return Math.min(COUNT_IN_BEATS, Math.ceil(remaining / BEAT_SECONDS - 1e-6));
}

/** true cuando ya toca empezar a grabar. */
export function isDue(plan: CountInPlan, now: number): boolean {
  return now >= plan.downbeat;
}

/**
 * La entrada se perdio: el pulso de entrada quedo demasiado atras.
 *
 * Pasa cuando el bucle de fotogramas se para en mitad de la cuenta —la pestana
 * se va al fondo, el movil se bloquea—. Arrancar la toma ahi, con un inicio que
 * ya paso, la llenaria de silencio por delante; y con veinte segundos de
 * ausencia se descartaria sola nada mas nacer. Un pulso de margen es de sobra:
 * mas que eso ya no es llegar tarde, es no haber estado.
 */
export function isMissed(plan: CountInPlan, now: number): boolean {
  return now - plan.downbeat > BEAT_SECONDS;
}

/** El pulso fuerte es el primero: es el que marca donde cae el uno. */
export function isAccent(index: number): boolean {
  return index === 0;
}
