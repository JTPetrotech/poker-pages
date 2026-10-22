#!/usr/bin/env node
/**
 * Stamp a version onto every local module URL, then sanity-check the imports.
 *
 * GitHub Pages serves assets with a ten-minute cache and no way to override
 * it, and browsers hold ES modules longer still. Without this, an update can
 * leave one player's browser running yesterday's code against today's — and a
 * host and guest on different versions is a genuinely confusing bug.
 *
 * Run before committing:  node build.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const stamp = Date.now().toString(36);

// Every local .js we might import, relative to the page.
const LOCAL = /(['"])(\.\/[\w./-]+\.js)(\?v=[\w]+)?\1/g;
const SCRIPT_SRC = /(<script type="module" src=")([\w./-]+\.js)(\?v=[\w]+)?(")/;
// The stylesheet is cached exactly like the modules, so it needs stamping too.
const STYLE_HREF = /(<link rel="stylesheet" href=")([\w./-]+\.css)(\?v=[\w]+)?(")/;

const FILES = [
  'app.js', 'net.js', 'host.js', 'bot.js', 'vault.js', 'cloud.js',
  'firebase-config.js', 'engine/game.js', 'engine/hand.js', 'engine/cards.js',
];

/**
 * Catch a missing import before it ships.
 *
 * Patching these files by matching an exact import line is fragile, because
 * stamping rewrites those lines — a patch can miss silently and leave code
 * calling a module it never imported. That shipped once; this is the guard.
 * Each entry is [something the code does, the import it needs].
 */
const REQUIRED = {
  'app.js': [
    ['vault.balance(', './vault.js'],
    ['cloud.isConfigured(', './cloud.js'],
    ['bestHand(', './engine/hand.js'],
    ['cardValue(', './engine/cards.js'],
    ['new TableHost', './host.js'],
    ['new HostNet', './net.js'],
  ],
  'host.js': [['new Table(', './engine/game.js'], ['decide(', './bot.js']],
  'bot.js': [['bestHand(', './engine/hand.js'], ['makeDeck(', './engine/cards.js']],
};

function importedPaths(src) {
  const found = new Set();
  for (const line of src.split('\n')) {
    if (!line.startsWith('import ')) continue;
    const m = line.match(/from\s+'([^']+)'/);
    if (m) found.add(m[1].split('?')[0]);
  }
  return found;
}

let broken = false;
for (const [file, checks] of Object.entries(REQUIRED)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  const imports = importedPaths(src);
  for (const [usage, needed] of checks) {
    if (src.includes(usage) && !imports.has(needed)) {
      console.error(`  MISSING IMPORT: ${file} uses "${usage}" but never imports ${needed}`);
      broken = true;
    }
  }
}

if (broken) {
  console.error('Refusing to build with a missing import.');
  process.exit(1);
}

let touched = 0;

for (const rel of FILES) {
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
const stamped = html
  .replace(SCRIPT_SRC, (_m, open, src, _old, close) => `${open}${src}?v=${stamp}${close}`)
  .replace(STYLE_HREF, (_m, open, href, _old, close) => `${open}${href}?v=${stamp}${close}`);
if (stamped !== html) {
  fs.writeFileSync(indexPath, stamped);
  touched++;
}

console.log(`stamped ${touched} file(s) with v=${stamp}`);
