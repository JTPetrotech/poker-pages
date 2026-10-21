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

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...BLANK, created: Date.now() };
    const parsed = JSON.parse(raw);
    const profile = { ...BLANK, ...parsed };
    // Storage is editable by hand; never trust what comes back out of it.
    profile.vault = Math.max(0, Math.floor(Number(profile.vault) || 0));
    return profile;
  } catch {
    return { ...BLANK, created: Date.now() };
  }
}

function write(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch { /* private mode: the vault just won't persist */ }
  return profile;
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
  p.vault += add;
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
