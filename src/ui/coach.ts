import type { OnboardingStep } from './onboarding';

/**
 * La cara visible de la introduccion guiada.
 *
 * La logica de cuando avanzar vive en `onboarding.ts` y no sabe nada del DOM;
 * aqui solo se pinta. Se separan porque decidir si un gesto ha ocurrido se puede
 * comprobar con pruebas y dibujar una tarjeta no.
 */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en el documento`);
  return node as T;
}

export class CoachView {
  private readonly root = el('coach');
  private readonly title = el('coach-title');
  private readonly body = el('coach-body');
  private readonly dots = el('coach-dots');
  private rendered = '';
  private dotCount = 0;

  constructor(deps: { onSkipStep: () => void; onSkipAll: () => void }) {
    el('coach-skip-step').addEventListener('click', deps.onSkipStep);
    el('coach-skip-all').addEventListener('click', deps.onSkipAll);
  }

  /** @param step null para ocultar la tarjeta. */
  render(step: OnboardingStep | null, index: number, total: number): void {
    if (!step) {
      if (this.rendered !== '') {
        this.root.hidden = true;
        this.rendered = '';
      }
      return;
    }

    const signature = `${step.id}|${index}/${total}`;
    if (signature === this.rendered) return;
    this.rendered = signature;

    this.root.hidden = false;
    this.title.textContent = step.title;
    this.body.textContent = step.body;

    if (this.dotCount !== total) {
      this.dotCount = total;
      this.dots.replaceChildren(...Array.from({ length: total }, () => document.createElement('span')));
    }
    const marks = this.dots.children;
    for (let i = 0; i < marks.length; i += 1) {
      const mark = marks[i]!;
      mark.classList.toggle('done', i < index);
      mark.classList.toggle('current', i === index);
    }
  }
}
