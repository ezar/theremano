import './style.css';

import { AudioEngine } from './audio/engine';
import { Looper } from './audio/looper';
import { getPreset } from './audio/presets';
import { ClipRecorder, clipRecordingSupported, deliverClip } from './capture/recorder';
import { GuideSession, getMelody } from './mapping/melodies';
import { decodeSettings, hasShareableKeys, shareUrl } from './state/share';
import { i18n, t } from './i18n';
import { applyStaticStrings } from './ui/static';
import { Camera, HIGH_RES, LOW_RES, attachStream, type CameraInfo } from './camera/stream';
import { LandmarkFilter } from './filter/vectorFilter';
import { Mapper } from './mapping/mapper';
import { RoleTracker } from './tracking/handedness';
import { Landmarker } from './tracking/landmarker';
import type { HandFrame, RoleAssignment } from './tracking/types';
import { CoachView } from './ui/coach';
import { Controls } from './ui/controls';
import { Help } from './ui/help';
import { Hud } from './ui/hud';
import { Onboarding } from './ui/onboarding';
import { Overlay, type OverlayFrame } from './ui/overlay';
import { SettingsStore, runtime, type Settings, type StageMode } from './state/store';

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

/**
 * Tope de duracion del clip.
 *
 * No es una limitacion tecnica: es que un clip largo no se comparte. Treinta
 * segundos entran enteros en cualquier sitio donde estos videos circulan, y
 * obligan a que la toma sea la buena.
 */
