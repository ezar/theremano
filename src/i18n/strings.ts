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
import type { DrumPiece } from '../mapping/kit';
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

  /**
   * Nombres de las piezas de la bateria, para la rejilla y el panel.
   *
   * Cortos por obligacion: van debajo de una banda que mide un cuarto del ancho
   * de un movil en vertical, y cualquiera de los nombres largos ("charles",
   * "platillo") se sale o se lee a medias.
   */
  pieces: Record<DrumPiece, string>;

  splash: {
    tagline: string;
    bullets: readonly string[];
    start: string;
    starting: string;
    permissionNote: string;
    /** Cuando el enlace trae una interpretacion de otra persona. */
    invite: string;
    invitedNote: string;
    listen: string;
    stopListening: string;
    playAlong: string;
    /** Ver el instrumento tocandose solo, sin pedir la camara. */
    demo: string;
    /** Tocarlo con el raton o con el dedo, tampoco sin camara. */
    pointer: string;
    /** Se ensena cuando la camara falla: que hay salida. */
    pointerRescue: string;
  };
  demo: {
    playing: (melody: string) => string;
    /** Que hay que mirar. Sin esto la demostracion se ve, pero no se lee. */
    hint: string;
    stop: string;
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
    /** El mismo aviso, para quien toca con el raton o con el dedo. */
    pointerHint: string;
    /** Y los dos equivalentes en bateria, donde no se sostiene nada. */
    drumHint: string;
    drumPointerHint: string;
    melodyDot: string;
    expressionDot: string;
    volume: string;
    guideDone: string;
    lowPerformance: string;
    cameraSwitchFailed: string;
    layer: (index: number) => string;
    layerMuted: string;
    layerActive: string;
    /** Subtitulo del panel en modo bateria: ocupa el sitio de la escala. */
    kit: string;
  };

  actions: {
    loop: string;
    /** Rotulo del boton durante la claqueta: los pulsos que quedan. */
    loopCounting: (beats: number) => string;
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
    copyPerformance: string;
    performanceHint: string;
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
    melodySongs: string;
    melodyExercises: string;
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
    /** Tanteo del modo bateria: una voz y un gesto. */
    drums: string;
    drumsHint: string;
    /** Claqueta continua mientras gira el bucle. */
    metronome: string;
    metronomeHint: string;
    showDiagnostics: string;
    showRawTrace: string;
    reset: string;
  };

  toast: {
    /** Como se toca con el puntero. Se dice una vez, al entrar. */
    pointerHint: string;
    /** Lo mismo, cuando lo que hay debajo del puntero es una bateria. */
    drumPointerHint: string;
    /** Que nota se ha quedado sostenida con la otra mano. */
    drone: (note: string) => string;
    metronomeOn: string;
    metronomeOff: string;
    countIn: string;
    countInCancelled: string;
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
    performanceCopied: (tracks: number) => string;
    performanceEmpty: string;
    performanceTooBig: string;
    performanceBroken: string;
    linkInAddressBar: string;
    guideStart: (name: string, hint: string) => string;
    guideFinished: (accuracy: number) => string;
    guideNeedsScale: string;
    /** La guia no cabe en bateria: no hay notas que apuntar. */
    guideNeedsMelody: string;
    /** Los bucles todavia no saben grabar golpes. */
    loopNeedsMelody: string;
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
