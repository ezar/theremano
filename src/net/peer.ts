/**
 * Dos dispositivos tocando juntos, sin un servidor en medio.
 *
 * Lo que va por el cable son gestos y no audio, que es la misma decision que
 * hace que una interpretacion quepa en un enlace: cada navegador sintetiza con
 * su propio motor y lo que se manda es lo que la mano esta haciendo. Una docena
 * de bytes por fotograma.
 *
 * ## Como se conectan, y por que asi
 *
 * WebRTC necesita que los dos extremos se cuenten donde estan antes de hablarse,
 * y eso se llama senalizacion. Normalmente lo hace un servidor: los dos se
 * conectan a el, el les pasa los papeles y se aparta. Aqui no hay servidor, asi
 * que el papel lo pasa quien toca: uno genera un codigo, se lo manda al otro por
 * donde quiera -un mensaje, un correo, leyendolo en voz alta si tiene paciencia-,
 * el otro lo pega y devuelve un segundo codigo, y con ese se abre el canal.
 *
 * Son dos viajes de copiar y pegar antes de que suene una nota, y eso es
 * incomodo y no hay forma de que no lo sea sin poner un servidor. Es la eleccion
 * que se tomo: el README promete que esto no tiene servidor, y un servicio de
 * terceros para esto seria dejar de prometerlo.
 *
 * ## Lo que si es una dependencia, y conviene decirlo
 *
 * Para conectar dos dispositivos que no estan en la misma red hace falta que
 * cada uno averigue su direccion publica, y eso lo dice un STUN: un servidor
 * ajeno al que se le pregunta una vez y que no ve ni un byte de lo que se toca.
 * Se usa uno publico. En la misma red -dos dispositivos en el mismo wifi- no
 * hace falta y la conexion se abre sin preguntarle a nadie.
 *
 * "Sin servidor" sigue siendo verdad en lo que importa: no hay nada que montar,
 * nada que pagar y nada que se entere de lo que suena. Pero no es "sin red".
 */

import { decodeGesture, encodeGesture, type GesturePacket } from './packet';

/**
 * A quien se le pregunta la direccion publica.
 *
 * Uno y publico. Solo se le pregunta al abrir, no ve el trafico y no hace falta
 * en la misma red.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** El canal por donde van los gestos, configurado para tiempo real. */
const CHANNEL = 'theremano';

/**
 * Sin reintentos y sin orden, que es lo contrario de lo que se pide siempre.
 *
 * Un paquete de gesto caduca en cuanto llega el siguiente: reintentar el de hace
 * tres fotogramas para entregarlo en orden retrasaria todo lo que viene detras
 * para reproducir un instante que ya paso. Es la misma razon por la que el audio
 * en directo va por UDP y no por TCP. Perder uno se oye como nada, porque el
 * siguiente trae el estado completo; esperarlo se oye como un tropiezo.
 */
const CHANNEL_OPTIONS: RTCDataChannelInit = { ordered: false, maxRetransmits: 0 };

export type PeerState = 'idle' | 'inviting' | 'joining' | 'connected' | 'failed';

export interface PeerEvents {
  onGesture: (packet: GesturePacket) => void;
  onState: (state: PeerState) => void;
}

/**
 * Empaqueta lo que hay que copiar y pegar.
 *
 * El SDP que genera el navegador es un texto largo con saltos de linea, que en
 * un mensaje se rompe y pegado a medias no conecta. Se comprime a base64 de
 * direcciones -las mismas letras que ya usa el enlace de una interpretacion- de
 * modo que es una sola palabra, larga pero una, que sobrevive a cualquier sitio
 * por donde se mande.
 */
