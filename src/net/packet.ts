import { ROSTER, type DrumPiece } from '../mapping/kit';
import { midiToFreq, freqToMidi } from '../mapping/scales';
import type { LiveSnapshot } from '../audio/loopTake';
import type { HandPose } from '../tracking/phantom';

/**
 * Lo que viaja entre dos dispositivos: el gesto, no el sonido.
 *
 * Es la misma decision que hace que una interpretacion quepa en un enlace,
 * llevada al otro extremo: en vez de mandar audio -que pesa cien veces mas, se
 * corta en cuanto la red tose y llega comprimido- se manda lo que la mano esta
 * haciendo, y cada navegador lo sintetiza con su propio motor. Una docena de
 * bytes por fotograma, que a treinta por segundo son cuatrocientos bytes por
 * segundo: menos que un icono.
 *
 * Y tiene un efecto que el audio no puede tener: al otro lado no llega un
 * sonido, llega una mano. Se dibuja igual que la de las capas grabadas, con la
 * misma maquinaria, asi que se ve a la otra persona tocar.
 *
 * Lo que NO resuelve, y conviene decirlo: la red tarda. Cada uno se oye a si
 * mismo al instante y al otro con el retraso que haya. En un bucle eso se
 * esconde -el compas da vueltas y se entra en el siguiente- y tocando libre no.
 *
 * El formato es de campo fijo y sin negociacion, como el del enlace y por lo
 * mismo: lo que llega por la red lo puede escribir cualquiera, asi que se lee
 * entero o se tira entero. Un paquete a medio entender no da un error, da una
 * nota en una frecuencia imposible.
 */

/** Lo que una persona esta haciendo en un fotograma, listo para mandar. */
export interface GesturePacket {
  live: LiveSnapshot;
  /** Donde tiene la mano, para dibujarla al otro lado. Opcional. */
  pose: HandPose | null;
}

const GATE_CODES = { attack: 1, release: 2 } as const;
const GATE_NAMES = [null, 'attack', 'release'] as const;

/** Centesimas de semitono en un uint16, igual que en el enlace. */
const PITCH_SCALE = 100;

const HEADER_BYTES = 5;
const POSE_BYTES = 4;
const STRIKE_BYTES = 2;

/** Lo mas que cabe en los cuatro bits del recuento de golpes. */
const MAX_STRIKES = 15;

/**
 * La pinza y el ladeo, repartidos en un byte cada uno.
 *
 * La pinza va de cero a uno y el ladeo de menos uno a uno en radianes. Un byte
 * para cada uno es de sobra para dibujar una mano: el ojo no distingue
 * doscientos cincuenta y seis posiciones de un dedo en pantalla.
 */
const TILT_RANGE = 1;

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

const toByte = (v: number): number => clamp(Math.round(v * 255), 0, 255);

export function encodeGesture(packet: GesturePacket): Uint8Array {
  const { live, pose } = packet;
  const strikes = live.strikes.slice(0, MAX_STRIKES);
  const bytes = new Uint8Array(HEADER_BYTES + (pose ? POSE_BYTES : 0) + strikes.length * STRIKE_BYTES);

  const gate = live.gateEvent ? GATE_CODES[live.gateEvent] : 0;
  bytes[0] = gate | (live.gateOpen ? 1 << 2 : 0) | (pose ? 1 << 3 : 0) | (strikes.length << 4);
  const midi = clamp(Math.round(freqToMidi(live.freq) * PITCH_SCALE), 0, 0xffff);
  bytes[1] = midi >> 8;
  bytes[2] = midi & 0xff;
  bytes[3] = toByte(live.cutoffNorm);
  bytes[4] = toByte(live.gain);

  let at = HEADER_BYTES;
  if (pose) {
    bytes[at++] = toByte(pose.x);
    bytes[at++] = toByte(pose.y);
    bytes[at++] = toByte(pose.pinch);
    // El ladeo va con signo y un byte no lo tiene: se centra en la mitad.
    bytes[at++] = toByte((clamp(pose.tilt, -TILT_RANGE, TILT_RANGE) + TILT_RANGE) / (2 * TILT_RANGE));
  }
  for (const strike of strikes) {
    const piece = ROSTER.indexOf(strike.piece);
    // Una pieza que no existe no se manda a medias: se manda como la primera,
    // que es la unica que seguro existe al otro lado. Con el tipo puesto esto
    // no puede pasar hoy, y sigue aqui porque lo que llega por red no tiene
    // tipo cuando sale de aqui.
    bytes[at++] = ((piece < 0 ? 0 : piece) << 1) | (strike.open ? 1 : 0);
    bytes[at++] = toByte(strike.force);
  }
  return bytes;
}

/**
 * @returns null ante cualquier cosa que no sea exactamente un paquete.
 *
 * Se rechaza entero y no se arregla por dentro, igual que en el enlace: esto
 * llega por una red y lo puede escribir cualquiera. Medio paquete entendido no
 * da un error, da una nota en una frecuencia que nadie ha tocado.
 */
export function decodeGesture(bytes: Uint8Array): GesturePacket | null {
  if (bytes.length < HEADER_BYTES) return null;

  const flags = bytes[0]!;
  const gate = GATE_NAMES[flags & 0b11];
  if (gate === undefined) return null;
  const hasPose = (flags & (1 << 3)) !== 0;
  const strikeCount = flags >> 4;

  const expected = HEADER_BYTES + (hasPose ? POSE_BYTES : 0) + strikeCount * STRIKE_BYTES;
  // Ni un byte de menos ni uno de mas: lo de menos dejaria golpes a medio leer y
  // lo de mas significa que esto no lo escribio esta version.
  if (bytes.length !== expected) return null;

  const midi = ((bytes[1]! << 8) | bytes[2]!) / PITCH_SCALE;
  const live: LiveSnapshot = {
    gateEvent: gate,
    gateOpen: (flags & (1 << 2)) !== 0,
    freq: midiToFreq(midi),
    cutoffNorm: bytes[3]! / 255,
    gain: bytes[4]! / 255,
    strikes: [],
  };

  let at = HEADER_BYTES;
  let pose: HandPose | null = null;
  if (hasPose) {
    pose = {
      x: bytes[at]! / 255,
      y: bytes[at + 1]! / 255,
      pinch: bytes[at + 2]! / 255,
      tilt: (bytes[at + 3]! / 255) * 2 * TILT_RANGE - TILT_RANGE,
    };
    at += POSE_BYTES;
  }

  const strikes: { piece: DrumPiece; force: number; open: boolean }[] = [];
  for (let i = 0; i < strikeCount; i += 1) {
    const piece = ROSTER[bytes[at]! >> 1];
    // Tres bits dan para ocho y hay seis piezas: los dos ultimos no existen.
    if (!piece) return null;
    strikes.push({ piece, open: (bytes[at]! & 1) !== 0, force: bytes[at + 1]! / 255 });
    at += STRIKE_BYTES;
  }
  return { live: { ...live, strikes }, pose };
}
