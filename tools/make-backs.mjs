#!/usr/bin/env node
/**
 * Draw the ultra rare card backs.
 *
 * Every other design is a few CSS gradients. These four are real pictures,
 * which is the point of the tier — you can tell one across the table. There
 * is no image library here and no artwork to check in, so they are computed
 * pixel by pixel and written out as PNG, the same way the app icons are.
 *
 *   node tools/make-backs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'backs');

// Three times the 44x62 a card is drawn at, so they stay sharp on a phone.
const W = 132;
const H = 186;

// ------------------------------------------------------------------ png

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
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

function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: RGB, no alpha — these fill the whole card
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;   // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------- helpers

/** A canvas you can paint into, with blending so highlights sit on top. */
function canvas() {
  const px = new Float64Array(W * H * 3);
  return {
    px,
    set(x, y, r, g, b) {
      const i = (y * W + x) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    },
    /** Paint `(r,g,b)` over what is there, `a` being how much of it lands. */
    blend(x, y, r, g, b, a) {
      if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
      const k = Math.min(1, a);
      const i = (y * W + x) * 3;
      px[i] += (r - px[i]) * k;
      px[i + 1] += (g - px[i + 1]) * k;
      px[i + 2] += (b - px[i + 2]) * k;
    },
    bytes() {
      const out = Buffer.alloc(W * H * 3);
      for (let i = 0; i < px.length; i++) {
        out[i] = Math.max(0, Math.min(255, Math.round(px[i])));
      }
      return out;
    },
  };
}

const mix = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

/** Repeatable noise: the same picture every time the script is run. */
function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A soft round glow, bright in the middle and gone by `radius`. */
function glow(c, cx, cy, radius, r, g, b, strength) {
  const r0 = Math.ceil(radius);
  for (let y = Math.max(0, cy - r0); y < Math.min(H, cy + r0); y++) {
    for (let x = Math.max(0, cx - r0); x < Math.min(W, cx + r0); x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d >= 1) continue;
      c.blend(x, y, r, g, b, (1 - d) ** 2 * strength);
    }
  }
}

// ---------------------------------------------------------------- galaxy

/** A spiral galaxy: a bright core, two arms, and a lot of stars. */
function galaxy() {
  const c = canvas();
  const cx = W / 2;
  const cy = H / 2;
  const rnd = rand(20260127);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Deep space, a touch warmer towards the middle.
      const d = Math.hypot(x - cx, y - cy) / (H / 2);
      c.set(x, y, mix(26, 6, d), mix(14, 5, d), mix(48, 22, d));
    }
  }

  // Stars first, so the arms wash over them.
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H);
    const b = 0.3 + rnd() * 0.7;
    c.blend(x, y, 255, 250, 240, b * 0.9);
  }

  // Two logarithmic arms. Squashing y tilts the disc away from you.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = (y - cy) * 1.45;
      const r = Math.hypot(dx, dy);
      if (r < 3 || r > H * 0.52) continue;
      const theta = Math.atan2(dy, dx);
      const arm = Math.cos(2 * (theta - Math.log(r) * 1.9));
      const tight = Math.max(0, arm) ** 7;
      const fade = Math.max(0, 1 - r / (H * 0.5));
      const a = tight * fade * 0.85;
      // Arms run blue at the edge and gold towards the core.
      const t = 1 - fade;
      c.blend(x, y, mix(255, 150, t), mix(226, 180, t), mix(168, 255, t), a);
    }
  }

  glow(c, cx, cy, 34, 255, 236, 196, 0.95);
  glow(c, cx, cy, 13, 255, 253, 245, 1);
  return c.bytes();
}

// ------------------------------------------------------------------ strip

/** A sunset, a slatted sun and a road grid running to the horizon. */
function strip() {
  const c = canvas();
  const horizon = H * 0.52;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y < horizon) {
        const t = y / horizon;
        c.set(x, y, mix(28, 230, t), mix(10, 70, t), mix(60, 120, t));
      } else {
        const t = (y - horizon) / (H - horizon);
        c.set(x, y, mix(28, 10, t), mix(8, 4, t), mix(52, 28, t));
      }
    }
  }

  // The sun, cut by horizontal slats that widen towards the bottom.
  const sx = W / 2;
  const sy = horizon - 6;
  const sr = W * 0.3;
  for (let y = Math.floor(sy - sr); y < horizon; y++) {
    for (let x = Math.floor(sx - sr); x < Math.ceil(sx + sr); x++) {
      if (x < 0 || x >= W || y < 0) continue;
      if (Math.hypot(x - sx, y - sy) > sr) continue;
      const down = (y - (sy - sr)) / (2 * sr);
      const gap = 2 + down * 7;
      if (down > 0.45 && (y % Math.round(gap)) < Math.max(1, gap * 0.35)) continue;
      c.blend(x, y, mix(255, 255, down), mix(238, 120, down), mix(120, 180, down), 1);
    }
  }

  // The grid: lines running away, and rungs bunching up at the horizon.
  for (let y = Math.floor(horizon); y < H; y++) {
    const depth = (y - horizon) / (H - horizon);
    const spread = 0.06 + depth * 1.6;
    for (let k = -9; k <= 9; k++) {
      const x = Math.round(W / 2 + k * W * spread * 0.16);
      c.blend(x, y, 90, 240, 255, 0.5 * (0.3 + depth));
    }
    // Rungs: spaced by the square of depth, which is what reads as distance.
    if (Math.abs((depth ** 0.45 * 7) % 1) < 0.1) {
      for (let x = 0; x < W; x++) c.blend(x, y, 90, 240, 255, 0.55);
    }
  }

  // The horizon itself, glowing.
  for (let x = 0; x < W; x++) {
    c.blend(x, Math.round(horizon), 255, 180, 210, 0.9);
    c.blend(x, Math.round(horizon) - 1, 255, 140, 190, 0.5);
  }
  return c.bytes();
}