const CLIP_MAX_SECONDS = 30;

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
  private readonly looper = new Looper();
  private readonly clip = new ClipRecorder();
  private readonly mapper: Mapper;
  private readonly hud = new Hud();
  private readonly overlay: Overlay;
  private readonly controls: Controls;
  private readonly onboarding = new Onboarding();
  private readonly coach: CoachView;
  private readonly help: Help;

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
  private lastEffectsTime = 0;
  private clipStopping = false;
  private guide: GuideSession | null = null;

  constructor() {
    // Un enlace compartido trae escala, tonica y timbre. Se aplica antes de
    // construir nada, para que el instrumento arranque ya configurado.
    const fromLink = decodeSettings(window.location.hash);
    if (hasShareableKeys(fromLink)) this.store.set(fromLink);

    const settings = this.store.get();
    // Antes que nada: el idioma decide el texto de todo lo que se construye a
    // continuacion, incluido el HTML estatico de la pantalla inicial.
    i18n.init(settings.locale);
    applyStaticStrings();

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
      onShareLink: () => void this.copyShareLink(),
      onMelodyChange: (id) => this.store.set({ melodyId: id }),
      // Solo escribe en el store: aplicar el idioma es cosa del suscriptor de
      // ajustes, para que Restablecer, que tambien lo cambia, pase por el mismo
      // camino en lugar de dejar la pantalla en un idioma y el selector en otro.
      onLocaleChange: (preference) => this.store.set({ locale: preference }),
      localePreference: () => this.store.get().locale,
    });
    i18n.subscribe(() => {
      applyStaticStrings();
      this.hud.setSubtitle(this.store.get());
    });

    this.coach = new CoachView({
      onSkipStep: () => this.advanceCoach(this.onboarding.skipStep()),
      onSkipAll: () => this.finishOnboarding(t().toast.onboardingSkipped),
    });
    this.help = new Help({ onReplay: () => this.startOnboarding() });

    this.store.subscribe((next, changed) => this.onSettingsChanged(next, changed));
    this.startButton.addEventListener('click', () => void this.start());
    this.bindActions();
    // Al restaurar no se toca la escala: el interprete pudo cambiarla despues de
    // elegir la melodia, y un enlace compartido trae la suya.
    this.syncGuide(settings.melodyId, { applySuggestedScale: false });

    window.addEventListener('resize', () => this.overlay.resize());
    window.addEventListener('orientationchange', () => this.overlay.resize());
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    window.addEventListener('pagehide', () => this.suspend());
  }

  // ----------------------------------------------------------------- acciones

  private bindActions(): void {
    must('loop-button').addEventListener('click', () => this.toggleLoop());
    must('clip-button').addEventListener('click', () => void this.toggleClip());
    must('undo-button').addEventListener('click', () => {
      this.looper.undo();
      this.hud.toast(t().toast.layerRemoved);
    });
    this.hud.onLaneClick((id) => {
      const track = this.looper.state.tracks.find((t) => t.id === id);
      if (track) this.looper.setMuted(id, !track.muted);
    });

    document.addEventListener('keydown', (event) => {
      if (!runtime.running || event.metaKey || event.ctrlKey || event.altKey) return;
      // Escribir en el panel de ajustes no debe disparar la grabacion.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

      if (event.key === '?' || (event.key === 'h' && !event.shiftKey)) {
        this.help.setOpen(!this.help.isOpen);
        return;
      }
      // Con la ayuda abierta, el espacio hace scroll: no debe grabar tambien.
      if (this.help.isOpen) return;

      if (event.code === 'Space') {
        event.preventDefault();
        this.toggleLoop();
      } else if (event.key.toLowerCase() === 'c') {
        void this.toggleClip();
      } else if (event.key.toLowerCase() === 'z') {
        this.looper.undo();
      } else if (event.key.toLowerCase() === 'v') {
        this.toggleStageMode();
      }
    });
  }

  /**
   * Alterna entre ver la camara y ver solo las manos.
   *
   * Tiene atajo propio porque la razon para usarlo suele aparecer un segundo
   * antes de grabar, y abrir los ajustes en ese momento es abrir los ajustes en
   * mitad de una toma.
   */
  private toggleStageMode(): void {
    const handsOnly = this.store.get().stageMode !== 'hands';
    // El aviso se resuelve antes de la llamada: la guarda de textos revisa lo
    // que se le pasa a toast(), y un literal de comparacion ahi dentro la
    // dispara aunque no sea texto que nadie vaya a leer.
    const message = handsOnly ? t().toast.stageHands : t().toast.stageCamera;
    this.store.set({ stageMode: handsOnly ? 'hands' : 'camera' });
    this.hud.toast(message);
  }

  private toggleLoop(): void {
    const hadCycle = this.looper.state.cycleSeconds > 0;
    switch (this.looper.toggle(this.store.get().preset)) {
      case 'rejected':
        this.hud.toast(t().toast.layersFull);
        return;
      case 'started':
        this.hud.toast(hadCycle ? t().toast.layerRecording : t().toast.layerRecordingFirst);
        return;
      case 'saved':
        this.hud.toast(t().toast.layerSaved(this.looper.state.tracks.length));
        return;
      case 'discarded':
        this.hud.toast(t().toast.layerDiscarded);
        return;
    }
  }

  private async toggleClip(): Promise<void> {
    if (this.clipStopping) return;

    if (this.clip.isRecording) {
      await this.finishClip();
      return;
    }
    if (!clipRecordingSupported()) {
      this.hud.toast(t().toast.clipUnsupported);
      return;
    }
    const audio = this.engine.captureStream();
    if (!this.clip.start(audio, this.store.get().clipAspect)) {
      this.hud.toast(t().toast.clipFailed);
      return;
    }
    this.hud.toast(t().toast.clipRecording);
  }

  private async finishClip(): Promise<void> {
    this.clipStopping = true;
    try {
      const result = await this.clip.stop();
      this.hud.setClipRecording(false, 0, CLIP_MAX_SECONDS);
      if (!result || result.seconds < 0.6) {
        this.hud.toast(t().toast.clipTooShort);
        return;
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const delivery = await deliverClip(result, `theremano-${stamp}`);
      const messages: Record<typeof delivery, string> = {
        shared: t().toast.clipShared,
        downloaded: t().toast.clipDownloaded,
        cancelled: t().toast.clipCancelled,
        failed: t().toast.clipSaveFailed,
      };
      this.hud.toast(messages[delivery]);
    } finally {
      this.clipStopping = false;
    }
  }

  /**
   * @param applySuggestedScale solo al elegir la melodia a mano. Al restaurarla
   * de los ajustes guardados no se toca la escala: hacerlo pisaria la que el
   * interprete eligio despues, y la que trae un enlace compartido.
   */
  private syncGuide(melodyId: string, options: { applySuggestedScale: boolean }): void {
    const melody = melodyId ? getMelody(melodyId) : null;
    if (!melody) {
      this.guide = null;
      return;
    }
    if (options.applySuggestedScale) {
      // La escala sugerida es parte de la melodia: pedirla y no ponerla dejaria
      // objetivos aproximados donde deberia haber notas exactas. El rango va en
      // el mismo lote porque una cancion que no cabe en el encuadre reparte dos
      // notas distintas en la misma zona y deja de reconocerse. Solo se amplia:
      // quien toca con cuatro octavas no las pierde por elegir una melodia.
      const patch: Partial<Settings> = {};
      if (this.store.get().scale !== melody.suggestedScale) patch.scale = melody.suggestedScale;
      if (this.store.get().octaves < melody.minOctaves) patch.octaves = melody.minOctaves;
      if (Object.keys(patch).length > 0) this.store.set(patch);
    }
    this.guide = new GuideSession(melody, this.mapper.currentLayout);
    const copy = t().melodies[melody.id];
    if (runtime.running && copy) this.hud.toast(t().toast.guideStart(copy.name, copy.hint), 4200);
  }

  private scoreGuide(zoneIndex: number): void {
    const guide = this.guide;
    if (!guide || guide.finished || zoneIndex < 0) return;
    if (guide.onAttack(zoneIndex) !== 'finished') return;
    this.hud.toast(t().toast.guideFinished(Math.round(guide.accuracy * 100)), 5200);
  }

  private startOnboarding(): void {
    this.onboarding.start();
    this.coach.render(this.onboarding.step, this.onboarding.index, this.onboarding.total);
    this.hud.dismissHint();
  }

  private advanceCoach(event: 'advanced' | 'finished' | null): void {
    if (event === null) return;
    this.coach.render(this.onboarding.step, this.onboarding.index, this.onboarding.total);
    if (event === 'finished') this.finishOnboarding(t().toast.onboardingDone);
  }

  private finishOnboarding(message: string): void {
    this.onboarding.stop();
    this.coach.render(null, 0, this.onboarding.total);
    // Se marca visto tanto si se completa como si se salta: insistir con algo
    // que ya se ha rechazado una vez es la forma mas rapida de molestar.
    this.store.set({ onboarded: true });
    this.hud.toast(message, 4800);
  }

  private async copyShareLink(): Promise<void> {
    const url = shareUrl(this.store.get());
    try {
      await navigator.clipboard.writeText(url);
      this.hud.toast(t().toast.linkCopied);
    } catch {
      // Sin permiso de portapapeles, al menos que quede en la barra de
      // direcciones para poder copiarlo a mano.
      window.location.hash = url.split('#')[1] ?? '';
      this.hud.toast(t().toast.linkInAddressBar);
    }
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
      this.setStatus(t().loading.camera);
      const state = await this.camera.open({ deviceId: settings.cameraId, ...HIGH_RES });
      this.highRes = true;
      await attachStream(this.video, state.stream);
      this.applyMirror(state.frontFacing);
      this.applyStageMode(settings.stageMode);
      this.store.set({ cameraId: state.deviceId });

      this.setStatus(t().loading.audio);
      await this.engine.start(settings.preset, settings.masterVolume);

      this.looper.attach(this.engine.loopOutput);

      const loading = t().loading;
      await this.landmarker.load(loading, (message) => this.setStatus(message));
      await this.landmarker.warmUp(loading.warmup, (message) => this.setStatus(message));

      void this.refreshCameraList();
      void this.requestWakeLock();

      this.overlay.resize();
      this.hud.setSubtitle(this.store.get());
      this.hud.show();
      this.controls.reveal();
      this.help.reveal();

      runtime.running = true;
      if (!this.store.get().onboarded) this.startOnboarding();
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
      message = t().errors.permission;
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      message = t().errors.notFound;
    } else if (name === 'NotReadableError') {
      message = t().errors.busy;
    } else {
      message = t().errors.generic(error instanceof Error ? error.message : String(error));
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
    runtime.midi = output.midi;

    // La capa que se este grabando guarda el gesto, no el sonido.
    this.looper.capture({
      gateEvent: output.gateEvent,
      gateOpen: output.gateOpen,
      freq: output.freq,
      cutoffNorm: output.cutoffNorm,
      gain: output.volume,
    });

    const loops = this.looper.state;
    const frame: OverlayFrame = {
      assignment,
      layout: this.mapper.currentLayout,
      pitchX: output.pitchX,
      midi: output.midi,
      gateOpen: output.gateOpen,
      volume: output.volume,
      loops,
      targetZone: this.guide && !this.guide.finished ? this.guide.targetZone : null,
      showRawTrace: settings.showRawTrace,
    };

    // Los efectos avanzan una vez por fotograma aunque se pinten dos veces:
    // si dependieran del numero de destinos, grabar aceleraria las particulas.
    const dt = this.lastEffectsTime > 0 ? (now - this.lastEffectsTime) / 1000 : 1 / 60;
    this.lastEffectsTime = now;
    if (output.gateEvent === 'attack') {
      this.overlay.attack(frame);
      this.hud.dismissHint();
      this.scoreGuide(output.zoneIndex);
    }
    this.overlay.update(frame, dt);

    const handsOnly = settings.stageMode === 'hands';
    this.overlay.paint(this.overlay.screenTarget, frame, this.video.videoWidth, this.video.videoHeight, {
      backdrop: handsOnly,
    });

    const clipTarget = this.clip.target;
    if (clipTarget) {
      // El clip se dibuja aparte y completo: incluye el fotograma de la camara,
      // la nota y la marca, porque en el video no hay HUD de HTML detras.
      this.overlay.paint(clipTarget, frame, this.video.videoWidth, this.video.videoHeight, {
        ...(handsOnly ? { backdrop: true } : { video: this.video }),
        mirror: settings.mirror,
        watermark: true,
        caption: true,
      });
      this.hud.setClipRecording(true, this.clip.seconds, CLIP_MAX_SECONDS);
      if (this.clip.seconds >= CLIP_MAX_SECONDS) void this.finishClip();
    }

    if (this.onboarding.isActive) {
      this.advanceCoach(
        this.onboarding.update({
          melodyVisible: runtime.melodyVisible,
          melodyHeld: runtime.melodyHeld,
          expressionVisible: runtime.expressionVisible,
          expressionHeld: runtime.expressionHeld,
          gateOpen: output.gateOpen,
          attack: output.gateEvent === 'attack',
          pitchX: output.pitchX,
          volume: output.volume,
          dt,
        }),
      );
    }
    this.coach.render(this.onboarding.step, this.onboarding.index, this.onboarding.total);

    this.hud.setLoops(loops);
    this.hud.setGuide(
      this.guide
        ? {
            name: t().melodies[this.guide.melody.id]?.name ?? this.guide.melody.id,
            done: this.guide.done,
            total: this.guide.total,
            finished: this.guide.finished,
          }
        : null,
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
    // Se compara el mensaje exacto, no su comienzo: buscar un prefijo en
    // espanol dejaba el aviso ingles clavado en pantalla para siempre.
    const notice = t().hud.lowPerformance;
    runtime.notice = notice;
    window.setTimeout(() => {
      if (runtime.notice === notice) runtime.notice = null;
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
      const notice = t().hud.cameraSwitchFailed;
      runtime.notice = notice;
      window.setTimeout(() => {
        if (runtime.notice === notice) runtime.notice = null;
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

  /**
   * El degradado del lienzo ya tapa la camara, pero el video sigue ahi debajo.
   * Ocultarlo ademas por CSS evita que un fotograma pintado a medias, o un
   * lienzo que aun no se ha redimensionado tras girar el movil, deje ver la
   * habitacion por un borde.
   */
  private applyStageMode(mode: StageMode): void {
    this.video.classList.toggle('camera-hidden', mode === 'hands');
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
    if (changed.has('locale')) i18n.set(settings.locale);
    if (changed.has('melodyId')) this.syncGuide(settings.melodyId, { applySuggestedScale: true });

    // El modo continuo no reparte el encuadre en zonas, asi que una guia activa
    // se quedaria en 0/0 sin objetivo y sin poder avanzar nunca. Se retira, y se
    // dice por que: dejarla puesta y muerta seria peor que quitarla.
    // La llamada anidada deja la guia a null, asi que el resto del manejador
    // puede seguir: cortar aqui se saltaria el timbre, el espejo y el resto de
    // cambios que pudieran venir en el mismo lote.
    if (changed.has('scale') && settings.scale === 'continuous' && settings.melodyId) {
      this.store.set({ melodyId: '' });
      this.hud.toast(t().toast.guideNeedsScale);
    }

    // Cambiar de escala o de rango mueve las zonas bajo los pies de la guia.
    if (this.guide && (changed.has('scale') || changed.has('tonicPc') || changed.has('octaves') || changed.has('baseOctave'))) {
      this.guide.relayout(this.mapper.currentLayout);
    }
    if (changed.has('preset')) this.engine.setPreset(getPreset(settings.preset));
    if (changed.has('masterVolume')) this.mapper.setVolume(settings.masterVolume);
    if (changed.has('stageMode')) this.applyStageMode(settings.stageMode);
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
    this.lastEffectsTime = 0;
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
    this.overlay.resetEffects();
    this.lastEffectsTime = 0;
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
