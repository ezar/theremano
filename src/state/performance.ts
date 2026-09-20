import { PRESETS, type PresetId } from '../audio/presets';
import type { DrumHitEvent, LoopEvent } from '../audio/loopTake';
import { MAX_CYCLE_SECONDS, MAX_TRACKS, MIN_CYCLE_SECONDS } from '../audio/loopTake';
import { KIT, MAX_LEVEL, MAX_PIECES, MIN_PIECES, ROSTER, TUNING_RANGE, type DrumPiece } from '../mapping/kit';

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
  /** Golpes, si la capa es de bateria. */
  hits?: DrumHitEvent[];
  drums?: boolean;
}

/**
 * El kit con el que se toco un ritmo.
 *
 * Viaja porque sin el, un ritmo compartido suena con las piezas de fabrica y no
 * con las que se tocaron: quien afino el bombo dos semitonos abajo y bajo el
 * charles a la mitad manda un enlace que no es lo que hizo. Y es peor que un
 * detalle de timbre, porque el reparto de bandas cambia DONDE hay que golpear:
 * con el plato movido a la izquierda, el enlace ensena un ritmo y las manos del
 * fantasma senalan otro sitio.
 */
export interface PerformanceKit {
  bands: DrumPiece[];
  tuning: Record<DrumPiece, number>;
  level: Record<DrumPiece, number>;
}

export interface Performance {
  cycleSeconds: number;
  tracks: PerformanceTrack[];
  /** Solo si hay alguna capa de bateria. En melodia no significa nada. */
  kit?: PerformanceKit;
}

/**
 * Version 1: el kit son cuatro piezas, dos bits por golpe.
 *
 * Version 2: el kit puede tener hasta seis, asi que el golpe necesita tres bits
 * de pieza y le quita uno al tiempo. Se escribe la 2 SOLO cuando hace falta -un
 * ritmo con las cuatro de siempre sigue saliendo en version 1, byte por byte
 * igual que antes-, y ahi esta lo que lo hace seguro: los enlaces que ya
 * existen se siguen leyendo en cualquier copia de la pagina, y uno con toms lo
 * rechaza entera una copia vieja, que no tiene esas piezas. Rechazar en bloque
 * es lo mismo que se hace con todo lo demas de aqui, y es lo correcto: media
 * bateria reconstruida con las piezas cambiadas sonaria a otro ritmo.
 */
const VERSION = 1;
const VERSION_WIDE_KIT = 2;

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

/**
 * Un golpe cabe en tres bytes: trece bits de tiempo, uno de charles abierto, dos
 * de pieza y ocho de fuerza. Dos bits dan para cuatro piezas, que es exactamente
 * el kit.
 */
const BYTES_PER_HIT = 3;

/**
 * El bit del charles abierto, robado al campo de tiempo.
 *
 * Ese campo tenia catorce bits -163 segundos- para un ciclo que no pasa de
 * veinte, asi que le sobraban tres. Quitarle uno lo deja en 81 segundos, sigue
 * cuadruplicando el maximo, y a cambio el golpe sigue pesando tres bytes.
 *
 * Lo importante es que asi no se rompe nada de lo ya escrito: un enlace anterior
 * lleva ahi un cero -ningun tiempo valido llega a ese bit-, de modo que se lee
 * como charles cerrado, que es lo unico que existia entonces. No hace falta
 * subir la version ni marcar la capa de otra forma.
 *
 * Al reves no, y no puede serlo: una copia vieja de la pagina que reciba un
 * enlace con un charles abierto lee ese bit como tiempo, le salen ochenta
 * segundos, y rechaza la interpretacion entera -capas de melodia incluidas-. Es
 * inherente a validar en bloque, que es lo que se decidio para no reconstruir
 * medio bucle de un enlace roto; y falla como debe, diciendo que el enlace trae
 * algo que no puede reproducir, en vez de sonando mal.
 */
const OPEN_HAT_BIT = 1 << 13;
const MAX_HIT_TIME_UNITS = 0x1fff;

/**
 * Lo mismo con una pieza mas ancha, para los kits de mas de cuatro.
 *
 * Tres bits de pieza dan para ocho, que es mas de las que hay. El bit sale del
 * tiempo, que se queda en doce: 40,95 segundos, que sigue doblando el ciclo
 * maximo de veinte. El del charles abierto se corre un sitio.
 */
const WIDE_PIECE_SHIFT = 13;
const WIDE_OPEN_HAT_BIT = 1 << 12;
const MAX_WIDE_HIT_TIME_UNITS = 0xfff;

