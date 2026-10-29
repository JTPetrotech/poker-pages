/**
 * The vault: your chips between games.
 *
 * It lives in this browser's storage, so it persists across tables and page
 * reloads but does not follow you to another device — there is no server to
 * hold it. You take chips out of the vault to sit down and put them back when
 * you cash out.
 */

import { DECK_IDS, CHIP_IDS, sparePrice } from './decks.js?v=mvu5hq9n';

const KEY = 'pn.profile.v1';

export const STARTING_VAULT = 10_000;

/**
 * A quadrillion. Above roughly 9 quadrillion JavaScript stops counting whole
 * numbers exactly, and chips would start appearing and vanishing in the
 * rounding. Capping here keeps every total on every table comfortably inside
 * the range where the arithmetic is still exact.
 */
export const MAX_VAULT = 1_000_000_000_000_000;

const BLANK = {
  name: '',
  // Chips currently sitting on a table. Tracked continuously so that a closed
  // tab, a crash or a dead connection can never swallow them.
  atTable: null,
  vault: STARTING_VAULT,
  handsPlayed: 0,
  biggestPot: 0,
  bestHand: null,
  reloads: 0,
  // Card backs pulled out of packs. Classic is free and never listed.
  decks: [],
  // Chip skins, in a list of their own so neither kind can shift the
  // other's place in a backup code. Pink is free and never listed.
  chipSkins: [],
  // Spare copies: how many extra of each skin a pack has handed over since
  // the first one. These are what the shop buys back. They are kept apart
  // from the collections above because a backup code carries one bit per
  // skin and has no room for a count — and a spare is for selling here
  // rather than for moving to another device.
  deckSpares: {},
  chipSpares: {},
  created: null,
};

/** Past this a count is meaningless, and it keeps the arithmetic small. */
const MAX_SPARES = 99_999;

let cache = null;
let remote = null;        // { uid, save(profile) } once signed in
let storageKey = KEY;

/** Keep only real ids, once each — storage and accounts can both lie. */
function tidyIds(list, allowed) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((id) => allowed.includes(id)))];
}

const tidyDecks = (list) => tidyIds(list, DECK_IDS);

/** Keep only real ids with a real count — storage is editable by hand. */
function tidySpares(map, allowed) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [id, raw] of Object.entries(map)) {
    const count = Math.floor(Number(raw));
    if (allowed.includes(id) && count > 0) out[id] = Math.min(MAX_SPARES, count);
  }
  return out;
}

function readStored() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...BLANK, created: Date.now() };
    const parsed = JSON.parse(raw);
    const profile = { ...BLANK, ...parsed };
    // Storage is editable by hand; never trust what comes back out of it.
    profile.vault = Math.min(MAX_VAULT, Math.max(0, Math.floor(Number(profile.vault) || 0)));
    profile.decks = tidyDecks(profile.decks);
    profile.chipSkins = tidyIds(profile.chipSkins, CHIP_IDS);
    profile.deckSpares = tidySpares(profile.deckSpares, DECK_IDS);
    profile.chipSpares = tidySpares(profile.chipSpares, CHIP_IDS);
    return profile;
  } catch {
    return { ...BLANK, created: Date.now() };
  }
}

function read() {
  if (!cache) cache = readStored();
  return cache;
}

function write(profile) {
  cache = profile;
  try {
    localStorage.setItem(storageKey, JSON.stringify(profile));
  } catch { /* private mode: the local mirror just won't persist */ }
  // Signed in, the local copy is only a mirror — the account is the truth.
  if (remote) remote.save(profile);
  return profile;
}

/**
 * Attach a signed-in account. `profile` is whatever the account already had,
 * or null for a brand new one. Reads stay synchronous because the profile is
 * held in memory from here on; writes mirror locally and sync to the account.
 */
