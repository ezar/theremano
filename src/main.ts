import './style.css';

import { AudioEngine } from './audio/engine';
import { getPreset } from './audio/presets';
import { Camera, HIGH_RES, LOW_RES, attachStream, type CameraInfo } from './camera/stream';
import { LandmarkFilter } from './filter/vectorFilter';
import { Mapper } from './mapping/mapper';
import { RoleTracker } from './tracking/handedness';
import { Landmarker } from './tracking/landmarker';
import type { HandFrame, RoleAssignment } from './tracking/types';
import { Controls } from './ui/controls';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';
import { SettingsStore, runtime, type Settings } from './state/store';

/**
 * Arranque y bucle principal.
 *
 * El bucle actualiza parametros continuos. Los eventos discretos del gate
 * (ataque y suelta) se atienden en el mismo instante en que se detectan, sin
 * esperar al siguiente repintado: el audio no puede ir al ritmo del render.
 */

/** Debajo de esto, de forma sostenida, se baja la resolucion pedida. */
const LOW_FPS_THRESHOLD = 20;
const LOW_FPS_WINDOW_MS = 3000;

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en el documento`);
  return node as T;
}

class Theremano {
  private readonly store = new SettingsStore();
  private readonly camera = new Camera();
  private readonly landmarker = new Landmarker();
  private readonly roles = new RoleTracker();
  private readonly engine = new AudioEngine();
  private readonly mapper: Mapper;
  private readonly hud = new Hud();
  private readonly overlay: Overlay;
  private readonly controls: Controls;

  private readonly video = must<HTMLVideoElement>('video');
  private readonly splash = must('splash');
  private readonly splashStatus = must('splash-status');
  private readonly splashError = must('splash-error');
  private readonly startButton = must<HTMLButtonElement>('start-button');

  /** Un filtro de overlay por rol: los puntos de cada mano tienen su historia. */
  private readonly overlayFilters: Record<'melody' | 'expression', LandmarkFilter>;

  private frameHandle: number | null = null;
  private rafHandle: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private lastFrameTime = 0;
  private lastMediaTime = -1;
  private lowFpsSince: number | null = null;
  private highRes = true;
  private lastAutoMirror: boolean | null = null;
  private starting = false;

  constructor() {
    const settings = this.store.get();
    this.mapper = new Mapper(settings);
    this.overlay = new Overlay(must<HTMLCanvasElement>('overlay'));
    this.overlayFilters = {
      melody: new LandmarkFilter({ minCutoff: settings.overlayMinCutoff, beta: settings.overlayBeta }),
      expression: new LandmarkFilter({ minCutoff: settings.overlayMinCutoff, beta: settings.overlayBeta }),
    };
    this.controls = new Controls({
      store: this.store,
      onCameraChange: (deviceId) => {
        this.store.set({ cameraId: deviceId });
        void this.reopenCamera();
      },
      onRequestClose: () => undefined,
    });

    this.store.subscribe((next, changed) => this.onSettingsChanged(next, changed));
    this.startButton.addEventListener('click', () => void this.start());

    window.addEventListener('resize', () => this.overlay.resize());
    window.addEventListener('orientationchange', () => this.overlay.resize());
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    window.addEventListener('pagehide', () => this.suspend());
  }

  // ---------------------------------------------------------------- arranque

  private async start(): Promise<void> {
    if (this.starting || runtime.running) return;
    this.starting = true;
    this.startButton.disabled = true;
    this.splashError.hidden = true;

    try {
      const settings = this.store.get();

      // Tanto la camara como el contexto de audio exigen un gesto del usuario:
      // este es el unico momento en el que se pueden arrancar los dos.
      this.setStatus('Pidiendo acceso a la camara...');
      const state = await this.camera.open({ deviceId: settings.cameraId, ...HIGH_RES });
      this.highRes = true;
      await attachStream(this.video, state.stream);
      this.applyMirror(state.frontFacing);
      this.store.set({ cameraId: state.deviceId });

      this.setStatus('Iniciando audio...');
      await this.engine.start(settings.preset, settings.masterVolume);

      await this.landmarker.load((message) => this.setStatus(message));
      await this.landmarker.warmUp((message) => this.setStatus(message));

      void this.refreshCameraList();
      void this.requestWakeLock();

      this.overlay.resize();
      this.hud.setSubtitle(this.store.get());
      this.hud.show();
      this.controls.reveal();

      runtime.running = true;
      this.splash.classList.add('leaving');
      window.setTimeout(() => {
        this.splash.hidden = true;
      }, 340);

      this.scheduleFrame();
    } catch (error) {
      this.showStartError(error);
    } finally {
      this.starting = false;
      this.startButton.disabled = false;
    }
  }

  private showStartError(error: unknown): void {
    console.error('[theremano] fallo al arrancar', error);
    const name = error instanceof DOMException ? error.name : '';
    let message: string;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      message =
        'No hay permiso de camara. Concedelo en el candado de la barra de direcciones y vuelve a intentarlo. ' +
        'Recuerda que el navegador solo permite la camara en https o en localhost.';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      message = 'No se ha encontrado ninguna camara disponible en este dispositivo.';
    } else if (name === 'NotReadableError') {
      message = 'La camara esta ocupada por otra aplicacion. Cierrala y vuelve a intentarlo.';
    } else {
      message = `No se ha podido arrancar: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.splashError.textContent = message;
    this.splashError.hidden = false;
    this.setStatus('');
    this.camera.stop();
  }

  private setStatus(text: string): void {
    this.splashStatus.textContent = text;
  }

  // ------------------------------------------------------------------ bucle

  private scheduleFrame(): void {
    if (!runtime.running) return;
    // Un visibilitychange repetido no debe dejar dos bucles vivos compitiendo
    // por la misma GPU.
    if (this.frameHandle !== null || this.rafHandle !== null) return;

    // requestVideoFrameCallback avisa una vez por fotograma real de la camara.
    // Con requestAnimationFrame se acaba infiriendo dos veces sobre la misma
    // imagen, que es tiempo de GPU tirado a la basura.
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.frameHandle = this.video.requestVideoFrameCallback((now, metadata) => {
        this.frameHandle = null;
        this.onFrame(now, metadata);
        this.scheduleFrame();
      });
      return;
    }

    this.rafHandle = requestAnimationFrame((now) => {
      this.rafHandle = null;
      // Sin metadatos hay que descartar a mano los fotogramas repetidos.
      if (this.video.currentTime !== this.lastMediaTime) {
        this.lastMediaTime = this.video.currentTime;
        this.onFrame(now, null);
      }
      this.scheduleFrame();
    });
  }

  private cancelFrame(): void {
    if (this.frameHandle !== null && typeof this.video.cancelVideoFrameCallback === 'function') {
      this.video.cancelVideoFrameCallback(this.frameHandle);
    }
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.frameHandle = null;
    this.rafHandle = null;
  }

  private onFrame(now: number, metadata: VideoFrameCallbackMetadata | null): void {
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const settings = this.store.get();
    const seconds = now / 1000;
    this.updateFps(now);

    const detection = this.landmarker.detect(this.video, now, settings.mirror);
    const hands: HandFrame[] = detection?.hands ?? [];
    runtime.inferenceMs = detection?.inferenceMs ?? runtime.inferenceMs;

    const assignment = this.roles.update(hands, now);
    this.smoothForOverlay(assignment, seconds);

    const output = this.mapper.update(assignment, seconds);

    // El evento del gate se atiende antes que cualquier otra cosa: es lo unico
    // de este bucle que el oido percibe como instantaneo o como tarde.
    if (output.gateEvent === 'attack') this.engine.attack(output.freq);
    else if (output.gateEvent === 'release') this.engine.release();

    this.engine.setFrequency(output.freq, output.glide);
    this.engine.setCutoffNorm(output.cutoffNorm);
    this.engine.setVolume(output.volume);
    if (output.preset) this.store.set({ preset: output.preset.id });

    runtime.gateOpen = output.gateOpen;
    runtime.noteName = output.noteName;
    runtime.freq = output.freq;
    runtime.pitchX = output.pitchX;
    runtime.pitchXRaw = output.pitchXRaw;
    runtime.cutoffNorm = output.cutoffNorm;
    runtime.volume = output.volume;
    runtime.pinchRatio = output.pinch;
    runtime.fingerCount = output.fingerCount;
    runtime.melodyVisible = assignment.melody !== null;
    runtime.melodyHeld = assignment.melody?.held ?? false;
    runtime.expressionVisible = assignment.expression !== null;
    runtime.expressionHeld = assignment.expression?.held ?? false;
    runtime.latencyMs = this.estimateLatency(now, metadata);

    this.overlay.draw(
      {
        assignment,
        layout: this.mapper.currentLayout,
        pitchX: output.pitchX,
        gateOpen: output.gateOpen,
        showRawTrace: settings.showRawTrace,
      },
      this.video.videoWidth,
      this.video.videoHeight,
    );
    this.hud.update(runtime, settings);
  }

  /**
   * Los puntos que se dibujan llevan su propio suavizado, mas suelto que el de
   * los parametros de audio: en pantalla un poco de retardo no se nota y un
   * esqueleto tembloroso queda mal.
   */
  private smoothForOverlay(assignment: RoleAssignment, seconds: number): void {
    for (const role of ['melody', 'expression'] as const) {
      const tracked = assignment[role];
      if (!tracked) {
        this.overlayFilters[role].reset();
        continue;
      }
      // Una mano sostenida no aporta datos nuevos: filtrarla otra vez solo
      // arrastraria el esqueleto hacia ninguna parte.
      if (tracked.held && tracked.hand.landmarks.length > 0) continue;
      tracked.hand.landmarks = this.overlayFilters[role].apply(tracked.hand.raw, seconds);
    }
  }

  private updateFps(now: number): void {
    if (this.lastFrameTime > 0) {
      const dt = now - this.lastFrameTime;
      if (dt > 0 && dt < 1000) {
        const instant = 1000 / dt;
        runtime.fps = runtime.fps === 0 ? instant : runtime.fps * 0.9 + instant * 0.1;
      }
    }
    this.lastFrameTime = now;
    this.checkPerformance(now);
  }

  private estimateLatency(now: number, metadata: VideoFrameCallbackMetadata | null): number {
    // captureTime es el unico dato que mide de verdad desde el sensor; cuando no
    // esta, presentationTime da el tramo desde que el fotograma llego al
    // compositor. Sin metadatos se estima medio fotograma.
    const capture = metadata?.captureTime ?? metadata?.presentationTime;
    const videoLeg = capture !== undefined ? Math.max(0, now - capture) : (runtime.fps > 0 ? 500 / runtime.fps : 16);
    return videoLeg + this.engine.outputLatencyMs;
  }

  private checkPerformance(now: number): void {
    if (!this.highRes || runtime.fps === 0) return;
    if (runtime.fps >= LOW_FPS_THRESHOLD) {
      this.lowFpsSince = null;
      return;
    }
    if (this.lowFpsSince === null) {
      this.lowFpsSince = now;
      return;
    }
    if (now - this.lowFpsSince < LOW_FPS_WINDOW_MS) return;

    this.lowFpsSince = null;
    this.highRes = false;
    runtime.notice = 'Rendimiento bajo: se reduce la camara a 640x480';
    window.setTimeout(() => {
      if (runtime.notice?.startsWith('Rendimiento bajo')) runtime.notice = null;
    }, 5000);
    void this.reopenCamera();
  }

  // ------------------------------------------------------------- ciclo de vida

  private async reopenCamera(): Promise<void> {
    if (!runtime.running) return;
    const settings = this.store.get();
    const resolution = this.highRes ? HIGH_RES : LOW_RES;
    try {
      const state = await this.camera.open({ deviceId: settings.cameraId, ...resolution });
      await attachStream(this.video, state.stream);
      this.applyMirror(state.frontFacing);
      this.roles.reset();
      this.overlayFilters.melody.reset();
      this.overlayFilters.expression.reset();
      this.lastMediaTime = -1;
      if (state.deviceId !== settings.cameraId) this.store.set({ cameraId: state.deviceId });
      void this.refreshCameraList();
    } catch (error) {
      console.error('[theremano] no se pudo reabrir la camara', error);
      runtime.notice = 'No se ha podido cambiar de camara';
      window.setTimeout(() => {
        runtime.notice = null;
      }, 4000);
    }
  }

  private async refreshCameraList(): Promise<void> {
    try {
      const cameras: CameraInfo[] = await this.camera.list();
      this.controls.setCameras(cameras, this.camera.current?.deviceId ?? null);
    } catch {
      /* enumerateDevices puede fallar sin permisos: no es critico */
    }
  }

  private applyMirror(frontFacing: boolean): void {
    // La camara frontal se muestra en espejo porque es lo que espera cualquiera
    // que se vea en pantalla; la trasera no. Pero el autodetectado solo se
    // impone cuando la orientacion de la camara cambia de verdad: si se aplicara
    // en cada apertura, pisaria la casilla de espejo cada vez que el usuario la
    // desmarca a mano.
    if (this.lastAutoMirror !== frontFacing) {
      this.lastAutoMirror = frontFacing;
      this.store.set({ mirror: frontFacing });
    }
    this.video.classList.toggle('mirrored', this.store.get().mirror);
  }

  private onSettingsChanged(settings: Readonly<Settings>, changed: ReadonlySet<keyof Settings>): void {
    if (
      changed.has('scale') ||
      changed.has('tonicPc') ||
      changed.has('baseOctave') ||
      changed.has('octaves') ||
      changed.has('pitchMinCutoff') ||
      changed.has('pitchBeta') ||
      changed.has('controlMinCutoff') ||
      changed.has('controlBeta') ||
      changed.has('preset')
    ) {
      this.mapper.syncSettings(settings);
      this.hud.setSubtitle(settings);
    }
    if (changed.has('preset')) this.engine.setPreset(getPreset(settings.preset));
    if (changed.has('masterVolume')) this.mapper.setVolume(settings.masterVolume);
    if (changed.has('mirror')) {
      this.video.classList.toggle('mirrored', settings.mirror);
      this.roles.reset();
    }
    if (changed.has('overlayMinCutoff') || changed.has('overlayBeta')) {
      const params = { minCutoff: settings.overlayMinCutoff, beta: settings.overlayBeta };
      this.overlayFilters.melody.setParams(params);
      this.overlayFilters.expression.setParams(params);
    }
  }

  private onVisibilityChange(): void {
    if (document.hidden) {
      this.suspend();
      return;
    }
    if (!runtime.running) return;
    this.engine.setMuted(false);
    this.lastFrameTime = 0;
    this.lastMediaTime = -1;
    void this.requestWakeLock();
    this.scheduleFrame();
  }

  /** Deja de sonar y de consumir GPU en cuanto la pestana pasa a segundo plano. */
  private suspend(): void {
    if (!runtime.running) return;
    const event = this.mapper.silence();
    if (event === 'release') this.engine.release();
    this.engine.setMuted(true);
    this.cancelFrame();
    void this.releaseWakeLock();
  }

  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      /* el bloqueo de pantalla es un lujo, no un requisito */
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      /* ya liberado */
    }
    this.wakeLock = null;
  }
}

new Theremano();
