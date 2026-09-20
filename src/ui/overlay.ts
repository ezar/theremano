import { HAND_BONES, point, type Finger, type Landmark, type RoleAssignment } from '../tracking/types';
import { FULL_LENS, denormalizeIn, palmCenter, type Lens } from '../mapping/features';
import { midiToName, zoneCenters, type PitchLayout } from '../mapping/scales';
import { t } from '../i18n';
import { TrackGhost } from '../mapping/ghost';
import { drawnScale, phantomHand } from '../tracking/phantom';
import type { LoopState, LoopTrack } from '../audio/looper';
import { Visualizer } from './visualizer';
import { coverRect, pitchHue, PIECE_HUE, type RenderTarget } from './target';
import { ROSTER, bandCenter, bandWidth, type DrumPiece, type KitLayout } from '../mapping/kit';

/**
 * Todo lo que se ve encima del video: esqueleto, rejilla de la escala, efectos y
 * el anillo de los bucles.
 *
 * Pinta contra un `RenderTarget` en lugar de contra su propio lienzo, y esa es
 * la decision que sostiene la funcion de compartir: el video que se graba se
 * dibuja con este mismo codigo, en vertical y a otra resolucion, en vez de ser
 * una captura de pantalla recortada. Lo que se comparte se ve tan bien como lo
 * que se toca.
 */

/** Lo que tarda en apagarse el destello de una banda golpeada. */
const FLASH_SECONDS = 0.18;

const FINGER_COLORS: Record<Finger, string> = {
  palm: 'rgba(255,255,255,0.5)',
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
  midi: number;
  gateOpen: boolean;
  volume: number;
  loops: LoopState;
  /** Zona que la melodia guiada pide ahora, o null. */
  targetZone: number | null;
  /** Nota que sostiene el pedal, en MIDI, o null si no hay ninguna. */
  drone: number | null;
  /** Modo bateria: en vez de la rejilla de la escala se dibuja la del kit. */
  drums: boolean;
  /**
   * Que pieza hay debajo de cada banda. Solo se mira en bateria.
   *
   * Viene en el fotograma y no de una constante porque el reparto se puede
   * cambiar: lo que se dibuja tiene que ser lo que suena al golpear ahi, o las
   * bandas pasan de ser la explicacion a ser la mentira.
   */
  kit: KitLayout;
  showRawTrace: boolean;
  /** Dibujar las manos que grabaron cada capa mientras la capa suena. */
  ghosts: boolean;
  /**
   * La franja de quien toca. El encuadre entero salvo en duo a media pantalla.
   *
   * La rejilla y las bandas se dibujan dentro de ella, y ahi esta todo el
   * asunto: sin esto, en duo a media pantalla las dos personas verian las notas
   * donde no estan, que es peor que no ver rejilla ninguna.
   */
  lens: Lens;
  /**
   * Las demas personas, si hay mas de una. Se dibujan igual que la primera.
   *
   * Una lista y no una sola porque a una mano cada una pueden ser hasta cuatro.
   * Vacia cuando se toca solo, que es lo de siempre.
   */
  partners: readonly PartnerFrame[];
}

/**
 * Lo poco que hace falta para dibujar a la otra persona.
 *
 * No un OverlayFrame entero: casi todo lo que hay ahi -los bucles, la guia, el
 * rotulo de la nota- es de una sola persona y ya esta puesto. Lo que cambia entre
 * las dos es donde tienen las manos, en que franja tocan y que nota estan
 * apuntando.
 */
export interface PartnerFrame {
  assignment: RoleAssignment;
  lens: Lens;
  pitchX: number;
  gateOpen: boolean;
}

/** Dos franjas son la misma cuando empiezan y acaban en el mismo sitio. */
function sameLens(a: Lens, b: Lens): boolean {
  return a.from === b.from && a.to === b.to;
}