export function adopt(profile, backend) {
  storageKey = `${KEY}:${backend.uid}`;
  remote = backend;
  const merged = { ...BLANK, ...(profile || {}) };
  merged.vault = Math.min(MAX_VAULT, Math.max(0, Math.floor(Number(merged.vault) || 0)));
  if (!merged.created) merged.created = Date.now();
  return write(merged);
}

/** Sign out: forget the account's profile and fall back to this device's. */
export function detach() {
  remote = null;
  storageKey = KEY;
  cache = null;
}

export function isCloudBacked() {
  return remote !== null;
}

export function profile() {
  return read();
}

export function balance() {
  return read().vault;
}

export function setName(name) {
  const p = read();
  p.name = String(name || '').slice(0, 16);
  return write(p);
}

/** Take chips out for a buy-in. Returns the amount actually withdrawn. */
export function withdraw(amount) {
  const p = read();
  const take = Math.min(Math.max(0, Math.floor(amount)), p.vault);
  p.vault -= take;
  write(p);
  return take;
}

/** Put chips back after cashing out. */
export function deposit(amount) {
  const p = read();
  const add = Math.max(0, Math.floor(amount));
  p.vault = Math.min(MAX_VAULT, p.vault + add);
  write(p);
  return p.vault;
}

// ------------------------------------------------------------ card backs

/** Every design you own, Classic aside — it is free and always yours. */
export function decks() {
  return [...read().decks];
}

export function ownsDeck(id) {
  return read().decks.includes(id);
}

/** Every chip skin you own, Pink aside — it is free and always yours. */
export function chipSkins() {
  return [...read().chipSkins];
}

export function ownsChip(id) {
  return read().chipSkins.includes(id);
}

export function grantChip(id) {
  if (!CHIP_IDS.includes(id) || ownsChip(id)) return false;
  const p = read();
  p.chipSkins = [...p.chipSkins, id];
  write(p);
  return true;
}

/**
 * Hand over a design. Returns false when it is already yours or is not a
 * design at all, so the caller can tell a real pull from a no-op.
 */
export function grantDeck(id) {
  if (!DECK_IDS.includes(id) || ownsDeck(id)) return false;
  const p = read();
  p.decks = [...p.decks, id];
  write(p);
  return true;
}

// ---------------------------------------------------------------- spares

const SPARE_KEY = { deck: 'deckSpares', chip: 'chipSpares' };

/** Every spare of one kind, as { id: count }. */
export function spares(kind) {
  return { ...read()[SPARE_KEY[kind]] };
}

export function spareCount(kind, id) {
  return read()[SPARE_KEY[kind]][id] || 0;
}

/** Spare copies in hand, both kinds together. */
export function spareTotal() {
  const p = read();
  const sum = (map) => Object.values(map).reduce((a, b) => a + b, 0);
  return sum(p.deckSpares) + sum(p.chipSpares);
}

/**
 * What every spare in hand would fetch.
 *
 * Each one is priced by its own rarity, so this is a sum rather than a
 * count times a price, and the buttons quote it before anything is sold.
 */
export function spareValue() {
  const p = read();
  let total = 0;
  for (const [kind, key] of Object.entries(SPARE_KEY)) {
    for (const [id, n] of Object.entries(p[key])) total += n * sparePrice(kind, id);
  }
  return total;
}

/**
 * Take delivery of a skin a pack just handed over.
 *
 * The first copy joins the collection; every one after it is a spare. The
 * return value says which happened, so the shop can tell you whether it has
 * given you something new or something to sell.
 */
function take(kind, id, catalogue, listKey) {
  if (!catalogue.includes(id)) return false;
  const p = read();
  if (!p[listKey].includes(id)) {
    p[listKey] = [...p[listKey], id];
    write(p);
    return true;
  }
  const key = SPARE_KEY[kind];
  p[key] = { ...p[key], [id]: Math.min(MAX_SPARES, (p[key][id] || 0) + 1) };
  write(p);
  return false;
}

/** Returns true when it was new, false when it became a spare. */
export function addDeck(id) {
  return take('deck', id, DECK_IDS, 'decks');
}

