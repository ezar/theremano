import type { RenderTarget } from '../ui/target';
import { t } from '../i18n';

/**
 * Grabacion de un clip con imagen y sonido.
 *
 * Graba sobre un lienzo propio, no sobre el de la pantalla. Eso cuesta un
 * dibujado extra por fotograma mientras se graba, y a cambio permite grabar en
 * vertical desde una camara apaisada, a resolucion fija, sin depender del tamano
 * de la ventana ni de la densidad del dispositivo. Un clip que sale a 9:16 y con
 * la marca del proyecto es la diferencia entre algo que se puede compartir y una
 * captura de pantalla.
 */

export type ClipAspect = 'vertical' | 'landscape';

const SIZES: Record<ClipAspect, { width: number; height: number }> = {
  vertical: { width: 720, height: 1280 },
  landscape: { width: 1280, height: 720 },
};

const FPS = 30;

/**
 * Tasa de video del clip.
 *
 * Bajo de 6 a 4 Mbit/s al subir el tope de duracion a un minuto: a 6 el clip
 * largo se acercaba a los limites de subida de las aplicaciones donde estos
 * videos circulan, y lo que se graba —una figura de lineas sobre una imagen
 * quieta— no tiene el detalle que justificaria esa tasa. El codificador ademas
 * suele quedarse muy por debajo del techo que se le pide.
 */
const VIDEO_BITRATE = 4_000_000;

/**
 * Orden de preferencia de formato. MP4 primero porque es lo unico que Safari
 * en iOS acepta compartir a otras aplicaciones; un webm alli se queda en el
 * carrete sin poder subirse a ningun sitio.
 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export interface ClipResult {
  blob: Blob;
  extension: string;
  seconds: number;
}

export function clipRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    MIME_CANDIDATES.some((m) => MediaRecorder.isTypeSupported(m))
  );
}

function pickMime(): string | null {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export class ClipRecorder {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mime = '';

  constructor() {
    this.ctx = this.canvas.getContext('2d', { alpha: false });
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get seconds(): number {
    return this.isRecording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** Destino sobre el que el renderizador debe pintar mientras se graba. */
  get target(): RenderTarget | null {
    if (!this.ctx || !this.isRecording) return null;
    return {
      ctx: this.ctx,
      width: this.canvas.width,
      height: this.canvas.height,
      // El video de referencia mide 720 de alto: con esto un trazo de 3 unidades
      // se ve igual de grueso en el clip que en pantalla.
      unit: this.canvas.height / 720,
    };
  }

  start(audio: MediaStream | null, aspect: ClipAspect): boolean {
    if (this.isRecording || !this.ctx) return false;
    const mime = pickMime();
    if (!mime) return false;

    const size = SIZES[aspect];
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    // Un primer fotograma en negro evita que captureStream arranque con un
    // lienzo transparente, que algunos codificadores convierten en basura.
    this.ctx.fillStyle = '#05070c';
    this.ctx.fillRect(0, 0, size.width, size.height);

    const stream = this.canvas.captureStream(FPS);
    for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track);

    try {
      this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
    } catch {
      return false;
    }
    this.mime = mime;
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(200);
    this.startedAt = performance.now();
    return true;
  }

  async stop(): Promise<ClipResult | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') return null;
    const seconds = this.seconds;

    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await done;
    this.recorder = null;

    if (this.chunks.length === 0) return null;
    const blob = new Blob(this.chunks, { type: this.mime });
    this.chunks = [];
    return { blob, extension: this.mime.startsWith('video/mp4') ? 'mp4' : 'webm', seconds };
  }

  dispose(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.chunks = [];
  }
}

export type DeliveryResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/**
 * Entrega el clip por donde se pueda.
 *
 * En movil, la hoja de compartir del sistema es el camino corto a las
 * aplicaciones donde estos videos viven. En escritorio no existe, y una descarga
 * es la respuesta correcta.
 */
export async function deliverClip(result: ClipResult, baseName: string): Promise<DeliveryResult> {
  const file = new File([result.blob], `${baseName}.${result.extension}`, { type: result.blob.type });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'theremano',
        text: t().shareText,
      });
      return 'shared';
    } catch (error) {
      // Cancelar la hoja de compartir lanza AbortError. No es un fallo, y no
      // deberia acabar en una descarga que nadie ha pedido.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
