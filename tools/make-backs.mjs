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

/**
 * A five-by-seven alphabet, enough for the few words that go on a picture.
 * There is no font to load here, so letters are drawn as pixels and scaled
 * up -- blocky on purpose, like something stencilled on.
 */
const GLYPHS = {
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
};

const textWidth = (text, scale, gap) => text.length * 5 * scale + (text.length - 1) * gap;

/** Stencil `text` with its left edge at `x` and its top at `y`. */
function drawText(c, text, x, y, scale, colour, alpha = 1, gap = scale) {
  const [r, g, b] = colour;
  let cursor = x;
  for (const ch of text) {
    const rows = GLYPHS[ch];
    if (rows) {
      rows.forEach((row, ry) => {
        [...row].forEach((on, rx) => {
          if (on !== '1') return;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              c.blend(Math.round(cursor + rx * scale + dx),
                Math.round(y + ry * scale + dy), r, g, b, alpha);
            }
          }
        });
      });
    }
    cursor += 5 * scale + gap;
  }
}

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

// ---------------------------------------------------------------- jackpot

/** A gold coin under a spotlight: the one skin the gamble pack hands over. */
function jackpot() {
  const c = canvas();
  const cx = W / 2;
  const cy = H / 2;
  const R = W * 0.33;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy) / (H / 2);
      c.set(x, y, mix(44, 8, d), mix(28, 5, d), mix(8, 14, d));
    }
  }

  // Rays fanning out behind the coin.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const theta = Math.atan2(y - cy, x - cx);
      const r = Math.hypot(x - cx, y - cy);
      if (r < R) continue;
      const ray = Math.cos(theta * 8) ** 12;
      c.blend(x, y, 255, 206, 108, ray * Math.max(0, 1 - r / (H * 0.55)) * 0.55);
    }
  }

  // The coin: a bevelled rim, a flat face, and a highlight up and left.
  for (let y = Math.floor(cy - R - 2); y < cy + R + 2; y++) {
    for (let x = Math.floor(cx - R - 2); x < cx + R + 2; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r > R) continue;
      // Light from the upper left, so the coin reads as a solid disc.
      const lit = (-dx - dy) / (R * 2) + 0.5;
      let [cr, cg, cb] = [mix(176, 255, lit), mix(118, 232, lit), mix(30, 150, lit)];
      if (r > R * 0.84) {
        // The milled rim, notched all the way round.
        const notch = Math.cos(Math.atan2(dy, dx) * 40) > 0 ? 1.12 : 0.82;
        cr *= notch; cg *= notch; cb *= notch;
      } else if (r > R * 0.74) {
        [cr, cg, cb] = [cr * 0.74, cg * 0.74, cb * 0.72];   // the inner groove
      }
      c.blend(x, y, cr, cg, cb, 1);
    }
  }

  // A four-pointed sparkle on the face, where a mint mark would sit.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / (R * 0.52);
      const dy = (y - cy) / (R * 0.52);
      const star = 1 - (Math.abs(dx) ** 0.55 + Math.abs(dy) ** 0.55);
      if (star > 0) c.blend(x, y, 255, 252, 232, Math.min(1, star * 2.4));
    }
  }

  glow(c, Math.round(cx - R * 0.34), Math.round(cy - R * 0.34), R * 0.5, 255, 255, 240, 0.4);
  return c.bytes();
}

// ------------------------------------------------------------------- milk

/** A glass of milk, lit from the left. One of the two rare ones in Limited. */
function milk() {
  const c = canvas();
  const topY = H * 0.2;
  const botY = H * 0.88;
  const topHalf = W * 0.27;
  const botHalf = W * 0.2;     // tapered, the way a tumbler is
  const level = H * 0.3;       // where the milk starts

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = y / H;
      c.set(x, y, mix(74, 40, t), mix(96, 58, t), mix(126, 84, t));
    }
  }

  for (let y = Math.floor(topY); y < botY; y++) {
    const t = (y - topY) / (botY - topY);
    const half = mix(topHalf, botHalf, t);
    for (let x = Math.round(W / 2 - half); x < W / 2 + half; x++) {
      if (x < 0 || x >= W) continue;
      const edge = Math.abs(x - W / 2) / half;
      if (y < level) {
        // Empty glass above the milk: just the walls catching the light.
        const wall = edge > 0.88 ? 0.75 : 0.12;
        c.blend(x, y, 232, 240, 250, wall);
      } else {
        // Milk, shaded round so it reads as liquid in a cylinder.
        const lit = 1 - Math.abs(x - (W / 2 - half * 0.3)) / (half * 1.9);
        const v = mix(214, 255, Math.max(0, lit));
        c.blend(x, y, v, v, mix(v - 10, 252, 0.5), 1);
        if (edge > 0.9) c.blend(x, y, 196, 202, 214, 0.5);
      }
    }
  }

  // The surface of the milk, and a highlight down the left wall.
  for (let x = Math.round(W / 2 - topHalf * 0.93); x < W / 2 + topHalf * 0.93; x++) {
    for (let d = -2; d <= 2; d++) {
      c.blend(x, Math.round(level + d), 255, 255, 252, 0.6 - Math.abs(d) * 0.2);
    }
  }
  for (let y = Math.floor(topY + 6); y < botY - 8; y++) {
    const t = (y - topY) / (botY - topY);
    const half = mix(topHalf, botHalf, t);
    for (let d = 0; d < 3; d++) {
      c.blend(Math.round(W / 2 - half + 4 + d), y, 255, 255, 255, 0.4);
    }
  }

  // Stencilled across the glass: this one is given away, not sold.
  const scale = 2;
  const gap = 3;
  drawText(c, 'FREE', (W - textWidth('FREE', scale, gap)) / 2, H * 0.53,
    scale, [104, 126, 162], 0.95, gap);
  return c.bytes();
}

