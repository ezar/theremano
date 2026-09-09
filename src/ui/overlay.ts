import { HAND_BONES, point, type Finger, type Landmark, type RoleAssignment } from '../tracking/types';
import { denormalize, palmCenter } from '../mapping/features';
import { midiToName, zoneCenters, type PitchLayout } from '../mapping/scales';

/**
 * Esqueleto de la mano y rejilla de la escala sobre el video.
 *
 * Sin marcos ni cajas: el instrumento es la imagen. El dibujo se hace en un
 * unico lienzo que se solapa al video y que replica su recorte, de modo que un
 * punto de la mano cae exactamente donde esta la mano.
 */

const FINGER_COLORS: Record<Finger, string> = {
  palm: 'rgba(255,255,255,0.55)',
  thumb: '#ff6b6b',
  index: '#ffd166',
  middle: '#06d6a0',
  ring: '#4cc9f0',
  pinky: '#c77dff',
};

export interface OverlayFrame {
  assignment: RoleAssignment;
  layout: PitchLayout;
  pitchX: number;
  gateOpen: boolean;
  /** Puntos sin filtrar de la mano de melodia, para comparar a ojo el suavizado. */
  showRawTrace: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) throw new Error('No se pudo crear el contexto 2D del overlay');
    this.ctx = ctx;
  }

  resize(): void {
    // Se limita el devicePixelRatio: en moviles de 3x el coste de rellenar el
    // lienzo compite con la inferencia por el mismo presupuesto de fotograma.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth, clientHeight } = this.canvas;
    const w = Math.round(clientWidth * this.dpr);
    const h = Math.round(clientHeight * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /**
   * Rectangulo que ocupa el video dentro del lienzo. Replica `object-fit: cover`,
   * que recorta por el lado largo: sin esto el esqueleto se separa de la mano en
   * cuanto la ventana no tiene la proporcion de la camara.
   */
  private videoRect(videoWidth: number, videoHeight: number): Rect {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (videoWidth <= 0 || videoHeight <= 0) return { x: 0, y: 0, w: cw, h: ch };
    const scale = Math.max(cw / videoWidth, ch / videoHeight);
    const w = videoWidth * scale;
    const h = videoHeight * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  draw(frame: OverlayFrame, videoWidth: number, videoHeight: number): void {
    const { ctx } = this;
    const rect = this.videoRect(videoWidth, videoHeight);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawGrid(rect, frame.layout, frame.pitchX, frame.gateOpen);


    const melody = frame.assignment.melody;
    const expression = frame.assignment.expression;

    if (expression) {
      this.drawHand(rect, expression.hand.landmarks, expression.held, 0.55);
      this.drawRoleTag(rect, expression.hand.landmarks, 'expresion', expression.held);
    }
    if (melody) {
      if (frame.showRawTrace) this.drawRawTrace(rect, melody.hand.raw);
      this.drawHand(rect, melody.hand.landmarks, melody.held, 1);
      this.drawRoleTag(rect, melody.hand.landmarks, 'melodia', melody.held);
      this.drawPinch(rect, melody.hand.landmarks, frame.gateOpen);
    }
  }

  private toCanvas(rect: Rect, p: { x: number; y: number }): { x: number; y: number } {
    return { x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h };
  }

  private drawGrid(rect: Rect, layout: PitchLayout, pitchX: number, gateOpen: boolean): void {
    const { ctx } = this;
    const centers = zoneCenters(layout);
    if (centers.length === 0) return;

    // Las lineas se colocan en X segun el recorte del video, para que coincidan
    // con la mano, pero se extienden en Y sobre el lienzo visible: con
    // `object-fit: cover` el video se sale por arriba y por abajo, y las
    // etiquetas dibujadas contra el rectangulo del video caerian fuera de
    // pantalla.
    const top = this.canvas.height * 0.06;
    const bottom = this.canvas.height * 0.93;
    const labelY = this.canvas.height * 0.965;
    const labelPad = 22 * this.dpr;

    const activeIndex =
      pitchX >= 0 && centers.length > 1 ? Math.round(Math.min(1, Math.max(0, pitchX)) * (centers.length - 1)) : -1;

    ctx.save();
    ctx.lineWidth = Math.max(1, this.dpr);
    ctx.font = `${12 * this.dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';

    for (let i = 0; i < centers.length; i += 1) {
      const zone = centers[i] ?? 0;
      const x = rect.x + denormalize(zone) * rect.w;
      const semitone = layout.degrees[i] ?? 0;
      const isTonic = semitone % 12 === 0;
      const isActive = i === activeIndex;

      ctx.strokeStyle = isActive
        ? gateOpen
          ? 'rgba(255, 209, 102, 0.9)'
          : 'rgba(255, 255, 255, 0.5)'
        : isTonic
          ? 'rgba(255, 255, 255, 0.28)'
          : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = (isActive ? 2.5 : isTonic ? 1.5 : 1) * this.dpr;

      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();

      if (isTonic || isActive) {
        ctx.fillStyle = isActive ? 'rgba(255, 209, 102, 0.95)' : 'rgba(255,255,255,0.4)';
        // Sin recortar, la etiqueta del ultimo grado se sale del lienzo o se
        // mete debajo del contador de fps.
        const labelX = Math.min(Math.max(x, labelPad), this.canvas.width - labelPad);
        ctx.fillText(midiToName(layout.baseMidi + semitone), labelX, labelY);
      }
    }
    ctx.restore();
  }

  private drawHand(rect: Rect, landmarks: readonly Landmark[], held: boolean, alpha: number): void {
    if (landmarks.length < 21) return;
    const { ctx } = this;
    ctx.save();
    // Una mano sostenida por el margen de gracia se dibuja translucida: el
    // interprete ve que el sistema la esta recordando, no detectando.
    ctx.globalAlpha = alpha * (held ? 0.4 : 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const bone of HAND_BONES) {
      ctx.strokeStyle = FINGER_COLORS[bone.finger];
      ctx.lineWidth = (bone.finger === 'palm' ? 2 : 3.2) * this.dpr;
      ctx.beginPath();
      for (const [a, b] of bone.pairs) {
        const pa = this.toCanvas(rect, point(landmarks, a));
        const pb = this.toCanvas(rect, point(landmarks, b));
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const lm of landmarks) {
      const p = this.toCanvas(rect, lm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Puntos crudos superpuestos: hace visible cuanto trabajo hace One Euro. */
  private drawRawTrace(rect: Rect, landmarks: readonly Landmark[]): void {
    if (landmarks.length < 21) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 80, 80, 0.75)';
    for (const lm of landmarks) {
      const p = this.toCanvas(rect, lm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPinch(rect: Rect, landmarks: readonly Landmark[], gateOpen: boolean): void {
    if (landmarks.length < 21) return;
    const { ctx } = this;
    const thumb = this.toCanvas(rect, point(landmarks, 4));
    const index = this.toCanvas(rect, point(landmarks, 8));
    const mid = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };

    ctx.save();
    ctx.strokeStyle = gateOpen ? 'rgba(255, 209, 102, 0.95)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = (gateOpen ? 3 : 1.5) * this.dpr;
    ctx.setLineDash(gateOpen ? [] : [4 * this.dpr, 4 * this.dpr]);
    ctx.beginPath();
    ctx.moveTo(thumb.x, thumb.y);
    ctx.lineTo(index.x, index.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (gateOpen) {
      ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, 6 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRoleTag(rect: Rect, landmarks: readonly Landmark[], label: string, held: boolean): void {
    if (landmarks.length < 21) return;
    const { ctx } = this;
    const palm = this.toCanvas(rect, palmCenter(landmarks));
    ctx.save();
    ctx.globalAlpha = held ? 0.35 : 0.75;
    ctx.font = `${11 * this.dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(label.toUpperCase(), palm.x, palm.y - 14 * this.dpr);
    ctx.restore();
  }
}
