import { en } from './en';
import { es } from './es';
import type { Locale, Strings } from './strings';

export type { Locale, Strings } from './strings';

/**
 * Idioma activo y notificacion de cambios.
 *
 * El idioma no se guarda como parte de los ajustes normales sino como una
 * preferencia con un tercer valor, "auto", que sigue al navegador. Guardar solo
 * "es" o "en" obligaria a elegir en la primera visita a quien no le importa, y
 * dejaria congelada esa eleccion en un dispositivo que luego cambia de idioma.
 */

export const LOCALES: Record<Locale, Strings> = { es, en };

export type LocalePreference = Locale | 'auto';

/** Idioma del navegador, con el espanol como respaldo. */
export function detectLocale(): Locale {
  const candidates = typeof navigator !== 'undefined' ? [navigator.language, ...(navigator.languages ?? [])] : [];
  for (const tag of candidates) {
    const base = tag?.toLowerCase().split('-')[0];
    if (base === 'es' || base === 'en') return base;
  }
  return 'es';
}

export function resolveLocale(preference: LocalePreference): Locale {
  return preference === 'auto' ? detectLocale() : preference;
}

type Listener = (strings: Strings, locale: Locale) => void;

class I18n {
  private locale: Locale = 'es';
  private readonly listeners = new Set<Listener>();

  get current(): Locale {
    return this.locale;
  }

  get t(): Strings {
    return LOCALES[this.locale];
  }

  set(preference: LocalePreference): void {
    const next = resolveLocale(preference);
    if (next === this.locale) return;
    this.locale = next;
    document.documentElement.lang = this.t.htmlLang;
    for (const listener of this.listeners) listener(this.t, this.locale);
  }

  /** Se aplica sin notificar: para el arranque, antes de construir nada. */
  init(preference: LocalePreference): void {
    this.locale = resolveLocale(preference);
    document.documentElement.lang = this.t.htmlLang;
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }
}

export const i18n = new I18n();

/** Atajo para leer el diccionario activo en el punto de uso. */
export function t(): Strings {
  return i18n.t;
}