function pack(description: RTCSessionDescriptionInit): string {
  const json = JSON.stringify({ t: description.type, s: description.sdp });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unpack(code: string): RTCSessionDescriptionInit | null {
  try {
    const normal = code.trim().replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { t?: string; s?: string };
    // Lo que llega aqui lo ha pegado alguien de un mensaje: puede venir
    // recortado, con un espacio de mas o directamente ser otra cosa.
    if ((parsed.t !== 'offer' && parsed.t !== 'answer') || typeof parsed.s !== 'string') return null;
    return { type: parsed.t, sdp: parsed.s };
  } catch {
    return null;
  }
}

export class Peer {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private state: PeerState = 'idle';

  constructor(private readonly events: PeerEvents) {}

  get currentState(): PeerState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.channel?.readyState === 'open';
  }

  /**
   * Quien invita: genera el codigo que hay que mandarle al otro.
   *
   * Espera a que el navegador termine de recoger direcciones antes de devolver
   * nada, y eso es lo que tarda unos segundos. Se podrian ir mandando por
   * separado segun aparecen -es lo que hace un servidor de senalizacion- pero
   * aqui no hay por donde mandarlas: el codigo se copia una vez, asi que tiene
   * que llevarlo todo.
   */
  async invite(): Promise<string | null> {
    this.close();
    const connection = this.open();
    this.attach(connection.createDataChannel(CHANNEL, CHANNEL_OPTIONS));
    await connection.setLocalDescription(await connection.createOffer());
    await this.gathered(connection);
    this.set('inviting');
    return connection.localDescription ? pack(connection.localDescription) : null;
  }

  /**
   * Quien se une: lee el codigo del otro y devuelve el suyo.
   *
   * @returns el codigo de vuelta, o null si lo que se pego no es una invitacion.
   */
  async join(code: string): Promise<string | null> {
    const offer = unpack(code);
    if (!offer || offer.type !== 'offer') return null;
    this.close();
    const connection = this.open();
    // El canal lo crea quien invita; aqui se espera a que llegue.
    connection.ondatachannel = (event) => this.attach(event.channel);
    await connection.setRemoteDescription(offer);
    await connection.setLocalDescription(await connection.createAnswer());
    await this.gathered(connection);
    this.set('joining');
    return connection.localDescription ? pack(connection.localDescription) : null;
  }

  /** Quien invito, cerrando el trato con el codigo de vuelta del otro. */
  async accept(code: string): Promise<boolean> {
    const answer = unpack(code);
    if (!answer || answer.type !== 'answer' || !this.connection) return false;
    await this.connection.setRemoteDescription(answer);
    return true;
  }

  /**
   * Manda lo que se esta tocando. Se llama en cada fotograma.
   *
   * Se traga lo que pase: un canal que se cae a mitad de una nota no puede
   * tumbar el bucle de fotogramas de quien esta tocando.
   */
  send(packet: GesturePacket): void {
    if (this.channel?.readyState !== 'open') return;
    try {
      // El buffer y no la vista: el tipo del canal pide un ArrayBuffer a secas,
      // y la vista que sale del codificador ocupa el buffer entero.
      this.channel.send(encodeGesture(packet).buffer as ArrayBuffer);
    } catch {
      /* el canal se ha caido; el cambio de estado llega por su propio camino */
    }
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.connection?.close();
    this.connection = null;
    this.set('idle');
  }

  private open(): RTCPeerConnection {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    connection.onconnectionstatechange = () => {
      const phase = connection.connectionState;
      if (phase === 'failed' || phase === 'disconnected' || phase === 'closed') this.set('failed');
    };
    this.connection = connection;
    return connection;
  }

  private attach(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.set('connected');
    channel.onclose = () => this.set('idle');
    channel.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const packet = decodeGesture(new Uint8Array(event.data));
      // Lo que no es exactamente un paquete se tira sin mas: por la red llega lo
      // que llega, y un paquete a medio entender es una nota que nadie ha tocado.
      if (packet) this.events.onGesture(packet);
    };
    this.channel = channel;
  }

  /**
   * Espera a que el navegador acabe de recoger direcciones.
   *
   * Con un tope, porque hay redes en las que la recogida no termina nunca: si a
   * los tres segundos no ha acabado, se manda lo que haya. Lo que suele faltar
   * son las direcciones de ultimo recurso, y sin ellas se conecta igual en la
   * mayoria de los casos.
   */
  private gathered(connection: RTCPeerConnection): Promise<void> {
    if (connection.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        connection.removeEventListener('icegatheringstatechange', check);
        window.clearTimeout(timer);
        resolve();
      };
      const check = (): void => {
        if (connection.iceGatheringState === 'complete') done();
      };
      const timer = window.setTimeout(done, 3000);
      connection.addEventListener('icegatheringstatechange', check);
    });
  }

  private set(state: PeerState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onState(state);
  }
}
