// Renders the extension icon (a fiery slit-pupil eye on an obsidian tile) to PNGs.
// No image libraries needed: shapes are evaluated per pixel with supersampling.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function shade(x, y) {
  // x, y in [-1, 1]
  // Rounded-square tile
  const r = 0.36;
  const qx = Math.max(Math.abs(x) - (1 - r), 0);
  const qy = Math.max(Math.abs(y) - (1 - r), 0);
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  let col = mix([34, 26, 21], [14, 11, 9], (y + 1) / 2);

  // Almond eye: intersection of two circles
  const R = 1.25;
  const off = 0.92;
  const inEye = Math.hypot(x, y - off) < R && Math.hypot(x, y + off) < R;
  const d = Math.hypot(x, y);
  // outer glow
  const glow = Math.exp(-((d * 1.6) ** 2)) * 0.55;
  col = mix(col, [255, 110, 20], glow);
  if (inEye) {
    const t = Math.min(1, d / 0.8);
    const iris = t < 0.35 ? mix([255, 230, 140], [255, 150, 40], t / 0.35) : mix([255, 150, 40], [190, 50, 10], (t - 0.35) / 0.65);
    col = iris;
    // vertical slit pupil (narrow ellipse)
    const pupil = (x / 0.11) ** 2 + (y / 0.62) ** 2;
    if (pupil < 1) col = mix([20, 10, 6], col, smooth(0.7, 1, pupil));
  }
  return [...col, 255];
}

function render(size) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const acc = [0, 0, 0, 0];
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = ((i + (si + 0.5) / ss) / size) * 2 - 1;
          const y = ((j + (sj + 0.5) / ss) / size) * 2 - 1;
          const c = shade(x, y);
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const o = (j * size + i) * 4;
      const a = acc[3] / (ss * ss);
      px[o] = a ? acc[0] / acc[3] : 0;
      px[o + 1] = a ? acc[1] / acc[3] : 0;
      px[o + 2] = a ? acc[2] / acc[3] : 0;
      px[o + 3] = a;
    }
  }
  return png(size, px);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(join(OUT, `icon-${size}.png`), render(size));
}
console.log('icons written to', OUT);