// ------------------------------------------------------------------ supra

/**
 * The back of a modded MK4 Supra: round quad lights and that wing.
 *
 * Drawn from the rear because that is the view the car is known for, and
 * because round lights and a straight wing are shapes this can actually
 * draw convincingly at the size a card is.
 */
function supra() {
  const c = canvas();
  const groundY = H * 0.82;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y < groundY) {
        const t = y / groundY;
        c.set(x, y, mix(18, 56, t), mix(16, 26, t), mix(34, 44, t));
      } else {
        const t = (y - groundY) / (H - groundY);
        c.set(x, y, mix(32, 12, t), mix(20, 9, t), mix(28, 14, t));
      }
    }
  }

  const cx = W / 2;
  const roofY = H * 0.27;      // top of the rear glass
  const shoulderY = H * 0.45;  // where glass meets bodywork
  const bumperY = H * 0.665;
  const sillY = H * 0.79;
  // Bright enough to read as Supra orange rather than brown at card size.
  const paint = (lit) => [
    mix(214, 255, Math.max(0, lit)),
    mix(92, 206, Math.max(0, lit)),
    mix(26, 148, Math.max(0, lit)),
  ];

  // The rear glass: a trapezoid narrowing to the roof, pale enough to read
  // as glass catching the sky rather than a hole in the picture.
  for (let y = Math.round(roofY); y < shoulderY; y++) {
    const t = (y - roofY) / (shoulderY - roofY);
    const half = W * mix(0.24, 0.33, t);
    for (let x = Math.round(cx - half); x < cx + half; x++) {
      if (x < 0 || x >= W) continue;
      const across = (x - (cx - half)) / (half * 2);
      const sheen = Math.max(0, 1 - Math.abs(across - 0.3) * 2.6);
      c.blend(x, y,
        mix(86, 196, sheen * (1 - t * 0.4)),
        mix(102, 214, sheen * (1 - t * 0.4)),
        mix(126, 238, sheen * (1 - t * 0.4)), 1);
    }
  }

  // Bodywork: shoulders down to the sill, squared off with soft corners.
  for (let y = Math.round(shoulderY); y < sillY; y++) {
    const t = (y - shoulderY) / (sillY - shoulderY);
    const half = W * mix(0.36, 0.45, Math.min(1, t * 2.4));
    for (let x = Math.round(cx - half); x < cx + half; x++) {
      if (x < 0 || x >= W) continue;
      const corner = Math.abs(x - cx) / half;
      if (t < 0.1 && corner > 0.94) continue;          // rounded top corners
      const lit = 1 - Math.abs(x - (cx - half * 0.4)) / (half * 2.1) - t * 0.25;
      const [r, g, b] = paint(lit);
      // The bumper sits lower and catches less light; the arches fall away.
      const dark = (y > bumperY ? 0.68 : 1) * (corner > 0.86 ? 0.66 : 1);
      c.blend(x, y, r * dark, g * dark, b * dark, 1);
    }
  }

  // The four round lights that say which car this is.
  const ly = shoulderY + (bumperY - shoulderY) * 0.42;
  for (const lx of [cx - W * 0.27, cx - W * 0.12, cx + W * 0.12, cx + W * 0.27]) {
    const r = W * 0.058;
    for (let y = Math.round(ly - r - 1); y <= ly + r + 1; y++) {
      for (let x = Math.round(lx - r - 1); x <= lx + r + 1; x++) {
        const d = Math.hypot(x - lx, y - ly) / r;
        if (d > 1.18) continue;
        if (d > 1) c.blend(x, y, 28, 14, 10, 1);                    // surround
        else if (d > 0.74) c.blend(x, y, 150, 22, 24, 1);           // lens rim
        else c.blend(x, y, mix(255, 206, d), mix(120, 26, d), mix(110, 26, d), 1);
      }
    }
    glow(c, Math.round(lx), Math.round(ly), r * 2.6, 255, 60, 44, 0.4);
  }

  // The wing: two uprights off the bootlid and a deck across the top.
  const wingY = roofY - H * 0.11;
  for (const ux of [cx - W * 0.21, cx + W * 0.21]) {
    for (let y = Math.round(wingY + 5); y < shoulderY + 4; y++) {
      for (let x = Math.round(ux - 3); x <= ux + 3; x++) c.blend(x, y, 38, 17, 10, 1);
    }
  }
  for (let y = Math.round(wingY); y < wingY + 8; y++) {
    const lit = 1 - (y - wingY) / 10;
    for (let x = Math.round(cx - W * 0.46); x < cx + W * 0.46; x++) {
      if (x < 0 || x >= W) continue;
      const [r, g, b] = paint(lit * 0.9);
      c.blend(x, y, r, g, b, 1);
    }
  }

  // Twin exhausts, and the light they throw on the road.
  for (const ex of [cx - W * 0.13, cx + W * 0.13]) {
    for (let y = Math.round(sillY - 9); y < sillY - 1; y++) {
      for (let x = Math.round(ex - 8); x <= ex + 8; x++) {
        if ((x - ex) ** 2 / 64 + (y - (sillY - 5)) ** 2 / 16 > 1) continue;
        c.blend(x, y, 188, 196, 206, 1);
      }
    }
  }
  glow(c, Math.round(cx), Math.round(groundY + 10), W * 0.55, 255, 120, 50, 0.32);
  return c.bytes();
}

