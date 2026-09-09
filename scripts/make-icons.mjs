/**
 * Genera los iconos PNG de la PWA a partir de la misma figura que el favicon.
 * Se escribe a mano un PNG minimo (zlib va en la biblioteca estandar) para no
 * arrastrar una dependencia de imagen solo por dos ficheros.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BG = [5, 7, 12];
const BARS = [
  { x: 0.3125, top: 0.406, color: [255, 107, 107] },
  { x: 0.4375, top: 0.281, color: [255, 209, 102] },
  { x: 0.5625, top: 0.344, color: [6, 214, 160] },
  { x: 0.6875, top: 0.469, color: [76, 201, 240] },
];
const BAR_BOTTOM = 0.688;
const BAR_HALF_W = 0.031;
const DOT = { x: 0.5, y: 0.781, r: 0.055, color: [255, 209, 102] };
const CORNER = 0.22;

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Cobertura de un pixel dentro de la esquina redondeada, con antialiasing 2x2. */
function roundedAlpha(px, py, size) {
  const r = CORNER * size;
  let hits = 0;
  for (const ox of [0.25, 0.75]) {
    for (const oy of [0.25, 0.75]) {
      const x = px + ox;
      const y = py + oy;
      const cx = Math.min(Math.max(x, r), size - r);
      const cy = Math.min(Math.max(y, r), size - r);
      if (Math.hypot(x - cx, y - cy) <= r) hits += 1;
    }
  }
  return hits / 4;
}

function blend(dst, src, alpha) {
  for (let i = 0; i < 3; i += 1) dst[i] = Math.round(dst[i] * (1 - alpha) + src[i] * alpha);
}

function render(size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);

  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    for (let x = 0; x < size; x += 1) {
      const px = [BG[0], BG[1], BG[2]];
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      for (const bar of BARS) {
        const dx = Math.abs(u - bar.x);
        if (dx > BAR_HALF_W + 1 / size) continue;
        if (v < bar.top - BAR_HALF_W || v > BAR_BOTTOM + BAR_HALF_W) continue;
        // Barra con extremos redondeados: distancia al segmento vertical.
        const cy = Math.min(Math.max(v, bar.top), BAR_BOTTOM);
        const d = Math.hypot(u - bar.x, v - cy);
        const a = Math.min(1, Math.max(0, (BAR_HALF_W - d) * size + 0.5));
        if (a > 0) blend(px, bar.color, a);
      }

      const dd = Math.hypot(u - DOT.x, v - DOT.y);
      const da = Math.min(1, Math.max(0, (DOT.r - dd) * size + 0.5));
      if (da > 0) blend(px, DOT.color, da);

      const offset = y * (stride + 1) + 1 + x * 4;
      raw[offset] = px[0];
      raw[offset + 1] = px[1];
      raw[offset + 2] = px[2];
      raw[offset + 3] = Math.round(roundedAlpha(x, y, size) * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(resolve(root, 'public/icons'), { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(root, `public/icons/icon-${size}.png`);
  await writeFile(file, render(size));
  console.log(`[icons] ${file}`);
}
