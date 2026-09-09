/**
 * Panel de ayuda, accesible en cualquier momento.
 *
 * Existe porque la introduccion guiada solo se ve una vez, y quien vuelve una
 * semana despues no se acuerda de que la pinza era la llave. Tambien es el sitio
 * desde donde se repite la introduccion: haberla pasado no puede ser una puerta
 * de un solo sentido.
 */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id} en el documento`);
  return node as T;
}

export class Help {
  private readonly panel = el('help');
  private readonly toggle = el<HTMLButtonElement>('help-toggle');

  constructor(deps: { onReplay: () => void }) {
    this.toggle.addEventListener('click', () => this.setOpen(!this.isOpen));
    el('help-close').addEventListener('click', () => this.setOpen(false));
    el('help-replay').addEventListener('click', () => {
      this.setOpen(false);
      deps.onReplay();
    });
    // Pulsar fuera de la hoja cierra: es lo que espera cualquiera ante una capa
    // oscurecida a pantalla completa.
    this.panel.addEventListener('click', (event) => {
      if (event.target === this.panel) this.setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.setOpen(false);
    });
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  reveal(): void {
    this.toggle.classList.remove('hidden');
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
  }
}
