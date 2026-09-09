import { PRESETS, type PresetId } from '../audio/presets';
import type { LoopEvent } from '../audio/loopTake';
import { MAX_CYCLE_SECONDS, MAX_TRACKS, MIN_CYCLE_SECONDS } from '../audio/loopTake';

/**
 * Una interpretacion dentro de un enlace.
 *
 * La estacion de bucles no graba audio, graba gestos, y esa decision es la que
 * hace posible esto: unos cientos de bytes en la direccion bastan para que otra
 * persona abra el enlace y oiga lo que se toco, sintetizado en su navegador. No
 * hay fichero que subir ni servidor donde dejarlo.
 *
 * Todo lo delicado esta aqui y es puro: el formato, el remuestreo y el
 * presupuesto de tamano. Lo que decodifica viene de una direccion que cualquiera
 * puede escribir a mano, asi que se valida entero y se rechaza en bloque; medio
 * bucle reconstruido de un enlace roto sonaria a fallo del instrumento.
 */

export interface PerformanceTrack {
  presetId: PresetId;
  events: LoopEvent[];
}

export interface Performance {
  cycleSeconds: number;
  tracks: PerformanceTrack[];
}

const VERSION = 1;

/**
 * Tope de bytes antes de pasar a base64.
 *
 * 1400 bytes se quedan en unos 1870 caracteres, y con el resto de la direccion
 * el enlace no llega a los 2000. Por encima de esa cifra empiezan a aparecer
 * recortes en clientes de mensajeria y en previsualizaciones, que es justo por
 * donde va a viajar esto.
 */
const MAX_BYTES = 1400;

/**
 * Ritmos de remuestreo, del mejor al peor.
 *
 * La captura guarda parametros a 30 Hz, que en una direccion no cabe. Al
 * reproducir, cada parametro es una rampa hasta el siguiente, no un salto, asi
 * que bajar el ritmo alarga las rampas en vez de escalonar el sonido: a 10 Hz
 * un glissando sigue siendo un glissando.
 */
const PARAM_RATES = [10, 5] as const;

const BYTES_PER_EVENT = 6;
const KIND_CODES = { attack: 0, release: 1, param: 2 } as const;
const KIND_NAMES = ['attack', 'release', 'param'] as const;

/** Centisegundos. El campo de tiempo son 14 bits: 163,83 s de techo. */
const TIME_SCALE = 100;
const MAX_TIME_UNITS = 0x3fff;

/** Centesimas de semitono. Un midi de 127 son 12700, dentro de un uint16. */
const PITCH_SCALE = 100;

export interface EncodeResult {
  /** Cadena lista para el fragmento de la direccion. */
  encoded: string;
  /** Capas que han entrado. Puede ser menos de las que se le pasaron. */
  tracks: number;
  /** Parametros por segundo con los que se ha guardado. */
  paramHz: number;
}

/**
 * @returns null si no hay nada que compartir. Nunca lanza: compartir es una
 * comodidad y no puede tumbar la aplicacion.
 */
export function encodePerformance(performance: Performance): EncodeResult | null {
  // Se recorta a lo que se puede reproducir. Codificar una quinta capa seria
  // escribir algo que el propio decodificador va a rechazar despues.
  const usable = performance.tracks.filter((track) => track.events.length > 0).slice(0, MAX_TRACKS);
  if (usable.length === 0) return null;
  if (!(performance.cycleSeconds > 0)) return null;

  for (let count = usable.length; count >= 1; count -= 1) {
    for (const paramHz of PARAM_RATES) {
      const bytes = write({ cycleSeconds: performance.cycleSeconds, tracks: usable.slice(0, count) }, paramHz);
      if (bytes && bytes.length <= MAX_BYTES) {
        return { encoded: toBase64Url(bytes), tracks: count, paramHz };
      }
    }
  }
  return null;
}

/** @returns null ante cualquier cosa que no sea exactamente lo que se escribio. */
export function decodePerformance(encoded: string): Performance | null {
  const bytes = fromBase64Url(encoded);
  if (!bytes || bytes.length < 4) return null;

  let at = 0;
  if (bytes[at++] !== VERSION) return null;

  const cycleSeconds = readUint16(bytes, at) / TIME_SCALE;
  at += 2;
  // El ciclo manda sobre todo lo demas: con uno de cero el repetidor de Tone.js
  // programaria una vuelta de duracion nula y se comeria el hilo de audio.
  if (!(cycleSeconds >= MIN_CYCLE_SECONDS) || cycleSeconds > MAX_CYCLE_SECONDS) return null;

  const trackCount = bytes[at++] ?? 0;
  // Contra el limite de la estacion de bucles, no contra un numero cualquiera:
  // aceptar mas capas de las que se pueden reproducir daria por bueno un enlace
  // al que luego se le caen las ultimas por el camino, en silencio.
  if (trackCount < 1 || trackCount > MAX_TRACKS) return null;

  const tracks: PerformanceTrack[] = [];
  for (let i = 0; i < trackCount; i += 1) {
    if (at + 3 > bytes.length) return null;
    const preset = PRESETS[bytes[at++] ?? -1];
    if (!preset) return null;
    const eventCount = readUint16(bytes, at);
    at += 2;
    // Una capa sin eventos no la produce el codificador: las vacias se filtran
    // antes de escribir. Si aparece, el enlace no es de aqui.
    if (eventCount === 0 || at + eventCount * BYTES_PER_EVENT > bytes.length) return null;

    const events: LoopEvent[] = [];
    let previous = -1;
    for (let e = 0; e < eventCount; e += 1) {
      const packed = readUint16(bytes, at);
      const kind = KIND_NAMES[packed >> 14];
      if (!kind) return null;
      const t = (packed & MAX_TIME_UNITS) / TIME_SCALE;
      if (t > cycleSeconds + 0.5) return null;
      /*
       * En orden de tiempo, y no solo dentro del ciclo.
       *
       * Sin esto, la comprobacion de notas enteras miraria el orden del array y
       * no el del sonido, que son cosas distintas: el reproductor recorre los
       * eventos en orden de array pero los programa en su instante, y Web Audio
       * los ejecuta por instante. Un enlace con ataque en 0, suelta en 2, ataque
       * en 1 y suelta en 3 alterna perfectamente en el array y suena como dos
       * ataques seguidos. El codificador siempre escribe en orden, porque
       * LoopTake.finish() ordena antes de cerrar la toma, asi que exigirlo no
       * rechaza nada legitimo.
       */
      if (t < previous) return null;
      previous = t;
      const midi = readUint16(bytes, at + 2) / PITCH_SCALE;
      events.push({
        t,
        kind,
        freq: midiToFreq(midi),
        cutoffNorm: (bytes[at + 4] ?? 0) / 255,
        gain: (bytes[at + 5] ?? 0) / 255,
      });
      at += BYTES_PER_EVENT;
    }
    if (!hasWholeNotes(events)) return null;
    tracks.push({ presetId: preset.id, events });
  }

  // Bytes de sobra significan que esto no lo escribio esta version. Antes que
  // adivinar, se rechaza.
  if (at !== bytes.length) return null;
  return { cycleSeconds, tracks };
}

