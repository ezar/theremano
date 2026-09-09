import { t } from '../i18n';
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
  private readonly badge = el('coach-optional');
  private readonly skipStep = el<HTMLButtonElement>('coach-skip-step');
  private readonly body = el('coach-body');
  private readonly dots = el('coach-dots');
  private rendered = '';
  private dotCount = 0;

  constructor(deps: { onSkipStep: () => void; onSkipAll: () => void }) {
    this.skipStep.addEventListener('click', deps.onSkipStep);
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

    const strings = t();
    const copy = strings.coach.steps[step.id];
    const signature = `${strings.htmlLang}|${step.id}|${index}/${total}`;
    if (signature === this.rendered) return;
    this.rendered = signature;

    this.root.hidden = false;
    this.title.textContent = copy?.title ?? step.id;
    this.body.textContent = copy?.body ?? '';
    this.badge.textContent = strings.coach.optional;

    // En un paso opcional el boton deja de sonar a rendirse: no se esta saltando
    // nada, se esta eligiendo tocar con una mano.
    this.badge.hidden = !step.optional;
    this.skipStep.textContent = step.optional ? strings.coach.skipStepOptional : strings.coach.skipStep;

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
