#!/usr/bin/env node
/**
 * Draw the app icons.
 *
 * iOS wants a real PNG for the Home Screen icon — it will not take an SVG —
 * and there is no image library here, so this writes the PNG bytes directly.
 * A PNG is a signature, a header chunk, the pixel data deflated, and an end
 * marker; zlib comes with Node, so that is all it takes.
 *
 *   node tools/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  // Each scanline is prefixed with a filter byte; 0 means "no filter".
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A pink chip on green felt, with the chip's edge marks. */
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const chipR = size * 0.33;
  const holeR = size * 0.15;

  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Felt, lit slightly from above.
      const lift = 1 - (y / size) * 0.35;
      set(x, y, Math.round(21 * lift), Math.round(140 * lift), Math.round(104 * lift));

      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);

      if (dist <= chipR) {
        // Six white edge marks around the rim.
        const angle = Math.atan2(dy, dx);
        const sector = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 12);
        const onMark = sector % 2 === 0 && dist > chipR * 0.74;
        if (onMark) set(x, y, 255, 255, 255);
        else if (dist > chipR * 0.72) set(x, y, 168, 53, 106);
        else if (dist <= holeR) set(x, y, 255, 255, 255);
        else set(x, y, 225, 99, 154);
      }
    }
  }
  return png(size, size, px);
}

for (const size of [180, 192, 512]) {
  const file = path.join(root, `icon-${size}.png`);
  fs.writeFileSync(file, draw(size));
  console.log(`wrote icon-${size}.png (${fs.statSync(file).size} bytes)`);
}