export function addChip(id) {
  return take('chip', id, CHIP_IDS, 'chipSkins');
}

/**
 * Sell spare copies back to the shop.
 *
 * Only spares are ever sold: the copy that is in your collection stays
 * there, so no tap can cost you a skin. Returns what was sold and the new
 * balance, or null when there was no spare to sell.
 */
export function sellSpares(kind, id, howMany = 1) {
  const key = SPARE_KEY[kind];
  if (!key) return null;
  const p = read();
  const have = p[key][id] || 0;
  const sold = Math.min(have, Math.max(0, Math.floor(howMany)));
  if (sold <= 0) return null;
  const next = { ...p[key] };
  if (sold === have) delete next[id];
  else next[id] = have - sold;
  p[key] = next;
  const paid = sold * sparePrice(kind, id);
  p.vault = Math.min(MAX_VAULT, p.vault + paid);
  write(p);
  return { sold, paid, balance: p.vault };
}

/**
 * Hand one spare over to somebody else: it leaves, and no chips arrive.
 *
 * Called only once the table has confirmed the gift was delivered, so a
 * gift that was refused costs nothing. Returns false when there was no
 * spare to give, which the caller says out loud rather than swallowing.
 */
export function giveSpare(kind, id) {
  const key = SPARE_KEY[kind];
  if (!key) return false;
  const p = read();
  const have = p[key][id] || 0;
  if (have <= 0) return false;
  const next = { ...p[key] };
  if (have === 1) delete next[id];
  else next[id] = have - 1;
  p[key] = next;
  write(p);
  return true;
}

/**
 * Sell every spare in one go, both collections together.
 *
 * Same rule as selling one: the copy in your collection stays, so this
 * empties the doubles and leaves you owning exactly what you owned before.
 * Returns null when there was nothing to sell, so the caller can say so
 * rather than claiming a sale of nothing.
 */
export function sellAllSpares() {
  const p = read();
  let sold = 0;
  let paid = 0;
  for (const [kind, key] of Object.entries(SPARE_KEY)) {
    for (const [id, n] of Object.entries(p[key])) {
      sold += n;
      paid += n * sparePrice(kind, id);
    }
    p[key] = {};
  }
  if (!sold) return null;
  p.vault = Math.min(MAX_VAULT, p.vault + paid);
  write(p);
  return { sold, paid, balance: p.vault };
}

/** How often a chip flip comes up heads. A fair coin, by design. */
export const COIN_ODDS = 0.5;

/**
 * Stake chips on a coin flip. Win and the stake doubles, lose and it is gone.
 *
 * At even odds and an even payout neither side has an edge, which is the
 * honest version of this and the only one worth building: nobody is quietly
 * being drained. `roll` is passed in by the tests so an outcome can be
 * checked exactly rather than hoped for.
 *
 * Returns null when the stake is not a real one or is more than the vault
 * holds, so nothing moves on a bad bet.
 */
export function coinFlip(stake, roll = Math.random()) {
  const bet = Math.floor(Number(stake));
  if (!Number.isFinite(bet) || bet <= 0) return null;
  const p = read();
  if (p.vault < bet) return null;
  const won = roll < COIN_ODDS;
  p.vault = won ? Math.min(MAX_VAULT, p.vault + bet) : p.vault - bet;
  write(p);
  return { won, stake: bet, balance: p.vault };
}

/**
 * Pay for a pack. Returns true only if the chips were there and have been
 * taken — the caller draws the design afterwards, so a draw can never happen
 * without the chips having left the vault.
 */
export function spend(amount) {
  const cost = Math.max(0, Math.floor(amount));
  const p = read();
  if (p.vault < cost) return false;
  p.vault -= cost;
  write(p);
  return true;
}

