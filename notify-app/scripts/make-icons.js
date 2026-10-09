// 依存なしでベル型アイコンのPNGを生成する: node scripts/make-icons.js
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// ベル形状(0..1座標)
function inBell(u, v) {
  const cx = 0.5;
  const dome = Math.hypot(u - cx, v - 0.42) < 0.2 && v < 0.42;
  const body = v >= 0.42 && v <= 0.66 && Math.abs(u - cx) < 0.2 + (v - 0.42) * 0.55;
  const rim = v > 0.66 && v < 0.72 && Math.abs(u - cx) < 0.33;
  const knob = Math.hypot(u - cx, v - 0.2) < 0.045;
  const clapper = Math.hypot(u - cx, v - 0.77) < 0.065;
  return dome || body || rim || knob || clapper;
}
const bg = [79, 109, 245, 255];
const icon = (full) => (u, v) => {
  if (!full) { const r = 0.22, dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0); if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0]; }
  return inBell(u, v) ? [255, 255, 255, 255] : bg;
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, icon(false)));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, icon(false)));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, icon(true))); // iOSは角丸を自動適用
fs.writeFileSync(path.join(out, 'badge-96.png'), png(96, (u, v) => (inBell(u, v) ? [255, 255, 255, 255] : [0, 0, 0, 0])));
console.log('icons written to', out);
