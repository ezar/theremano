import { describe, expect, it } from 'vitest';
import { decodeSettings, encodeSettings, hasShareableKeys } from '../src/state/share';
import { DEFAULT_SETTINGS } from '../src/state/store';

/**
 * El enlace con la configuracion es una entrada publica: cualquiera puede
 * escribir lo que quiera en el fragmento. Lo que se comprueba aqui es que un
 * enlace roto nunca impida arrancar.
 */

describe('configuracion en el enlace', () => {
  it('lo que se codifica se vuelve a leer igual', () => {
    const settings = { ...DEFAULT_SETTINGS, scale: 'blues' as const, tonicPc: 4, baseOctave: 2, octaves: 3, preset: 'bass' as const };
    expect(decodeSettings(`#${encodeSettings(settings)}`)).toEqual({
      scale: 'blues',
      tonicPc: 4,
      baseOctave: 2,
      octaves: 3,
      preset: 'bass',
      drums: false,
    });
  });

  it('el enlace dice con que se tocaba, y lo dice en los dos sentidos', () => {
    /*
     * Los dos, y no solo el encendido. Decir solo "esto es bateria" deja el
     * fallo al reves: quien esta golpeando recibe un enlace de melodia, se le
     * aplican la escala y el timbre, y se queda golpeando con una portada que
     * promete otra cosa.
     */
    const bateria = decodeSettings(`#${encodeSettings({ ...DEFAULT_SETTINGS, drums: true })}`);
    expect(bateria.drums).toBe(true);
    const melodia = decodeSettings(`#${encodeSettings({ ...DEFAULT_SETTINGS, drums: false })}`);
    expect(melodia.drums).toBe(false);
  });

  it('un enlace de antes de que existiera el modo no lo toca', () => {
    // Ausente no es cero: esos enlaces no dicen nada del modo, y apagarle la
    // bateria a quien los abre seria inventarse lo que no traen.
    const viejo = decodeSettings('#e=blues&t=4&o=2&r=3&v=bass');
    expect('drums' in viejo, 'no dice nada del modo').toBe(false);
    expect(viejo.scale, 'y lo demas se lee igual que siempre').toBe('blues');
  });

  it('acepta el fragmento con y sin almohadilla', () => {
    const encoded = encodeSettings(DEFAULT_SETTINGS);
    expect(decodeSettings(encoded)).toEqual(decodeSettings(`#${encoded}`));
  });

  it('descarta valores que no reconoce en lugar de romperse', () => {
    expect(decodeSettings('#e=reggaeton&v=gaita&t=99&o=-4&r=0')).toEqual({});
    expect(decodeSettings('#t=abc')).toEqual({});
    expect(decodeSettings('#t=3.5')).toEqual({});
    expect(decodeSettings('')).toEqual({});
    expect(decodeSettings('#')).toEqual({});
  });

  it('se queda con lo valido aunque el resto sea basura', () => {
    expect(decodeSettings('#e=major&t=200&basura=1')).toEqual({ scale: 'major' });
  });

  it('no inventa una tonica cuando el enlace no la trae', () => {
    // Number(null) vale 0, y 0 es una tonica valida. Sin comprobar que el
    // parametro existe, cualquier ancla de la pagina fijaria la tonica en Do.
    expect(decodeSettings('#e=major')).toEqual({ scale: 'major' });
    expect(decodeSettings('#seccion-2')).toEqual({});
    expect(decodeSettings('#t=')).toEqual({});
    expect(decodeSettings('#t=0')).toEqual({ tonicPc: 0 });
  });

  it('sabe si un enlace traia algo que aplicar', () => {
    expect(hasShareableKeys({})).toBe(false);
    expect(hasShareableKeys({ scale: 'blues' })).toBe(true);
    expect(hasShareableKeys({ tonicPc: 0 })).toBe(true);
  });
});
