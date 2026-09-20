import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KIT,
  MAX_LEVEL,
  TUNING_RANGE,
  kitTrim,
  normalizeLayout,
  normalizePieceNumbers,
} from '../src/mapping/kit';
import { DEFAULT_SETTINGS, SettingsStore, normalizePresets } from '../src/state/store';

/**
 * Los ajustes del kit, que son los primeros que no son un numero.
 *
 * Todo lo demas que se guarda entre sesiones es un numero, una cadena o un si o
 * no, y para eso basta con mirar el tipo al recuperarlo. Un reparto de bandas es
 * una lista y una afinacion es un objeto con una entrada por pieza, y ahi
 * "object" es lo que dice typeof de una lista vacia, de un objeto sin ninguna
 * pieza dentro y de uno con un NaN: las tres cosas pasan la misma puerta y
 * ninguna de las tres da un error al llegar. La primera deja una banda golpeando
 * un undefined y la ultima apaga una pieza entera en silencio.
 */

/** Un almacenamiento de mentira, que es lo que no hay en las pruebas. */
function fakeStorage(value: string | null): Storage {
  const data = new Map<string, string>();
  if (value !== null) data.set('theremano.settings.v1', value);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, v: string) => void data.set(key, v),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

function storeWith(persisted: unknown): SettingsStore {
  vi.stubGlobal('localStorage', fakeStorage(JSON.stringify(persisted)));
  // El store agrupa los guardados con un temporizador de la ventana, que aqui no
  // existe. Solo hace falta que se pueda pedir: lo que se guarde da igual.
  vi.stubGlobal('window', { setTimeout: () => 0 });
  return new SettingsStore();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('el reparto de las bandas', () => {
  it('sale siempre con las cuatro piezas, una sola vez cada una', () => {
    const cases: unknown[] = [
      undefined,
      null,
      {},
      'kick,snare',
      [],
      ['hat'],
      ['hat', 'hat', 'hat', 'hat'],
      ['tom', 'cowbell'],
      ['crash', 'hat', 'snare', 'kick', 'kick'],
    ];
    for (const value of cases) {
      const layout = normalizeLayout(value, 4);
      expect(layout, JSON.stringify(value)).toHaveLength(KIT.length);
      expect(new Set(layout), JSON.stringify(value)).toEqual(new Set(KIT));
    }
  });

  it('respeta el sitio de lo que si se reconoce', () => {
    // Lo guardado no se descarta porque venga incompleto: quien movio el plato a
    // la izquierda lo encuentra donde lo dejo, y las que falten se ponen detras.
    expect(normalizeLayout(['crash'], 4)).toEqual(['crash', 'kick', 'snare', 'hat']);
    expect(normalizeLayout(['hat', 'kick'], 4)).toEqual(['hat', 'kick', 'snare', 'crash']);
  });

  it('una permutacion entera pasa tal cual', () => {
    const moved = ['crash', 'hat', 'snare', 'kick'];
    expect(normalizeLayout(moved, 4)).toEqual(moved);
  });
});

describe('la afinacion y el volumen por pieza', () => {
  it('rellenan lo que falte y descartan lo que no sea un numero', () => {
    const tuning = normalizePieceNumbers({ kick: 3, snare: 'alto', hat: null }, 0, -TUNING_RANGE, TUNING_RANGE);
    expect(tuning).toEqual({ kick: 3, snare: 0, tomLow: 0, tomHigh: 0, hat: 0, crash: 0 });
  });

  it('un NaN no se cuela, que es lo que apagaria la pieza sin decir nada', () => {
    const level = normalizePieceNumbers({ kick: NaN, snare: Infinity }, 1, 0, MAX_LEVEL);
    expect(level.kick).toBe(1);
    expect(level.snare).toBe(1);
  });

  it('lo que se sale del rango se recorta, no se tira', () => {
    // Recortar conserva la intencion -queria mas grave- y tirar la pierde.
    const tuning = normalizePieceNumbers({ kick: -99, crash: 99 }, 0, -TUNING_RANGE, TUNING_RANGE);
    expect(tuning.kick).toBe(-TUNING_RANGE);
    expect(tuning.crash).toBe(TUNING_RANGE);
  });

  it('se juntan por pieza para el kit', () => {
    const trim = kitTrim(
      { kick: 2, snare: 0, tomLow: 0, tomHigh: 0, hat: -1, crash: 0 },
      { kick: 1, snare: 0.5, tomLow: 1, tomHigh: 1, hat: 1, crash: 2 },
    );
    expect(trim.kick).toEqual({ tuning: 2, level: 1 });
    expect(trim.snare).toEqual({ tuning: 0, level: 0.5 });
  });

  it('y se sanean de paso, que es lo que llega de unos ajustes a mano', () => {
    // Lo que se recupera del almacenamiento ya viene saneado, pero esto tambien
    // lo llaman unos ajustes armados en una prueba o en un enlace: una entrada
    // que falta llega a la ganancia como un NaN y apaga la pieza sin volver.
    const trim = kitTrim({} as never, { kick: 5 } as never);
    expect(trim.kick).toEqual({ tuning: 0, level: MAX_LEVEL });
    expect(trim.crash).toEqual({ tuning: 0, level: 1 });
  });
});

describe('los ajustes guardados', () => {
  it('un kit a medio escribir se recupera entero', () => {
    const store = storeWith({ drums: true, kitBands: ['hat'], kitTuning: { kick: 'x' }, kitLevel: null });
    const settings = store.get();
    expect(settings.drums).toBe(true);
    expect(new Set(settings.kitBands)).toEqual(new Set(KIT));
    expect(settings.kitTuning).toEqual({ kick: 0, snare: 0, tomLow: 0, tomHigh: 0, hat: 0, crash: 0 });
    expect(settings.kitLevel).toEqual({ kick: 1, snare: 1, tomLow: 1, tomHigh: 1, hat: 1, crash: 1 });
  });

  it('un kit bien guardado se recupera tal cual', () => {
    const bands = ['crash', 'hat', 'snare', 'kick'];
    const store = storeWith({ kitBands: bands, kitTuning: { kick: -4, snare: 2, hat: 0, crash: 0 } });
    expect(store.get().kitBands).toEqual(bands);
    expect(store.get().kitTuning.kick).toBe(-4);
  });

  it('lo que se usa nunca es el mismo objeto que los valores de fabrica', () => {
    /*
     * Los ajustes de fabrica son una constante, y tres de sus valores son un
     * objeto: la lista de bandas y los dos numeros por pieza. Una copia
     * superficial los compartiria con ella, y a partir de ahi cualquiera que
     * escribiera dentro de uno -en vez de poner uno nuevo, que es lo que hace hoy
     * el panel- reescribiria los propios valores de fabrica. No habria a donde
     * volver, ni en esta sesion ni en las siguientes, porque de ahi sale tambien
     * lo que se guarda. Se comprueba la separacion y no el estropicio: el
     * estropicio hace falta provocarlo escribiendo mal, y lo que tiene que ser
     * imposible es que escribir mal llegue tan lejos.
     */
    const store = storeWith({});
    for (const state of [store.get(), (store.reset(), store.get())]) {
      expect(state.kitBands).not.toBe(DEFAULT_SETTINGS.kitBands);
      expect(state.kitTuning).not.toBe(DEFAULT_SETTINGS.kitTuning);
      expect(state.kitLevel).not.toBe(DEFAULT_SETTINGS.kitLevel);
      expect(state.kitBands).toEqual([...KIT]);
    }
  });
});

describe('los timbres de las demas personas', () => {
  it('siempre vienen todos, aunque haya menos gente', () => {
    /*
     * Una lista corta dejaria a la tercera persona con un undefined por timbre,
     * y eso no da un error: da el timbre de fabrica puesto de tapadillo, que es
     * ademas el de otra persona. Dos instrumentos iguales sonando a la vez
     * suenan a uno desafinado.
     */
    expect(normalizePresets(undefined, undefined)).toEqual(DEFAULT_SETTINGS.presetOthers);
    expect(normalizePresets(['bass'], undefined)).toEqual(['bass', ...DEFAULT_SETTINGS.presetOthers.slice(1)]);
    expect(normalizePresets(['bass', 'no existe', 7], undefined)).toEqual([
      'bass',
      ...DEFAULT_SETTINGS.presetOthers.slice(1),
    ]);
    expect(normalizePresets('ni siquiera es una lista', undefined)).toEqual(DEFAULT_SETTINGS.presetOthers);
  });

  it('la migracion llega hasta los ajustes de verdad, no solo hasta la funcion', () => {
    /*
     * Esto empezo roto y no lo dijo ningun test: la funcion recibia la lista ya
     * rellenada con los valores de fabrica, asi que su primer hueco siempre
     * venia ocupado y la clave vieja no se miraba nunca. Sanear bien una cosa
     * que nadie te pasa no sirve de nada, y por eso esto entra por la puerta de
     * verdad -unos ajustes guardados- y no por la funcion a pelo.
     */
    const store = storeWith({ presetTwo: 'flute' });
    expect(store.get().presetOthers[0]).toBe('flute');
    // Y el resto se queda de fabrica, no se arrastra el de la vieja.
    expect(store.get().presetOthers.slice(1)).toEqual(DEFAULT_SETTINGS.presetOthers.slice(1));
  });

  it('y el de cuando solo habia una segunda persona no se pierde', () => {
    /*
     * Hasta que el grupo pudo pasar de dos, ese timbre vivia en su propia clave.
     * Perderle a alguien un ajuste que eligio a mano, en silencio y por un
     * cambio interno, es de las pocas cosas que no se arreglan reiniciando.
     */
    expect(normalizePresets(undefined, 'flute')[0]).toBe('flute');
    // Pero solo cuando no hay nada mas nuevo: lo de la lista manda.
    expect(normalizePresets(['bass'], 'flute')[0]).toBe('bass');
    // Y una clave vieja con basura no le quita el sitio al de fabrica.
    expect(normalizePresets(undefined, 'trompeta')).toEqual(DEFAULT_SETTINGS.presetOthers);
  });
});
