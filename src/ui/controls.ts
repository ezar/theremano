import { PRESETS, type PresetId } from '../audio/presets';
import { MELODIES } from '../mapping/melodies';
import { SCALES, type ScaleId } from '../mapping/scales';
import { i18n, t } from '../i18n';
import type { Settings, SettingsStore } from '../state/store';
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
  onMelodyChange: (id: string) => void;
  onLocaleChange: (preference: string) => void;
  localePreference: () => string;
}

type Binder = (settings: Readonly<Settings>) => void;

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

    this.deps.store.subscribe((settings) => {
      for (const bind of this.binders) bind(settings);
    });
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

  private refresh(): void {
    const settings = this.deps.store.get();
    for (const bind of this.binders) bind(settings);
  }

  private build(): void {
    const s = t().settings;
    this.panel.replaceChildren();

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
    share.append(copy);
    this.panel.append(share);

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

    this.section(s.instrumentSection);

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

    this.select(
      'preset',
      s.preset,
      PRESETS.map((preset) => ({ value: preset.id, label: `${preset.fingers} · ${t().presets[preset.id]}` })),
      (settings) => settings.preset,
      (value) => this.deps.store.set({ preset: value as PresetId }),
    );

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

    this.section(s.guideSection);
    this.select(
      'melody',
      s.melody,
      [{ value: '', label: s.melodyNone }, ...MELODIES.map((m) => ({ value: m.id, label: t().melodies[m.id]?.name ?? m.id }))],
      (settings) => settings.melodyId,
      (value) => this.deps.onMelodyChange(value),
    );
    this.hint(s.melodyHint);

    this.section(s.cameraSection);
    this.cameraSelect = this.select('camera', s.device, [], (x) => x.cameraId ?? '', (value) => {
      this.deps.onCameraChange(value || null);
    });
    this.checkbox('mirror', s.mirror, (x) => x.mirror, (v) => this.deps.store.set({ mirror: v }));

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
    options: ReadonlyArray<{ value: string; label: string }>,
    read: (s: Readonly<Settings>) => string,
    write: (value: string) => void,
  ): HTMLSelectElement {
    const { wrapper, label } = this.field(labelText);
    const select = document.createElement('select');
    const id = `set-${key}`;
    select.id = id;
    label.htmlFor = id;
    for (const option of options) select.append(new Option(option.label, option.value));
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
