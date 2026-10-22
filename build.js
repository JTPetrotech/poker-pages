#!/usr/bin/env node
/**
 * Stamp a version onto every local module URL.
 *
 * GitHub Pages serves assets with a ten-minute cache and no way to override
 * it, and browsers hold ES modules longer still. Without this, an update can
 * leave one player's browser running yesterday's code against today's — and
 * a host and guest on different versions is a genuinely confusing bug.
 *
 * Changing the URL sidesteps the cache entirely. Run this before committing:
 *     node build.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const stamp = Date.now().toString(36);

// Every local .js we might import, relative to the page.
const LOCAL = /(['"])(\.\/[\w./-]+\.js)(\?v=[\w]+)?\1/g;
const SCRIPT_SRC = /(<script type="module" src=")([\w./-]+\.js)(\?v=[\w]+)?(")/;
// The stylesheet needs stamping too — it is cached exactly like the modules.
const STYLE_HREF = /(<link rel="stylesheet" href=")([\w./-]+\.css)(\?v=[\w]+)?(")/;

const files = ['app.js', 'net.js', 'host.js', 'bot.js', 'vault.js',
  'engine/game.js', 'engine/hand.js', 'engine/cards.js'];

let touched = 0;

for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(LOCAL, (_m, q, spec) => `${q}${spec}?v=${stamp}${q}`);
  if (after !== before) {
    fs.writeFileSync(file, after);
    touched++;
  }
}

const indexPath = path.join(root, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const stampedHtml = html
  .replace(SCRIPT_SRC, (_m, open, src, _old, close) => `${open}${src}?v=${stamp}${close}`)
  .replace(STYLE_HREF, (_m, open, href, _old, close) => `${open}${href}?v=${stamp}${close}`);
if (stampedHtml !== html) {
  fs.writeFileSync(indexPath, stampedHtml);
  touched++;
}

console.log(`stamped ${touched} file(s) with v=${stamp}`);
