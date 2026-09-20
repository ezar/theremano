import { PRESETS, type PresetId } from '../audio/presets';
import { MAX_PLAYERS, MIN_PLAYERS, isDuoMode, playerCount } from '../tracking/duo';
import { isEchoKind } from '../audio/echo';
import { MELODIES, type MelodyKind } from '../mapping/melodies';
import { SCALES, type ScaleId } from '../mapping/scales';
import { MAX_LEVEL, MAX_PIECES, MIN_PIECES, TUNING_RANGE, growLayout, type DrumPiece } from '../mapping/kit';
import { i18n, t } from '../i18n';
import type { Settings, SettingsStore, StageMode } from '../state/store';
import type { CameraInfo } from '../camera/stream';
import type { ClipAspect } from '../capture/recorder';

/**
 * Panel de ajustes con controles nativos.
 *
 * No hay framework a proposito: son quince campos que leen y escriben en el
 * store. El unico detalle que importa es que el panel escucha al store, porque
 * el timbre tambien lo cambia la mano de expresion y el selector tiene que
 * reflejarlo sin que nadie lo toque.
 */

interface ControlsDeps {
  store: SettingsStore;
  onCameraChange: (deviceId: string | null) => void;
  onRequestClose: () => void;
  onShareLink: () => void;
  onSharePerformance: () => void;
  onMelodyChange: (id: string) => void;
  onLocaleChange: (preference: string) => void;
  localePreference: () => string;
  /** Tocar con otro dispositivo: invitar, unirse y cerrar el trato. */
  onInvite: () => Promise<string | null>;
  onJoin: (code: string) => Promise<string | null>;
  onAccept: (code: string) => Promise<boolean>;
  onDisconnect: () => void;
}

type Binder = (settings: Readonly<Settings>) => void;

interface SelectOption {
  value: string;
  label: string;
}

/** Bloque con encabezado dentro de un desplegable. */
interface SelectGroup {
  group: string;
  options: readonly SelectOption[];
}

export class Controls {
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly binders: Binder[] = [];
  private cameraSelect: HTMLSelectElement | null = null;
  /**
   * La lista de camaras la trae la aplicacion una sola vez, al arrancar. Sin
   * recordarla aqui, reconstruir el panel al cambiar de idioma dejaba el
   * selector de dispositivo vacio hasta la siguiente recarga.
   */
  private cameras: readonly CameraInfo[] = [];
  private activeCameraId: string | null = null;
  private open = false;

