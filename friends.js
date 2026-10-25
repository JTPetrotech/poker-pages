/**
 * People you have played with.
 *
 * Kept on this device, like everything else here. One real limitation worth
 * knowing: there are no accounts, so players are recognised by the name they
 * sit down under. Two friends using the same name look like one person, and a
 * friend who changes theirs looks like someone new. Nothing can be done about
 * that without a server holding identities.
 */

const KEY = 'pn.friends.v1';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* private mode: the list just will not persist */ }
  return map;
}

const keyFor = (name) => String(name || '').trim().toLowerCase().slice(0, 16);

/**
 * Record that you played with someone. `table` counts a shared game once,
 * however many hands it runs to, so the tally means games rather than
 * refreshes.
 */
export function note(name, table) {
  const key = keyFor(name);
  if (!key) return;
  const all = readAll();
  const entry = all[key] || { name, games: 0, lastTable: null, fav: false, nick: '' };
  entry.name = name;              // keep their current spelling
  entry.seen = Date.now();
  if (table && entry.lastTable !== table) {
    entry.games += 1;
    entry.lastTable = table;
  }
  all[key] = entry;
  writeAll(all);
}

/** Favourites first, then whoever you saw most recently. */
export function list() {
  const all = readAll();
  return Object.entries(all)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.seen || 0) - (a.seen || 0));
}

export function star(key, on) {
  const all = readAll();
  if (!all[key]) return;
  all[key].fav = !!on;
  writeAll(all);
}

export function rename(key, nick) {
  const all = readAll();
  if (!all[key]) return;
  all[key].nick = String(nick || '').trim().slice(0, 16);
  writeAll(all);
}

export function remove(key) {
  const all = readAll();
  delete all[key];
  writeAll(all);
}

export function count() {
  return Object.keys(readAll()).length;
}

/** What to show for someone: their nickname if you gave them one. */
export function displayName(entry) {
  return entry.nick || entry.name;
}
