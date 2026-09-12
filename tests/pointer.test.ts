import { describe, expect, it } from 'vitest';
import { JUMP, PRESS_SECONDS, PointerPlayer } from '../src/mapping/pointer';
import { CLOSED_PINCH, OPEN_PINCH, drawnScale, phantomHand, type HandPose } from '../src/tracking/phantom';
import { PINCH_CLOSE, PINCH_OPEN } from '../src/mapping/gate';
import { Mapper } from '../src/mapping/mapper';
import { denormalize } from '../src/mapping/features';
import { zoneCenters } from '../src/mapping/scales';
import { DEFAULT_SETTINGS } from '../src/state/store';
import type { RoleAssignment } from '../src/tracking/types';

/**
 * Tocar con el raton o con el dedo.
 *
 * Lo que se comprueba aqui no es que suene: es que suene la nota que se ha
 * pulsado. Con el dedo, cada nota es un toque en un sitio distinto de la
 * pantalla, y el filtro del tono, que existe para limar el temblor de una mano
 * de verdad, llega a la nota nueva dos decimas tarde. Sin tratar ese salto, el
 * instrumento toca la zona de la que venia y parece desafinado.
 */

const FPS = 60;
const ASPECT = 0.46;

class Session {
  readonly mapper = new Mapper(DEFAULT_SETTINGS);
  readonly player = new PointerPlayer();
  /** MIDI de cada nota que ha entrado, en orden. */
  readonly attacks: number[] = [];
  releases = 0;
  gain = 0;
  drone = 0;
  private seconds = 0;

  /** Donde cae una zona de la escala en el encuadre, en espacio de vista. */
  zone(index: number): number {
    return denormalize(zoneCenters(this.mapper.currentLayout)[index] ?? 0.5);
  }

  /** La nota que corresponde a esa zona, para comparar con la que sono. */
  midi(index: number): number {
    const layout = this.mapper.currentLayout;
    return layout.baseMidi + (layout.degrees[index] ?? 0);
  }

  advance(seconds: number, fps = FPS): void {
    const dt = 1 / fps;
    for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) {
      this.seconds += dt;
      const pose = this.player.update(dt);
      const second = this.player.expression;
      const drawn = (hand: HandPose) => {
        const landmarks = phantomHand({ ...hand, aspect: ASPECT, scale: drawnScale(ASPECT) });
        return { hand: { landmarks, raw: landmarks }, held: false, heldFor: 0 };
      };
      const assignment: RoleAssignment = {
        melody: pose ? drawn(pose) : null,
        expression: second ? drawn(second) : null,
      };
      const output = this.mapper.update(assignment, this.seconds);
      if (output.gateEvent === 'attack') {
        this.attacks.push(output.midi);
        this.gain = output.gain;
      }
      if (output.gateEvent === 'release') this.releases += 1;
      this.drone = output.drone;
    }
  }
}