/** Remember what we're holding at a table, so it survives anything. */
export function setAtTable(code, amount) {
  const p = read();
  const chips = Math.max(0, Math.floor(amount) || 0);
  if (p.atTable && p.atTable.code === code && p.atTable.amount === chips) return;
  p.atTable = { code, amount: chips };
  write(p);
}

/** Stop tracking a table and report what was staked there. */
export function clearAtTable() {
  const p = read();
  const amount = p.atTable ? p.atTable.amount : 0;
  if (!p.atTable) return 0;
  p.atTable = null;
  write(p);
  return amount;
}

/**
 * Called on load: if a previous session left chips on a table and never
 * cashed out — tab closed, browser crashed, host vanished — take them back.
 */
export function recoverStranded() {
  const p = read();
  if (!p.atTable) return 0;
  const amount = Math.max(0, Math.floor(p.atTable.amount) || 0);
  p.atTable = null;
  p.vault += amount;
  write(p);
  return amount;
}

export function recordHand({ pot, handName } = {}) {
  const p = read();
  p.handsPlayed += 1;
  if (pot && pot > p.biggestPot) p.biggestPot = pot;
  if (handName) p.bestHand = handName;
  return write(p);
}

/** Free reload when the vault runs dry — it is play money, after all. */
export function reload() {
  const p = read();
  if (p.vault > 0) return p.vault;
  p.vault = STARTING_VAULT;
  p.reloads += 1;
  write(p);
  return p.vault;
}

/**
 * A short code carrying your chips to another device.
 *
 * Crockford's base32 alphabet: no I, L, O or U, so there is nothing to
 * confuse with 1 and 0 and nothing that spells a word by accident. Case and
 * dashes are ignored when reading one back, and two check characters catch a
 * mistyped code rather than silently setting the wrong balance.
 *
 * Carries your chips, your hands played and the card backs you have bought.
 * Hands take three fixed characters and the backs four, which is what lets
 * the fields be told apart without separators; the leading letter marks the
 * format, so every older code still reads back.
 */
const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode32(n) {
  let out = '';
  let v = Math.max(0, Math.floor(n));
  do {
    out = C32[v % 32] + out;
    v = Math.floor(v / 32);
  } while (v > 0);
  return out;
}

function decode32(text) {
  let v = 0;
  for (const ch of text) {
    const i = C32.indexOf(ch);
    if (i < 0) return null;
    v = v * 32 + i;
  }
  return v;
}

function checkChars(body) {
  let sum = 7;
  for (const ch of body) sum = (sum * 31 + C32.indexOf(ch)) % 1024;
  return C32[Math.floor(sum / 32)] + C32[sum % 32];
}

