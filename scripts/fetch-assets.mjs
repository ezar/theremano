/**
 * Prepara los activos que la aplicacion sirve desde su propio origen.
 *
 * La SPEC exige que ni el modelo ni el WASM de MediaPipe se pidan al CDN de
 * Google en tiempo de ejecucion: solo asi la aplicacion funciona sin red tras
 * la primera carga. Por eso ambos se materializan en `public/` durante la
 * instalacion y antes de cada build, y no se versionan en git (8 MB de binario
 * no pintan nada en el historial).
 */
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_PATH = resolve(root, 'public/models/hand_landmarker.task');
const MODEL_MIN_BYTES = 5_000_000;

const WASM_SRC = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_DEST = resolve(root, 'public/wasm');

const exists = async (path) => access(path).then(() => true, () => false);

async function fetchModel() {
  const already = await stat(MODEL_PATH).catch(() => null);
  if (already && already.size >= MODEL_MIN_BYTES) {
    console.log(`[assets] modelo ya presente (${(already.size / 1e6).toFixed(1)} MB)`);
    return;
  }

  console.log('[assets] descargando hand_landmarker.task...');
  await mkdir(dirname(MODEL_PATH), { recursive: true });
  const tmp = `${MODEL_PATH}.download`;

  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      const { size } = await stat(tmp);
      if (size < MODEL_MIN_BYTES) throw new Error(`descarga truncada (${size} bytes)`);
      await rm(MODEL_PATH, { force: true });
      await cp(tmp, MODEL_PATH);
      await rm(tmp, { force: true });
      console.log(`[assets] modelo listo (${(size / 1e6).toFixed(1)} MB)`);
      return;
    } catch (error) {
      lastError = error;
      await rm(tmp, { force: true });
      if (attempt < 4) {
        const wait = 2 ** attempt * 1000;
        console.warn(`[assets] intento ${attempt} fallido (${error.message}); reintento en ${wait} ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw new Error(
    `No se pudo descargar el modelo desde ${MODEL_URL}: ${lastError?.message}. ` +
      'Descargalo a mano en public/models/hand_landmarker.task y repite el build.',
  );
}

async function copyWasm() {
  if (!(await exists(WASM_SRC))) {
    throw new Error('Falta node_modules/@mediapipe/tasks-vision/wasm. Ejecuta npm install primero.');
  }
  await rm(WASM_DEST, { recursive: true, force: true });
  await cp(WASM_SRC, WASM_DEST, { recursive: true });
  console.log('[assets] WASM de MediaPipe copiado a public/wasm');
}

await copyWasm();
await fetchModel();
