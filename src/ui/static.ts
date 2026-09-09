import { t } from '../i18n';

/**
 * Rellena con el idioma activo todo lo que no pinta ningun componente vivo: la
 * pantalla inicial, los rotulos de los botones y el panel de ayuda entero.
 *
 * El HTML llega vacio a proposito. Escribir los dos idiomas a mano en el
 * documento significaria mantener dos copias del mismo texto, y dos copias se
 * desincronizan a la primera correccion que se hace solo en una.
 */

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setText(id: string, text: string): void {
  const node = el(id);
  if (node) node.textContent = text;
}

function setAttr(id: string, attribute: string, value: string): void {
  el(id)?.setAttribute(attribute, value);
}

function list(items: readonly string[], className: string): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.className = className;
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  return ul;
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

export function applyStaticStrings(): void {
  const s = t();

  setText('splash-tagline', s.splash.tagline);
  const bullets = el('splash-bullets');
  if (bullets) bullets.replaceChildren(...s.splash.bullets.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  setText('start-button', s.splash.start);
  setText('splash-status', s.splash.permissionNote);

  setText('hint', s.hud.hint);
  setAttr('volume-rail', 'title', s.hud.volume);
  setAttr('dot-melody', 'title', s.hud.melodyDot);
  setAttr('dot-expression', 'title', s.hud.expressionDot);

  const loop = el('loop-button');
  const clip = el('clip-button');
  loop?.setAttribute('title', s.actions.loopTitle);
  clip?.setAttribute('title', s.actions.clipTitle);
  const loopLabel = loop?.querySelector('.label');
  const clipLabel = clip?.querySelector('.label');
  if (loopLabel) loopLabel.textContent = s.actions.loop;
  if (clipLabel) clipLabel.textContent = s.actions.clip;
  setText('undo-button', s.actions.undo);
  setAttr('undo-button', 'title', s.actions.undoTitle);
  setText('coach-skip-step', s.coach.skipStep);
  setText('coach-skip-all', s.coach.skipAll);
  setText('coach-optional', s.coach.optional);

  setAttr('help-toggle', 'aria-label', s.actions.helpTitle);
  setAttr('help-toggle', 'title', s.actions.helpTitle);
  setAttr('help', 'aria-label', s.actions.helpTitle);
  setAttr('settings-toggle', 'aria-label', s.actions.settings);
  setText('settings-toggle', s.actions.settings);

  setText('help-title', s.help.title);
  setText('help-close', s.help.close);
  setAttr('help-close', 'aria-label', s.help.close);
  setText('help-replay', s.help.replay);

  const body = el('help-body');
  if (!body) return;

  const table = document.createElement('table');
  table.className = 'help-table';
  const tbody = document.createElement('tbody');
  for (const row of s.help.gestures) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = row.what;
    if (row.optional) {
      const mark = document.createElement('em');
      mark.textContent = ` (${s.coach.optional})`;
      th.append(mark);
    }
    const td = document.createElement('td');
    td.textContent = row.does;
    tr.append(th, td);
    tbody.append(tr);
  }
  table.append(tbody);

  const keys = document.createElement('ul');
  keys.className = 'help-list keys';
  for (const shortcut of s.help.keys) {
    const li = document.createElement('li');
    const kbd = document.createElement('kbd');
    kbd.textContent = shortcut.key;
    const text = document.createElement('span');
    text.textContent = shortcut.does;
    li.append(kbd, text);
    keys.append(li);
  }

  body.replaceChildren(
    table,
    heading(s.help.recordTitle),
    list(s.help.record, 'help-list'),
    heading(s.help.keysTitle),
    keys,
    heading(s.help.troubleTitle),
    list(s.help.trouble, 'help-list'),
  );
}