/** Normalise what someone typed: case, dashes, and the usual lookalikes. */
function tidy(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

// Three base32 characters, so the most hands a code can carry.
const MAX_CODED_HANDS = 32 ** 3 - 1;

/**
 * One bit per design, at its fixed position in the catalogue, packed into
 * base32 characters at five bits each.
 *
 * The letter at the front of a code says how wide that field is, because the
 * catalogue outgrew the first width when the ultra rares were added. Codes
 * written at the old width keep reading at the old width.
 */
const DECK_FIELD = { C: 4, D: 5, E: 5, F: 5, G: 7, H: 9, J: 11, K: 13, M: 16 };
// E onwards carry chip skins. Each letter is a width, and a new one is
// minted whenever a catalogue outgrows the field it was written into.
const CHIP_FIELD = { E: 2, F: 4, G: 4, H: 4, J: 6, K: 8, M: 10 };
// J, not I: the alphabet below leaves out I, L, O and U so nothing can be
// confused with 1 or 0, and a version letter has to be one of its own
// characters or the code could not be read back.
const DECK_VERSION = 'M';

/**
 * How many skins the current code width can carry. A skin past this point
 * would be dropped from every code without a word, so the tests check the
 * catalogue against it — going over means a wider field and a new letter.
 */
export const CODED_DECK_LIMIT = DECK_FIELD[DECK_VERSION] * 5;

/** The same, for chip skins. */
export const CODED_CHIP_LIMIT = CHIP_FIELD[DECK_VERSION] * 5;

/**
 * The bit field is BigInt throughout, not a number.
 *
 * JavaScript's shifts and masks are 32-bit, so the moment a catalogue passed
 * 31 skins `1 << i` wrapped around and the whole field encoded as zeros —
 * silently, with every card skin dropped from every code. BigInt has no such
 * edge, and the round-trip test below covers a full collection.
 */
function encodeBits(list, catalogue, width) {
  let bits = 0n;
  for (const id of list) {
    const i = catalogue.indexOf(id);
    if (i >= 0 && i < width * 5) bits |= 1n << BigInt(i);
  }
  let out = '';
  let v = bits;
  do {
    out = C32[Number(v % 32n)] + out;
    v /= 32n;
  } while (v > 0n);
  return out.padStart(width, '0');
}

function decodeBits(text, catalogue) {
  let bits = 0n;
  for (const ch of text) {
    const i = C32.indexOf(ch);
    if (i < 0) return null;
    bits = bits * 32n + BigInt(i);
  }
  return catalogue.filter((_id, i) => ((bits >> BigInt(i)) & 1n) === 1n);
}

export function backupCode() {
  const p = read();
  const chips = p.vault + (p.atTable ? p.atTable.amount : 0);
  const hands = encode32(Math.min(p.handsPlayed, MAX_CODED_HANDS)).padStart(3, '0');
  const body = `${DECK_VERSION}${encode32(chips)}${hands}`
    + encodeBits(p.decks, DECK_IDS, DECK_FIELD[DECK_VERSION])
    + encodeBits(p.chipSkins, CHIP_IDS, CHIP_FIELD[DECK_VERSION]);
  const full = body + checkChars(body);
  // Grouped in fours, which is easier to read aloud and to type.
  return full.match(/.{1,4}/g).join('-');
}

/** Returns the restored balance, or null if the code is not a valid one. */
export function restoreCode(code) {
  const clean = tidy(code);
  if (clean.length < 3) return null;

  const body = clean.slice(0, -2);
  if (checkChars(body) !== clean.slice(-2)) return null;

  // E and F carry chip skins too, C and D the card backs, B the chips and
  // hands alone, and anything else is an older chips-only code. The leading
  // letter says which, and every one of them still reads back.
  let chips;
  let hands = null;
  let decksOwned = null;
  let chipsOwned = null;
  const deckW = DECK_FIELD[body[0]] || 0;
  const chipW = CHIP_FIELD[body[0]] || 0;
  const tail = 3 + deckW + chipW;
  if (deckW && body.length >= 2 + tail) {
    chips = decode32(body.slice(1, -tail));
    hands = decode32(body.slice(-tail, -(deckW + chipW)));
    decksOwned = decodeBits(body.slice(-(deckW + chipW), chipW ? -chipW : undefined), DECK_IDS);
    if (chipW) chipsOwned = decodeBits(body.slice(-chipW), CHIP_IDS);
  } else if (body[0] === 'B' && body.length >= 5) {
    chips = decode32(body.slice(1, -3));
    hands = decode32(body.slice(-3));
  } else {
    chips = decode32(body);
  }
  if (chips === null || !Number.isFinite(chips)) return null;

  const p = read();
  p.vault = Math.min(MAX_VAULT, Math.max(0, Math.floor(chips)));
  p.atTable = null;
  if (hands !== null && Number.isFinite(hands)) p.handsPlayed = Math.max(0, hands);
  // A code that predates a collection says nothing about it, so it leaves
  // whatever this device already has rather than wiping what is there.
  if (decksOwned) p.decks = tidyDecks([...p.decks, ...decksOwned]);
  if (chipsOwned) p.chipSkins = tidyIds([...p.chipSkins, ...chipsOwned], CHIP_IDS);
  write(p);
  return p.vault;
}
