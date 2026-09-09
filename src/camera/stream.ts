/**
 * Ciclo de vida de la camara: apertura, enumeracion, cambio de dispositivo y
 * bajada de resolucion cuando el equipo no da la talla.
 */

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export interface OpenOptions {
  deviceId?: string | null;
  width: number;
  height: number;
}

export interface CameraState {
  stream: MediaStream;
  deviceId: string | null;
  /** true si es la camara frontal: el video debe mostrarse en espejo. */
  frontFacing: boolean;
  width: number;
  height: number;
}

export const HIGH_RES: Pick<OpenOptions, 'width' | 'height'> = { width: 1280, height: 720 };
export const LOW_RES: Pick<OpenOptions, 'width' | 'height'> = { width: 640, height: 480 };

export class Camera {
  private state: CameraState | null = null;

  get current(): CameraState | null {
    return this.state;
  }

  async open(options: OpenOptions): Promise<CameraState> {
    this.stop();

    const video: MediaTrackConstraints = {
      width: { ideal: options.width },
      height: { ideal: options.height },
      frameRate: { ideal: 60, min: 15 },
    };
    if (options.deviceId) {
      video.deviceId = { exact: options.deviceId };
    } else {
      video.facingMode = { ideal: 'user' };
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (error) {
      // Un deviceId guardado puede haber dejado de existir (webcam desconectada,
      // permisos revocados). Reintentar sin el es mejor que rendirse.
      if (options.deviceId) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: options.width }, height: { ideal: options.height } },
          audio: false,
        });
      } else {
        throw error;
      }
    }

    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    const facing = typeof settings.facingMode === 'string' ? settings.facingMode : undefined;

    this.state = {
      stream,
      deviceId: settings.deviceId ?? options.deviceId ?? null,
      // Sin facingMode (tipico en portatiles de escritorio) se asume frontal,
      // que es el caso de una webcam integrada.
      frontFacing: facing === undefined ? true : facing === 'user',
      width: settings.width ?? options.width,
      height: settings.height ?? options.height,
    };
    return this.state;
  }

  stop(): void {
    if (!this.state) return;
    for (const track of this.state.stream.getTracks()) track.stop();
    this.state = null;
  }

  /** Solo devuelve etiquetas utiles despues de haber concedido permiso. */
  async list(): Promise<CameraInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camara ${i + 1}` }));
  }
}

/** Espera a que el elemento de video tenga dimensiones reales antes de inferir. */
export function attachStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('error', fail);
      video.play().then(resolve, reject);
    };
    const fail = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('error', fail);
      reject(new Error('No se pudo iniciar el video de la camara'));
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      done();
      return;
    }
    video.addEventListener('loadedmetadata', done);
    video.addEventListener('error', fail);
  });
}
