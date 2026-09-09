/** Punto normalizado tal y como lo entrega MediaPipe (0..1 sobre el encuadre). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Role = 'melody' | 'expression';

/** Indices de los 21 puntos de la mano en el modelo de MediaPipe. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Conexiones del esqueleto, agrupadas por dedo para poder colorearlas. */
export const HAND_BONES: ReadonlyArray<{ finger: Finger; pairs: ReadonlyArray<readonly [number, number]> }> = [
  { finger: 'palm', pairs: [[0, 5], [5, 9], [9, 13], [13, 17], [17, 0]] },
  { finger: 'thumb', pairs: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { finger: 'index', pairs: [[5, 6], [6, 7], [7, 8]] },
  { finger: 'middle', pairs: [[9, 10], [10, 11], [11, 12]] },
  { finger: 'ring', pairs: [[13, 14], [14, 15], [15, 16]] },
  { finger: 'pinky', pairs: [[17, 18], [18, 19], [19, 20]] },
];

export type Finger = 'palm' | 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

/**
 * Una mano ya normalizada a espacio de vista: si el video se muestra en espejo,
 * la X viene invertida, de modo que todo lo que hay aguas abajo (mapeo, overlay,
 * rejilla) comparte el mismo sistema de coordenadas que ve el interprete.
 */
export interface HandFrame {
  /** 21 puntos suavizados, en espacio de vista. */
  landmarks: Landmark[];
  /** 21 puntos sin filtrar, en espacio de vista. Solo para el HUD de diagnostico. */
  raw: Landmark[];
}

/** Resultado de la asignacion de roles para un fotograma. */
export interface RoleAssignment {
  melody: TrackedHand | null;
  expression: TrackedHand | null;
}

export interface TrackedHand {
  hand: HandFrame;
  /** true si la mano no se ve ahora mismo y se esta manteniendo su ultimo estado. */
  held: boolean;
  /** Milisegundos que lleva sostenida sin deteccion real. */
  heldFor: number;
}

/** Utilidad tipada para indexar los 21 puntos sin pelearse con el compilador. */
export function point(landmarks: readonly Landmark[], index: number): Landmark {
  const p = landmarks[index];
  if (!p) throw new RangeError(`Landmark ${index} fuera de rango`);
  return p;
}
