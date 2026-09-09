import { getPreset } from '../audio/presets';
import { getScale, NOTE_NAMES } from '../mapping/scales';
import type { Runtime, Settings } from '../state/store';

/**
 * HUD: nota, volumen, timbre, manos y diagnostico.
 *
 * Se llama en cada fotograma, asi que cada campo compara con su ultimo valor
 * antes de tocar el DOM. Escribir textContent sesenta veces por segundo con el
 * mismo texto invalida el layout para nada.
 */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en el documento`);
  return node as T;
}

export class Hud {
  private readonly root = el('hud');
  private readonly note = el('note');
  private readonly noteSub = el('note-sub');
  private readonly volumeFill = el('volume-fill');
  private readonly volumeValue = el('volume-value');
  private readonly presetName = el('preset-name');
  private readonly presetFingers = el('preset-fingers');
  private readonly dotMelody = el('dot-melody');
  private readonly dotExpression = el('dot-expression');
  private readonly diagnostics = el('diagnostics');
  private readonly notice = el('notice');

  private last = {
    note: '',
    sub: '',
    sounding: false,
    volume: -1,
    preset: '',
    fingers: -1,
    melody: '',
    expression: '',
    diagnostics: '',
    notice: '',
    diagnosticsVisible: true,
  };

  show(): void {
    this.root.classList.remove('hidden');
  }

  setSubtitle(settings: Readonly<Settings>): void {
    const scale = getScale(settings.scale);
    const tonic = NOTE_NAMES[settings.tonicPc] ?? '?';
    const sub = scale.degrees.length === 0 ? scale.name : `${scale.name} · ${tonic}`;
    if (sub !== this.last.sub) {
      this.noteSub.textContent = sub;
      this.last.sub = sub;
    }
  }

  update(runtime: Runtime, settings: Readonly<Settings>): void {
    if (runtime.noteName !== this.last.note) {
      this.note.textContent = runtime.noteName;
      this.last.note = runtime.noteName;
    }
    if (runtime.gateOpen !== this.last.sounding) {
      this.note.classList.toggle('sounding', runtime.gateOpen);
      this.last.sounding = runtime.gateOpen;
    }

    const volumePct = Math.round(runtime.volume * 100);
    if (volumePct !== this.last.volume) {
      this.volumeFill.style.height = `${volumePct}%`;
      this.volumeValue.textContent = String(volumePct);
      this.last.volume = volumePct;
    }

    const preset = getPreset(settings.preset);
    if (preset.name !== this.last.preset) {
      this.presetName.textContent = preset.name;
      this.last.preset = preset.name;
    }
    if (runtime.fingerCount !== this.last.fingers) {
      this.presetFingers.textContent = runtime.expressionVisible ? `${runtime.fingerCount}/4` : '';
      this.last.fingers = runtime.fingerCount;
    }

    this.updateDot(this.dotMelody, runtime.melodyVisible, runtime.melodyHeld, 'melody');
    this.updateDot(this.dotExpression, runtime.expressionVisible, runtime.expressionHeld, 'expression');

    if (settings.showDiagnostics !== this.last.diagnosticsVisible) {
      this.diagnostics.classList.toggle('hidden', !settings.showDiagnostics);
      this.last.diagnosticsVisible = settings.showDiagnostics;
    }
    if (settings.showDiagnostics) {
      const text =
        `${runtime.fps.toFixed(0)} fps · ~${runtime.latencyMs.toFixed(0)} ms\n` +
        `inferencia ${runtime.inferenceMs.toFixed(1)} ms\n` +
        `pinza ${runtime.pinchRatio.toFixed(2)} · ${runtime.freq.toFixed(1)} Hz` +
        (settings.showRawTrace ? `\nx ${runtime.pitchXRaw.toFixed(3)} → ${runtime.pitchX.toFixed(3)}` : '');
      if (text !== this.last.diagnostics) {
        this.diagnostics.textContent = text;
        this.last.diagnostics = text;
      }
    }

    const notice = runtime.notice ?? '';
    if (notice !== this.last.notice) {
      this.notice.textContent = notice;
      this.notice.hidden = notice.length === 0;
      this.last.notice = notice;
    }
  }

  private updateDot(node: HTMLElement, visible: boolean, held: boolean, key: 'melody' | 'expression'): void {
    const state = visible ? (held ? 'held' : 'on') : 'off';
    if (this.last[key] === state) return;
    this.last[key] = state;
    node.classList.toggle('on', state === 'on');
    node.classList.toggle('held', state === 'held');
  }
}