describe('puntero', () => {
  it('mantener pulsado suena y soltar calla', () => {
    const session = new Session();
    session.player.press(session.zone(4), 0.5);
    session.advance(0.3);
    expect(session.attacks).toHaveLength(1);
    expect(session.releases).toBe(0);

    session.player.release();
    session.advance(0.3);
    expect(session.releases).toBe(1);
    expect(session.attacks).toHaveLength(1);
  });

  it('un toque suena donde se ha pulsado, no donde se venia', () => {
    // El caso del dedo, y el unico que de verdad puede sonar mal: dos notas
    // lejanas seguidas. Sin tratar el salto, la segunda entra en la zona de la
    // primera porque el filtro del tono todavia viene de camino.
    const session = new Session();
    session.player.press(session.zone(0), 0.5);
    session.advance(0.3);
    session.player.release();
    session.advance(0.15);

    session.player.press(session.zone(8), 0.5);
    session.advance(0.3);
    expect(session.attacks).toEqual([session.midi(0), session.midi(8)]);
  });

  it('toca lo mismo a treinta fotogramas que a sesenta', () => {
    const notes = [30, 60].map((fps) => {
      const session = new Session();
      for (const zone of [2, 7, 1, 9]) {
        session.player.press(session.zone(zone), 0.5);
        session.advance(0.3, fps);
        session.player.release();
        session.advance(0.15, fps);
      }
      return session.attacks;
    });
    expect(notes[0]).toEqual(notes[1]);
    const session = new Session();
    expect(notes[0]).toEqual([2, 7, 1, 9].map((zone) => session.midi(zone)));
  });

  it('arrastrar con el boton pulsado cambia la nota sin cortarla', () => {
    const session = new Session();
    session.player.press(session.zone(1), 0.5);
    session.advance(0.3);
    // Despacio, como se arrastra un dedo: medio segundo para cruzar el encuadre.
    const from = session.zone(1);
    const to = session.zone(9);
    for (let step = 1; step <= 30; step += 1) {
      session.player.moveTo(from + ((to - from) * step) / 30, 0.5);
      session.advance(1 / 60);
    }
    session.advance(0.3);
    expect(session.releases, 'un glissando no es una nota nueva').toBe(0);
    expect(session.attacks).toHaveLength(1);
  });

  it('la pinza no se cierra de golpe, para que la nota no entre siempre al maximo', () => {
    const session = new Session();
    session.player.press(0.5, 0.5);
    // Al primer fotograma todavia no ha llegado abajo: si llegara, la fuerza del
    // ataque se saturaria y todas las notas entrarian igual de fuertes.
    session.advance(1 / 60);
    expect(session.attacks).toHaveLength(0);
    session.advance(PRESS_SECONDS + 0.05);
    expect(session.attacks).toHaveLength(1);
    expect(session.gain).toBeGreaterThan(DEFAULT_SETTINGS.masterVolume * 0.6);
    expect(session.gain).toBeLessThan(DEFAULT_SETTINGS.masterVolume);
  });

  it('la mano aparece en el sitio nuevo, y solo se pierde un fotograma', () => {
    const player = new PointerPlayer();
    expect(player.update(1 / 60), 'la primera pose no tiene pasado').toBeNull();
    expect(player.update(1 / 60)).not.toBeNull();

    player.press(0.2, 0.5);
    expect(player.update(1 / 60)).toBeNull();
    const pose = player.update(1 / 60);
    expect(pose?.x).toBe(0.2);
  });

  it('con el raton, pulsar donde ya esta el puntero no pierde ningun fotograma', () => {
    const player = new PointerPlayer();
    player.update(1 / 60);
    player.moveTo(0.7, 0.4);
    player.update(1 / 60);
    player.press(0.7 + JUMP / 2, 0.4);
    expect(player.update(1 / 60), 'el filtro ya venia siguiendo al raton').not.toBeNull();
  });

  it('las dos aperturas de la pinza caen a los dos lados de la banda muerta', () => {
    const player = new PointerPlayer();
    player.update(1 / 60);
    expect(player.update(1 / 60)?.pinch).toBeGreaterThan(PINCH_OPEN);

    player.press(0.5, 0.5);
    player.update(1 / 60);
    for (let frame = 0; frame < 20; frame += 1) player.update(1 / 60);
    expect(player.update(1 / 60)?.pinch).toBeLessThan(PINCH_CLOSE);
    expect(player.update(1 / 60)?.pinch).toBe(CLOSED_PINCH);

    player.release();
    for (let frame = 0; frame < 20; frame += 1) player.update(1 / 60);
    expect(player.update(1 / 60)?.pinch).toBe(OPEN_PINCH);
  });

  it('un segundo dedo deja la nota sostenida de pedal', () => {
    // Con camara son dos manos; aqui son dos dedos, y hacen lo mismo: la segunda
    // mano entra por el mismo sitio y el pedal lo decide el mismo gesto.
    const session = new Session();
    session.player.press(session.zone(3), 0.5);
    session.advance(0.3);
    const sounding = session.attacks[0]!;
    expect(session.drone).toBe(0);

    session.player.pressSecond(0.2, 0.5);
    session.advance(0.2);
    expect(session.drone).toBeGreaterThan(0);

    // Y sigue puesta cuando el primer dedo se levanta y se va a otra nota.
    session.player.release();
    session.advance(0.2);
    session.player.press(session.zone(8), 0.5);
    session.advance(0.3);
    expect(session.attacks).toEqual([sounding, session.midi(8)]);
    expect(session.drone, 'el pedal no se mueve con la melodia').toBeGreaterThan(0);

    session.player.releaseSecond();
    session.advance(0.2);
    expect(session.drone).toBe(0);
  });

  it('el segundo dedo es una mano con la pinza ya cerrada', () => {
    const player = new PointerPlayer();
    expect(player.expression).toBeNull();
    player.pressSecond(0.3, 0.7);
    expect(player.expression?.pinch).toBe(CLOSED_PINCH);
    expect(player.expression?.x).toBe(0.3);
    player.moveSecond(0.4, 0.6);
    expect(player.expression?.x).toBe(0.4);
    player.releaseSecond();
    expect(player.expression).toBeNull();
  });

  it('la mano cabe en el encuadre en la nota mas grave', () => {
    // Es el caso que se rompia en el movil: la palma pegada al borde izquierdo.
    const session = new Session();
    const player = new PointerPlayer();
    player.update(1 / 60);
    player.press(session.zone(0), 0.5);
    player.update(1 / 60);
    const pose = player.update(1 / 60)!;
    const hand = phantomHand({ ...pose, aspect: ASPECT, scale: drawnScale(ASPECT) });
    for (const index of [0, 4, 5, 8, 9, 13, 17]) {
      expect(hand[index]!.x, `punto ${index}`).toBeGreaterThanOrEqual(0);
      expect(hand[index]!.x, `punto ${index}`).toBeLessThanOrEqual(1);
    }
  });
});
