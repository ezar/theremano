import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandFrame, Landmark } from './types';

/**
 * Envoltorio de HandLandmarker.
 *
 * El modelo y el WASM se sirven desde el propio origen (`public/models`,
 * `public/wasm`): es lo que permite que la aplicacion funcione en modo avion
 * despues de la primera carga, y lo que evita depender del CDN de Google.
 */

const base = import.meta.env.BASE_URL;
const WASM_PATH = `${base}wasm`;
const MODEL_PATH = `${base}models/hand_landmarker.task`;

export interface DetectionResult {
  hands: HandFrame[];
  /** Milisegundos que ha costado la inferencia. */
  inferenceMs: number;
}

export class Landmarker {
  private landmarker: HandLandmarker | null = null;
  private lastTimestamp = -1;
  private delegateUsed: 'GPU' | 'CPU' = 'GPU';

  get delegate(): 'GPU' | 'CPU' {
    return this.delegateUsed;
  }

  async load(labels: { vision: string; model: string }, onProgress?: (message: string) => void): Promise<void> {
    onProgress?.(labels.vision);
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

    onProgress?.(labels.model);
    const options = {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' as const },
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
      this.delegateUsed = 'GPU';
    } catch (error) {
      // Algunos moviles y maquinas virtuales no exponen WebGL utilizable.
      console.warn('[theremano] delegado GPU no disponible, se usa CPU', error);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      });
      this.delegateUsed = 'CPU';
    }
  }

  /**
   * La primera inferencia compila shaders y reserva memoria: cuesta un orden de
   * magnitud mas que las siguientes. Hacerla contra un lienzo en blanco durante
   * la pantalla de carga evita que el primer gesto real llegue tarde.
   */
  async warmUp(label: string, onProgress?: (message: string) => void): Promise<void> {
    if (!this.landmarker) return;
    onProgress?.(label);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 2; i += 1) {
      this.lastTimestamp += 1;
      try {
        this.landmarker.detectForVideo(canvas, this.lastTimestamp);
      } catch {
        /* un calentamiento fallido no es motivo para abortar el arranque */
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  /**
   * @param mirror invierte la X para trabajar en espacio de vista.
   * @param timestampMs debe crecer estrictamente; MediaPipe rechaza retrocesos.
   */
  detect(source: HTMLVideoElement, timestampMs: number, mirror: boolean): DetectionResult | null {
    if (!this.landmarker) return null;
    // Reprocesar el mismo fotograma es tiempo de GPU tirado y, ademas,
    // detectForVideo lanza si el timestamp no avanza.
    const ts = timestampMs <= this.lastTimestamp ? this.lastTimestamp + 1 : timestampMs;
    this.lastTimestamp = ts;

    const t0 = performance.now();
    let result: HandLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(source, ts);
    } catch (error) {
      console.warn('[theremano] fallo de inferencia', error);
      return null;
    }
    const inferenceMs = performance.now() - t0;

    // La lateralidad que reporta MediaPipe se descarta a proposito: es inestable
    // cuando la mano gira o se sale del encuadre, y el reparto de roles se
    // decide por continuidad espacial.
    const hands: HandFrame[] = [];
    for (const raw of result.landmarks) {
      if (!raw) continue;
      hands.push({
        landmarks: [],
        raw: raw.map<Landmark>((p) => ({ x: mirror ? 1 - p.x : p.x, y: p.y, z: p.z })),
      });
    }

    return { hands, inferenceMs };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
