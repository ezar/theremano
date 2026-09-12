import { describe, expect, it } from 'vitest';
import { LOCALES, detectLocale, resolveLocale } from '../src/i18n';
import { PRESETS } from '../src/audio/presets';
import { SCALES } from '../src/mapping/scales';
import { MELODIES } from '../src/mapping/melodies';
import { DRUM_STEPS, STEPS } from '../src/ui/onboarding';

/**
 * El tipo ya obliga a que los dos idiomas tengan las mismas claves, pero no a
 * que esten rellenas ni a que cubran los datos del instrumento. Una cadena vacia
 * compila igual de bien que una traducida, y una escala nueva sin nombre sale en
 * pantalla como "undefined".
 */

const locales = Object.entries(LOCALES);

/** Recorre el diccionario y devuelve todas las hojas de texto con su ruta. */
function leaves(value: unknown, path: string[] = []): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path: path.join('.'), text: value }];
  if (typeof value === 'function') return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, [...path, String(i)]));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
  }
  return [];
}

describe('diccionarios de idioma', () => {
  it.each(locales)('%s no tiene ninguna cadena vacia', (_name, strings) => {
    for (const leaf of leaves(strings)) {
      expect(leaf.text.trim(), leaf.path).not.toBe('');
    }
  });

  it('los dos idiomas tienen exactamente las mismas rutas de texto', () => {
    const [[, first], [, second]] = locales as [[string, object], [string, object]];
    expect(leaves(first).map((l) => l.path)).toEqual(leaves(second).map((l) => l.path));
  });

  it.each(locales)('%s nombra las doce notas', (_name, strings) => {
    expect(strings.notes).toHaveLength(12);
    expect(new Set(strings.notes).size).toBe(12);
  });

  it.each(locales)('%s cubre todas las escalas, timbres, melodias y pasos', (_name, strings) => {
    for (const scale of SCALES) expect(strings.scales[scale.id], scale.id).toBeTruthy();
    for (const preset of PRESETS) expect(strings.presets[preset.id], preset.id).toBeTruthy();
    for (const melody of MELODIES) {
      expect(strings.melodies[melody.id]?.name, melody.id).toBeTruthy();
      expect(strings.melodies[melody.id]?.hint, melody.id).toBeTruthy();
    }
    // Los dos recorridos, no solo el de la melodia: un paso de bateria sin texto
    // sale en pantalla como un cuadro vacio esperando un gesto que nadie ha
    // pedido, y el compilador no puede cazarlo porque las claves son libres.
    for (const step of [...STEPS, ...DRUM_STEPS]) {
      expect(strings.coach.steps[step.id]?.title, step.id).toBeTruthy();
      expect(strings.coach.steps[step.id]?.body, step.id).toBeTruthy();
    }
  });

  it('el espanol lleva las tildes y las enes que le tocan', () => {
    // La primera version se escribio entera sin acentos. Esta prueba existe para
    // que no vuelva a colarse: si estas palabras aparecen sin tilde, algo se ha
    // reescrito a mano y mal.
    const text = leaves(LOCALES.es).map((l) => l.text).join(' ');
    expect(text).toContain('melodía');
    expect(text).toContain('cámara');
    expect(text).toContain('puño');
    expect(text).toContain('índice');
    expect(text).not.toMatch(/\bcamara\b/);
    expect(text).not.toMatch(/\bmelodia\b/);
    expect(text).not.toMatch(/\bpuno\b/);
  });

  it('resuelve la preferencia automatica a un idioma soportado', () => {
    expect(['es', 'en']).toContain(detectLocale());
    expect(resolveLocale('auto')).toBe(detectLocale());
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('es')).toBe('es');
  });

  it('un idioma guardado que no existe no impide arrancar', () => {
    // El almacenamiento local es entrada externa: un valor de otra version, o
    // escrito a mano, llega hasta aqui. Sin normalizar dejaba el diccionario en
    // undefined y la aplicacion no llegaba a pintarse.
    for (const raro of ['fr', '', 'ES', 'es-AR', 'null', '../../etc']) {
      const resolved = resolveLocale(raro);
      expect(['es', 'en'], raro).toContain(resolved);
      expect(LOCALES[resolved], raro).toBeDefined();
    }
  });
});
