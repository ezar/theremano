import type { DrumPiece } from '../mapping/kit';

/**
 * Un destino de dibujo. La pantalla es uno; el lienzo de grabacion es otro, con
 * otro tamano y otra proporcion.
 *
 * Todo lo que se pinta se mide en `unit` en lugar de en pixeles fijos, de modo
 * que un trazo de 3 unidades se ve igual de grueso en un movil de 3x que en un
 * video vertical de 720 de ancho. Sin esta indireccion, el video grabado saldria
 * con lineas de pelo y texto ilegible.
 */
export interface RenderTarget {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Escala de referencia: 1 unidad equivale a 1 pixel CSS a densidad 1. */
  unit: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rectangulo que ocupa el video dentro del destino, replicando `object-fit:
 * cover`. Es lo que mantiene el esqueleto pegado a la mano cuando la ventana no
 * tiene la proporcion de la camara, y lo que permite grabar en vertical desde
 * una camara apaisada sin que nada se deforme.
 */
export function coverRect(target: RenderTarget, videoWidth: number, videoHeight: number): Rect {
  if (videoWidth <= 0 || videoHeight <= 0) return { x: 0, y: 0, w: target.width, h: target.height };
  const scale = Math.max(target.width / videoWidth, target.height / videoHeight);
  const w = videoWidth * scale;
  const h = videoHeight * scale;
  return { x: (target.width - w) / 2, y: (target.height - h) / 2, w, h };
}

/** Tono de color asociado a una clase de altura, para que cada nota tenga el suyo. */
export function pitchHue(midi: number): number {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  // El circulo de quintas reparte los tonos de forma que las notas vecinas de
  // una escala no salgan con colores casi identicos.
  return (pc * 7 * 30) % 360;
}

/**
 * Tono de color de cada pieza de la bateria.
 *
 * No sale del circulo de quintas como el de las notas, porque aqui no hay
 * alturas que ordenar: son cuatro cosas distintas y lo unico que se les pide a
 * los colores es no parecerse. Van de grave a agudo —rojo el bombo, ambar la
 * caja, verde el charles, azul el platillo— que es el orden en que estan
 * repartidas por el encuadre, asi que la rejilla se lee de un vistazo.
 */
export const PIECE_HUE: Record<DrumPiece, number> = {
  kick: 8,
  snare: 42,
  hat: 152,
  crash: 205,
};