/**
 * Marca de capa de bateria en el byte donde una capa de melodia lleva su timbre.
 *
 * Se elige un valor que no puede ser un indice de timbre en vez de subir la
 * version del formato, y la diferencia importa: subir la version dejaria
 * ilegibles tambien los enlaces de melodia nuevos para quien tenga una copia
 * vieja de la pagina en cache. Asi los de melodia siguen viajando igual, y una
 * copia vieja que reciba uno con bateria lo rechaza entero -no hay indice de
 * timbre 255- y dice que el enlace trae algo que no puede reproducir, que es la
 * verdad y no media vuelta sonando mal.
 */
const DRUM_MARK = 0xff;
const KIND_CODES = { attack: 0, release: 1, param: 2 } as const;
const KIND_NAMES = ['attack', 'release', 'param'] as const;

/** Centisegundos. El campo de tiempo son 14 bits: 163,83 s de techo. */
const TIME_SCALE = 100;
const MAX_TIME_UNITS = 0x3fff;

/** Centesimas de semitono. Un midi de 127 son 12700, dentro de un uint16. */
const PITCH_SCALE = 100;

/**
 * El kit, detras de las capas: dos bytes de reparto y cuatro de cada ajuste.
 *
 * Va al final y solo cuando hay bateria, y ahi esta lo que lo hace gratis: un
 * enlace con bateria ya es ilegible para una copia vieja de la pagina -no hay
 * timbre numero 255-, asi que anadirle bytes no rompe nada que hoy funcione. Un
 * enlace de melodia, en cambio, sale byte por byte igual que antes y se sigue
 * leyendo en cualquier copia.
 *
 * No lleva marca ni bandera: si alguna capa es de bateria, el bloque esta; si no,
 * no. Una bandera seria un estado mas que validar por nada.
 */
function kitBlockBytes(pieces: number): number {
  // Un byte cada dos bandas -dos piezas por byte- y uno por pieza para cada uno
  // de los dos ajustes. Con un numero impar de piezas, la ultima media banda se
  // queda a cero y se lee como tal.
  return Math.ceil(pieces / 2) + pieces * 2;
}