// ----------------------------------------------------------------- aurora

/** Northern lights: curtains of green and violet over a cold sky. */
function aurora() {
  const c = canvas();
  const rnd = rand(31415);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = y / H;
      c.set(x, y, mix(10, 30, t), mix(14, 40, t), mix(34, 58, t));
    }
  }

  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H * 0.8);
    c.blend(x, y, 255, 252, 240, (0.25 + rnd() * 0.7) * 0.85);
  }

  // Three curtains, each a wavering top edge with light hanging below it.
  const curtains = [
    { base: H * 0.3, amp: H * 0.09, freq: 2.1, drop: H * 0.4, rgb: [90, 255, 170] },
    { base: H * 0.4, amp: H * 0.07, freq: 3.4, drop: H * 0.32, rgb: [150, 120, 255] },
    { base: H * 0.24, amp: H * 0.05, freq: 1.4, drop: H * 0.26, rgb: [120, 240, 255] },
  ];
  for (const { base, amp, freq, drop, rgb } of curtains) {
    for (let x = 0; x < W; x++) {
      const top = base + Math.sin((x / W) * Math.PI * freq) * amp;
      for (let y = Math.round(top); y < top + drop; y++) {
        if (y < 0 || y >= H) continue;
        const down = (y - top) / drop;
        // Vertical streaks, the way a real curtain is ribbed.
        const rib = 0.55 + 0.45 * Math.sin(x * 0.9);
        c.blend(x, y, rgb[0], rgb[1], rgb[2], (1 - down) ** 1.8 * 0.5 * rib);
      }
    }
  }

  // A dark ridge along the bottom, so the sky has something to stand on.
  for (let x = 0; x < W; x++) {
    const ridge = H * 0.86 + Math.sin(x * 0.11) * 5 + Math.sin(x * 0.37) * 3;
    for (let y = Math.round(ridge); y < H; y++) c.blend(x, y, 9, 11, 18, 1);
  }
  return c.bytes();
}

// ---------------------------------------------------------------- invader

/** A big pixel alien on a screen, scanlines and all. */
function invader() {
  const c = canvas();
  const ART = [
    '..#.....#..',
    '...#...#...',
    '..#######..',
    '.##.###.##.',
    '###########',
    '#.#######.#',
    '#.#.....#.#',
    '...##.##...',
  ];
  const cell = Math.floor(W / 13);
  const artW = ART[0].length * cell;
  const artH = ART.length * cell;
  const ox = (W - artW) / 2;
  const oy = (H - artH) / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = Math.hypot(x - W / 2, y - H / 2) / (H / 2);
      c.set(x, y, mix(14, 4, t), mix(22, 6, t), mix(16, 5, t));
    }
  }

  ART.forEach((row, ry) => {
    [...row].forEach((on, rx) => {
      if (on !== '#') return;
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          // A hair of a gap between pixels, so it reads as pixel art.
          if (dx >= cell - 1 || dy >= cell - 1) continue;
          c.blend(Math.round(ox + rx * cell + dx), Math.round(oy + ry * cell + dy),
            108, 255, 120, 1);
        }
      }
    });
  });

  glow(c, Math.round(W / 2), Math.round(H / 2), W * 0.62, 70, 220, 90, 0.3);

  // Scanlines, last, so they fall across the alien too.
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x++) c.blend(x, y, 0, 0, 0, 0.3);
  }
  return c.bytes();
}

// ------------------------------------------------------------------ write

fs.mkdirSync(outDir, { recursive: true });
const pictures = { galaxy, strip, melon, stadium, jackpot, milk, supra, aurora, invader };
for (const [name, draw] of Object.entries(pictures)) {
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, png(W, H, draw()));
  console.log(`wrote backs/${name}.png (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}
