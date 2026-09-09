import { getPreset } from '../audio/presets';
import { getScale, NOTE_NAMES } from '../mapping/scales';
import type { LoopState } from '../audio/looper';
import type { Runtime, Settings } from '../state/store';
import { pitchHue } from './target';

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
  private readonly actions = el('actions');
  private readonly loopButton = el<HTMLButtonElement>('loop-button');
  private readonly clipButton = el<HTMLButtonElement>('clip-button');
  private readonly undoButton = el<HTMLButtonElement>('undo-button');
  private readonly lanes = el('loop-lanes');
  private readonly hint = el('hint');
  private readonly toastNode = el('toast');
  private readonly stage = el('stage');

  private toastHandle: number | null = null;
  private hintHidden = false;
  private laneSignature = '';
  private onLaneToggle: ((id: number) => void) | null = null;

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
    hue: -1,
    loopLabel: '',
    clipLabel: '',
  };

  show(): void {
    this.root.classList.remove('hidden');
    this.actions.classList.remove('hidden');
  }

  /** El aviso inicial desaparece en cuanto se toca la primera nota. */
  dismissHint(): void {
    if (this.hintHidden) return;
    this.hintHidden = true;
    this.hint.classList.add('gone');
  }

  onLaneClick(handler: (id: number) => void): void {
    this.onLaneToggle = handler;
    this.lanes.addEventListener('click', (event) => {
      const lane = (event.target as HTMLElement).closest<HTMLElement>('.loop-lane');
      const id = lane?.dataset['id'];
      if (id) this.onLaneToggle?.(Number(id));
    });
  }

  toast(message: string, ms = 2600): void {
    this.toastNode.textContent = message;
    this.toastNode.hidden = false;
    if (this.toastHandle !== null) clearTimeout(this.toastHandle);
    this.toastHandle = window.setTimeout(() => {
      this.toastNode.hidden = true;
      this.toastHandle = null;
    }, ms);
  }

  setClipRecording(recording: boolean, seconds: number, maxSeconds: number): void {
    this.stage.classList.toggle('recording', recording);
    this.clipButton.classList.toggle('armed', recording);
    const label = recording ? `${Math.max(0, maxSeconds - seconds).toFixed(0)} s` : 'Grabar clip';
    if (label !== this.last.clipLabel) {
      this.clipButton.querySelector('.label')!.textContent = label;
      this.last.clipLabel = label;
    }
  }

  setLoops(loops: LoopState): void {
    this.loopButton.classList.toggle('armed', loops.recording);
    this.loopButton.disabled = !loops.recording && loops.full;
    const label = loops.recording ? 'Parar' : loops.full ? 'Capas llenas' : 'Bucle';
    if (label !== this.last.loopLabel) {
      this.loopButton.querySelector('.label')!.textContent = label;
      this.last.loopLabel = label;
    }
    this.undoButton.hidden = loops.tracks.length === 0;

    // Solo se reconstruyen las capas cuando cambian de verdad: hacerlo por
    // fotograma reiniciaria su animacion de entrada sesenta veces por segundo.
    const signature = loops.tracks.map((t) => `${t.id}:${t.muted ? 'm' : 'a'}`).join('|');
    if (signature === this.laneSignature) return;
    this.laneSignature = signature;

    this.lanes.replaceChildren();
    for (let i = 0; i < loops.tracks.length; i += 1) {
      const track = loops.tracks[i]!;
      const lane = document.createElement('div');
      lane.className = `loop-lane${track.muted ? ' muted' : ''}`;
      lane.dataset['id'] = String(track.id);
      lane.title = track.muted ? 'Capa silenciada. Pulsa para activarla.' : 'Pulsa para silenciar esta capa.';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = `hsl(${track.hue}, 90%, 62%)`;
      swatch.style.color = `hsl(${track.hue}, 90%, 62%)`;
      const text = document.createElement('span');
      text.textContent = `Capa ${i + 1}`;
      lane.append(swatch, text);
      this.lanes.append(lane);
    }
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
    const hue = Math.round(pitchHue(runtime.midi));
    if (hue !== this.last.hue) {
      document.documentElement.style.setProperty('--note-hue', String(hue));
      this.last.hue = hue;
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
