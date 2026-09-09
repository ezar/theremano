/**
 * Genera la imagen de vista previa que se ve al compartir el enlace.
 *
 * Un enlace sin vista previa es un rectangulo gris en cualquier chat, y eso mata
 * las ganas de abrirlo. La imagen es estatica, asi que se genera a mano y se
 * versiona; este script solo hace falta cuando cambia el diseno de la tarjeta.
 *
 *   npm run og
 *
 * Usa Chromium a traves de Playwright porque hace falta rasterizar texto, y
 * escribir un rasterizador de fuentes para una sola imagen no tiene sentido.
 * CHROMIUM_PATH permite apuntar a un binario ya instalado.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/og.png');

const CARD = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: center; padding: 76px 88px; gap: 26px;
    background: radial-gradient(120% 120% at 12% 0%, #16203a 0%, #05070c 58%);
    color: #f4f6fb; font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  }
  h1 {
    font-size: 132px; font-weight: 700; letter-spacing: -0.05em; line-height: 1;
    background: linear-gradient(100deg, #ffd166, #06d6a0 52%, #4cc9f0);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p { font-size: 34px; line-height: 1.35; color: rgba(244,246,251,0.72); max-width: 20ch; }
  .bars { position: absolute; right: 96px; bottom: 96px; display: flex; align-items: flex-end; gap: 20px; height: 300px; }
  .bars i { width: 22px; border-radius: 999px; display: block; }
  .tags { display: flex; gap: 12px; margin-top: 8px; }
  .tags span {
    padding: 10px 20px; border-radius: 999px; font-size: 24px;
    border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05);
    color: rgba(244,246,251,0.85);
  }
</style>
<h1>theremano</h1>
<p>Un instrumento que se toca con las manos en el aire.</p>
<div class="tags"><span>Sin contacto</span><span>Sin instalar</span><span>En el navegador</span></div>
<div class="bars">
  <i style="height:44%;background:#ff6b6b"></i>
  <i style="height:88%;background:#ffd166"></i>
  <i style="height:66%;background:#06d6a0"></i>
  <i style="height:34%;background:#4cc9f0"></i>
</div>`;

await mkdir(dirname(out), { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(CARD);
await page.screenshot({ path: out });
await browser.close();
console.log(`[og] ${out}`);
