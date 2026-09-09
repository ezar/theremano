import { describe, expect, it } from 'vitest';
import { GuideSession, MELODIES, getMelody, resolveTargets } from '../src/mapping/melodies';
import { buildDegreeTable, createLayout, pitchAt } from '../src/mapping/scales';

/** Por id y no por indice: añadir una melodia no debe mover estas pruebas. */
function melody(id: string) {
  const found = getMelody(id);
  if (!found) throw new Error(`No existe la melodia ${id}`);
  return found;
}

/**
 * La guia tiene que sobrevivir a que el interprete cambie de escala a mitad, y
 * no debe poder quedarse atascada pidiendo una nota que no existe en el
 * encuadre.
 */

const pentatonic = createLayout('pentatonic', 9, 3, 2);

describe('melodias guiadas', () => {
  it('cada melodia se puede tocar entera en cualquier escala', () => {
    for (const item of MELODIES) {
      for (const scale of ['pentatonic', 'blues', 'major', 'minor', 'chromatic'] as const) {
        const layout = createLayout(scale, 9, 3, 2);
        const targets = resolveTargets(item, layout);
        expect(targets, `${item.id} en ${scale}`).toHaveLength(item.notes.length);
        for (const zone of targets) {
          expect(zone).toBeGreaterThanOrEqual(0);
          expect(zone).toBeLessThan(layout.degrees.length);
        }
      }
    }
  });

  it('en modo continuo la guia no puede avanzar, y por eso hay que retirarla', () => {
    // El modo continuo no reparte el encuadre en zonas. La sesion no se rompe,
    // pero se queda en 0/0 sin objetivo y sin poder terminar nunca. Documentado
    // aqui porque es la razon por la que la aplicacion desactiva la guia al
    // elegir esta escala en lugar de dejarla puesta y muerta.
    const session = new GuideSession(melody('ascenso'), createLayout('continuous', 9, 3, 2));
    expect(session.total).toBe(0);
    expect(session.targetZone).toBe(null);
    expect(session.finished).toBe(false);
    expect(session.onAttack(0)).toBe('miss');
    expect(session.finished, 'nunca podria darse por completada').toBe(false);
  });

  it('avanza al acertar y no retrocede al fallar', () => {
    const session = new GuideSession(melody('ida-vuelta'), pentatonic);
    const first = session.targetZone!;
    // Un fallo cuenta como intento pero no mueve el cursor.
    expect(session.onAttack(first + 1)).toBe('miss');
    expect(session.done).toBe(0);
    expect(session.onAttack(first)).toBe('hit');
    expect(session.done).toBe(1);
  });

  it('termina al completar la secuencia y luego se queda quieta', () => {
    const chosen = melody('ascenso');
    const session = new GuideSession(chosen, pentatonic);
    const targets = resolveTargets(chosen, pentatonic);
    for (let i = 0; i < targets.length - 1; i += 1) {
      expect(session.onAttack(targets[i]!)).toBe('hit');
    }
    expect(session.onAttack(targets[targets.length - 1]!)).toBe('finished');
    expect(session.finished).toBe(true);
    // Seguir tocando despues no debe alterar el resultado.
    expect(session.onAttack(0)).toBe('idle');
    expect(session.done).toBe(targets.length);
  });

  it('la precision cuenta intentos, no castiga el avance', () => {
    const session = new GuideSession(melody('ascenso'), pentatonic);
    expect(session.accuracy).toBe(1);
    const target = session.targetZone!;
    session.onAttack(target === 0 ? 1 : 0);
    session.onAttack(target);
    expect(session.accuracy).toBeCloseTo(0.5, 5);
  });

  it('cambiar de escala a mitad recalcula los objetivos sin perder el progreso', () => {
    const session = new GuideSession(melody('ida-vuelta'), pentatonic);
    session.onAttack(session.targetZone!);
    expect(session.done).toBe(1);
    session.relayout(createLayout('major', 9, 3, 2));
    expect(session.done).toBe(1);
    expect(session.targetZone).not.toBe(null);
    expect(session.targetZone).toBeLessThan(createLayout('major', 9, 3, 2).degrees.length);
  });

  it('el objetivo apunta a una nota real del encuadre', () => {
    const session = new GuideSession(melody('octavas'), pentatonic);
    const zone = session.targetZone!;
    const centers = pentatonic.degrees.length - 1;
    // La zona se puede convertir en una posicion tocable y devolver esa nota.
    const x = zone / centers;
    expect(pitchAt(pentatonic, x).index).toBe(zone);
  });

  /**
   * La prueba que sostiene las canciones.
   *
   * `resolveTargets` busca la zona mas cercana, asi que una nota que no exista
   * en la escala no falla: suena la de al lado. En un ejercicio da igual; en una
   * cancion conocida es la diferencia entre reconocerla y no. Aqui se exige que
   * cada nota exista exacta en la escala y el rango que la propia melodia pide.
   */
  it('cada nota de cada melodia existe exacta en la escala y el rango que pide', () => {
    for (const item of MELODIES) {
      const table = buildDegreeTable(item.suggestedScale, item.minOctaves);
      for (const note of item.notes) {
        expect(table, `${item.id}: el semitono ${note} no esta en ${item.suggestedScale}`).toContain(note);
      }
    }
  });

  it('ninguna melodia pide mas octavas de las que necesita', () => {
    for (const item of MELODIES) {
      const highest = Math.max(...item.notes);
      expect(item.minOctaves, `${item.id}`).toBeGreaterThanOrEqual(1);
      // Una octava de mas estrecharia las zonas sin motivo: cuantas mas zonas,
      // mas fina tiene que ser la punteria de la mano.
      expect(highest, `${item.id} cabria en menos octavas`).toBeGreaterThan((item.minOctaves - 1) * 12);
    }
  });

  it('ninguna melodia baja de la tonica: el encuadre empieza ahi', () => {
    for (const item of MELODIES) {
      expect(Math.min(...item.notes), item.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('getMelody solo devuelve lo que existe', () => {
    expect(getMelody('ascenso')?.id).toBe('ascenso');
    expect(getMelody('no-existe')).toBe(null);
  });
});
