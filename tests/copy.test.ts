import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guarda contra el texto visible que se queda escrito en el codigo.
 *
 * Existe por un fallo concreto: al traducir la interfaz una etiqueta se quedo en
 * castellano porque la sustitucion no llego a aplicarse y nadie lo comprobo. El
 * tipo de los diccionarios no ayuda ahi, porque una cadena escrita directamente
 * en un componente compila perfectamente.
 *
 * Se mira el lado derecho de cada asignacion a algo que se ve, no solo lo que
 * viene pegado al igual: la primera version de esta prueba buscaba el literal
 * justo detras del "=" y se le escapaba el caso que la motivo, que estaba dentro
 * de un ternario.
 *
 * Los mensajes de Error quedan fuera a proposito: van a la consola, los lee
 * quien programa, y traducirlos no ayuda a nadie.
 */

const SOURCE = new URL('../src', import.meta.url).pathname;

/** Puede llevar texto escrito sin ser una traduccion pendiente. */
const ALLOWED = new Set(['theremano', '--']);

/** Cada patron captura la expresion que acaba delante de alguien. */
const SINKS = [
  /\.textContent\s*=([^\n]*)/g,
  /\.(?:title|placeholder)\s*=([^\n]*)/g,
  /setAttribute\(\s*'[^']*'\s*,([^\n]*)/g,
  /fillText\(([^\n]*)/g,
  /new Option\(([^\n]*)/g,
  /\btoast\(([^\n]*)/g,
  /setStatus\(([^\n]*)/g,
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'i18n' ? [] : sources(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** Palabras sueltas escritas a mano dentro de una expresion visible. */
function hardcoded(expression: string): string[] {
  return [...expression.matchAll(/'([^']*)'/g)]
    .map((m) => m[1] ?? '')
    // Dos letras seguidas es la senal de que hay una palabra, y no una clase de
    // CSS, un separador o un simbolo.
    .filter((text) => /\p{L}\p{L}/u.test(text) && !ALLOWED.has(text));
}

describe('texto visible', () => {
  it('no hay cadenas escritas fuera de los diccionarios', () => {
    const offenders: string[] = [];
    for (const file of sources(SOURCE)) {
      const code = readFileSync(file, 'utf8');
      for (const sink of SINKS) {
        for (const match of code.matchAll(sink)) {
          for (const text of hardcoded(match[1] ?? '')) {
            offenders.push(`${file.replace(SOURCE, 'src')}: ${JSON.stringify(text)}`);
          }
        }
      }
    }
    expect(offenders, 'debe salir del diccionario, no del codigo').toEqual([]);
  });
});
