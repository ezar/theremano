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

// El panel de ajustes tiene que abrir y responder.
await page.click('#settings-toggle');
await page.waitForTimeout(400);
const fields = await page.evaluate(() => document.querySelectorAll('#settings-panel .field').length);
await page.selectOption('#set-escala', 'blues');
await page.selectOption('#set-tonica', '2');
await page.waitForTimeout(600);
const afterScale = await page.evaluate(() => document.getElementById('note-sub')?.textContent);
const persisted = await page.evaluate(() => localStorage.getItem('theremano.settings.v1'));
console.log(JSON.stringify({ fields, afterScale, persisted: JSON.parse(persisted ?? 'null') }, null, 2));

await page.screenshot({ path: screenshot });
const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
console.log('--- consola ---');
console.log(logs.slice(-25).join('\n'));
await browser.close();

if (state.error || errors.length > 0) {
  console.error(`\nFALLO: ${state.error ?? errors.join('\n')}`);
  process.exit(1);
}
if (!state.splashHidden || !state.hudVisible) {
  console.error('\nFALLO: el instrumento no llego a arrancar');
  process.exit(1);
}
console.log('\nOK: arranque, modelo, audio y bucle en marcha.');
