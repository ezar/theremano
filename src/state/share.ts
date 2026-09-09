import { PRESETS, type PresetId } from '../audio/presets';
import { SCALES, type ScaleId } from '../mapping/scales';
import type { Settings } from './store';

/**
 * Configuracion en la direccion.
 *
 * Sirve para que "prueba esto con blues en Mi" sea un enlace en vez de una
 * explicacion. Va en el fragmento y no en la consulta para que no llegue nunca
 * al servidor, y porque asi GitHub Pages y Vercel lo sirven igual.
 */

export interface ShareableSettings {
  scale: ScaleId;
  tonicPc: number;
  baseOctave: number;
  octaves: number;
  preset: PresetId;
}

const KEYS: Array<keyof ShareableSettings> = ['scale', 'tonicPc', 'baseOctave', 'octaves', 'preset'];

export function encodeSettings(settings: Readonly<Settings>): string {
  const params = new URLSearchParams();
  params.set('e', settings.scale);
  params.set('t', String(settings.tonicPc));
  params.set('o', String(settings.baseOctave));
  params.set('r', String(settings.octaves));
  params.set('v', settings.preset);
  return params.toString();
}

/**
 * @param performance interpretacion codificada, o null para un enlace de solo
 * ajustes. Va en el mismo fragmento y detras de todo lo demas: si algo recorta
 * el enlace por largo, lo que se pierde es la interpretacion y no la escala.
 */
export function shareUrl(settings: Readonly<Settings>, performance: string | null = null): string {
  const { origin, pathname } = window.location;
  const params = encodeSettings(settings);
  return `${origin}${pathname}#${performance ? `${params}&p=${performance}` : params}`;
}

/**
 * La interpretacion tal cual viene, sin decodificar.
 *
 * Se devuelve en crudo a proposito: este modulo sabe de ajustes, y quien sepa
 * del formato de la interpretacion es quien tiene que validarla.
 */
export function readPerformanceParam(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const value = new URLSearchParams(raw).get('p');
  return value && value.length > 0 ? value : null;
}

/**
 * Lee el fragmento. Devuelve solo lo que reconoce: un enlace manipulado o de una
 * version anterior no debe impedir que la aplicacion arranque.
 */
export function decodeSettings(hash: string): Partial<ShareableSettings> {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const out: Partial<ShareableSettings> = {};

  const scale = params.get('e');
  if (scale && SCALES.some((s) => s.id === scale)) out.scale = scale as ScaleId;

  const preset = params.get('v');
  if (preset && PRESETS.some((p) => p.id === preset)) out.preset = preset as PresetId;

  // Hay que comprobar que el parametro existe antes de convertirlo: Number(null)
  // vale 0, y 0 es una tonica perfectamente valida. Sin esto, cualquier ancla de
  // la pagina ("#seccion-2") acabaria fijando la tonica en Do y guardandola.
  const tonic = readInt(params, 't', 0, 11);
  if (tonic !== null) out.tonicPc = tonic;

  const octave = readInt(params, 'o', 1, 5);
  if (octave !== null) out.baseOctave = octave;

  const range = readInt(params, 'r', 1, 4);
  if (range !== null) out.octaves = range;

  return out;
}

function readInt(params: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function hasShareableKeys(patch: Partial<ShareableSettings>): boolean {
  return KEYS.some((key) => patch[key] !== undefined);
}
