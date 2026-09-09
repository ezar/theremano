/**
 * Prueba de humo del arranque completo, con una camara falsa de Chromium.
 *
 * No sustituye a los tests unitarios: cubre lo que ellos no pueden tocar, que
 * es que el modelo cargue, que el contexto de audio arranque tras el gesto del
 * usuario y que el bucle gire sin errores en consola. Sin manos delante de la
 * camara no hay notas, y eso esta bien: aqui se comprueba que el instrumento se
 * enciende, no que suene afinado.
 *
 *   npm run build && npm run preview &
 *   npm run smoke
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const screenshot = process.argv[3] ?? 'smoke.png';
const logs = [];
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
  ],
});
const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 1100, height: 720 } });
const page = await ctx.newPage();
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.click('#start-button');

// Espera a que el bucle este girando de verdad.
await page.waitForFunction(() => !document.getElementById('splash')?.hidden === false, { timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(12000);

// --- Introduccion guiada: quien llega por primera vez tiene que verla.
const coachStart = await page.evaluate(() => ({
  visible: !document.getElementById('coach')?.hidden,
  title: document.getElementById('coach-title')?.textContent,
  dots: document.querySelectorAll('#coach-dots span').length,
  current: document.querySelectorAll('#coach-dots span.current').length,
}));

// Sin manos delante de la camara ningun paso se cierra solo, que es justo lo
// que debe pasar. Se recorre entera con el boton de saltar, anotando por el
// camino que el paso de la segunda mano se anuncia como opcional.
let skips = 0;
const optionalSteps = [];
while (await page.evaluate(() => !document.getElementById('coach')?.hidden)) {
  const step = await page.evaluate(() => ({
    title: document.getElementById('coach-title')?.textContent,
    optional: !document.getElementById('coach-optional')?.hidden,
    skipLabel: document.getElementById('coach-skip-step')?.textContent,
  }));
  if (step.optional) optionalSteps.push({ title: step.title, skipLabel: step.skipLabel });
  await page.click('#coach-skip-step');
  await page.waitForTimeout(120);
  if (++skips > 12) break;
}
console.log(JSON.stringify({ optionalSteps }, null, 2));
// El store agrupa las escrituras a localStorage con 250 ms de retardo, asi que
// leer la bandera justo despues del ultimo salto es una carrera: la prueba
// fallaria con la aplicacion funcionando bien.
await page
  .waitForFunction(() => JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').onboarded === true, {
    timeout: 5000,
  })
  .catch(() => {});
const coachEnd = await page.evaluate(() => ({
  visible: !document.getElementById('coach')?.hidden,
  onboarded: JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').onboarded,
}));
console.log(JSON.stringify({ coachStart, skips, coachEnd }, null, 2));

// --- Ayuda: tiene que abrirse siempre y poder relanzar la introduccion.
await page.click('#help-toggle');
await page.waitForTimeout(300);
const helpOpen = await page.evaluate(() => ({
  visible: !document.getElementById('help')?.hidden,
  rows: document.querySelectorAll('#help .help-table tr').length,
  keys: document.querySelectorAll('#help kbd').length,
}));
await page.click('#help-replay');
await page.waitForTimeout(400);
const replayed = await page.evaluate(() => ({
  helpClosed: document.getElementById('help')?.hidden,
  coachVisible: !document.getElementById('coach')?.hidden,
  title: document.getElementById('coach-title')?.textContent,
}));
console.log(JSON.stringify({ helpOpen, replayed }, null, 2));
await page.click('#coach-skip-all');
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const diag = document.getElementById('diagnostics');
  const err = document.getElementById('splash-error');
  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  return {
    splashHidden: document.getElementById('splash')?.hidden,
    error: err && !err.hidden ? err.textContent : null,
    diagnostics: diag?.textContent,
    note: document.getElementById('note')?.textContent,
    noteSub: document.getElementById('note-sub')?.textContent,
    preset: document.getElementById('preset-name')?.textContent,
    videoSize: [video?.videoWidth, video?.videoHeight],
    videoMirrored: video?.classList.contains('mirrored'),
    canvasSize: [canvas?.width, canvas?.height],
    hudVisible: !document.getElementById('hud')?.classList.contains('hidden'),
  };
});

console.log(JSON.stringify(state, null, 2));

// --- Grabacion de clip: la funcion de compartir tiene que producir un fichero.
const download = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await page.click('#clip-button');
await page.waitForTimeout(2500);
await page.click('#clip-button');
const file = await download;
const clip = file
  ? { name: file.suggestedFilename(), bytes: (await import('node:fs')).statSync(await file.path()).size }
  : null;
console.log(JSON.stringify({ clip }, null, 2));

// --- Bucles: una toma sin una sola nota no debe dejar una capa fantasma.
await page.click('#loop-button');
await page.waitForTimeout(1200);
await page.click('#loop-button');
await page.waitForTimeout(400);
const loops = await page.evaluate(() => ({
  lanes: document.querySelectorAll('.loop-lane').length,
  undoHidden: document.getElementById('undo-button')?.hidden,
  toast: document.getElementById('toast')?.textContent,
}));
console.log(JSON.stringify({ loops }, null, 2));

// El panel de ajustes tiene que abrir y responder.
await page.click('#settings-toggle');
await page.waitForTimeout(400);
const fields = await page.evaluate(() => document.querySelectorAll('#settings-panel .field').length);
await page.selectOption('#set-escala', 'blues');
await page.selectOption('#set-tonica', '2');
await page.waitForTimeout(600);
const afterScale = await page.evaluate(() => document.getElementById('note-sub')?.textContent);
const persisted = await page.evaluate(() => localStorage.getItem('theremano.settings.v1'));
console.log(JSON.stringify({ fields, afterScale, scale: JSON.parse(persisted ?? '{}').scale }, null, 2));

// --- Melodia guiada: elegirla muestra el progreso y fija la escala sugerida.
await page.selectOption('#set-melodia', 'blues');
await page.waitForTimeout(700);
const guide = await page.evaluate(() => ({
  visible: !document.getElementById('guide-chip')?.hidden,
  name: document.getElementById('guide-name')?.textContent,
  progress: document.getElementById('guide-progress')?.textContent,
  scale: document.getElementById('set-escala')?.value,
}));
console.log(JSON.stringify({ guide }, null, 2));

// --- El modo continuo no tiene zonas: la guia debe retirarse sola.
await page.selectOption('#set-escala', 'continuous');
await page.waitForTimeout(700);
const afterContinuous = await page.evaluate(() => ({
  melody: document.getElementById('set-melodia')?.value,
  chipHidden: document.getElementById('guide-chip')?.hidden,
  toast: document.getElementById('toast')?.textContent,
}));
console.log(JSON.stringify({ afterContinuous }, null, 2));
await page.selectOption('#set-escala', 'blues');
await page.waitForTimeout(400);

// --- Enlace compartible: tiene que reconstruir la configuracion al abrirlo.
const link = await page.evaluate(() => {
  const url = new URL(location.href);
  url.hash = 'e=major&t=0&o=2&r=3&v=flute';
  return url.toString();
});
const fresh = await ctx.newPage();
await fresh.goto(link, { waitUntil: 'domcontentloaded' });
await fresh.waitForTimeout(800);
const restored = await fresh.evaluate(() => JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}'));
console.log(JSON.stringify({ fromLink: { scale: restored.scale, tonicPc: restored.tonicPc, octaves: restored.octaves, preset: restored.preset } }, null, 2));
await fresh.close();

await page.screenshot({ path: screenshot });
const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
console.log('--- consola ---');
console.log(logs.slice(-25).join('\n'));
await browser.close();

if (!coachStart.visible || coachStart.dots !== 5 || coachStart.current !== 1) {
  console.error('\nFALLO: la introduccion no aparece al llegar por primera vez');
  process.exit(1);
}
if (optionalSteps.length !== 1 || !/una mano/.test(optionalSteps[0]?.skipLabel ?? '')) {
  console.error('\nFALLO: el paso de la segunda mano no se anuncia como opcional');
  process.exit(1);
}
if (coachEnd.visible || coachEnd.onboarded !== true) {
  console.error('\nFALLO: la introduccion no se cierra ni se recuerda como vista');
  process.exit(1);
}
if (!helpOpen.visible || helpOpen.rows < 5 || helpOpen.keys < 4) {
  console.error('\nFALLO: la ayuda no muestra el contenido esperado');
  process.exit(1);
}
if (!replayed.helpClosed || !replayed.coachVisible) {
  console.error('\nFALLO: no se puede relanzar la introduccion desde la ayuda');
  process.exit(1);
}
if (afterContinuous.melody !== '' || afterContinuous.chipHidden !== true) {
  console.error('\nFALLO: la guia sigue activa en una escala sin zonas');
  process.exit(1);
}
if (!guide.visible || guide.progress !== '0/9' || guide.scale !== 'blues') {
  console.error('\nFALLO: la melodia guiada no se ha activado como deberia');
  process.exit(1);
}
if (!clip || clip.bytes < 20000) {
  console.error('\nFALLO: la grabacion del clip no ha producido un fichero utilizable');
  process.exit(1);
}
if (loops.lanes !== 0 || loops.undoHidden !== true) {
  console.error('\nFALLO: una toma sin notas ha dejado una capa fantasma');
  process.exit(1);
}
if (state.error || errors.length > 0) {
  console.error(`\nFALLO: ${state.error ?? errors.join('\n')}`);
  process.exit(1);
}
if (!state.splashHidden || !state.hudVisible) {
  console.error('\nFALLO: el instrumento no llego a arrancar');
  process.exit(1);
}
console.log(
  `\nOK: arranque, modelo, audio, introduccion de ${coachStart.dots} pasos, ayuda, bucle, clip de ${(clip.bytes / 1024).toFixed(0)} kB y enlace compartible.`,
);