// ------------------------------------------------------------------ melon

/**
 * A watermelon slice: a dome of flesh with the rind arcing over the top.
 *
 * The origin sits well below the card, so every band is an arc that is
 * highest in the middle — which is what makes it read as a cut slice rather
 * than a red rectangle.
 */
function melon() {
  const c = canvas();
  const ox = W / 2;
  const oy = H * 1.55;
  const RIND = 250;    // beyond this, green
  const PALE = 234;    // between the two, the white inner rind

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - ox;
      const dy = y - oy;
      const r = Math.hypot(dx, dy);
      if (r >= RIND) {
        // The dark bands that run around a watermelon, following the curve.
        const stripe = Math.sin(Math.atan2(dy, dx) * 26) > 0.15;
        c.set(x, y, stripe ? 26 : 58, stripe ? 84 : 132, stripe ? 38 : 62);
      } else if (r >= PALE) {
        c.set(x, y, 238, 245, 228);
      } else {
        // Flesh: deeper in the middle, paler as it nears the rind.
        const t = r / PALE;
        c.set(x, y, mix(214, 243, t), mix(32, 96, t), mix(52, 104, t));
      }
    }
  }

  // Seeds, sitting in the flesh and following the same arc.
  const rnd = rand(815);
  for (let i = 0; i < 14; i++) {
    const r = 120 + rnd() * 100;
    const theta = -Math.PI / 2 + (rnd() - 0.5) * 0.95;
    const x = ox + Math.cos(theta) * r;
    const y = oy + Math.sin(theta) * r;
    if (y < 6 || y > H - 6) continue;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if ((dx / 2.6) ** 2 + (dy / 4) ** 2 > 1) continue;
        c.blend(Math.round(x + dx), Math.round(y + dy), 30, 20, 16, 0.95);
      }
    }
  }
  return c.bytes();
}

// ---------------------------------------------------------------- stadium

/** A floodlit pitch at night, from up in the stand. */
function stadium() {
  const c = canvas();
  const horizon = H * 0.38;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y < horizon) {
        const t = y / horizon;
        c.set(x, y, mix(8, 26, t), mix(12, 38, t), mix(32, 60, t));
      } else {
        // The pitch, lit from above and falling away into the dark.
        const t = (y - horizon) / (H - horizon);
        c.set(x, y, mix(16, 10, t), mix(96, 52, t), mix(54, 32, t));
      }
    }
  }

  // Mown stripes, widening as the pitch comes towards you.
  for (let y = Math.floor(horizon); y < H; y++) {
    const depth = (y - horizon) / (H - horizon);
    const width = 5 + depth * 13;
    for (let x = 0; x < W; x++) {
      const band = Math.floor((x - W / 2) / width + depth * 2);
      if (band % 2 === 0) c.blend(x, y, 255, 255, 255, 0.05);
    }
  }

  // The halfway line and the centre circle, in perspective.
  for (let x = 0; x < W; x++) c.blend(x, Math.round(horizon + (H - horizon) * 0.42), 230, 255, 238, 0.5);
  const ccy = horizon + (H - horizon) * 0.42;
  for (let a = 0; a < 360; a++) {
    const t = (a * Math.PI) / 180;
    const x = Math.round(W / 2 + Math.cos(t) * W * 0.26);
    const y = Math.round(ccy + Math.sin(t) * H * 0.07);
    c.blend(x, y, 230, 255, 238, 0.55);
  }

  // Four floodlights, with the beams they throw down the pitch.
  for (const lx of [W * 0.16, W * 0.84]) {
    const ly = horizon * 0.42;
    glow(c, Math.round(lx), Math.round(ly), 30, 255, 248, 214, 0.8);
    glow(c, Math.round(lx), Math.round(ly), 10, 255, 255, 255, 1);
    for (let y = Math.round(ly); y < H; y++) {
      const t = (y - ly) / (H - ly);
      const half = 4 + t * W * 0.42;
      for (let x = Math.round(lx - half); x < lx + half; x++) {
        const edge = 1 - Math.abs(x - lx) / half;
        c.blend(x, y, 255, 250, 220, edge * 0.1 * (1 - t * 0.7));
      }
    }
  }
  return c.bytes();
}

// ------------------------------------------------------------------ write

fs.mkdirSync(outDir, { recursive: true });
const pictures = { galaxy, strip, melon, stadium };
for (const [name, draw] of Object.entries(pictures)) {
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, png(W, H, draw()));
  console.log(`wrote backs/${name}.png (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}