/** El volumen por pieza va de 0 a MAX_LEVEL repartido en un byte. */
const LEVEL_SCALE = 255 / MAX_LEVEL;

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
  const usable = performance.tracks
    .filter((track) => (track.drums ? (track.hits?.length ?? 0) > 0 : track.events.length > 0))
    .slice(0, MAX_TRACKS);
  if (usable.length === 0) return null;
  if (!(performance.cycleSeconds > 0)) return null;

  for (let count = usable.length; count >= 1; count -= 1) {
    for (const paramHz of PARAM_RATES) {
      const bytes = write(
        { cycleSeconds: performance.cycleSeconds, tracks: usable.slice(0, count), kit: performance.kit },
        paramHz,
      );
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
  const version = bytes[at++];
  if (version !== VERSION && version !== VERSION_WIDE_KIT) return null;
  const wide = version === VERSION_WIDE_KIT;

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
    const mark = bytes[at++] ?? -1;
    const drums = mark === DRUM_MARK;
    const preset = drums ? PRESETS[0] : PRESETS[mark];
    if (!preset) return null;
    const eventCount = readUint16(bytes, at);
    at += 2;

    if (drums) {
      if (eventCount === 0 || at + eventCount * BYTES_PER_HIT > bytes.length) return null;
      const hits: DrumHitEvent[] = [];
      let last = -1;
      for (let h = 0; h < eventCount; h += 1) {
        const packed = readUint16(bytes, at);
        // En version 1 la pieza son dos bits sobre las cuatro de siempre; en la
        // 2, tres bits sobre todas las que existen. Es la unica diferencia entre
        // las dos, y la razon por la que hay dos.
        const piece = wide ? ROSTER[packed >> WIDE_PIECE_SHIFT] : KIT[packed >> 14];
        // Tres bits dan para ocho y hay seis piezas, asi que los dos ultimos
        // valores no existen: un enlace manipulado traeria un undefined
        // golpeando, y con cuatro piezas pasaria lo mismo el dia que sean tres.
        if (!piece) return null;
        const t = (packed & (wide ? MAX_WIDE_HIT_TIME_UNITS : MAX_HIT_TIME_UNITS)) / TIME_SCALE;
        if (t > cycleSeconds + 0.5) return null;
        // En orden, por el mismo motivo que en melodia: el reproductor programa
        // por instante y no por posicion en la lista.
        if (t < last) return null;
        last = t;
        hits.push({
          t,
          piece,
          force: (bytes[at + 2] ?? 0) / 255,
          open: (packed & (wide ? WIDE_OPEN_HAT_BIT : OPEN_HAT_BIT)) !== 0,
        });
        at += BYTES_PER_HIT;
      }
      // Sin notas enteras que exigir: un golpe no deja nada abierto. Con que
      // haya uno, la capa suena.
      tracks.push({ presetId: preset.id, events: [], hits, drums: true });
      continue;
    }
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

  /*
   * El kit, si alguna capa es de bateria. Sin bandera: esta o no esta segun lo
   * que haya en las capas, que es algo que ya se sabe aqui.
   *
   * Un enlace de bateria escrito antes de que esto existiera no lo trae, y se
   * distingue sin ambiguedad porque ahi se acaban los bytes. Ese suena con el
   * kit de quien lo abre, que es exactamente lo que hacian todos hasta ahora.
   */
  let kit: PerformanceKit | undefined;
  if (tracks.some((track) => track.drums) && at < bytes.length) {
    const read = readKit(bytes, at, wide);
    if (!read) return null;
    kit = read.kit;
    at += read.bytes;
  }

  // Bytes de sobra significan que esto no lo escribio esta version. Antes que
  // adivinar, se rechaza.
  if (at !== bytes.length) return null;
  return kit ? { cycleSeconds, tracks, kit } : { cycleSeconds, tracks };
}

/**
 * El kit de un enlace, o null si no es exactamente un kit.
 *
 * Se valida entero y se rechaza en bloque, como todo lo demas de aqui: un
 * reparto con una pieza repetida deja una banda golpeando un undefined, y un
 * volumen fuera de rango puede apagar una pieza para siempre o reventar el
 * limitador. Recortar en silencio seria reproducir un kit que nadie toco.
 */
function readKit(bytes: Uint8Array, at: number, wide: boolean): { kit: PerformanceKit; bytes: number } | null {
  /*
   * En version 1 el kit son cuatro y no hace falta decirlo. En la 2 el bloque
   * empieza por cuantas piezas trae, que es un byte y quita toda ambiguedad:
   * deducirlo de lo que sobra al final obligaria a adivinar, que es justo lo
   * que no se hace en ninguna otra parte de este formato.
   */
  let cursor = at;
  const pieces = wide ? (bytes[cursor++] ?? 0) : KIT.length;
  if (pieces < MIN_PIECES || pieces > MAX_PIECES) return null;
  const size = (wide ? 1 : 0) + kitBlockBytes(pieces);
  if (at + size > bytes.length) return null;

  // De donde salen las piezas: en version 1 solo pueden ser las cuatro de
  // siempre, y en la 2 cualquiera de las que existen.
  const catalogue = wide ? ROSTER : KIT;
  const bands: DrumPiece[] = [];
  for (let byte = 0; byte < Math.ceil(pieces / 2); byte += 1) {
    const packed = bytes[cursor + byte] ?? 0;
    for (const index of [packed >> 4, packed & 0x0f]) {
      // Con un numero impar de piezas, la ultima media banda no es una banda:
      // se escribio a cero y aqui sobra.
      if (bands.length >= pieces) break;
      const piece = catalogue[index];
      // Cada pieza una vez y todas: es lo que hace que sea un reparto y no una
      // lista de piezas. Con una repetida, otra se queda sin banda.
      if (!piece || bands.includes(piece)) return null;
      bands.push(piece);
    }
  }
  if (bands.length !== pieces) return null;
  cursor += Math.ceil(pieces / 2);

  /*
   * La afinacion y el volumen van en el orden de las bandas y no en el de las
   * piezas que existen: asi el bloque se lee sin saber nada de como esta
   * ordenado el catalogo, que es lo que lo deja a salvo si algun dia se anade
   * una pieza mas en medio.
   */
  const tuning = {} as Record<DrumPiece, number>;
  const level = {} as Record<DrumPiece, number>;
  for (const piece of bands) {
    const raw = (bytes[cursor++] ?? 0) - TUNING_RANGE;
    if (raw < -TUNING_RANGE || raw > TUNING_RANGE) return null;
    tuning[piece] = raw;
  }
  for (const piece of bands) {
    level[piece] = (bytes[cursor++] ?? 0) / LEVEL_SCALE;
  }
  // Las que no estan en el escenario se quedan como vienen de fabrica: el
  // enlace no dice nada de ellas porque no sonaron.
  for (const piece of ROSTER) {
    if (tuning[piece] === undefined) tuning[piece] = 0;
    if (level[piece] === undefined) level[piece] = 1;
  }
  return { kit: { bands, tuning, level }, bytes: size };
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
  // Los golpes no se remuestrean: no son instantaneas de un parametro que se
  // pueda estirar en rampas, son eventos. Quitar uno es quitar un golpe.
  const thinned = performance.tracks.map((track) =>
    track.drums ? track : { ...track, events: thin(track.events, paramHz) },
  );
  const kit = thinned.some((track) => track.drums) ? performance.kit : undefined;
  /*
   * La version la decide lo que hay que escribir, no una preferencia.
   *
   * Un ritmo con las cuatro piezas de siempre sale en version 1, byte por byte
   * igual que antes de que los toms existieran, y lo sigue leyendo cualquier
   * copia de la pagina. Solo cuando hay una pieza que en la 1 no cabe -o un kit
   * de mas de cuatro bandas- se sube a la 2, que una copia vieja rechaza entera
   * en vez de reconstruir un ritmo con las piezas cambiadas.
   */
  const wide =
    (kit !== undefined && kit.bands.length > KIT.length) ||
    thinned.some((track) => (track.hits ?? []).some((hit) => !KIT.includes(hit.piece)));
  const pieces = kit ? kit.bands.length : KIT.length;
  const total = thinned.reduce(
    (sum, track) =>
      sum + 3 + (track.drums ? (track.hits?.length ?? 0) * BYTES_PER_HIT : track.events.length * BYTES_PER_EVENT),
    4 + (kit ? (wide ? 1 : 0) + kitBlockBytes(pieces) : 0),
  );
  const bytes = new Uint8Array(total);

  let at = 0;
  bytes[at++] = wide ? VERSION_WIDE_KIT : VERSION;
  writeUint16(bytes, at, Math.round(performance.cycleSeconds * TIME_SCALE));
  at += 2;
  bytes[at++] = thinned.length;

  for (const track of thinned) {
    if (track.drums) {
      const hits = track.hits ?? [];
      bytes[at++] = DRUM_MARK;
      writeUint16(bytes, at, hits.length);
      at += 2;
      for (const hit of hits) {
        const ceiling = wide ? MAX_WIDE_HIT_TIME_UNITS : MAX_HIT_TIME_UNITS;
        const units = Math.min(ceiling, Math.max(0, Math.round(hit.t * TIME_SCALE)));
        const piece = (wide ? ROSTER : KIT).indexOf(hit.piece);
        // Como con un timbre que no existe: se rechaza el enlace entero en vez
        // de escribir otra pieza en su sitio. Con la version elegida por lo que
        // hay dentro esto no deberia poder pasar, y sigue aqui porque compartir
        // un ritmo con los golpes cambiados de sitio es peor que no compartir.
        if (piece < 0) return null;
        const shift = wide ? WIDE_PIECE_SHIFT : 14;
        const openBit = wide ? WIDE_OPEN_HAT_BIT : OPEN_HAT_BIT;
        writeUint16(bytes, at, (piece << shift) | (hit.open ? openBit : 0) | units);
        bytes[at + 2] = clampInt(Math.round(hit.force * 255), 0, 255);
        at += BYTES_PER_HIT;
      }
      continue;
    }
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

  if (kit) {
    // Cuantas piezas trae, que en version 1 no hace falta porque son cuatro.
    if (wide) bytes[at++] = pieces;
    const catalogue = wide ? ROSTER : KIT;
    // El reparto, dos piezas por byte: cuatro bits sobran para un indice de
    // seis. Y se escribe el indice y no el nombre, que en una direccion cada
    // byte se paga. Con un numero impar, la ultima media banda se queda a cero.
    for (let band = 0; band < pieces; band += 2) {
      const high = catalogue.indexOf(kit.bands[band] as DrumPiece);
      const low = band + 1 < pieces ? catalogue.indexOf(kit.bands[band + 1] as DrumPiece) : 0;
      // Igual que con una pieza que no existe al escribir un golpe: antes no
      // compartir nada que compartir un kit con una banda vacia.
      if (high < 0 || low < 0) return null;
      bytes[at++] = (high << 4) | low;
    }
    // En el orden de las bandas, que es como se leen: asi el bloque no depende
    // de como este ordenado el catalogo.
    for (const piece of kit.bands) {
      // La afinacion va con signo, y un byte no lo tiene: se le suma el tope
      // para dejarla en positivo y se le resta al leerla.
      bytes[at++] = clampInt(Math.round(kit.tuning[piece] ?? 0) + TUNING_RANGE, 0, 2 * TUNING_RANGE);
    }
    for (const piece of kit.bands) {
      bytes[at++] = clampInt(Math.round((kit.level[piece] ?? 1) * LEVEL_SCALE), 0, 255);
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
