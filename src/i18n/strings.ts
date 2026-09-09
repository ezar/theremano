/**
 * Todo el texto que ve quien usa la aplicacion.
 *
 * Vive fuera de los modulos que hacen el trabajo por dos razones. La primera es
 * que asi hay una sola lista que revisar cuando algo esta mal escrito, en vez de
 * un centenar de cadenas repartidas por veinte ficheros. La segunda es que el
 * tipo obliga a que cada idioma tenga exactamente las mismas claves: una
 * traduccion a medias no compila.
 */
import type { PresetId } from '../audio/presets';
import type { ScaleId } from '../mapping/scales';

export type Locale = 'es' | 'en';

export interface Strings {
  /** Valor del atributo lang del documento. */
  htmlLang: string;
  /**
   * Nombres de las doce notas. No es una traduccion cualquiera: el mundo
   * hispanohablante lee Do Re Mi y el anglosajon C D E, y ver la notacion
   * equivocada convierte la rejilla en ruido para quien sabe algo de musica.
   */
  notes: readonly [string, string, string, string, string, string, string, string, string, string, string, string];

  splash: {
    tagline: string;
    bullets: readonly string[];
    start: string;
    starting: string;
    permissionNote: string;
  };
  loading: {
    camera: string;
    audio: string;
    vision: string;
    model: string;
    warmup: string;
  };
  errors: {
    permission: string;
    notFound: string;
    busy: string;
    generic: (detail: string) => string;
  };

  hud: {
    hint: string;
    melodyDot: string;
    expressionDot: string;
    volume: string;
    guideDone: string;
    lowPerformance: string;
    cameraSwitchFailed: string;
    layer: (index: number) => string;
    layerMuted: string;
    layerActive: string;
  };

  actions: {
    loop: string;
    loopStop: string;
    loopFull: string;
    loopTitle: string;
    clip: string;
    clipTitle: string;
    undo: string;
    undoTitle: string;
    settings: string;
    close: string;
    helpTitle: string;
  };

  coach: {
    optional: string;
    skipStep: string;
    skipStepOptional: string;
    skipAll: string;
    steps: Record<string, { title: string; body: string }>;
  };

  help: {
    title: string;
    close: string;
    gestures: readonly { what: string; does: string; optional?: boolean }[];
    recordTitle: string;
    record: readonly string[];
    keysTitle: string;
    keys: readonly { key: string; does: string }[];
    troubleTitle: string;
    trouble: readonly string[];
    replay: string;
  };

  settings: {
    language: string;
    languageAuto: string;
    shareSection: string;
    copyLink: string;
    clipFormat: string;
    clipVertical: string;
    clipLandscape: string;
    clipHint: string;
    stage: string;
    stageCamera: string;
    stageHands: string;
    stageHint: string;
    instrumentSection: string;
    scale: string;
    tonic: string;
    baseOctave: string;
    range: string;
    rangeUnit: (value: number) => string;
    preset: string;
    baseVolume: string;
    baseVolumeHint: string;
    guideSection: string;
    melody: string;
    melodyNone: string;
    melodyHint: string;
    cameraSection: string;
    device: string;
    defaultCamera: string;
    mirror: string;
    smoothingSection: string;
    smoothingHint: string;
    pitchCutoff: string;
    pitchBeta: string;
    controlCutoff: string;
    controlBeta: string;
    overlayCutoff: string;
    overlayBeta: string;
    hudSection: string;
    showDiagnostics: string;
    showRawTrace: string;
    reset: string;
  };

  toast: {
    layerRecording: string;
    layerRecordingFirst: string;
    layerSaved: (count: number) => string;
    layerDiscarded: string;
    layerRemoved: string;
    layersFull: string;
    clipRecording: string;
    clipUnsupported: string;
    clipFailed: string;
    clipTooShort: string;
    clipShared: string;
    clipDownloaded: string;
    clipCancelled: string;
    clipSaveFailed: string;
    stageHands: string;
    stageCamera: string;
    linkCopied: string;
    linkInAddressBar: string;
    guideStart: (name: string, hint: string) => string;
    guideFinished: (accuracy: number) => string;
    guideNeedsScale: string;
    onboardingDone: string;
    onboardingSkipped: string;
  };

  overlay: { melodyTag: string; expressionTag: string };

  /** Texto que acompana al clip en la hoja de compartir del sistema. */
  shareText: string;

  scales: Record<ScaleId, string>;
  presets: Record<PresetId, string>;
  melodies: Record<string, { name: string; hint: string }>;
}
