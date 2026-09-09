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

export function shareUrl(settings: Readonly<Settings>): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${encodeSettings(settings)}`;
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

  const tonic = Number(params.get('t'));
  if (Number.isInteger(tonic) && tonic >= 0 && tonic <= 11) out.tonicPc = tonic;

  const octave = Number(params.get('o'));
  if (Number.isInteger(octave) && octave >= 1 && octave <= 5) out.baseOctave = octave;

  const range = Number(params.get('r'));
  if (Number.isInteger(range) && range >= 1 && range <= 4) out.octaves = range;

  return out;
}

export function hasShareableKeys(patch: Partial<ShareableSettings>): boolean {
  return KEYS.some((key) => patch[key] !== undefined);
}
