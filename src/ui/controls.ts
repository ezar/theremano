import { PRESETS, type PresetId } from '../audio/presets';
import { NOTE_NAMES, SCALES, type ScaleId } from '../mapping/scales';
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
}

type Binder = (settings: Readonly<Settings>) => void;

export class Controls {
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly binders: Binder[] = [];
  private cameraSelect: HTMLSelectElement | null = null;
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
    this.refresh();
  }

  reveal(): void {
    this.toggle.classList.remove('hidden');
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.toggle.textContent = open ? 'Cerrar' : 'Ajustes';
    if (open) this.refresh();
  }

  setCameras(cameras: readonly CameraInfo[], activeId: string | null): void {
    const select = this.cameraSelect;
    if (!select) return;
    select.replaceChildren();
    if (cameras.length === 0) {
      select.append(new Option('Camara por defecto', ''));
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
    this.panel.replaceChildren();

    this.section('Compartir');
    const share = document.createElement('div');
    share.className = 'share-row';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copiar enlace con esta configuracion';
    copy.addEventListener('click', () => this.deps.onShareLink());
    share.append(copy);
    this.panel.append(share);

    this.select(
      'Formato del clip',
      [
        { value: 'vertical', label: 'Vertical 9:16' },
        { value: 'landscape', label: 'Apaisado 16:9' },
      ],
      (s) => s.clipAspect,
      (value) => this.deps.store.set({ clipAspect: value as ClipAspect }),
    );
    this.hint('Vertical es lo que piden las aplicaciones donde estos videos se ven.');

    this.section('Instrumento');

    this.select(
      'Escala',
      SCALES.map((s) => ({ value: s.id, label: s.name })),
      (s) => s.scale,
      (value) => this.deps.store.set({ scale: value as ScaleId }),
    );

    const tonicSelect = this.select(
      'Tonica',
      NOTE_NAMES.map((name, index) => ({ value: String(index), label: name })),
      (s) => String(s.tonicPc),
      (value) => this.deps.store.set({ tonicPc: Number(value) }),
    );
    // En modo continuo no hay grados que anclar a una tonica.
    this.binders.push((s) => {
      tonicSelect.disabled = s.scale === 'continuous';
    });

    this.range('Octava mas grave', 1, 5, 1, (s) => s.baseOctave, (v) => this.deps.store.set({ baseOctave: v }), (v) => `${v}`);
    this.range('Rango', 1, 4, 1, (s) => s.octaves, (v) => this.deps.store.set({ octaves: v }), (v) => `${v} oct`);

    this.select(
      'Timbre',
      PRESETS.map((p) => ({ value: p.id, label: `${p.fingers} · ${p.name}` })),
      (s) => s.preset,
      (value) => this.deps.store.set({ preset: value as PresetId }),
    );

    this.range(
      'Volumen base',
      0,
      1,
      0.01,
      (s) => s.masterVolume,
      (v) => this.deps.store.set({ masterVolume: v }),
      (v) => `${Math.round(v * 100)}%`,
    );
    this.hint('La mano de expresion manda sobre este valor mientras esta a la vista.');

    this.section('Camara');
    this.cameraSelect = this.select('Dispositivo', [], (s) => s.cameraId ?? '', (value) => {
      this.deps.onCameraChange(value || null);
    });
    this.checkbox('Espejo horizontal', (s) => s.mirror, (v) => this.deps.store.set({ mirror: v }));

    this.section('Suavizado');
    this.hint(
      'minCutoff baja el temblor en reposo. beta devuelve respuesta al movimiento rapido. Se afina escuchando, no mirando.',
    );
    this.range('Tono · minCutoff', 0.2, 4, 0.05, (s) => s.pitchMinCutoff, (v) => this.deps.store.set({ pitchMinCutoff: v }), (v) => v.toFixed(2));
    this.range('Tono · beta', 0, 0.2, 0.005, (s) => s.pitchBeta, (v) => this.deps.store.set({ pitchBeta: v }), (v) => v.toFixed(3));
    this.range('Control · minCutoff', 0.2, 4, 0.05, (s) => s.controlMinCutoff, (v) => this.deps.store.set({ controlMinCutoff: v }), (v) => v.toFixed(2));
    this.range('Control · beta', 0, 0.2, 0.005, (s) => s.controlBeta, (v) => this.deps.store.set({ controlBeta: v }), (v) => v.toFixed(3));
    this.range('Overlay · minCutoff', 0.2, 6, 0.05, (s) => s.overlayMinCutoff, (v) => this.deps.store.set({ overlayMinCutoff: v }), (v) => v.toFixed(2));
    this.range('Overlay · beta', 0, 0.3, 0.005, (s) => s.overlayBeta, (v) => this.deps.store.set({ overlayBeta: v }), (v) => v.toFixed(3));

    this.section('HUD');
    this.checkbox('Mostrar fps y latencia', (s) => s.showDiagnostics, (v) => this.deps.store.set({ showDiagnostics: v }));
    this.checkbox('Superponer puntos sin filtrar', (s) => s.showRawTrace, (v) => this.deps.store.set({ showRawTrace: v }));

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Restablecer';
    reset.addEventListener('click', () => this.deps.store.reset());

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cerrar';
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
    labelText: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    read: (s: Readonly<Settings>) => string,
    write: (value: string) => void,
  ): HTMLSelectElement {
    const { wrapper, label } = this.field(labelText);
    const select = document.createElement('select');
    const id = `set-${labelText.toLowerCase().replace(/[^a-z]+/g, '-')}`;
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
    const id = `set-${labelText.toLowerCase().replace(/[^a-z]+/g, '-')}`;
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

  private checkbox(labelText: string, read: (s: Readonly<Settings>) => boolean, write: (value: boolean) => void): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'field checkbox';
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'checkbox';
    const id = `set-${labelText.toLowerCase().replace(/[^a-z]+/g, '-')}`;
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