export interface PaintOptions {
  /** Dibuja el fotograma de la camara en el propio lienzo (grabacion). */
  video?: HTMLVideoElement;
  /**
   * Rellena el destino con un degradado propio antes de pintar nada.
   *
   * Es lo que sostiene el modo de solo manos: en pantalla tapa el video que hay
   * detras del lienzo, y en el clip ocupa el sitio del fotograma que no se
   * dibuja. Sin esto, el lienzo transparente de la pantalla dejaria ver la
   * camara igualmente.
   */
  backdrop?: boolean;
  mirror?: boolean;
  /** Marca discreta con el nombre y la direccion. Solo en lo que se comparte. */
  watermark?: boolean;
  /** Nota grande sobreimpresa. En pantalla la pone el HUD en HTML. */
  caption?: boolean;
  /**
   * Lo fuerte que se dibujan las manos de las capas. 1 es lo normal.
   *
   * Sobre el instrumento van tenues a proposito: son una referencia y lo que
   * manda es la mano propia. En la pantalla de escuchar no hay mano propia ni
   * instrumento, asi que ahi son lo unico que hay que ver y suben.
   */
  ghostStrength?: number;
}

export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly visualizer = new Visualizer();
  /** Lo que le queda de destello a cada banda, de 1 a 0. */
  private readonly flashes: Record<DrumPiece, number> = {
    kick: 0, snare: 0, tomLow: 0, tomHigh: 0, hat: 0, crash: 0,
  };
  /**
   * Un fantasma por capa, preparado una vez.
   *
   * Preparar uno cuesta recorrer la capa entera deshaciendo cada evento, y una
   * capa no cambia nunca despues de cerrarse. Ademas se pinta dos veces por
   * fotograma mientras se graba un clip -la pantalla y el video-, asi que sin
   * esto seria el doble de un trabajo que ya sobraba entero.
   */
  private readonly ghosts = new Map<number, TrackGhost>();
  private ghostCycle = 0;
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

  /** Avanza los efectos. Una vez por fotograma, no una vez por destino. */
  update(frame: OverlayFrame, dtSeconds: number): void {
    this.visualizer.update(
      {
        gateOpen: frame.gateOpen,
        midi: frame.midi,
        volume: frame.volume,
        source: this.pinchPoint(frame),
      },
      dtSeconds,
    );
    // El destello dura poco a proposito: tiene que leerse como un golpe y no
    // como una banda encendida, que es lo que parece en cuanto se solapa con el
    // siguiente.
    for (const piece of ROSTER) {
      const left = this.flashes[piece];
      if (left > 0) this.flashes[piece] = Math.max(0, left - dtSeconds / FLASH_SECONDS);
    }
  }

  attack(frame: OverlayFrame): void {
    this.visualizer.attack(this.pinchPoint(frame), frame.midi);
  }

  /**
   * La salpicadura de un golpe, donde ha caido la mano y del color de su pieza.
   *
   * No reutiliza `attack` porque ahi el punto es la pinza de la mano de melodia,
   * y en bateria golpean las dos manos: la salpicadura tiene que salir de la que
   * ha dado el golpe, o deja de decir cual de las dos ha sonado. Y el destello
   * de la banda es lo que convierte el color en informacion: si la mano ha
   * entrado en la pieza de al lado, se ve antes de oirlo.
   */
  splash(x: number, y: number, piece: DrumPiece): void {
    this.visualizer.splash({ x, y }, PIECE_HUE[piece]);
    this.flashes[piece] = 1;
  }

  resetEffects(): void {
    this.visualizer.reset();
    for (const piece of ROSTER) this.flashes[piece] = 0;
  }

  /**
   * Deja el lienzo limpio.
   *
   * Lo necesita la demostracion al terminar: el bucle de fotogramas para, y sin
   * esto la ultima mano se queda dibujada encima de la pantalla inicial.
   */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Destino que representa el lienzo visible. */
  get screenTarget(): RenderTarget {
    return { ctx: this.ctx, width: this.canvas.width, height: this.canvas.height, unit: this.dpr };
  }

  paint(target: RenderTarget, frame: OverlayFrame, videoWidth: number, videoHeight: number, options: PaintOptions = {}): void {
    const { ctx } = target;
    ctx.clearRect(0, 0, target.width, target.height);

    if (options.backdrop) this.drawBackdrop(target);
    if (options.video) this.drawVideo(target, options.video, videoWidth, videoHeight, options.mirror ?? false);

    const rect = coverRect(target, videoWidth, videoHeight);
    this.visualizer.paintBackground(target);
    // La rejilla se calibro contra una imagen de camara. Sobre el fondo oscuro
    // del modo de solo manos, con esos mismos valores, casi no se ve: hay que
    // subirla, porque ahi es de lo poco que queda en pantalla.
    const lift = options.backdrop ? 1.7 : 1;
    const mine = { pitchX: frame.pitchX, gateOpen: frame.gateOpen };
    /*
     * Una rejilla por franja, no una por persona.
     *
     * A media pantalla son dos cosas distintas y hay dos rejillas, cada una con
     * su escala entera: sin la suya, la segunda persona no sabe donde estan sus
     * notas, porque la de al lado no le sirve. A una mano cada una las franjas
     * son todas la misma, y ahi dibujarla una vez por persona no anade nada:
     * suma la misma linea sobre si misma y la deja del doble de fuerte. Por eso
     * lo que se agrupa es la franja y no la gente.
     */
    const sharing = frame.partners.filter((partner) => sameLens(partner.lens, frame.lens));
    const apart = frame.partners.filter((partner) => !sameLens(partner.lens, frame.lens));
    if (frame.drums) this.drawKit(target, rect, frame.kit, lift, frame.lens);
    else this.drawGrid(target, rect, frame, lift, frame.lens, [mine, ...sharing], frame.targetZone);
    for (const partner of apart) {
      if (frame.drums) this.drawKit(target, rect, frame.kit, lift, partner.lens);
      else this.drawGrid(target, rect, frame, lift, partner.lens, [partner], null);
      this.drawSplit(target, rect, frame, partner);
    }

    const melody = frame.assignment.melody;
    const expression = frame.assignment.expression;

    // Debajo de las manos de verdad, que es el sitio: la propia va encima.
    if (frame.ghosts) this.drawGhosts(target, rect, frame, options.ghostStrength ?? 1);

    if (expression) {
      // En bateria las dos manos hacen lo mismo, asi que la de expresion se
      // dibuja tan presente como la otra: atenuarla diria que es la secundaria.
      this.drawHand(target, rect, expression.hand.landmarks, expression.held, frame.drums ? 1 : 0.5);
      // Y los rotulos de rol sobran: ahi ninguna de las dos es la melodia.
      if (!frame.drums) this.drawRoleTag(target, rect, expression.hand.landmarks, t().overlay.expressionTag, expression.held);
      if (frame.drone !== null) this.drawDrone(target, rect, expression.hand.landmarks, frame.drone);
    }
    // Las demas, antes que la propia: al cruzarse, las manos de uno tienen que
    // quedar encima de las de los otros, que es lo que dice cual es la tuya.
    for (const partner of frame.partners) {
      for (const role of ['expression', 'melody'] as const) {
        const tracked = partner.assignment[role];
        if (!tracked) continue;
        this.drawHand(target, rect, tracked.hand.landmarks, tracked.held, 1);
        // Con su rotulo, igual que la propia: saber cual de tus dos manos lleva
        // la nota es lo primero que hay que saber, y en duo hay cuatro manos
        // repartidas en dos instrumentos.
        if (!frame.drums) {
          const label = role === 'melody' ? t().overlay.melodyTag : t().overlay.expressionTag;
          this.drawRoleTag(target, rect, tracked.hand.landmarks, label, tracked.held);
        }
      }
    }

    if (melody) {
      if (frame.showRawTrace) this.drawRawTrace(target, rect, melody.hand.raw);
      this.drawHand(target, rect, melody.hand.landmarks, melody.held, 1, frame.gateOpen);
      if (!frame.drums) {
        this.drawRoleTag(target, rect, melody.hand.landmarks, t().overlay.melodyTag, melody.held);
        // El circulo de la pinza mide lo que le falta para sonar, y en bateria
        // no le falta nada porque no es la pinza lo que hace sonar.
        this.drawPinch(target, rect, melody.hand.landmarks, frame);
      }
    }

    this.visualizer.paintForeground(target, videoWidth, videoHeight);
    this.drawLoopRing(target, frame.loops);
    /*
     * El rotulo grande del clip dice la nota, y en bateria no hay ninguna: hasta
     * ahora escribia el nombre de una que no sonaba, en gris, en la esquina de un
     * video que alguien va a compartir. Ahi el rotulo ya existe y son las bandas,
     * cada una con su nombre y su color debajo de la mano.
     */
    if (options.caption && !frame.drums) this.drawCaption(target, frame);
    if (options.watermark) this.drawWatermark(target);
  }

  private pinchPoint(frame: OverlayFrame): { x: number; y: number } | null {
    const melody = frame.assignment.melody;
    if (!melody || melody.hand.landmarks.length < 21) return null;
    const thumb = point(melody.hand.landmarks, 4);
    const index = point(melody.hand.landmarks, 8);
    return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
  }

  /**
   * Fondo del modo de solo manos.
   *
   * Opaco a proposito: es lo unico que separa la camara de la pantalla en ese
   * modo, y un degradado translucido dejaria una silueta reconocible detras.
   */
  private drawBackdrop(target: RenderTarget): void {
    const { ctx, width, height } = target;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#0b1020');
    sky.addColorStop(0.55, '#070a14');
    sky.addColorStop(1, '#03050c');
    ctx.save();
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  private drawVideo(
    target: RenderTarget,
    video: HTMLVideoElement,
    videoWidth: number,
    videoHeight: number,
    mirror: boolean,
  ): void {
    const rect = coverRect(target, videoWidth, videoHeight);
    const { ctx } = target;
    ctx.save();
    if (mirror) {
      // El espejo se aplica solo al fotograma. Los puntos ya vienen en espacio
      // de vista, asi que reflejarlos otra vez los descuadraria.
      ctx.translate(target.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, target.width - rect.x - rect.w, rect.y, rect.w, rect.h);
    } else {
      ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
  }

  /**
   * La rejilla de la bateria. No se parece a la de la escala y no debe.
   *
   * Las zonas de una escala son puntos en un continuo: la mano se desliza entre
   * ellas y lo que hay que ensenar es donde esta cada centro. Las piezas de un
   * kit son territorios con frontera: dentro de la banda suena la caja y un
   * dedo mas alla suena el charles, sin nada en medio. Por eso aqui se pintan
   * las fronteras y el suelo de cada banda, y no unas lineas por el centro que
   * dejarian lo unico que importa —donde acaba una pieza y empieza la otra— sin
   * dibujar.
   */
  private drawKit(target: RenderTarget, rect: Rect2, bands: KitLayout, lift: number, lens: Lens = FULL_LENS): void {
    const { ctx } = target;
    const top = target.height * 0.08;
    const bottom = target.height * 0.84;
    const labelY = target.height * 0.885;
    const labelPad = 24 * target.unit;
    const names = t().pieces;

    ctx.save();
    ctx.font = `${11 * target.unit}px ui-monospace, monospace`;
    ctx.textAlign = 'center';

    // Tantas bandas como piezas haya puestas: el reparto es la lista de lo que
    // esta en el escenario, y el encuadre se parte en tantas partes como haya.
    const count = bands.length;
    const width = bandWidth(count);
    for (let i = 0; i < count; i += 1) {
      // El reparto llega ya saneado del mapeador, que es el mismo que decide
      // que suena al golpear ahi: no hay forma de que la banda diga una pieza y
      // suene otra. El respaldo es para el compilador, que eso no lo sabe.
      const piece = bands[i] ?? ROSTER[i]!;
      const hue = PIECE_HUE[piece];
      const left = rect.x + denormalizeIn(i * width, lens) * rect.w;
      const right = rect.x + denormalizeIn((i + 1) * width, lens) * rect.w;
      const flash = this.flashes[piece];

      // El relleno permanente es casi invisible y aun asi hace todo el trabajo:
      // sin el, cuatro rayas verticales no dicen que hay cuatro territorios.
      const fill = ctx.createLinearGradient(0, top, 0, bottom);
      const base = Math.min(1, 0.05 * lift);
      fill.addColorStop(0, `hsla(${hue}, 90%, 60%, 0)`);
      fill.addColorStop(1, `hsla(${hue}, 90%, 60%, ${base + flash * 0.42})`);
      ctx.fillStyle = fill;
      ctx.fillRect(left, top, right - left, bottom - top);

      // La frontera: solo las de dentro, que son las que hay que ver. Las de los
      // extremos coinciden con el borde del encuadre util y no separan nada.
      if (i > 0) {
        const line = ctx.createLinearGradient(left, top, left, bottom);
        const strength = Math.min(1, 0.18 * lift);
        line.addColorStop(0, 'rgba(255,255,255,0)');
        line.addColorStop(0.5, `rgba(255,255,255,${strength})`);
        line.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = line;
        ctx.lineWidth = 1 * target.unit;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, bottom);
        ctx.stroke();
      }

      const x = rect.x + denormalizeIn(bandCenter(i, count), lens) * rect.w;
      const labelX = Math.min(Math.max(x, labelPad), target.width - labelPad);
      ctx.fillStyle = `hsla(${hue}, 90%, ${70 + flash * 25}%, ${Math.min(1, (0.45 + flash * 0.5) * lift)})`;
      ctx.fillText(names[piece], labelX, labelY);
    }
    ctx.restore();
  }

  /**
   * @param lens la franja sobre la que se dibuja.
   * @param highlights una columna encendida por persona que toque EN esta franja.
   * Son varias porque a una mano cada una las dos comparten encuadre: ahi la
   * rejilla es una sola y lo que hay que ver son las dos notas a la vez. A media
   * pantalla es una por rejilla, que es el caso de siempre con otro nombre.
   * @param targetZone la guia, que es de quien toca y no de la otra persona.
   */
  private drawGrid(
    target: RenderTarget,
    rect: Rect2,
    frame: OverlayFrame,
    lift: number,
    lens: Lens,
    highlights: readonly { pitchX: number; gateOpen: boolean }[],
    targetZone: number | null,
  ): void {
    const { ctx } = target;
    const centers = zoneCenters(frame.layout);
    if (centers.length === 0) return;

    // La rejilla no llega hasta abajo del todo: ahi viven la barra de acciones y
    // las capas de bucle, y unas lineas cruzandolas ensucian sin informar.
    const top = target.height * 0.08;
    const bottom = target.height * 0.84;
    const labelY = target.height * 0.885;
    const labelPad = 24 * target.unit;
    const actives = highlights
      .filter((each) => each.pitchX >= 0 && centers.length > 1)
      .map((each) => ({
        index: Math.round(Math.min(1, Math.max(0, each.pitchX)) * (centers.length - 1)),
        gateOpen: each.gateOpen,
      }));

    ctx.save();
    ctx.font = `${11 * target.unit}px ui-monospace, monospace`;
    ctx.textAlign = 'center';

    for (let i = 0; i < centers.length; i += 1) {
      const zone = centers[i] ?? 0;
      const x = rect.x + denormalizeIn(zone, lens) * rect.w;
      const semitone = frame.layout.degrees[i] ?? 0;
      const isTonic = semitone % 12 === 0;
      const active = actives.find((each) => each.index === i);
      const isActive = active !== undefined;
      const isTarget = i === targetZone;

      if (isActive) {
        // Columna de luz en la zona activa: el interprete ve donde esta antes de
        // que suene, que es lo que permite apuntar a una nota concreta.
        const hue = pitchHue(frame.layout.baseMidi + semitone);
        const column = ctx.createLinearGradient(x, top, x, bottom);
        const alpha = active!.gateOpen ? 0.3 : 0.12;
        column.addColorStop(0, `hsla(${hue}, 95%, 65%, 0)`);
        column.addColorStop(0.5, `hsla(${hue}, 95%, 65%, ${alpha})`);
        column.addColorStop(1, `hsla(${hue}, 95%, 65%, 0)`);
        ctx.fillStyle = column;
        const halfWidth = ((rect.w * (lens.to - lens.from)) / Math.max(centers.length - 1, 1)) * 0.42;
        ctx.fillRect(x - halfWidth, top, halfWidth * 2, bottom - top);
      }

      if (isTarget) {
        // El objetivo se marca con un trazo continuo y un cabezal arriba: tiene
        // que leerse de un vistazo y sin confundirse con la zona activa, porque
        // durante media melodia son dos sitios distintos.
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 2 * target.unit;
        ctx.setLineDash([6 * target.unit, 5 * target.unit]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(x, top + 10 * target.unit);
        ctx.lineTo(x - 7 * target.unit, top);
        ctx.lineTo(x + 7 * target.unit, top);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const line = ctx.createLinearGradient(x, top, x, bottom);
      const strength = Math.min(1, (isActive ? 0.85 : isTonic ? 0.3 : 0.13) * lift);
      line.addColorStop(0, `rgba(255,255,255,0)`);
      line.addColorStop(0.5, `rgba(255,255,255,${strength})`);
      line.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.strokeStyle = line;
      ctx.lineWidth = (isActive ? 2.4 : isTonic ? 1.4 : 1) * target.unit;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();

      if (isTonic || isActive || isTarget) {
        const labelX = Math.min(Math.max(x, labelPad), target.width - labelPad);
        ctx.fillStyle = isActive ? 'rgba(255,255,255,0.95)' : `rgba(255,255,255,${Math.min(1, 0.38 * lift)})`;
        ctx.fillText(midiToName(frame.layout.baseMidi + semitone, t().notes), labelX, labelY);
      }
    }
    ctx.restore();
  }

  private drawHand(
    target: RenderTarget,
    rect: Rect2,
    landmarks: readonly Landmark[],
    held: boolean,
    alpha: number,
    glowing = false,
  ): void {
    if (landmarks.length < 21) return;
    const { ctx } = target;
    ctx.save();
    // Una mano sostenida por el margen de gracia se dibuja translucida: el
    // interprete ve que el sistema la esta recordando, no detectando.
    ctx.globalAlpha = alpha * (held ? 0.35 : 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glowing) {
      ctx.shadowBlur = 14 * target.unit;
      ctx.shadowColor = `hsla(${this.visualizer.currentHue}, 95%, 65%, 0.9)`;
    }

    for (const bone of HAND_BONES) {
      ctx.strokeStyle = FINGER_COLORS[bone.finger];
      ctx.lineWidth = (bone.finger === 'palm' ? 2 : 3.2) * target.unit;
      ctx.beginPath();
      for (const [a, b] of bone.pairs) {
        const pa = this.toCanvas(rect, point(landmarks, a));
        const pb = this.toCanvas(rect, point(landmarks, b));
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const lm of landmarks) {
      const p = this.toCanvas(rect, lm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.3 * target.unit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * La nota pedal, en la mano que la sostiene.
   *
   * Un anillo del color de esa nota entre los dos dedos que la sujetan, y el
   * nombre debajo. Es el unico sitio donde se ve: la nota grande del HUD es la
   * que se esta tocando, y la del pedal es otra.
   */
  private drawDrone(target: RenderTarget, rect: Rect2, landmarks: readonly Landmark[], midi: number): void {
    if (landmarks.length < 21) return;
    const { ctx } = target;
    const thumb = this.toCanvas(rect, point(landmarks, 4));
    const index = this.toCanvas(rect, point(landmarks, 8));
    const mid = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
    const hue = pitchHue(midi);
    const radius = 13 * target.unit;

    ctx.save();
    ctx.strokeStyle = `hsla(${hue}, 95%, 70%, 0.9)`;
    ctx.lineWidth = 2.4 * target.unit;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    const halo = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, radius * 2.4);
    halo.addColorStop(0, `hsla(${hue}, 95%, 70%, 0.5)`);
    halo.addColorStop(1, `hsla(${hue}, 95%, 60%, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${11 * target.unit}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = `hsla(${hue}, 95%, 78%, 0.95)`;
    ctx.fillText(midiToName(midi, t().notes), mid.x, mid.y + radius * 2.2);
    ctx.restore();
  }

  /** Puntos crudos superpuestos: hace visible cuanto trabajo hace One Euro. */
  private drawRawTrace(target: RenderTarget, rect: Rect2, landmarks: readonly Landmark[]): void {
    if (landmarks.length < 21) return;
    const { ctx } = target;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 80, 80, 0.75)';
    for (const lm of landmarks) {
      const p = this.toCanvas(rect, lm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8 * target.unit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPinch(target: RenderTarget, rect: Rect2, landmarks: readonly Landmark[], frame: OverlayFrame): void {
    if (landmarks.length < 21) return;
    const { ctx } = target;
    const thumb = this.toCanvas(rect, point(landmarks, 4));
    const index = this.toCanvas(rect, point(landmarks, 8));
    const mid = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
    const hue = pitchHue(frame.midi);

    ctx.save();
    ctx.strokeStyle = frame.gateOpen ? `hsla(${hue}, 95%, 70%, 0.95)` : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = (frame.gateOpen ? 3 : 1.5) * target.unit;
    ctx.setLineDash(frame.gateOpen ? [] : [4 * target.unit, 4 * target.unit]);
    ctx.beginPath();
    ctx.moveTo(thumb.x, thumb.y);
    ctx.lineTo(index.x, index.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (frame.gateOpen) {
      const radius = (7 + frame.volume * 7) * target.unit;
      const halo = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, radius * 3.2);
      halo.addColorStop(0, `hsla(${hue}, 95%, 72%, 0.95)`);
      halo.addColorStop(1, `hsla(${hue}, 95%, 60%, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, radius * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRoleTag(target: RenderTarget, rect: Rect2, landmarks: readonly Landmark[], label: string, held: boolean): void {
    if (landmarks.length < 21) return;
    const { ctx } = target;
    const palm = this.toCanvas(rect, palmCenter(landmarks));
    ctx.save();
    ctx.globalAlpha = held ? 0.3 : 0.6;
    ctx.font = `${10 * target.unit}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(label, palm.x, palm.y - 14 * target.unit);
    ctx.restore();
  }

  /**
   * La tierra de nadie de en medio, en duo a media pantalla.
   *
   * Es el sitio donde no se toca: los margenes de las dos franjas juntos. Sin
   * dibujarlo, las dos rejillas parecen una sola rejilla rara con un hueco en el
   * centro, y quien esta cerca del borde no entiende por que su nota no se mueve.
   * Con esto se ve que son dos instrumentos, uno al lado del otro.
   */
  private drawSplit(target: RenderTarget, rect: Rect2, frame: OverlayFrame, partner: PartnerFrame): void {
    if (partner.lens.from === frame.lens.from) return;
    const { ctx } = target;
    const left = rect.x + denormalizeIn(1, frame.lens) * rect.w;
    const right = rect.x + denormalizeIn(0, partner.lens) * rect.w;
    if (right <= left) return;
    const top = target.height * 0.08;
    const bottom = target.height * 0.84;
    ctx.save();
    const band = ctx.createLinearGradient(left, top, left, bottom);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.restore();
  }

  /**
   * Las manos que grabaron las capas, cada una en el color de la suya.
   *
   * Es lo que convierte un bucle en una leccion: la capa no guarda sonido, guarda
   * el gesto, asi que se puede volver a dibujar la mano que lo hizo y poner la
   * propia encima. Van debajo de las manos de verdad y translucidas -son una
   * referencia, no el instrumento- y las silenciadas no salen, porque una mano
   * moviendose sobre algo que no suena es exactamente la leccion equivocada.
   *
   * Y se dibujan con la escala y el reparto de AHORA: lo que ensenan es donde
   * hay que poner la mano para que suene eso, y eso cambia si se cambia la
   * escala o se mueve una pieza de banda.
   */
  private drawGhosts(target: RenderTarget, rect: Rect2, frame: OverlayFrame, strength: number): void {
    const { loops } = frame;
    if (loops.playhead < 0 || loops.cycleSeconds <= 0) return;
    const cycleTime = loops.playhead * loops.cycleSeconds;
    /*
     * La proporcion sale del recuadro que se esta pintando y no del video.
     *
     * Es lo mismo mientras haya camara, porque ese recuadro es justo el video
     * recortado. Sin camara no lo es: el video mide cero por cero, y una
     * proporcion de cero encoge el palmo hasta dejar la mano en una mota. Asi
     * que se saca de donde la sacan las manos dibujadas de verdad -el propio
     * destino, que es lo que vale cuando no hay video- y se comprueba, porque un
     * destino de altura cero existe un fotograma al arrancar.
     */
    const measured = rect.w / rect.h;
    const aspect = Number.isFinite(measured) && measured > 0 ? measured : 1;
    const scale = drawnScale(aspect);
    for (const track of loops.tracks) {
      if (track.muted) continue;
      for (const pose of this.ghostFor(track, loops).posesAt(cycleTime, frame.layout, frame.kit)) {
        this.drawGhostHand(target, rect, phantomHand({ ...pose, aspect, scale }), track.hue, strength);
      }
    }
  }

  private ghostFor(track: LoopTrack, loops: LoopState): TrackGhost {
    // El compas lo fija la primera capa, asi que si cambia es que se vaciaron
    // los bucles y lo que hay ahora es otra cosa con los mismos numeros.
    if (loops.cycleSeconds !== this.ghostCycle) {
      this.ghosts.clear();
      this.ghostCycle = loops.cycleSeconds;
    } else if (this.ghosts.size > loops.tracks.length) {
      // Deshacer una capa la quita de la lista y deja aqui la suya: son cuatro
      // como mucho a la vez, pero grabar y deshacer se puede hacer toda la tarde.
      const live = new Set(loops.tracks.map((each) => each.id));
      for (const id of [...this.ghosts.keys()]) if (!live.has(id)) this.ghosts.delete(id);
    }
    let ghost = this.ghosts.get(track.id);
    if (!ghost) {
      ghost = new TrackGhost(track, loops.cycleSeconds);
      this.ghosts.set(track.id, ghost);
    }
    return ghost;
  }

  /**
   * Una mano fantasma: el esqueleto entero de un color solo.
   *
   * Sin los colores por dedo de una mano de verdad, y a proposito: lo que tiene
   * que decir de un vistazo es de que capa es, no que dedo es cual. El color es
   * el mismo con el que esa capa sale en el anillo y en su carril.
   */
  private drawGhostHand(
    target: RenderTarget,
    rect: Rect2,
    landmarks: readonly Landmark[],
    hue: number,
    strength: number,
  ): void {
    if (landmarks.length < 21) return;
    const { ctx } = target;
    // Nunca opaca del todo: una mano fantasma que tapa lo que hay detras deja de
    // leerse como una referencia y empieza a leerse como la mano de verdad.
    const alpha = Math.min(0.85, 0.4 * strength);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${alpha})`;
    ctx.lineWidth = (strength > 1 ? 2.6 : 2) * target.unit;
    ctx.beginPath();
    for (const bone of HAND_BONES) {
      for (const [a, b] of bone.pairs) {
        const pa = this.toCanvas(rect, point(landmarks, a));
        const pb = this.toCanvas(rect, point(landmarks, b));
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
    }
    ctx.stroke();

    // La palma marcada, que es el punto que decide: la nota en melodia y la
    // banda en bateria. Lo demas es la forma de la mano, no lo que hay que ir a
    // buscar.
    const palm = this.toCanvas(rect, palmCenter(landmarks));
    ctx.fillStyle = `hsla(${hue}, 95%, 72%, ${Math.min(0.95, 0.55 * strength)})`;
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, 4 * target.unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Anillo con el ciclo de los bucles y una marca por capa. */
  private drawLoopRing(target: RenderTarget, loops: LoopState): void {
    if (loops.cycleSeconds <= 0 && !loops.recording) return;
    const { ctx } = target;
    const radius = 20 * target.unit;
    const cx = target.width - radius - 22 * target.unit;
    const cy = target.height - radius - 22 * target.unit;

    ctx.save();
    ctx.lineWidth = 3 * target.unit;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (loops.playhead >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + loops.playhead * Math.PI * 2);
      ctx.stroke();
    }

    if (loops.recording) {
      ctx.fillStyle = '#ff5f56';
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `600 ${13 * target.unit}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(loops.tracks.length), cx, cy);
    }

    // Una marca por capa alrededor del anillo.
    for (let i = 0; i < loops.tracks.length; i += 1) {
      const track = loops.tracks[i]!;
      const angle = -Math.PI / 2 + (i / Math.max(loops.tracks.length, 1)) * Math.PI * 2;
      ctx.fillStyle = track.muted ? 'rgba(255,255,255,0.2)' : `hsl(${track.hue}, 90%, 62%)`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * (radius + 9 * target.unit), cy + Math.sin(angle) * (radius + 9 * target.unit), 3 * target.unit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Nota grande. Solo en el video: en pantalla el HUD la pinta en HTML. */
  private drawCaption(target: RenderTarget, frame: OverlayFrame): void {
    const { ctx } = target;
    const size = Math.max(30, target.height * 0.062);
    ctx.save();
    ctx.font = `650 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 18 * target.unit;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = frame.gateOpen ? `hsla(${pitchHue(frame.midi)}, 95%, 72%, 1)` : 'rgba(255,255,255,0.55)';
    ctx.fillText(midiToName(frame.midi, t().notes), 26 * target.unit, 26 * target.unit);
    ctx.restore();
  }

  /**
   * Marca del proyecto en el video.
   *
   * Es la unica pieza de todo esto que existe por una razon que no es musical:
   * un video compartido sin la direccion es un callejon sin salida. Quien lo vea
   * no tiene forma de llegar hasta aqui.
   */
  private drawWatermark(target: RenderTarget): void {
    const { ctx } = target;
    const size = Math.max(13, target.height * 0.021);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowBlur = 12 * target.unit;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText('theremano', target.width / 2, target.height - size * 1.9);
    ctx.font = `${size * 0.78}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fillText(watermarkHost(), target.width / 2, target.height - size * 0.7);
    ctx.restore();
  }

  private toCanvas(rect: Rect2, p: { x: number; y: number }): { x: number; y: number } {
    return { x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h };
  }
}

interface Rect2 {
  x: number;
  y: number;
  w: number;
  h: number;
}

function watermarkHost(): string {
  try {
    const { host, pathname } = window.location;
    const path = pathname.replace(/\/$/, '');
    return `${host}${path}`;
  } catch {
    return 'theremano';
  }
}
