/**
 * The vault: your chips between games.
 *
 * It lives in this browser's storage, so it persists across tables and page
 * reloads but does not follow you to another device — there is no server to
 * hold it. You take chips out of the vault to sit down and put them back when
 * you cash out.
 */

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
  created: null,
};

let cache = null;
let remote = null;        // { uid, save(profile) } once signed in
let storageKey = KEY;

function readStored() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...BLANK, created: Date.now() };
    const parsed = JSON.parse(raw);
    const profile = { ...BLANK, ...parsed };
    // Storage is editable by hand; never trust what comes back out of it.
    profile.vault = Math.min(MAX_VAULT, Math.max(0, Math.floor(Number(profile.vault) || 0)));
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
 * A short code carrying your chips, for moving to another device or keeping
 * somewhere safe. Browsers clear stored data on their own schedule — Safari
 * after about a week of not visiting — and this is the way back.
 */
export function backupCode() {
  const p = read();
  const payload = {
    v: 1,
    c: p.vault + (p.atTable ? p.atTable.amount : 0),
    h: p.handsPlayed,
    b: p.biggestPot,
    n: p.name,
  };
  return btoa(JSON.stringify(payload)).replace(/=+$/, '');
}

/** Returns the restored balance, or null if the code is not one of ours. */
export function restoreCode(code) {
  try {
    const text = String(code || '').trim();
    if (!text) return null;
    const json = JSON.parse(atob(text));
    if (!json || json.v !== 1 || typeof json.c !== 'number') return null;

    const p = read();
    p.vault = Math.min(MAX_VAULT, Math.max(0, Math.floor(json.c)));
    p.atTable = null;
    p.handsPlayed = Math.max(0, Math.floor(json.h) || 0);
    p.biggestPot = Math.max(0, Math.floor(json.b) || 0);
    if (json.n) p.name = String(json.n).slice(0, 16);
    write(p);
    return p.vault;
  } catch {
    return null;
  }
}