/**
 * Notas enteras, contadas dando la vuelta al ciclo.
 *
 * Sin esto, dos capas rotas pasan el resto de la validacion y suenan mal en vez
 * de rechazarse: una con solo parametros no produce una sola nota, y el enlace
 * se queda anunciando que esta sonando algo que no suena; y un ataque sin su
 * suelta deja la nota abierta, y como cada vuelta la vuelve a atacar, se
 * convierte en un bordon que ya no para.
 *
 * Cuenta con que los eventos llegan en orden de tiempo, cosa que el
 * decodificador exige antes de llamar aqui: mirar el orden del array cuando el
 * sonido va por otro seria comprobar la lista equivocada.
 *
 * La comprobacion es circular y no lineal, y esa es la parte que importa.
 * `LoopTake.finish()` ordena los eventos por tiempo, asi que una sobregrabacion
 * que empieza a mitad de vuelta acaba con la suelta ANTES que su ataque en el
 * array: la nota cruza el final del ciclo. Exigir que empiece por un ataque
 * rechazaria esas capas, que son perfectamente legitimas. Lo que hay que exigir
 * es que ataques y sueltas se alternen al dar la vuelta.
 */
export function hasWholeNotes(events: readonly LoopEvent[]): boolean {
  const gates = events.filter((event) => event.kind !== 'param');
  if (gates.length < 2) return false;
  for (let i = 0; i < gates.length; i += 1) {
    if (gates[i]!.kind === gates[(i + 1) % gates.length]!.kind) return false;
  }
  return true;
}

/** Descarta parametros hasta dejar como mucho `paramHz` por segundo. */
export function thin(events: readonly LoopEvent[], paramHz: number): LoopEvent[] {
  const minGap = 1 / paramHz - 1e-6;
  const kept: LoopEvent[] = [];
  let lastParamAt = -Infinity;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.kind !== 'param') {
      kept.push(event);
      // Un ataque reinicia el reloj: el primer parametro de una nota no debe
      // caer descartado por estar pegado al ataque que lo precede.
      lastParamAt = event.t;
      continue;
    }
    // El ultimo parametro antes de una suelta se guarda siempre: es donde
    // termina el glissando, y perderlo deja la nota acabando en otra altura.
    const lastOfNote = events[i + 1]?.kind === 'release';
    if (lastOfNote || event.t - lastParamAt >= minGap) {
      kept.push(event);
      lastParamAt = event.t;
    }
  }
  return kept;
}

function write(performance: Performance, paramHz: number): Uint8Array | null {
  const thinned = performance.tracks.map((track) => ({ ...track, events: thin(track.events, paramHz) }));
  const total = thinned.reduce((sum, track) => sum + 3 + track.events.length * BYTES_PER_EVENT, 4);
  const bytes = new Uint8Array(total);

  let at = 0;
  bytes[at++] = VERSION;
  writeUint16(bytes, at, Math.round(performance.cycleSeconds * TIME_SCALE));
  at += 2;
  bytes[at++] = thinned.length;

  for (const track of thinned) {
    const index = PRESETS.findIndex((preset) => preset.id === track.presetId);
    if (index < 0) return null;
    bytes[at++] = index;
    writeUint16(bytes, at, track.events.length);
    at += 2;
    for (const event of track.events) {
      const units = Math.min(MAX_TIME_UNITS, Math.max(0, Math.round(event.t * TIME_SCALE)));
      writeUint16(bytes, at, (KIND_CODES[event.kind] << 14) | units);
      writeUint16(bytes, at + 2, clampInt(Math.round(freqToMidi(event.freq) * PITCH_SCALE), 0, 0xffff));
      bytes[at + 4] = clampInt(Math.round(event.cutoffNorm * 255), 0, 255);
      bytes[at + 5] = clampInt(Math.round(event.gain * 255), 0, 255);
      at += BYTES_PER_EVENT;
    }
  }
  return bytes;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function freqToMidi(freq: number): number {
  if (!(freq > 0)) return 0;
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function readUint16(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function writeUint16(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >> 8) & 0xff;
}

/**
 * base64 en su variante para direcciones: sin `+`, sin `/` y sin relleno. Los
 * tres caracteres que sobran son justo los que un cliente de mensajeria puede
 * decidir que no forman parte del enlace.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