  constructor(private readonly deps: ControlsDeps) {
    const panel = document.getElementById('settings-panel');
    const toggle = document.getElementById('settings-toggle');
    if (!panel || !toggle) throw new Error('Falta el panel de ajustes en el documento');
    this.panel = panel;
    this.toggle = toggle as HTMLButtonElement;

    this.build();
    this.toggle.addEventListener('click', () => this.setOpen(!this.open));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) this.setOpen(false);
    });

    // Por refresh() y no llamando a los enlaces directamente: ahi dentro hay ya
    // dos cosas que hacer con los ajustes -poner cada control en su valor y
    // esconder lo que no vale en bateria- y saltarse una de ellas es lo que
    // dejaba el panel entero de melodia puesto con la bateria encendida.
    this.deps.store.subscribe(() => this.refresh());
    // Cambiar de idioma reconstruye el panel entero. Es un puñado de nodos y
    // ocurre una vez cada muchos minutos: no compensa mantener una referencia
    // por etiqueta solo para reescribir su texto.
    i18n.subscribe(() => {
      this.binders.length = 0;
      this.build();
      this.setCameras(this.cameras, this.activeCameraId);
      this.refresh();
      this.toggle.textContent = this.open ? t().actions.close : t().actions.settings;
      this.toggle.setAttribute('aria-label', t().actions.settings);
    });
    this.refresh();
  }

  reveal(): void {
    this.toggle.classList.remove('hidden');
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.toggle.textContent = open ? t().actions.close : t().actions.settings;
    if (open) this.refresh();
  }

  setCameras(cameras: readonly CameraInfo[], activeId: string | null): void {
    this.cameras = cameras;
    this.activeCameraId = activeId;
    const select = this.cameraSelect;
    if (!select) return;
    select.replaceChildren();
    if (cameras.length === 0) {
      select.append(new Option(t().settings.defaultCamera, ''));
      select.disabled = true;
      return;
    }
    select.disabled = cameras.length < 2;
    for (const camera of cameras) select.append(new Option(camera.label, camera.deviceId));
    if (activeId && cameras.some((c) => c.deviceId === activeId)) select.value = activeId;
  }

  private melodyOnly: HTMLElement[] = [];
  private drumOnly: HTMLElement[] = [];
  /**
   * Lo que solo vale a partir de cierta cantidad de gente, con cuanta hace falta.
   *
   * El numero es la razon de que esto no sea una lista pelada: el timbre de la
   * tercera persona no puede estar a la vista cuando el grupo es de dos, porque
   * cambiarlo no haria nada y quien lo toca no entenderia por que.
   */
  private duoOnly: { needs: number; node: HTMLElement }[] = [];
  /** Y el tamano del grupo, que solo existe a una mano cada una. */
  private handsOnly: HTMLElement[] = [];

  private refresh(): void {
    const settings = this.deps.store.get();
    for (const bind of this.binders) bind(settings);
    // Escala, tonica, octava, rango, timbre y la melodia guiada no hacen nada en
    // bateria. Dejarlos puestos no es solo ruido: invita a moverlos y a esperar
    // que cambie algo, y lo unico que cambia es el instrumento al que se vuelva.
    for (const node of this.melodyOnly) node.hidden = settings.drums;
    // Y al reves con los del kit, que son doce: con la bateria apagada no hay
    // ninguna pieza que afinar y lo unico que aportan es tapar lo que si vale.
    for (const node of this.drumOnly) node.hidden = !settings.drums;
    // Y el timbre de cada persona de mas, que sin ella no es de nadie. Tambien
    // se esconde en bateria, como el primero: ahi no hay timbre que elegir.
    const people = playerCount(settings.duo, settings.groupSize);
    for (const { needs, node } of this.duoOnly) node.hidden = settings.drums || people < needs;
    // El tamano solo a una mano cada una: por mitades son dos y no se discute.
    for (const node of this.handsOnly) node.hidden = settings.duo !== 'hands';
  }

  /**
   * Recoge lo que se anada aqui dentro como "solo melodia".
   *
   * Se apunta el trozo de panel en lugar de una referencia por control porque
   * hay que esconder tambien los rotulos de seccion y las notas al pie, que no
   * son controles y no tienen enlace.
   */
  private melodic(build: () => void): void {
    this.collect(this.melodyOnly, build);
  }

  /** Lo mismo para lo que solo vale en bateria: el kit entero. */
  private percussive(build: () => void): void {
    this.collect(this.drumOnly, build);
  }

  /** Y lo que solo vale a partir de `needs` personas delante. */
  private paired(needs: number, build: () => void): void {
    const from = this.panel.childElementCount;
    build();
    for (let i = from; i < this.panel.childElementCount; i += 1) {
      const node = this.panel.children[i];
      if (node instanceof HTMLElement) this.duoOnly.push({ needs, node });
    }
  }

  private collect(into: HTMLElement[], build: () => void): void {
    const from = this.panel.childElementCount;
    build();
    for (let i = from; i < this.panel.childElementCount; i += 1) {
      const node = this.panel.children[i];
      if (node instanceof HTMLElement) into.push(node);
    }
  }

  private build(): void {
    const s = t().settings;
    this.panel.replaceChildren();
    this.melodyOnly = [];
    this.drumOnly = [];
    this.duoOnly = [];
    this.handsOnly = [];

    this.select(
      'language',
      s.language,
      [
        { value: 'auto', label: s.languageAuto },
        { value: 'es', label: 'Español' },
        { value: 'en', label: 'English' },
      ],
      () => this.deps.localePreference(),
      (value) => this.deps.onLocaleChange(value),
    );

    this.section(s.shareSection);
    const share = document.createElement('div');
    share.className = 'share-row';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = s.copyLink;
    copy.addEventListener('click', () => this.deps.onShareLink());
    const performance = document.createElement('button');
    performance.type = 'button';
    performance.id = 'share-performance';
    performance.textContent = s.copyPerformance;
    performance.addEventListener('click', () => this.deps.onSharePerformance());
    share.append(copy, performance);
    this.panel.append(share);
    this.hint(s.performanceHint);

    this.select(
      'clip-format',
      s.clipFormat,
      [
        { value: 'vertical', label: s.clipVertical },
        { value: 'landscape', label: s.clipLandscape },
      ],
      (settings) => settings.clipAspect,
      (value) => this.deps.store.set({ clipAspect: value as ClipAspect }),
    );
    this.hint(s.clipHint);

    this.select(
      'stage',
      s.stage,
      [
        { value: 'camera', label: s.stageCamera },
        { value: 'hands', label: s.stageHands },
      ],
      (settings) => settings.stageMode,
      (value) => this.deps.store.set({ stageMode: value as StageMode }),
    );
    this.hint(s.stageHint);

    this.section(s.instrumentSection);

    this.melodic(() => {
      this.select(
        'scale',
        s.scale,
        SCALES.map((scale) => ({ value: scale.id, label: t().scales[scale.id] })),
        (settings) => settings.scale,
        (value) => this.deps.store.set({ scale: value as ScaleId }),
      );

      const tonicSelect = this.select(
        'tonic',
        s.tonic,
        t().notes.map((name, index) => ({ value: String(index), label: name })),
        (settings) => String(settings.tonicPc),
        (value) => this.deps.store.set({ tonicPc: Number(value) }),
      );
      // En modo continuo no hay grados que anclar a una tonica.
      this.binders.push((settings) => {
        tonicSelect.disabled = settings.scale === 'continuous';
      });

      this.range('base-octave', s.baseOctave, 1, 5, 1, (x) => x.baseOctave, (v) => this.deps.store.set({ baseOctave: v }), (v) => `${v}`);
      this.range('range', s.range, 1, 4, 1, (x) => x.octaves, (v) => this.deps.store.set({ octaves: v }), (v) => s.rangeUnit(v));

      const timbres = PRESETS.map((preset) => ({
        value: preset.id,
        label: `${preset.fingers} · ${t().presets[preset.id]}`,
      }));
      this.select(
        'preset',
        s.preset,
        timbres,
        (settings) => settings.preset,
        (value) => this.deps.store.set({ preset: value as PresetId }),
      );
      /*
       * Y el de cada persona de mas, uno debajo de otro: son el mismo ajuste
       * repetido, y leerlos juntos es lo que dice que son varios instrumentos y
       * no uno con mandos sueltos. Se montan todos los que pueden existir y se
       * esconden los que sobran, en vez de reconstruir el panel cada vez que
       * alguien cambia el tamano del grupo: reconstruirlo cerraria el
       * desplegable que se acaba de abrir.
       */
      for (let seat = 1; seat < MAX_PLAYERS; seat += 1) {
        this.paired(seat + 1, () => {
          this.select(
            `preset-player-${seat + 1}`,
            s.presetOther(seat + 1),
            timbres,
            (settings) => settings.presetOthers[seat - 1] ?? settings.preset,
            (value) => {
              const timbresNow = [...this.deps.store.get().presetOthers];
              timbresNow[seat - 1] = value as PresetId;
              this.deps.store.set({ presetOthers: timbresNow });
            },
          );
        });
      }
    });

    this.range(
      'base-volume',
      s.baseVolume,
      0,
      1,
      0.01,
      (x) => x.masterVolume,
      (v) => this.deps.store.set({ masterVolume: v }),
      (v) => `${Math.round(v * 100)}%`,
    );
    this.hint(s.baseVolumeHint);

    this.checkbox('drums', s.drums, (x) => x.drums, (v) => this.deps.store.set({ drums: v }));
    this.hint(s.drumsHint);
    this.checkbox('metronome', s.metronome, (x) => x.metronome, (v) => this.deps.store.set({ metronome: v }));
    this.hint(s.metronomeHint);

    this.percussive(() => this.kit());

    // La guia entera, rotulo incluido: apunta a notas, y en bateria no las hay.
    this.melodic(() => {
      this.section(s.guideSection);
      // Diez entradas seguidas no dicen cual es una cancion y cual un ejercicio de
      // los que hay aqui dentro. Los grupos lo dicen sin gastar una linea de texto.
      const melodyOf = (kind: MelodyKind) =>
        MELODIES.filter((m) => m.kind === kind).map((m) => ({ value: m.id, label: t().melodies[m.id]?.name ?? m.id }));
      this.select(
        'melody',
        s.melody,
        [
          { value: '', label: s.melodyNone },
          { group: s.melodySongs, options: melodyOf('song') },
          { group: s.melodyExercises, options: melodyOf('exercise') },
        ],
        (settings) => settings.melodyId,
        (value) => this.deps.onMelodyChange(value),
      );
      this.hint(s.melodyHint);
    });

    // El eco va con lo que se graba y no con el instrumento: lo que decide es
    // que capa aparece al pedir una respuesta, no como suena lo que tocas.
    this.select(
      'echo-kind',
      s.echoKind,
      [
        { value: 'invert', label: s.echoInvert },
        { value: 'mirror', label: s.echoMirror },
        { value: 'fifth', label: s.echoFifth },
      ],
      (x) => x.echoKind,
      (value) => this.deps.store.set({ echoKind: isEchoKind(value) ? value : 'invert' }),
    );
    this.hint(s.echoHint);

    this.together(s);

    this.section(s.cameraSection);
    this.cameraSelect = this.select('camera', s.device, [], (x) => x.cameraId ?? '', (value) => {
      this.deps.onCameraChange(value || null);
    });
    this.checkbox('mirror', s.mirror, (x) => x.mirror, (v) => this.deps.store.set({ mirror: v }));
    // Aqui y no en el bloque del instrumento: lo que decide es cuanta gente cabe
    // delante de la camara, que es una pregunta sobre la camara.
    this.select(
      'duo',
      s.duo,
      [
        { value: 'off', label: s.duoOptionOff },
        { value: 'halves', label: s.duoOptionHalves },
        { value: 'hands', label: s.duoOptionHands },
      ],
      (x) => x.duo,
      (value) => this.deps.store.set({ duo: isDuoMode(value) ? value : 'off' }),
    );
    this.hint(s.duoHint);
    this.collect(this.handsOnly, () => {
      this.range(
        'group-size',
        s.groupSize,
        MIN_PLAYERS,
        MAX_PLAYERS,
        1,
        (x) => x.groupSize,
        (v) => this.deps.store.set({ groupSize: v }),
        (v) => s.groupSizeUnit(v),
      );
      this.hint(s.groupSizeHint);
    });

    this.section(s.smoothingSection);
    this.hint(s.smoothingHint);
    this.range('pitch-cutoff', s.pitchCutoff, 0.2, 4, 0.05, (x) => x.pitchMinCutoff, (v) => this.deps.store.set({ pitchMinCutoff: v }), (v) => v.toFixed(2));
    this.range('pitch-beta', s.pitchBeta, 0, 0.2, 0.005, (x) => x.pitchBeta, (v) => this.deps.store.set({ pitchBeta: v }), (v) => v.toFixed(3));
    this.range('control-cutoff', s.controlCutoff, 0.2, 4, 0.05, (x) => x.controlMinCutoff, (v) => this.deps.store.set({ controlMinCutoff: v }), (v) => v.toFixed(2));
    this.range('control-beta', s.controlBeta, 0, 0.2, 0.005, (x) => x.controlBeta, (v) => this.deps.store.set({ controlBeta: v }), (v) => v.toFixed(3));
    this.range('overlay-cutoff', s.overlayCutoff, 0.2, 6, 0.05, (x) => x.overlayMinCutoff, (v) => this.deps.store.set({ overlayMinCutoff: v }), (v) => v.toFixed(2));
    this.range('overlay-beta', s.overlayBeta, 0, 0.3, 0.005, (x) => x.overlayBeta, (v) => this.deps.store.set({ overlayBeta: v }), (v) => v.toFixed(3));

    this.section(s.hudSection);
    this.checkbox('diagnostics', s.showDiagnostics, (x) => x.showDiagnostics, (v) => this.deps.store.set({ showDiagnostics: v }));
    this.checkbox('raw-trace', s.showRawTrace, (x) => x.showRawTrace, (v) => this.deps.store.set({ showRawTrace: v }));
    this.checkbox('ghosts', s.ghosts, (x) => x.ghosts, (v) => this.deps.store.set({ ghosts: v }));

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = s.reset;
    reset.addEventListener('click', () => this.deps.store.reset());

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = t().actions.close;
    close.addEventListener('click', () => {
      this.setOpen(false);
      this.deps.onRequestClose();
    });

    actions.append(reset, close);
    this.panel.append(actions);
  }

  /**
   * Los ajustes del kit, agrupados por pieza y no por ajuste.
   *
   * Tres mandos por pieza y cuatro piezas son doce, y el orden importa: quien
   * abre esto viene de oir una pieza concreta -el charles tapa, el bombo no se
   * oye- y quiere los mandos de esa pieza juntos, no tres listas de cuatro donde
   * hay que contar posiciones para encontrar la suya.
   */
  private kit(): void {
    const s = t().settings;
    this.section(s.kitSection);
    this.range('kit-space', s.kitSpace, 0, 1, 0.05, (x) => x.kitSpace, (v) => this.deps.store.set({ kitSpace: v }), (v) => `${Math.round(v * 100)}%`);
    this.range('swing', s.swing, 0, 1, 0.05, (x) => x.swing, (v) => this.deps.store.set({ swing: v }), (v) => `${Math.round(v * 100)}%`);
    this.hint(s.swingHint);
    // Cuantas piezas caben. Va arriba del todo del kit porque cambia lo que
    // sale debajo: las secciones por pieza son las que esten en el escenario.
    this.range(
      'kit-size',
      s.kitSize,
      MIN_PIECES,
      MAX_PIECES,
      1,
      (x) => x.kitSize,
      (v) => this.resize(v),
      (v) => String(v),
    );
    this.hint(s.kitSizeHint);
    this.hint(s.kitHint);

    // Las que esten puestas, en el orden en que estan: asi la lista de secciones
    // se lee como se ve el encuadre, de izquierda a derecha.
    for (const piece of this.deps.store.get().kitBands) {
      this.section(t().pieces[piece]);

      this.select(
        `kit-band-${piece}`,
        s.kitBand,
        this.deps.store.get().kitBands.map((_, index) => ({ value: String(index), label: String(index + 1) })),
        (settings) => String(settings.kitBands.indexOf(piece)),
        (value) => this.moveToBand(piece, Number(value)),
      );

      this.range(
        `kit-tuning-${piece}`,
        s.kitTuning,
        -TUNING_RANGE,
        TUNING_RANGE,
        1,
        (settings) => settings.kitTuning[piece],
        (v) => this.setPiece('kitTuning', piece, v),
        (v) => (v > 0 ? `+${v}` : String(v)),
      );

      this.range(
        `kit-level-${piece}`,
        s.kitLevel,
        0,
        MAX_LEVEL,
        0.05,
        (settings) => settings.kitLevel[piece],
        (v) => this.setPiece('kitLevel', piece, v),
        (v) => `${Math.round(v * 100)}%`,
      );
    }
  }

  /**
   * Lleva una pieza a una banda cambiandola por la que estuviera alli.
   *
   * No es una lista libre: las cuatro piezas tienen que seguir estando, porque
   * una banda repetida deja otra pieza sin ningun sitio desde el que tocarla.
   * Cambiarlas de sitio es ademas lo que uno espera al mover algo a un hueco
   * ocupado.
   */
  /**
   * Cambia cuantas piezas hay, y el reparto con ellas.
   *
   * Las dos a la vez y en una sola escritura: el reparto se sanea contra el
   * tamano, asi que dejarlos discrepar aunque sea un instante deja un kit con
   * mas bandas de las que dice tener. Y el panel se reconstruye entero, porque
   * lo que cambia no es un valor sino cuantas secciones hay.
   */
  private resize(size: number): void {
    const bands = growLayout(this.deps.store.get().kitBands, size);
    this.deps.store.set({ kitSize: size, kitBands: bands });
    this.build();
    this.refresh();
  }

  private moveToBand(piece: DrumPiece, band: number): void {
    const bands = [...this.deps.store.get().kitBands];
    const from = bands.indexOf(piece);
    const displaced = bands[band];
    if (from < 0 || from === band || displaced === undefined) return;
    bands[band] = piece;
    bands[from] = displaced;
    this.deps.store.set({ kitBands: bands });
  }

  /**
   * Un ajuste de una pieza, sin tocar los de las otras tres.
   *
   * Siempre sobre lo que hay en el store en este instante y no sobre lo que
   * recibio el enlace: arrastrar un deslizador dispara un cambio por pixel, y
   * partir de una copia vieja devolveria a su sitio lo que se acabase de mover.
   */
  private setPiece(key: 'kitTuning' | 'kitLevel', piece: DrumPiece, value: number): void {
    this.deps.store.set({ [key]: { ...this.deps.store.get()[key], [piece]: value } });
  }

  /**
   * Tocar con otro dispositivo.
   *
   * Son dos viajes de copiar y pegar, y el panel no puede disimularlo: lo que
   * hace es guiarlos en orden -genera, pega, devuelve- para que se vea que son
   * dos pasos y no un boton que no funciona. Disfrazarlo de "conectar" y dejar
   * al otro esperando seria peor que decir lo que cuesta.
   */
  private together(s: ReturnType<typeof t>['settings']): void {
    this.section(s.netSection);
    this.hint(s.netHint);

    const code = document.createElement('textarea');
    code.id = 'set-net-code';
    code.className = 'net-code';
    code.rows = 3;
    code.spellcheck = false;
    code.placeholder = s.netPlaceholder;

    const status = document.createElement('p');
    status.className = 'hint';
    status.id = 'net-status';

    const row = document.createElement('div');
    row.className = 'share-row';
    const button = (id: string, label: string, run: () => void): HTMLButtonElement => {
      const node = document.createElement('button');
      node.type = 'button';
      node.id = id;
      node.textContent = label;
      node.addEventListener('click', run);
      row.append(node);
      return node;
    };

    // Invitar: genera el codigo y lo deja en la caja, ya seleccionado para
    // copiar. Tarda unos segundos porque el navegador esta recogiendo
    // direcciones, y decirlo es mejor que un boton que parece colgado.
    button('net-invite', s.netInvite, () => {
      status.textContent = s.netWorking;
      void this.deps.onInvite().then((generated) => {
        code.value = generated ?? '';
        status.textContent = generated ? s.netShareCode : s.netFailed;
        if (generated) code.select();
      });
    });

    // Unirse: lee lo que hay pegado y devuelve el codigo de vuelta. El mismo
    // boton sirve para cerrar el trato de quien invito, porque lo que hay que
    // hacer con un codigo pegado depende de cual sea, no de en que boton pulse.
    button('net-join', s.netJoin, () => {
      const pasted = code.value.trim();
      if (!pasted) return;
      status.textContent = s.netWorking;
      void this.deps.onAccept(pasted).then((closed) => {
        if (closed) {
          code.value = '';
          status.textContent = s.netConnecting;
          return;
        }
        void this.deps.onJoin(pasted).then((reply) => {
          code.value = reply ?? '';
          status.textContent = reply ? s.netSendBack : s.netBadCode;
          if (reply) code.select();
        });
      });
    });

    button('net-leave', s.netLeave, () => {
      this.deps.onDisconnect();
      code.value = '';
      status.textContent = '';
    });

    this.panel.append(code, row, status);
  }

  /** Lo que se ve del estado de la conexion, escrito desde fuera. */
  setNetStatus(text: string): void {
    const node = document.getElementById('net-status');
    if (node) node.textContent = text;
  }

  private section(title: string): void {
    const node = document.createElement('div');
    node.className = 'section-title';
    node.textContent = title;
    this.panel.append(node);
  }

  private hint(text: string): void {
    const node = document.createElement('p');
    node.className = 'hint';
    node.textContent = text;
    this.panel.append(node);
  }

  /**
   * El identificador sale de una clave fija y no del texto de la etiqueta. Si
   * dependiera del rotulo, cambiar de idioma renombraria todos los controles y
   * cualquier referencia externa dejaria de encontrarlos; ademas las tildes lo
   * convertian en cosas como "set-t-nica".
   */
  private field(labelText: string): { wrapper: HTMLElement; label: HTMLLabelElement; value: HTMLSpanElement } {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = labelText;
    const value = document.createElement('span');
    value.className = 'value';
    label.append(text, value);
    wrapper.append(label);
    this.panel.append(wrapper);
    return { wrapper, label, value };
  }

  private select(
    key: string,
    labelText: string,
    options: ReadonlyArray<SelectOption | SelectGroup>,
    read: (s: Readonly<Settings>) => string,
    write: (value: string) => void,
  ): HTMLSelectElement {
    const { wrapper, label } = this.field(labelText);
    const select = document.createElement('select');
    const id = `set-${key}`;
    select.id = id;
    label.htmlFor = id;
    for (const option of options) {
      if ('group' in option) {
        // Un grupo vacio dejaria un encabezado suelto sin nada debajo.
        if (option.options.length === 0) continue;
        const group = document.createElement('optgroup');
        group.label = option.group;
        for (const child of option.options) group.append(new Option(child.label, child.value));
        select.append(group);
      } else {
        select.append(new Option(option.label, option.value));
      }
    }
    select.addEventListener('change', () => write(select.value));
    wrapper.append(select);
    this.binders.push((s) => {
      const value = read(s);
      if (select.value !== value) select.value = value;
    });
    return select;
  }

  private range(
    key: string,
    labelText: string,
    min: number,
    max: number,
    step: number,
    read: (s: Readonly<Settings>) => number,
    write: (value: number) => void,
    format: (value: number) => string = (v) => String(v),
  ): void {
    const { wrapper, label, value: display } = this.field(labelText);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const id = `set-${key}`;
    input.id = id;
    label.htmlFor = id;
    input.addEventListener('input', () => write(Number(input.value)));
    wrapper.append(input);
    this.binders.push((s) => {
      const v = read(s);
      if (Number(input.value) !== v) input.value = String(v);
      display.textContent = format(v);
    });
  }

  private checkbox(key: string, labelText: string, read: (s: Readonly<Settings>) => boolean, write: (value: boolean) => void): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'field checkbox';
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'checkbox';
    const id = `set-${key}`;
    input.id = id;
    label.htmlFor = id;
    input.addEventListener('change', () => write(input.checked));
    label.append(text, input);
    wrapper.append(label);
    this.panel.append(wrapper);
    this.binders.push((s) => {
      const v = read(s);
      if (input.checked !== v) input.checked = v;
    });
  }
}
