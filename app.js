import { HostNet, GuestNet } from './net.js?v=mvrjawnn';
import { TableHost } from './host.js?v=mvrjawnn';
import * as vault from './vault.js?v=mvrjawnn';
import * as friends from './friends.js?v=mvrjawnn';
import * as packs from './decks.js?v=mvrjawnn';
import * as cloud from './cloud.js?v=mvrjawnn';
import { bestHand } from './engine/hand.js?v=mvrjawnn';
import { cardValue, cardSuit, RANK_NAMES, RANK_PLURALS } from './engine/cards.js?v=mvrjawnn';

const $ = (id) => document.getElementById(id);

/**
 * Show or hide an element. The `hidden` attribute alone isn't enough: any
 * stylesheet rule that sets `display` on the element outranks the user-agent
 * `[hidden]` rule, so set both and let the stylesheet decide the shown value.
 */
function show(el, visible) {
  el.hidden = !visible;
  el.style.display = visible ? '' : 'none';
}

/**
 * Shown at the bottom of the screen. Goes up by one for each substantial
 * change, so it is clear at a glance whether a browser has the latest build.
 */
const BUILD = 50;

const SUIT_GLYPH = { c: '♣', d: '♦', h: '♥', s: '♠' };

// Matched against this digest rather than a word, so the word itself appears
// nowhere in the published source. It no longer grants chips — it unlocks the
// admin panel, which does that and more.
const ADMIN_DIGEST = '78ae4ad356a45391a051a4bda7c2dbd1940068b4c3edd9a674279d52b8ac4409';
const ADMIN_KEY = 'pn.admin.v1';

/** True when the typed text is the admin code. */
async function matchesUnlock(text) {
  try {
    const bytes = new TextEncoder().encode(text.toLowerCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === ADMIN_DIGEST;
  } catch {
    return false;   // no subtle crypto (insecure origin): behave as no match
  }
}

function isAdmin() {
  try {
    return localStorage.getItem(ADMIN_KEY) === '1';
  } catch {
    return false;
  }
}

function setAdmin(on) {
  try {
    if (on) localStorage.setItem(ADMIN_KEY, '1');
    else localStorage.removeItem(ADMIN_KEY);
  } catch { /* unlocked for this session only */ }
  paintAdminButton();
}

function paintAdminButton() {
  const btn = $('adminBtn');
  if (btn) show(btn, isAdmin());
}
const RED_SUITS = new Set(['d', 'h']);

function safeGet(s, k) { try { return s.getItem(k); } catch { return null; } }
function safeSet(s, k, v) { try { s.setItem(k, v); } catch { /* private mode */ } }

const store = {
  get name() { return safeGet(localStorage, 'pn.name') || ''; },
  set name(v) { safeSet(localStorage, 'pn.name', v); },
  // Per-tab identity: it survives a reload, but two tabs are two players,
  // which is what lets one person test a table against themselves.
  get token() {
    let t = safeGet(sessionStorage, 'pn.token');
    if (!t) {
      t = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      safeSet(sessionStorage, 'pn.token', t);
    }
    return t;
  },
};

const app = {
  net: null,      // HostNet when hosting, GuestNet when joining
  host: null,     // TableHost — only set in the hosting tab
  isHost: false,
  user: null,
  unread: false,
  dialogMode: 'sit',
  pendingAdd: 0,
  addBounds: null,
  sized: false,
  dialogSeat: -1,
  buyIn: 0,
  pendingBuyIn: 0,  // withdrawn but not yet confirmed in a seat
  cashedOut: false,
  code: null,
  name: '',
  state: null,
  config: null,
  clockOffset: 0,   // serverNow - clientNow, so timers survive a skewed clock
  retry: 0,
  retryTimer: null,
  betTo: 0,
  betDirty: false,
  lastHandNo: 0,
  lastActingSeat: -2,
};

// ---------------------------------------------------------------- lobby

function codeFromUrl() {
  const m = location.hash.match(/^#([A-Za-z0-9]{1,8})$/);
  return m ? m[1].toUpperCase() : '';
}

function inviteLink() {
  return `${location.origin}${location.pathname}#${app.code}`;
}

// Deliberately no I/O/0/1 — table codes get read aloud and typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

function paintVault() {
  const bal = vault.balance();
  const lobby = $('lobbyVault');
  if (lobby) lobby.textContent = fmt(bal);
  const chip = $('vaultLabel');
  if (chip) chip.textContent = fmt(bal);
  const reload = $('lobbyReload');
  if (reload) reload.hidden = bal > 0;
}

function initLobby() {
  $('nameInput').value = store.name || vault.profile().name;
  paintVault();
  $('lobbyReload').addEventListener('click', () => {
    vault.reload();
    paintVault();
  });
  const urlCode = codeFromUrl();
  if (urlCode) $('codeInput').value = urlCode;

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`);
      });
    });
  }

  $('joinBtn').addEventListener('click', () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (!code) return lobbyError('Enter the table code your friend sent you.');
    doJoin(code);
  });

  $('codeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('joinBtn').click();
  });
  $('nameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.querySelector('.tab-panel.active .primary').click();
  });

  $('soloBtn').addEventListener('click', () => {
    if (vault.balance() <= 0) {
      lobbyError('Your vault is empty — reload it above first.');
      return;
    }
    startSession(playSolo);
  });

  $('createBtn').addEventListener('click', () => {
    const options = {
      smallBlind: Number($('sbInput').value),
      bigBlind: Number($('bbInput').value),
      startingStack: Number($('stackInput').value),
      maxSeats: Number($('seatsInput').value),
      meanie: $('meanieInput').checked,
    };
    if (options.bigBlind <= options.smallBlind) {
      return lobbyError('The big blind has to be bigger than the small blind.');
    }
    if (options.startingStack < options.bigBlind * 10) {
      return lobbyError('Give everyone at least 10 big blinds to start.');
    }
    startSession(() => hostTable(options));
  });

  if (urlCode) $('codeInput').focus();
  else $('nameInput').focus();
}

function lobbyError(msg) {
  const el = $('lobbyError');
  el.textContent = msg;
  el.hidden = !msg;
}

function doJoin(code) {
  if (!readName()) return;
  startSession(() => joinTable(code));
}

function readName() {
  app.name = ($('nameInput').value || '').trim().slice(0, 16);
  if (!app.name) {
    lobbyError('Pick a name so your friends know who you are.');
    return false;
  }
  store.name = app.name;
  vault.setName(app.name);
  return true;
}

/** Run a connect attempt with the lobby's busy state and error reporting. */
async function startSession(attempt) {
  if (!readName()) return;
  if (app.connecting) return;
  app.connecting = true;
  lobbyError('');
  startLoading();
  document.querySelectorAll('.lobby-card .primary, #soloBtn').forEach((b) => { b.disabled = true; });
  try {
    await attempt();
  } catch (err) {
    teardown();
    lobbyError(
      err.message === 'no-such-table'
        ? 'Could not reach that table. Check the code, make sure the host still has it open, and try again — a phone network can take a few tries.'
        : err.message || 'Could not connect. Check your internet and try again.',
    );
  } finally {
    app.connecting = false;
    stopLoading();
    document.querySelectorAll('.lobby-card .primary, #soloBtn').forEach((b) => { b.disabled = false; });
  }
}



// ---------------------------------------------------------------- appearance

/**
 * Theme and background, kept on this device. The felt is deliberately not
 * configurable — that is the table, and a poker table is green.
 */

const BACKGROUNDS = [
  { id: 'felt', name: 'Felt', css: 'radial-gradient(90% 70% at 50% 35%, #1d9a70 0%, #157f5c 48%, #0d5d43 100%)' },
  { id: 'white', name: 'White', css: '#ffffff' },
  { id: 'paper', name: 'Paper', css: 'radial-gradient(900px 500px at 50% 40%, #f3f5f7, #e9edf1)' },
  {
    id: 'textured',
    name: 'Textured',
    // Grain drawn by the browser rather than fetched, so it costs nothing to
    // load and stays sharp at any size.
    css: "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='p'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.9'%20numOctaves='4'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='180'%20height='180'%20filter='url(%23p)'%20opacity='0.3'/%3E%3C/svg%3E\") repeat, radial-gradient(90% 75% at 50% 30%, #faf4e6 0%, #efe4cd 55%, #ddceb0 100%)",
  },
  { id: 'midnight', name: 'Midnight', css: 'radial-gradient(90% 70% at 50% 30%, #1d2b44 0%, #121a2b 55%, #0a0f1a 100%)' },
  { id: 'wood', name: 'Wood', css: 'radial-gradient(90% 70% at 50% 35%, #7a5436 0%, #5d3f28 55%, #40291a 100%)' },
  { id: 'rose', name: 'Rose', css: 'radial-gradient(90% 70% at 50% 35%, #e58cb2 0%, #c35c8c 55%, #8e3b63 100%)' },
  { id: 'sky', name: 'Sky', css: 'radial-gradient(90% 70% at 50% 35%, #7fc4ef 0%, #4b94c9 55%, #2b5f8c 100%)' },
  { id: 'charcoal', name: 'Charcoal', css: 'radial-gradient(90% 70% at 50% 35%, #3a4249 0%, #262c32 55%, #15191d 100%)' },
];

const LOOK_KEY = 'pn.look.v1';

const BG_IMAGE_KEY = 'pn.bgimage.v1';

function storedImage() {
  try {
    return localStorage.getItem(BG_IMAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Shrink a chosen photo before storing it.
 *
 * Browser storage is a few megabytes in total and a data URL is about a third
 * larger than the file it encodes, so a photo straight off a phone would
 * simply be refused. Scaled to fit a large screen and re-encoded as JPEG, a
 * background lands comfortably inside the budget.
 */
function shrinkImage(file, maxW = 1920, maxH = 1200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      // Step the quality down until it fits, rather than failing outright.
      for (const q of [0.82, 0.7, 0.58, 0.45]) {
        const data = canvas.toDataURL('image/jpeg', q);
        if (data.length < 2_600_000) return resolve(data);
      }
      resolve(canvas.toDataURL('image/jpeg', 0.35));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

function bgNote(text, warn) {
  const el = $('bgNote');
  el.textContent = text || '';
  el.classList.toggle('warn', !!warn);
  el.hidden = !text;
}

async function chooseImage(file) {
  if (!file) return;
  bgNote('Resizing your photo…');
  try {
    const data = await shrinkImage(file);
    try {
      localStorage.setItem(BG_IMAGE_KEY, data);
    } catch {
      bgNote('That photo is too large to save on this device. Try a smaller one.', true);
      return;
    }
    updateLook({ bg: 'image' });
    bgNote('Saved on this device.');
  } catch (err) {
    bgNote(err.message, true);
  }
}



function readLook() {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (raw) return { theme: 'light', bg: 'felt', deck: 'classic', custom: null, ...JSON.parse(raw) };
  } catch { /* unreadable storage falls back to the defaults */ }
  return { theme: 'light', bg: 'felt', deck: 'classic', custom: null };
}

function writeLook(look) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch { /* private mode: the choice just won't stick */ }
}

function applyLook(look) {
  document.documentElement.dataset.theme = look.theme === 'dark' ? 'dark' : 'light';
  const preset = BACKGROUNDS.find((b) => b.id === look.bg);
  let css = preset && preset.css;
  if (look.bg === 'custom' && look.custom) css = look.custom;
  if (look.bg === 'image') {
    const data = storedImage();
    // A gentle scrim keeps the table readable over a busy photo.
    css = data
      ? `linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28)), url("${data}") center / cover no-repeat fixed`
      : null;
  }
  if (css) document.documentElement.style.setProperty('--page-bg', css);
  else document.documentElement.style.removeProperty('--page-bg');
}

function paintSettings() {
  const look = readLook();
  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.themePick === look.theme);
  });
  document.querySelectorAll('.swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.bg === look.bg);
  });
  if (look.custom) $('customBg').value = look.custom;

  const data = storedImage();
  const photo = document.querySelector('.swatch.photo');
  if (photo) {
    photo.classList.toggle('empty', !data);
    photo.style.backgroundImage = data ? `url("${data}")` : '';
    photo.innerHTML = data ? '<span>Photo</span>' : '+';
  }
  show($('bgRemove'), !!data);
  $('bgUploadBtn').textContent = data ? 'Choose another photo' : 'Upload a photo';
}

function updateLook(patch) {
  const look = { ...readLook(), ...patch };
  writeLook(look);
  applyLook(look);
  paintSettings();
  // The table is sized in pixels, and nothing about the look changes that —
  // but a background swap can change scrollbars, so re-measure to be safe.
  scheduleSizeFelt();
}

// ------------------------------------------------------------ card skins

/**
 * The card skin you are using, which the other players see on your cards.
 *
 * Checked against what you actually own on the way out, so a design can never
 * be worn because the stored setting says so — buying it is the only way.
 */
function myDeck() {
  const chosen = readLook().deck;
  if (chosen === packs.FREE_DECK) return chosen;
  return vault.ownsDeck(chosen) ? chosen : packs.FREE_DECK;
}

/** Wear a design, and tell the table so everyone else repaints. */
function wearDeck(id) {
  updateLook({ deck: id });
  if (app.code) send({ t: 'deck', deck: myDeck() });
}

/**
 * Buy one pack. The chips leave the vault first and the design is drawn
 * second, so a draw can never happen without having been paid for.
 *
 * A pack never hands over something you already have, so every purchase is
 * a design you did not have before — and once a pack is complete it refuses
 * the sale instead of taking the chips for nothing.
 */
function buyPack(packId) {
  const owned = vault.decks();
  if (packs.packContents(packId).every((d) => owned.includes(d.id))) {
    return { ok: false, why: 'You already have every skin in this pack.' };
  }
  if (vault.balance() < packs.PACK_PRICE) {
    return { ok: false, why: `A pack costs ${fmt(packs.PACK_PRICE)} chips and your vault has ${fmt(vault.balance())}.` };
  }
  if (!vault.spend(packs.PACK_PRICE)) {
    return { ok: false, why: 'Those chips are not in your vault any more.' };
  }
  const pulled = packs.drawFromPack(packId, owned);
  vault.grantDeck(pulled.id);
  paintVault();
  return { ok: true, pulled };
}

function deckTile(d, ownedList) {
  const owned = d.id === packs.FREE_DECK || ownedList.includes(d.id);
  const b = document.createElement('button');
  b.type = 'button';
  // The design's own class paints the preview, so each tile shows the real
  // card back rather than a picture of one.
  b.className = `deck-opt deck-${d.id} rar-${d.rarity}${owned ? '' : ' locked'}`;
  b.classList.toggle('active', owned && d.id === myDeck());
  b.dataset.deck = d.id;
  // Even a locked tile says how rare it is — that is half of wanting it.
  b.title = owned ? `${d.name} — ${d.rarity}` : `${d.rarity}, not yours yet`;
  b.innerHTML = `<span class="card back small"></span><span>${owned ? d.name : '???'}</span>`;
  if (owned) b.addEventListener('click', () => { wearDeck(d.id); paintDecks(); });
  return b;
}

/** The pulled-design announcement, or nothing when no pack was just opened. */
let lastPull = null;

function paintDecks() {
  const host = $('decksPicker');
  if (!host) return;
  host.innerHTML = '';
  const owned = vault.decks();

  $('decksChips').textContent = fmt(vault.balance());

  const note = $('decksPull');
  if (lastPull) {
    note.innerHTML = `You pulled <strong>${lastPull.name}</strong> `
      + `<span class="rarity ${lastPull.rarity}">${lastPull.rarity}</span>`;
    show(note, true);
  } else {
    show(note, false);
  }

  const legend = document.createElement('div');
  legend.className = 'deck-legend';
  legend.innerHTML = packs.RARITIES
    .map((r) => `<span><i class="dot rar-${r}"></i>${r}</span>`)
    .join('');
  host.appendChild(legend);

  // Classic on its own, then one row per pack.
  const free = document.createElement('div');
  free.className = 'decks';
  free.appendChild(deckTile(packs.deckById(packs.FREE_DECK), owned));
  host.appendChild(free);

  for (const pack of packs.PACKS) {
    const contents = packs.packContents(pack.id);
    const have = contents.filter((d) => owned.includes(d.id)).length;
    const complete = have === contents.length;

    const row = document.createElement('div');
    row.className = 'pack';

    const head = document.createElement('div');
    head.className = 'pack-head';
    head.innerHTML = `<div><strong>${pack.name}</strong> <span class="pack-count">`
      + `${have} of ${contents.length}</span></div>`;

    const buy = document.createElement('button');
    buy.className = 'pack-buy';
    buy.textContent = complete ? 'Complete' : `Open — ${fmt(packs.PACK_PRICE)}`;
    buy.disabled = complete;
    buy.addEventListener('click', () => {
      const result = buyPack(pack.id);
      if (!result.ok) {
        lastPull = null;
        toast(result.why);
        paintDecks();
        return;
      }
      lastPull = result.pulled;
      wearDeck(result.pulled.id);   // wear what you just pulled
      paintDecks();
    });
    head.appendChild(buy);
    row.appendChild(head);

    const tiles = document.createElement('div');
    tiles.className = 'decks';
    for (const d of contents) tiles.appendChild(deckTile(d, owned));
    row.appendChild(tiles);

    host.appendChild(row);
  }
}

function openDecks() {
  lastPull = null;
  paintDecks();
  show($('decksModal'), true);
}

function initSettings() {
  const host = $('swatches');
  for (const bg of BACKGROUNDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.bg = bg.id;
    b.style.background = bg.css;
    b.title = bg.name;
    b.innerHTML = `<span>${bg.name}</span>`;
    b.addEventListener('click', () => updateLook({ bg: bg.id }));
    host.appendChild(b);
  }

  const photo = document.createElement('button');
  photo.type = 'button';
  photo.className = 'swatch photo';
  photo.dataset.bg = 'image';
  photo.title = 'Your photo';
  photo.innerHTML = '<span>Photo</span>';
  photo.addEventListener('click', () => {
    if (storedImage()) updateLook({ bg: 'image' });
    else $('bgUpload').click();
  });
  host.appendChild(photo);

  $('bgUploadBtn').addEventListener('click', () => $('bgUpload').click());
  $('bgUpload').addEventListener('change', (e) => {
    chooseImage(e.target.files && e.target.files[0]);
    e.target.value = '';
  });
  $('bgRemove').addEventListener('click', () => {
    try { localStorage.removeItem(BG_IMAGE_KEY); } catch { /* nothing stored */ }
    bgNote('');
    updateLook({ bg: 'felt' });
  });

  document.querySelectorAll('.theme-opt').forEach((b) => {
    b.addEventListener('click', () => updateLook({ theme: b.dataset.themePick }));
  });

  $('customBg').addEventListener('input', (e) => {
    updateLook({ bg: 'custom', custom: e.target.value });
  });

  const open = () => {
    paintSettings();
    drawQr($('installQr'), `${location.origin}${location.pathname}`);
    show($('settingsModal'), true);
  };
  $('settingsBtn').addEventListener('click', open);
  $('lobbyGear').addEventListener('click', open);
  $('settingsClose').addEventListener('click', () => show($('settingsModal'), false));
  $('settingsModal').addEventListener('click', (e) => {
    if (e.target === $('settingsModal')) show($('settingsModal'), false);
  });

  $('decksBtn').addEventListener('click', openDecks);
  $('lobbyDecks').addEventListener('click', openDecks);
  $('decksClose').addEventListener('click', () => show($('decksModal'), false));
  $('decksModal').addEventListener('click', (e) => {
    if (e.target === $('decksModal')) show($('decksModal'), false);
  });

  migrateFreeDecks();
  applyLook(readLook());
}

/**
 * Card skins used to be free, chosen by the name of their pack. They are
 * bought now, so anyone who had already picked one keeps that exact design
 * rather than losing it to the change.
 */
function migrateFreeDecks() {
  const WAS_FREE = { cosmic: 'planet', car: 'checker', food: 'pizza', sport: 'pitch' };
  const look = readLook();
  const now = WAS_FREE[look.deck];
  if (!now) return;
  vault.grantDeck(now);
  updateLook({ deck: now });
}


/**
 * Codes have their own box rather than the chat. Typed into chat they could
 * swallow an ordinary message — one of them is a real word — and a box makes
 * it obvious where they are meant to go.
 */
async function redeem(box) {
  const text = box.value.trim();
  if (!text) return;

  const ok = await matchesUnlock(text);
  box.classList.remove('ok', 'bad');
  void box.offsetWidth;   // restart the flash on a repeated result

  if (ok) {
    setAdmin(true);
    box.value = '';
    box.classList.add('ok');
    toast('Admin unlocked.');
    openAdmin();
  } else {
    box.classList.add('bad');
  }
  setTimeout(() => box.classList.remove('ok', 'bad'), 1600);
}

function initCodeBoxes() {
  for (const id of ['codeBox', 'lobbyCodeBox']) {
    const box = $(id);
    if (!box) continue;
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') redeem(box);
    });
  }
}


/**
 * Ask the browser to keep this site's data rather than clearing it when
 * space runs short. Chrome usually grants it to a site you use; Safari grants
 * it to a page added to the Home Screen, which is what actually stops the
 * weekly clear-out there.
 */
function requestPersistence() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch { /* not supported; the backup code is the fallback */ }
}

function backupMsg(text, good) {
  const el = $('backupMsg');
  el.textContent = text || '';
  el.className = `backup-msg ${good ? 'good' : 'bad'}`;
  el.hidden = !text;
}

function initBackup() {
  $('backupCopy').addEventListener('click', async () => {
    const code = vault.backupCode();
    $('backupCode').value = code;
    try {
      await navigator.clipboard.writeText(code);
      backupMsg('Code copied. Keep it somewhere safe.', true);
    } catch {
      // Clipboard refused; the code is in the box to copy by hand.
      $('backupCode').select();
      backupMsg('Copy the code from the box above.', true);
    }
  });

  $('backupCode').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const restored = vault.restoreCode($('backupCode').value);
    if (restored === null) {
      backupMsg('That is not a valid code.', false);
      return;
    }
    paintVault();
    backupMsg(`Restored. Your vault is now ${fmt(restored)}.`, true);
  });
}


// ---------------------------------------------------------------- admin panel

function adminMsg(text, good) {
  const el = $('adminMsg');
  el.textContent = text || '';
  el.className = `backup-msg ${good ? 'good' : 'bad'}`;
  el.hidden = !text;
}

/**
 * Every card skin, as a tile you can hand yourself.
 *
 * Deliberately one at a time rather than an unlock-everything button: the
 * collection is the point of the packs, and emptying it in one click is a
 * thing you cannot undo.
 */
function paintAdminSkins() {
  const host = $('adminSkins');
  if (!host) return;
  host.innerHTML = '';
  for (const d of packs.DECKS) {
    if (d.id === packs.FREE_DECK) continue;
    const owned = vault.ownsDeck(d.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `deck-opt deck-${d.id} rar-${d.rarity}${owned ? '' : ' locked'}`;
    b.title = owned ? `${d.name} — already yours` : `Give yourself ${d.name}`;
    b.innerHTML = `<span class="card back small"></span><span>${d.name}</span>`;
    if (!owned) {
      b.addEventListener('click', () => {
        vault.grantDeck(d.id);
        adminMsg(`${d.name} is yours.`, true);
        paintAdminSkins();
      });
    }
    host.appendChild(b);
  }
}

function paintAdminList() {
  const host = $('adminList');
  host.innerHTML = '';

  if (!app.state || !mySeat()) {
    host.innerHTML = '<p class="admin-empty">Sit down at a table to take chips.</p>';
    return;
  }

  const others = (app.state.seats || []).filter((p) => p && !p.isMe);
  if (!others.length) {
    host.innerHTML = '<p class="admin-empty">Nobody else is seated.</p>';
    return;
  }

  for (const p of others) {
    const row = document.createElement('div');
    row.className = 'admin-row';

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = p.name;

    const has = document.createElement('div');
    has.className = 'has';
    has.textContent = fmt(p.chips);

    const amount = document.createElement('input');
    amount.type = 'number';
    amount.placeholder = 'Amount';
    amount.min = '1';

    const take = document.createElement('button');
    take.textContent = 'Take';
    take.addEventListener('click', () => {
      const n = Math.floor(Number(amount.value) || 0);
      if (n <= 0) { adminMsg('Enter an amount first.', false); return; }
      send({ t: 'take', fromSeat: p.seat, amount: n });
      amount.value = '';
      adminMsg(`Took ${fmt(n)} from ${p.name}.`, true);
    });

    const all = document.createElement('button');
    all.className = 'all';
    all.textContent = 'All';
    all.addEventListener('click', () => {
      send({ t: 'take', fromSeat: p.seat, amount: 'all' });
      adminMsg(`Took everything from ${p.name}.`, true);
    });

    row.append(who, has, amount, take, all);
    host.appendChild(row);
  }
}

function openAdmin() {
  if (!isAdmin()) return;
  adminMsg('');
  paintAdminList();
  paintAdminSkins();
  show($('adminModal'), true);
}

function initAdmin() {
  paintAdminButton();
  $('adminBtn').addEventListener('click', openAdmin);
  $('adminClose').addEventListener('click', () => show($('adminModal'), false));
  $('adminModal').addEventListener('click', (e) => {
    if (e.target === $('adminModal')) show($('adminModal'), false);
  });

  $('adminGrantGo').addEventListener('click', () => {
    const n = Math.floor(Number($('adminGrant').value) || 0);
    if (n <= 0) { adminMsg('Enter an amount first.', false); return; }
    vault.deposit(n);
    paintVault();
    $('adminGrant').value = '';
    adminMsg(`Added ${fmt(n)} to your vault, now ${fmt(vault.balance())}.`, true);
  });

  $('adminOff').addEventListener('click', () => {
    setAdmin(false);
    show($('adminModal'), false);
    toast('Admin is off. The code switches it back on.');
  });
}


// ---------------------------------------------------------------- qr & sharing

/** Draw a QR of `text` into `el`. Scanning it opens that address, nothing more. */
function drawQr(el, text) {
  el.innerHTML = '';
  if (typeof window.qrcode !== 'function') {
    el.textContent = text;
    return;
  }
  try {
    const qr = window.qrcode(0, 'M');   // 0 picks the smallest size that fits
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 1, scalable: true });
  } catch {
    el.textContent = text;
  }
}

function openShare() {
  if (!app.code) return;
  const link = inviteLink();
  $('shareCode').textContent = app.code;
  $('shareLink').value = link;
  $('shareMsg').hidden = true;
  drawQr($('shareQr'), link);
  show($('shareModal'), true);
}

function initShare() {
  $('shareClose').addEventListener('click', () => show($('shareModal'), false));
  $('shareModal').addEventListener('click', (e) => {
    if (e.target === $('shareModal')) show($('shareModal'), false);
  });

  $('shareCopy').addEventListener('click', async () => {
    const el = $('shareMsg');
    try {
      await navigator.clipboard.writeText($('shareLink').value);
      el.textContent = 'Link copied.';
    } catch {
      $('shareLink').select();
      el.textContent = 'Copy the link from the box above.';
    }
    el.className = 'backup-msg good';
    el.hidden = false;
  });
}

// ---------------------------------------------------------------- hosting on a phone

let wakeLock = null;

/**
 * Hosting means this tab is the table, and a phone that locks its screen
 * suspends the tab and takes the game down with it. A wake lock keeps the
 * screen on while hosting; the browser drops it whenever the page is hidden,
 * so it is taken again on the way back.
 */
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* unsupported or refused; hosting still works, just not asleep */ }
}

function initPhoneHosting() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (app.isHost) keepAwake(true);
    // Coming back from the background, the broker connection may have gone.
    try {
      const peer = app.net?.peer;
      if (peer && peer.disconnected && !peer.destroyed) peer.reconnect();
    } catch { /* the retry loop will pick it up */ }
  });
}


// ---------------------------------------------------------------- friends

function whenSeen(ts) {
  if (!ts) return 'a while ago';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

function paintFriends() {
  const host = $('friendList');
  host.innerHTML = '';
  const all = friends.list();

  if (!all.length) {
    host.innerHTML = '<p class="friend-empty">Nobody yet. Anyone who sits down at a '
      + 'table with you is added here automatically — computer players are not.</p>';
    return;
  }

  // Who is at this table right now, so the list is useful mid-game.
  const seatedNow = new Set(
    (app.state?.seats || [])
      .filter((p) => p && !p.bot && !p.isMe)
      .map((p) => p.name.trim().toLowerCase()),
  );

  for (const f of all) {
    const row = document.createElement('div');
    row.className = 'friend-row' + (seatedNow.has(f.key) ? ' here' : '');

    const main = document.createElement('div');
    main.className = 'friend-main';

    const name = document.createElement('div');
    name.className = 'friend-name';
    name.textContent = friends.displayName(f);

    const sub = document.createElement('div');
    sub.className = 'friend-sub';
    const games = f.games === 1 ? '1 game' : `${f.games} games`;
    sub.textContent = f.nick ? `${f.name} · ${games} · ${whenSeen(f.seen)}`
      : `${games} · ${whenSeen(f.seen)}`;

    main.append(name, sub);
    if (seatedNow.has(f.key)) {
      const here = document.createElement('div');
      here.className = 'friend-here';
      here.textContent = 'At this table';
      main.appendChild(here);
    }

    const star = document.createElement('button');
    star.className = 'star' + (f.fav ? ' on' : '');
    star.textContent = f.fav ? '★' : '☆';
    star.title = f.fav ? 'Remove from favourites' : 'Add to favourites';
    star.addEventListener('click', () => {
      friends.star(f.key, !f.fav);
      paintFriends();
    });

    const nick = document.createElement('button');
    nick.textContent = 'Rename';
    nick.addEventListener('click', () => {
      // An inline field rather than a browser prompt box: once the game is
      // installed to a Home Screen, iOS refuses to show prompts at all.
      const field = document.createElement('input');
      field.className = 'friend-rename';
      field.value = friends.displayName(f);
      field.maxLength = 16;
      let settled = false;
      const finish = (keep) => {
        if (settled) return;
        settled = true;
        if (keep) {
          const next = field.value.trim();
          friends.rename(f.key, next === f.name ? '' : next);
        }
        paintFriends();
      };
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      });
      field.addEventListener('blur', () => finish(true));
      name.replaceWith(field);
      field.focus();
      field.select();
    });

    const drop = document.createElement('button');
    drop.className = 'drop';
    drop.textContent = 'Forget';
    drop.addEventListener('click', () => {
      friends.remove(f.key);
      paintFriends();
    });

    row.append(main, star, nick, drop);
    host.appendChild(row);
  }
}

function openFriends() {
  paintFriends();
  show($('friendsModal'), true);
}

function initFriends() {
  $('friendsBtn').addEventListener('click', openFriends);
  $('lobbyFriends').addEventListener('click', openFriends);
  $('friendsClose').addEventListener('click', () => show($('friendsModal'), false));
  $('friendsModal').addEventListener('click', (e) => {
    if (e.target === $('friendsModal')) show($('friendsModal'), false);
  });
}

/** Everyone seated with you goes in the list; computer players do not. */
function recordFriends(state) {
  for (const p of state.seats || []) {
    if (p && !p.bot && !p.isMe) friends.note(p.name, app.code);
  }
}

// ---------------------------------------------------------------- loading

/**
 * Two browsers finding each other takes a few seconds, and a line of grey
 * text made that feel like something had gone wrong. The messages rotate so
 * the screen is visibly alive rather than frozen.
 */
const LOADING_LINES = [
  'Shuffling the deck…',
  'Cutting the cards…',
  'Stacking the chips…',
  'Finding your table…',
  'Dealing you in…',
];

let loadingTimer = null;

function startLoading(firstLine) {
  const el = $('loadingMsg');
  let i = 0;
  el.textContent = firstLine || LOADING_LINES[0];
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    i = (i + 1) % LOADING_LINES.length;
    el.textContent = LOADING_LINES[i];
  }, 1600);
  show($('loading'), true);
}

function stopLoading() {
  clearInterval(loadingTimer);
  loadingTimer = null;
  show($('loading'), false);
}

// ---------------------------------------------------------------- transport

/**
 * Two ways to be connected, one interface.
 *
 * Hosting runs the whole table in this tab: its own messages are piped
 * straight into the UI, everyone else's go out over WebRTC. Joining opens one
 * connection to whoever is hosting. Nothing below this point knows which.
 */

async function hostTable(options) {
  // The table code doubles as our address on the broker, so a collision just
  // means trying another one.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode();
    const net = new HostNet({
      code,
      onMessage: (token, msg) => app.host?.handle(token, msg),
      onLeave: (token) => app.host?.disconnect(token),
      onStatus: (status) => setConn(status === 'ready'),
    });

    try {
      await net.start();
    } catch (err) {
      net.destroy();
      if (err.message === 'code-taken') continue;
      throw err;
    }

    app.net = net;
    app.isHost = true;
    app.code = code;
    app.host = new TableHost({
      code,
      options,
      deliver: (token, msg) => {
        if (token === store.token) onMessage(msg);
        else net.sendTo(token, msg);
      },
    });
    app.host.start();
    setConn(true);
    keepAwake(true);   // this tab is the table now
    app.host.handle(store.token, { t: 'hello', token: store.token, name: app.name });
    return;
  }
  throw new Error('Could not claim a table code. Try again.');
}


/**
 * Solo mode: host a private table, take a seat and fill four more with bots,
 * in one go. The table still has a code, so a friend can drop into the spare
 * seat later if you want one.
 */
// A tougher solo table than before: two Experts, and no free money.
const SOLO_OPPONENTS = ['expert', 'shark', 'maniac', 'expert'];

async function playSolo() {
  const cfg = {
    smallBlind: 5,
    bigBlind: 10,
    startingStack: 1000,
    maxSeats: 6,
    meanie: $('meanieInput').checked,
  };
  await hostTable(cfg);

  const buyIn = vault.withdraw(Math.min(cfg.startingStack, vault.balance()));
  app.pendingBuyIn = buyIn;
  vault.setAtTable(app.code, buyIn);
  paintVault();
  send({ t: 'sit', seat: 0, name: app.name, buyIn, deck: myDeck() });

  SOLO_OPPONENTS.forEach((style, i) => send({ t: 'addbot', seat: i + 1, style }));
}

async function joinTable(code) {
  const net = new GuestNet({
    code,
    token: store.token,
    name: app.name,
    onMessage,
    onStatus: (status) => setConn(status === 'ready'),
  });
  await net.start();
  app.net = net;
  app.isHost = false;
  app.code = code;
}

function send(msg) {
  if (app.isHost) app.host?.handle(store.token, msg);
  else app.net?.send(msg);
}

function teardown() {
  keepAwake(false);
  try { app.host?.stop(); } catch { /* already stopped */ }
  try { app.net?.destroy(); } catch { /* already gone */ }
  app.host = null;
  app.net = null;
}

function setConn(ok) {
  const dot = $('connDot');
  dot.classList.toggle('down', !ok);
  dot.title = ok ? 'Connected' : 'Reconnecting…';
}

function onMessage(msg) {
  switch (msg.t) {
    case 'joined': {
      app.config = msg.config;
      // Reconnecting after changing your skin: the greeting does not
      // carry it, so say it now rather than wearing the old one until you
      // next sit down.
      send({ t: 'deck', deck: myDeck() });
      enterGame();
      break;
    }
    case 'state': {
      if (typeof msg.now === 'number') app.clockOffset = msg.now - Date.now();
      render(msg.state);
      break;
    }
    case 'added': {
      app.pendingAdd = 0;
      bubbleAtMySeat(`+${fmt(msg.amount)} chips`);
      break;
    }
    case 'removed': {
      vault.deposit(msg.amount);
      paintVault();
      bubbleAtMySeat(`${fmt(msg.amount)} → vault`);
      break;
    }
    case 'queued-remove': {
      toast(`${fmt(msg.amount)} chips will go back to your vault after this hand.`);
      break;
    }
    case 'sent': {
      bubbleAtMySeat(`−${fmt(msg.amount)} to ${msg.who}`);
      break;
    }
    case 'received': {
      bubbleAtMySeat(`+${fmt(msg.amount)} from ${msg.who}`);
      toast(`${msg.who} sent you ${fmt(msg.amount)} chips.`);
      break;
    }
    case 'queued-send': {
      toast(`${fmt(msg.amount)} chips will go to ${msg.who} when this hand ends.`);
      break;
    }
    case 'queued': {
      app.pendingAdd = 0;
      bubbleAtMySeat(`+${fmt(msg.amount)} after this hand`);
      toast(`${fmt(msg.amount)} chips will be added when this hand ends.`);
      break;
    }
    case 'cashout':
      cashOut(msg.amount, 'stand');
      break;
    case 'chat':
      addChat(msg.from, msg.text);
      break;
    case 'error': {
      // A rejected sit leaves chips in limbo — put them straight back.
      if (app.pendingBuyIn || app.pendingAdd) {
        vault.deposit(app.pendingBuyIn + app.pendingAdd);
        app.pendingBuyIn = 0;
        app.pendingAdd = 0;
        paintVault();
      }
      if ($('game').hidden) lobbyError(msg.message);
      else toast(msg.message);
      break;
    }
  }
}


// ---------------------------------------------------------------- vault & seats

/**
 * A short-lived bubble above a seat, for things worth announcing that the
 * stack number alone does not make obvious — like chips arriving from the
 * vault. Lives on the felt rather than inside the seat, because the seats are
 * rebuilt on every state update and would wipe it.
 */
function bubbleAtSeat(seatEl, text) {
  const felt = $('felt');
  if (!felt || !seatEl) return;
  const feltBox = felt.getBoundingClientRect();
  const seatBox = seatEl.getBoundingClientRect();

  const bubble = document.createElement('div');
  bubble.className = 'chip-bubble';
  bubble.textContent = text;
  bubble.style.left = `${seatBox.left - feltBox.left + seatBox.width / 2}px`;
  bubble.style.top = `${seatBox.top - feltBox.top}px`;
  felt.appendChild(bubble);
  setTimeout(() => bubble.remove(), 4000);
}

function bubbleAtMySeat(text) {
  bubbleAtSeat(document.querySelector('.seat.me'), text);
}



/**
 * Chips move between the vault and the table in exactly two places: a buy-in
 * takes them out, cashing out puts them back. Everything in between is the
 * table's business.
 */

function maxBuyIn() {
  const cfg = app.config || {};
  // Only a fallback: the table sends its real figure on join.
  return cfg.maxBuyIn || 1_000_000_000_000_000;
}

function buyInBounds() {
  const cfg = app.config || {};
  const bal = vault.balance();
  if (app.dialogMode !== 'sit' && app.addBounds) {
    return { ...app.addBounds, bal };
  }
  const min = Math.min(cfg.bigBlind || 10, bal);
  const max = Math.min(bal, maxBuyIn());
  return { min, max, bal };
}

function setBuyIn(value) {
  const { min, max } = buyInBounds();
  const v = Math.max(min, Math.min(max, Math.round(value || 0)));
  app.buyIn = v;
  $('buyInRange').value = String(v);
  $('buyInAmount').value = String(v);
  $('buyInLabel').textContent = fmt(v);
}

/** Send chips from your stack to another player at the table. */
function openTransfer(seat) {
  const me = mySeat();
  const them = app.state?.seats?.[seat];
  if (!me || !them || them.isMe) return;

  app.dialogMode = 'send';
  show($('chipDirection'), false);
  app.dialogSeat = seat;

  const max = Math.min(me.chips, maxBuyIn() - them.chips);
  $('modalTitle').textContent = `Send chips to ${them.name}`;
  $('modalSub').innerHTML =
    `You have <strong>${fmt(me.chips)}</strong> · ${them.name} has <strong>${fmt(them.chips)}</strong>`;
  modalError('');
  show($('botSection'), false);
  show($('emptyVault'), false);
  show($('buyInBlock'), max > 0);

  if (max > 0) {
    const min = Math.min(1, max);
    $('buyInRange').min = String(min);
    $('buyInRange').max = String(max);
    $('buyInAmount').min = String(min);
    $('buyInAmount').max = String(max);
    app.addBounds = { min, max };
    setBuyIn(Math.min(Math.max(1, Math.round(me.chips / 4)), max));
  } else {
    modalError(
      me.chips <= 0 ? 'You have no chips to send.' : `${them.name} is at the table maximum.`,
    );
  }

  $('buyInWord').textContent = 'Send';
  $('sitConfirm').textContent = 'Send chips';
  setQuickLabels('Everything');
  // Tapping a seat is the obvious gesture, so removal lives here too — the
  // small cross on the seat itself is easy to miss.
  $('removeBot').textContent = them.bot ? 'Remove this player' : `Remove ${them.name} from the table`;
  show($('removeBot'), !!app.isHost);
  show($('modal'), true);
}

/** Move chips between your vault and your stack, in either direction. */
function openAddChips(direction = 'add') {
  const me = mySeat();
  if (!me) return;
  app.dialogMode = direction;
  show($('removeBot'), false);
  app.dialogSeat = me.seat;

  const cfg = app.config || {};
  const bal = vault.balance();
  const queued = app.state?.you?.queuedChips || 0;

  $('modalTitle').textContent = 'Your chips';
  $('modalSub').innerHTML =
    `At the table <strong>${fmt(me.chips)}</strong> · Vault <strong>${fmt(bal)}</strong>`
    + (queued ? ` · <strong>${fmt(queued)}</strong> arriving after this hand` : '');
  modalError('');
  show($('botSection'), false);
  show($('chipDirection'), true);
  document.querySelectorAll('.dir').forEach((t) => t.classList.toggle('active', t.dataset.dir === direction));

  if (direction === 'take') {
    const max = me.chips;
    show($('emptyVault'), false);
    show($('buyInBlock'), max > 0);
    if (max > 0) {
      const min = 1;
      $('buyInRange').min = String(min);
      $('buyInRange').max = String(max);
      $('buyInAmount').min = String(min);
      $('buyInAmount').max = String(max);
      app.addBounds = { min, max };
      setBuyIn(Math.max(1, Math.round(max / 2)));
    } else {
      modalError('You have no chips at the table.');
    }
    $('buyInWord').textContent = 'Take back';
    $('sitConfirm').textContent = 'Move to vault';
    setQuickLabels('Everything');
    show($('modal'), true);
    return;
  }

  const room = Math.max(0, maxBuyIn() - me.chips - queued);
  const max = Math.min(bal, room);
  show($('emptyVault'), bal <= 0);
  show($('buyInBlock'), bal > 0 && room > 0);

  if (bal > 0 && room > 0) {
    const min = Math.min(cfg.bigBlind || 10, max);
    $('buyInRange').min = String(min);
    $('buyInRange').max = String(max);
    $('buyInAmount').min = String(min);
    $('buyInAmount').max = String(max);
    app.addBounds = { min, max };
    setBuyIn(Math.min(cfg.startingStack || 1000, max));
  } else if (room <= 0) {
    modalError('You are already at the table maximum.');
  }

  $('buyInWord').textContent = 'Add';
  $('sitConfirm').textContent = 'Add chips';
  setQuickLabels('All my chips');
  show($('modal'), true);
}

/** The widest option means different things in each dialog; say which. */
function setQuickLabels(maxLabel) {
  const max = document.querySelector('.buyin-row .quick[data-b="max"]');
  if (max) max.textContent = maxLabel;
}

function openSeatDialog(seat) {
  app.dialogMode = 'sit';
  show($('removeBot'), false);
  show($('chipDirection'), false);
  setQuickLabels('Max');
  $('buyInWord').textContent = 'Buy in with';
  $('sitConfirm').textContent = 'Sit down';
  app.dialogSeat = seat;
  const cfg = app.config || {};
  const { min, max, bal } = buyInBounds();
  const seated = !!mySeat();

  $('modalTitle').textContent = seated ? 'Fill this seat' : 'Take a seat';
  $('modalSub').innerHTML = `Seat ${seat + 1} · Vault <strong>${fmt(bal)}</strong> chips`;
  modalError('');

  // Hosts can add bots; you can only sit down yourself if you're not already in.
  show($('botSection'), !!app.isHost);
  const canSit = !seated && bal > 0;
  show($('buyInBlock'), canSit);
  show($('emptyVault'), !seated && bal <= 0);

  if (canSit) {
    $('buyInRange').min = String(min);
    $('buyInRange').max = String(max);
    $('buyInAmount').min = String(min);
    $('buyInAmount').max = String(max);
    setBuyIn(Math.min(cfg.startingStack || 1000, max));
  }

  show($('modal'), true);
}

function closeSeatDialog() {
  show($('modal'), false);
  app.dialogSeat = -1;
}

function modalError(msg) {
  const el = $('modalError');
  el.textContent = msg;
  el.hidden = !msg;
}

function initVaultUi() {
  $('loadingCancel').addEventListener('click', () => {
    teardown();
    stopLoading();
    app.connecting = false;
    document.querySelectorAll('.lobby-card .primary, #soloBtn').forEach((b) => { b.disabled = false; });
  });

  $('modalClose').addEventListener('click', closeSeatDialog);
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal')) closeSeatDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('decksModal').hidden) show($('decksModal'), false);
    else if (!$('friendsModal').hidden) show($('friendsModal'), false);
    else if (!$('adminModal').hidden) show($('adminModal'), false);
    else if (!$('settingsModal').hidden) show($('settingsModal'), false);
    else if (!$('helpModal').hidden) show($('helpModal'), false);
    else if (!$('modal').hidden) closeSeatDialog();
  });

  $('buyInRange').addEventListener('input', (e) => setBuyIn(Number(e.target.value)));
  $('buyInAmount').addEventListener('input', (e) => setBuyIn(Number(e.target.value)));

  for (const b of document.querySelectorAll('.buyin-row .quick')) {
    b.addEventListener('click', () => {
      const { min, max } = buyInBounds();
      if (b.dataset.b === 'min') setBuyIn(min);
      else if (b.dataset.b === 'half') setBuyIn(Math.round(max / 2));
      else setBuyIn(max);
    });
  }

  $('removeBot').addEventListener('click', () => {
    const seat = app.dialogSeat;
    const them = app.state?.seats?.[seat];
    if (!them) return;
    if (!them.bot && !confirm(`Remove ${them.name} from the table? Their chips go back to their vault.`)) return;
    send({ t: 'removebot', seat });
    closeSeatDialog();
    toast(`${them.name} removed from the table.`);
  });

  for (const tab of document.querySelectorAll('.dir')) {
    tab.addEventListener('click', () => openAddChips(tab.dataset.dir));
  }

  $('sitConfirm').addEventListener('click', () => {
    if (app.dialogMode === 'take') {
      send({ t: 'removechips', amount: app.buyIn });
      closeSeatDialog();
      return;
    }
    if (app.dialogMode === 'send') {
      send({ t: 'transfer', toSeat: app.dialogSeat, amount: app.buyIn });
      closeSeatDialog();
      return;
    }
    if (app.dialogMode === 'add') {
      const taken = vault.withdraw(app.buyIn);
      if (taken <= 0) return modalError('Not enough in your vault.');
      app.pendingAdd = taken;
      paintVault();
      send({ t: 'addchips', amount: taken });
      closeSeatDialog();
      return;
    }

    const seat = app.dialogSeat;
    if (seat < 0) return;
    // Take the chips out now; refund if the table turns us away.
    const taken = vault.withdraw(app.buyIn);
    if (taken <= 0) return modalError('Not enough in your vault.');
    app.pendingBuyIn = taken;
    vault.setAtTable(app.code, taken);
    paintVault();
    send({ t: 'sit', seat, name: app.name, buyIn: taken, deck: myDeck() });
    closeSeatDialog();
  });

  $('vaultReload').addEventListener('click', () => {
    vault.reload();
    paintVault();
    openSeatDialog(app.dialogSeat);
  });

  for (const b of document.querySelectorAll('.bot-pick')) {
    b.addEventListener('click', () => {
      send({ t: 'addbot', seat: app.dialogSeat, style: b.dataset.style });
      closeSeatDialog();
    });
  }

  $('vaultChip').addEventListener('click', () => {
    if (mySeat()) {
      openAddChips();
      return;
    }
    const p = vault.profile();
    toast(
      `Vault: ${fmt(p.vault)} chips · ${p.handsPlayed} hands played` +
      (p.biggestPot ? ` · biggest pot ${fmt(p.biggestPot)}` : ''),
    );
  });
}

/** Put table chips back in the vault — once, no matter how we got here. */
function cashOut(amount, reason) {
  if (app.cashedOut) return;
  app.cashedOut = true;
  // clearAtTable reports what we were last recorded as holding, which is the
  // fallback when we have no fresher number to hand.
  const staked = vault.clearAtTable();
  const chips = Math.max(0, Math.floor(amount ?? staked));
  if (chips > 0) {
    vault.deposit(chips);
    paintVault();
    if (reason) toast(`${fmt(chips)} chips returned to your vault.`);
  }
}


// ---------------------------------------------------------------- accounts

/**
 * Sign-in, when a Firebase project is configured. Without one the site runs
 * exactly as it always has: no accounts, vault saved in this browser.
 */

let authMode = 'in';   // 'in' to sign in, 'up' to create an account

function authError(msg) {
  const el = $('authError');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function authBusy(on) {
  $('authBusy').hidden = !on;
  $('authSubmit').disabled = on;
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.atab').forEach((t) => t.classList.toggle('active', t.dataset.atab === mode));
  show($('authNameField'), mode === 'up');
  $('authSubmit').textContent = mode === 'up' ? 'Create account' : 'Sign in';
  $('authPassword').setAttribute('autocomplete', mode === 'up' ? 'new-password' : 'current-password');
  show($('authForgot'), mode === 'in');
  authError('');
}

async function startCloud() {
  const ready = await cloud.initCloud();
  if (!ready) return false;

  cloud.onAuth(async (user) => {
    if (!user) {
      vault.detach();
      app.user = null;
      show($('authScreen'), true);
      show($('lobby'), false);
      return;
    }

    app.user = user;
    // Pull this account's profile, or start one for a new player.
    let stored = null;
    try {
      stored = await cloud.loadProfile(user.uid);
    } catch {
      // Offline or rules not set: fall back to the device copy rather than
      // locking someone out of a game they can otherwise play.
      toast('Could not reach your account. Using the chips saved on this device.');
    }
    const profile = vault.adopt(stored, {
      uid: user.uid,
      save: (p) => cloud.saveProfile(user.uid, p),
    });
    if (!stored) cloud.createProfile(user.uid, profile).catch(() => {});

    const name = user.name || profile.name || 'Player';
    app.name = name;
    store.name = name;
    vault.setName(name);

    show($('authScreen'), false);
    show($('lobby'), true);
    show($('whoami'), true);
    show($('nameField'), false);
    $('whoamiName').textContent = name;
    $('nameInput').value = name;
    paintVault();
  });

  return true;
}

function initAuthUi() {
  document.querySelectorAll('.atab').forEach((t) => {
    t.addEventListener('click', () => setAuthMode(t.dataset.atab));
  });

  $('authSubmit').addEventListener('click', async () => {
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    const name = $('authName').value.trim().slice(0, 16);
    if (!email) return authError('Enter your email address.');
    if (!password) return authError('Enter your password.');
    if (authMode === 'up' && !name) return authError('Pick a display name so players know who you are.');

    authBusy(true);
    authError('');
    try {
      if (authMode === 'up') await cloud.signUp(email, password, name);
      else await cloud.signIn(email, password);
      $('authPassword').value = '';
    } catch (err) {
      authError(err.message);
    } finally {
      authBusy(false);
    }
  });

  for (const id of ['authEmail', 'authPassword', 'authName']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('authSubmit').click();
    });
  }

  $('authForgot').addEventListener('click', async () => {
    const email = $('authEmail').value.trim();
    if (!email) return authError('Enter your email address first, then tap this again.');
    try {
      await cloud.resetPassword(email);
      authError('');
      $('authBusy').textContent = 'Check your email for a reset link.';
      $('authBusy').hidden = false;
    } catch (err) {
      authError(err.message);
    }
  });

  $('signOutBtn').addEventListener('click', async () => {
    if (app.net) {
      const me = mySeat();
      send({ t: 'stand' });
      cashOut(me ? me.chips : 0);
      teardown();
    }
    cloud.flush();
    await cloud.signOutUser();
    location.reload();
  });
}


// ---------------------------------------------------------------- hand rankings

const HAND_RANKINGS = [
  ['Royal Flush', 'The best hand there is', 'As Ks Qs Js Ts'],
  ['Straight Flush', 'Five in a row, all one suit', '9h 8h 7h 6h 5h'],
  ['Four of a Kind', 'All four of one rank', 'Qs Qh Qd Qc 3s'],
  ['Full House', 'Three of one, two of another', 'Js Jh Jd 8c 8s'],
  ['Flush', 'Any five of one suit', 'Kd Jd 9d 6d 2d'],
  ['Straight', 'Five in a row, suits mixed', 'Tc 9d 8s 7h 6c'],
  ['Three of a Kind', 'Three of one rank', '7s 7h 7d Kc 4s'],
  ['Two Pair', 'Two pairs', 'As Ad 5c 5h 9s'],
  ['One Pair', 'Two of the same rank', 'Ts Td Ac 7h 3s'],
  ['High Card', 'Nothing made — highest card plays', 'Ad Qs 9h 5c 2d'],
];


/** Where each hand category sits in the rankings list, best first. */
const CATEGORY_ROW = { 7: 2, 6: 3, 5: 4, 4: 5, 3: 6, 2: 7, 1: 8, 0: 9 };

/** Before the flop there is no five-card hand yet — name the two you hold. */
function startingHandName(cards) {
  const [a, b] = cards;
  const hi = Math.max(cardValue(a), cardValue(b));
  const lo = Math.min(cardValue(a), cardValue(b));
  if (hi === lo) return `Pocket ${RANK_PLURALS[hi]}`;
  const suited = cardSuit(a) === cardSuit(b) ? ', suited' : '';
  return `${RANK_NAMES[hi]}-${RANK_NAMES[lo]}${suited}`;
}

/**
 * What the viewer is actually holding right now: their best five once there
 * is a board, or their two cards before the flop.
 */
function currentHand() {
  const state = app.state;
  const you = state?.you;
  if (!you || !Array.isArray(you.cards) || you.cards.length < 2) return null;
  if (you.cards.some((c) => !c || c === '??')) return null;

  const me = mySeat();
  if (me && me.folded) {
    return { name: 'You folded this hand', cards: you.cards, note: 'Wait for the next deal.', row: -1 };
  }

  const board = state.community || [];
  if (board.length < 3) {
    return {
      name: startingHandName(you.cards),
      cards: you.cards,
      note: 'No five-card hand yet — the flop decides that.',
      row: -1,
    };
  }

  const hand = bestHand([...you.cards, ...board]);
  const category = hand.score[0];
  const row = category === 8 ? (hand.score[1] === 14 ? 0 : 1) : CATEGORY_ROW[category];
  return {
    name: hand.name,
    cards: hand.cards,
    note: 'Your best five right now, from your two cards and the board.',
    row,
  };
}

function paintYourHand() {
  const box = $('yourHand');
  const info = currentHand();
  document.querySelectorAll('.rank-row').forEach((r) => r.classList.remove('mine'));

  if (!info) {
    show(box, false);
    return;
  }

  $('yourHandName').textContent = info.name;
  $('yourHandNote').textContent = info.note;
  const cards = $('yourHandCards');
  cards.innerHTML = '';
  for (const c of info.cards) cards.appendChild(cardEl(c, false, false));
  show(box, true);

  if (info.row >= 0) {
    const row = document.querySelectorAll('.rank-row')[info.row];
    if (row) {
      row.classList.add('mine');
      row.scrollIntoView({ block: 'nearest' });
    }
  }
}


/** The rules of the table you are actually sitting at, not the general case. */
function paintTableFacts() {
  const host = $('tableFacts');
  const cfg = app.config || {};
  const me = mySeat();
  host.innerHTML = '';

  const fact = (k, v) => {
    const row = document.createElement('div');
    row.className = 'fact';
    const a = document.createElement('span');
    a.className = 'k';
    a.textContent = k;
    const b = document.createElement('span');
    b.className = 'v';
    b.textContent = v;
    row.append(a, b);
    host.appendChild(row);
  };

  const note = (text) => {
    const row = document.createElement('div');
    row.className = 'fact note';
    row.textContent = text;
    host.appendChild(row);
  };

  fact('Table', app.code || '—');
  fact('Blinds', `${fmt(cfg.smallBlind || 0)} / ${fmt(cfg.bigBlind || 0)}`);
  fact('Seats', String(cfg.maxSeats || 0));
  fact('Most on the table', fmt(cfg.maxBuyIn || 0));
  fact('Time to act', `${Math.round((cfg.actionTimeoutMs || 45000) / 1000)} seconds`);
  fact('Out of time', cfg.meanie ? 'Your whole stack goes in' : 'You fold');
  if (me) fact('Your stack', fmt(me.chips));
  fact('Your vault', fmt(vault.balance()));

  note('Tap the Vault chip to move chips between your vault and the table, '
    + 'either way. Tap another seat to send chips to that player.');
  note(`Skins opens your card skins. A pack costs ${fmt(packs.PACK_PRICE)} chips `
    + 'and always gives you one you do not already have. Everyone at the table '
    + 'sees the skin you are wearing.');
  note('The gear opens Settings, for the background and the light or dark '
    + 'look. Those two are yours alone — nobody else sees them.');
  if (app.isHost) {
    note('You are hosting, so this tab is the table. Closing it ends the game '
      + 'for everyone.');
  }
}

function openHelp() {
  const list = $('rankList');
  if (!list.childElementCount) {
    HAND_RANKINGS.forEach(([name, note, cards], i) => {
      const row = document.createElement('div');
      row.className = 'rank-row';

      const no = document.createElement('div');
      no.className = 'rank-no';
      no.textContent = String(i + 1);

      const text = document.createElement('div');
      text.className = 'rank-text';
      const n = document.createElement('div');
      n.className = 'rank-name';
      n.textContent = name;
      const d = document.createElement('div');
      d.className = 'rank-note';
      d.textContent = note;
      text.append(n, d);

      const hand = document.createElement('div');
      hand.className = 'rank-cards';
      for (const c of cards.split(' ')) hand.appendChild(cardEl(c, false, false));

      row.append(no, text, hand);
      list.appendChild(row);
    });
  }
  paintYourHand();
  paintTableFacts();
  show($('helpModal'), true);
}

// ---------------------------------------------------------------- game shell

function enterGame() {
  show($('lobby'), false);
  show($('game'), true);
  $('codeLabel').textContent = app.code;
  show($('hostBadge'), app.isHost);
  // Guests should know the rule they are playing under, not just the host.
  show($('meanieBadge'), !!app.config.meanie);
  $('blindsLabel').textContent = `${app.config.smallBlind} / ${app.config.bigBlind}`;
  paintVault();
  history.replaceState(null, '', `#${app.code}`);
  addChat('', 'Type "help" here for hand rankings.', true);
  document.title = `Side Pot · ${app.code}`;
  sizeFelt();
}

function initGame() {
  $('codeChip').addEventListener('click', openShare);

  $('leaveBtn').addEventListener('click', () => {
    const warning = app.isHost
      ? 'You are hosting. Leaving ends the table for everyone. Leave anyway?'
      : 'Leave the table?';
    if (!confirm(warning)) return;
    const me = mySeat();
    send({ t: 'stand' });
    cashOut(me ? me.chips : 0);
    teardown();
    location.href = location.pathname;
    location.reload();
  });

  $('sitOutBtn').addEventListener('click', () => {
    const me = mySeat();
    send({ t: 'sitout', value: !(me && me.sitOut) });
  });

  const setPanel = (open) => {
    $('panel').classList.toggle('hidden', !open);
    // The button would otherwise sit on top of the Send button.
    show($('chatFab'), !open);
    if (open) {
      app.unread = false;
      show($('chatDot'), false);
      $('chatInput').focus();
    }
  };
  const togglePanel = () => setPanel($('panel').classList.contains('hidden'));

  $('panelToggle').addEventListener('click', togglePanel);
  $('chatFab').addEventListener('click', togglePanel);
  $('panelClose').addEventListener('click', () => setPanel(false));
  // Start closed on a phone, where the panel covers the table.
  setPanel(window.innerWidth >= 860);

  for (const tab of document.querySelectorAll('.ptab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.ppanel').forEach((p) => {
        p.classList.toggle('active', p.id === `ppanel-${tab.dataset.ptab}`);
      });
    });
  }

  $('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    $('chatInput').value = '';
    // Asking for help shouldn't broadcast to the table.
    if (/^\/?(help|rankings|hands)$/i.test(text)) {
      openHelp();
      return;
    }

    send({ t: 'chat', text });
  });

  for (const tab of document.querySelectorAll('.htab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.htab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.hpane').forEach((pane) => {
        pane.classList.toggle('active', pane.id === `hpane-${tab.dataset.htab}`);
      });
    });
  }

  $('helpClose').addEventListener('click', () => show($('helpModal'), false));
  $('helpModal').addEventListener('click', (e) => {
    if (e.target === $('helpModal')) show($('helpModal'), false);
  });

  $('foldBtn').addEventListener('click', () => act('fold'));
  $('checkBtn').addEventListener('click', () => act('check'));
  $('callBtn').addEventListener('click', () => act('call'));
  $('raiseBtn').addEventListener('click', () => {
    const legal = app.state?.you?.legal;
    if (!legal) return;
    act(legal.canBet ? 'bet' : 'raise', app.betTo);
  });
  $('addChipsBtn').addEventListener('click', openAddChips);

  $('rebuyBtn').addEventListener('click', () => {
    const { min, max } = buyInBounds();
    if (max <= 0) {
      toast('Your vault is empty. Open the vault chip to reload.');
      return;
    }
    const amount = vault.withdraw(Math.min(app.config?.startingStack || 1000, max));
    if (amount < min) {
      vault.deposit(amount);
      toast('Not enough left in your vault for a top-up.');
      return;
    }
    paintVault();
    send({ t: 'rebuy', amount });
  });
  $('startBtn').addEventListener('click', () => send({ t: 'start' }));

  $('betRange').addEventListener('input', (e) => setBet(Number(e.target.value), true));
  $('betAmount').addEventListener('input', (e) => setBet(Number(e.target.value), true));

  for (const b of document.querySelectorAll('.quick')) {
    b.addEventListener('click', () => quickBet(b.dataset.q));
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    const legal = app.state?.you?.legal;
    if (!legal) return;
    const k = e.key.toLowerCase();
    if (k === 'f') act('fold');
    else if (k === 'c') act(legal.canCheck ? 'check' : 'call');
    else if (k === 'r' && (legal.canBet || legal.canRaise)) act(legal.canBet ? 'bet' : 'raise', app.betTo);
  });
}

function act(action, amount) {
  send({ t: 'action', action, amount });
  // Lock the buttons until the next state lands, so a double-tap can't double-act.
  show($('controls'), false);
  app.betDirty = false;
}

function mySeat() {
  if (!app.state) return null;
  return app.state.seats.find((s) => s && s.isMe) || null;
}

// ---------------------------------------------------------------- bet sizing

function setBet(value, dirty) {
  const legal = app.state?.you?.legal;
  if (!legal) return;
  const v = Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(value || 0)));
  app.betTo = v;
  if (dirty) app.betDirty = true;
  $('betRange').value = String(v);
  $('betAmount').value = String(v);
  updateRaiseLabel();
}

function quickBet(kind) {
  const legal = app.state?.you?.legal;
  if (!legal) return;
  const pot = legal.potTotal;
  const toCall = legal.callAmount;
  let target;
  switch (kind) {
    case 'min': target = legal.minTo; break;
    case 'half': target = app.state.currentBet + Math.round((pot + toCall) / 2); break;
    case 'pot': target = app.state.currentBet + pot + toCall; break;
    default: target = legal.maxTo;
  }
  setBet(target, true);
}

function updateRaiseLabel() {
  const legal = app.state?.you?.legal;
  const btn = $('raiseBtn');
  if (!legal) return;
  const allIn = app.betTo >= legal.maxTo;
  const verb = allIn ? 'All in' : legal.canBet ? 'Bet' : 'Raise to';
  btn.textContent = `${verb} ${fmt(app.betTo)}`;
}


// ---------------------------------------------------------------- table sizing

/**
 * Size the table to the space actually available.
 *
 * CSS alone cannot do this: `max-height: 100%` on the felt resolves against a
 * grid row of automatic height, so it is ignored, and the table overflows a
 * short window — which is why the game needed full screen on a Chromebook.
 * Seats are positioned in percentages, so they follow whatever we set here.
 */
function sizeFelt() {
  const wrap = document.querySelector('.felt-wrap');
  const felt = $('felt');
  if (!wrap || !felt) return;

  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (availW <= 0 || availH <= 0) return;

  // Portrait-ish on a phone, landscape on anything wider.
  const ratio = availW < 620 ? 0.95 : 1.6;

  // Seats straddle the table edge, so half of each box sits outside the felt.
  // Reserve that at the top and bottom or the nearest seats get clipped.
  const seat = document.querySelector('.seat');
  const measured = seat ? seat.getBoundingClientRect().height / 2 + 4 : 42;
  // Never let the reservation eat the table it is protecting.
  const overhang = Math.min(measured, 64, availH * 0.2);
  const usableH = Math.max(140, availH - overhang * 2);

  let w = Math.min(availW, 940);
  let h = w / ratio;
  if (h > usableH) {
    h = usableH;
    w = h * ratio;
  }

  felt.style.width = `${Math.floor(w)}px`;
  felt.style.height = `${Math.floor(h)}px`;

  // Seats are placed around the table in percentages, so on a small table
  // fixed-size boxes collide. Scale them with it instead.
  const seats = app.config?.maxSeats || 6;
  const seatW = Math.round(Math.max(64, Math.min(132, (w * 0.95) / seats)));
  felt.style.setProperty('--seat-w', `${seatW}px`);
  felt.style.setProperty('--seat-fs', `${Math.max(9, Math.round(seatW * 0.105))}px`);
  felt.style.setProperty('--seat-card-w', `${Math.round(seatW * 0.3)}px`);
}

let sizeTimer = null;
function scheduleSizeFelt() {
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(sizeFelt, 60);
}

/**
 * Watch the space the table sits in rather than just the window. The action
 * bar grows when it is your turn, which shrinks that space without the window
 * changing at all — measuring once on entry got this wrong by 96px.
 */
function watchFeltSpace() {
  const wrap = document.querySelector('.felt-wrap');
  if (!wrap || typeof ResizeObserver !== 'function') return;
  // Safe from feedback: sizeFelt only ever resizes the felt, never the wrap.
  new ResizeObserver(() => sizeFelt()).observe(wrap);
}

// ---------------------------------------------------------------- render

function render(state) {
  const prev = app.state;
  app.state = state;

  if (state.handNo !== app.lastHandNo) {
    app.lastHandNo = state.handNo;
    app.betDirty = false;
  }

  const seatedNow = state.seats.find((x) => x && x.isMe);
  if (app.pendingBuyIn && seatedNow) {
    app.pendingBuyIn = 0;
    app.cashedOut = false;
  }
  // Mirror the stack into storage continuously, so losing the tab can't lose
  // the chips. setAtTable skips the write when nothing changed.
  if (seatedNow && !app.cashedOut) vault.setAtTable(app.code, seatedNow.chips);

  if (!app.sized) {
    app.sized = true;
    sizeFelt();
  }

  recordFriends(state);
  if (!$('adminModal').hidden) paintAdminList();
  if (!$('friendsModal').hidden) paintFriends();

  renderBoard(state);
  renderSeats(state);
  renderActionBar(state, prev);
  renderLog(state);
  renderChips(state);
}

function renderBoard(state) {
  show($('potBox'), state.pot > 0);
  $('potLabel').textContent = fmt(state.pot);

  // Highlight the cards that actually won the pot — highlighting every
  // player's best five would light up most of the board and mean nothing.
  const highlight = new Set();
  if (state.results?.kind === 'showdown') {
    for (const h of state.results.hands) {
      if (h.won > 0) for (const c of h.best || []) highlight.add(c);
    }
  }

  const board = $('board');
  board.innerHTML = '';
  for (const c of state.community) board.appendChild(cardEl(c, false, highlight.has(c)));

  $('centerMsg').textContent = centerMessage(state);
}

function centerMessage(state) {
  if (state.stage === 'idle') {
    const seated = state.seats.filter(Boolean).length;
    if (seated === 0) return 'Pick a seat to get started.';
    if (state.seats.filter((s) => s && s.chips > 0 && !s.sitOut).length < 2) {
      return 'Waiting for one more player…';
    }
    return 'Dealing shortly…';
  }
  if (state.results) {
    const winners = state.results.hands.filter((h) => h.won > 0);
    if (!winners.length) return '';
    if (state.results.kind === 'fold') {
      return `${winners[0].name} wins ${fmt(winners[0].won)}.`;
    }
    return winners.map((w) => `${w.name} wins ${fmt(w.won)} — ${w.handName}`).join(' · ');
  }
  return '';
}

function renderSeats(state) {
  const host = $('seats');
  host.innerHTML = '';
  const n = state.maxSeats;
  const me = state.seats.find((s) => s && s.isMe);
  // Rotate the layout so you are always at the bottom of the table.
  const anchor = me ? me.seat : 0;
  const results = new Map((state.results?.hands || []).map((h) => [h.id, h]));
  const now = Date.now() + app.clockOffset;
  // Pull the seats in horizontally on narrow screens, or the boxes on the far
  // left and right get clipped by the edge of the phone.
  const narrow = host.clientWidth < 560;
  const radiusX = narrow ? 36 : 45;
  const radiusY = narrow ? 44 : 43;

  for (let seat = 0; seat < n; seat++) {
    const slot = (seat - anchor + n) % n;
    const angle = (90 + slot * (360 / n)) * (Math.PI / 180);
    const el = document.createElement('div');
    el.className = 'seat';
    el.style.left = `${50 + radiusX * Math.cos(angle)}%`;
    el.style.top = `${50 + radiusY * Math.sin(angle)}%`;

    const p = state.seats[seat];
    if (!p) {
      const btn = document.createElement('button');
      btn.className = 'empty-seat';
      // Once you're seated the only thing left to do with an empty seat is
      // fill it with a bot, and only the host can do that.
      const canOpen = !me || app.isHost;
      btn.textContent = me ? (app.isHost ? `+ Add AI` : `Seat ${seat + 1}`) : 'Sit here';
      btn.disabled = !canOpen;
      btn.addEventListener('click', () => openSeatDialog(seat));
      el.appendChild(btn);
      host.appendChild(el);
      continue;
    }

    if (p.isMe) el.classList.add('me');
    if (p.folded) el.classList.add('folded');
    const acting = state.actingSeat === seat;
    if (acting) el.classList.add('acting');

    const cards = document.createElement('div');
    cards.className = 'seat-cards';
    for (const c of p.cards || []) {
      // The server already masks what you're not allowed to see, so trust the
      // value: '??' means face down, anything else is a real, revealed card.
      cards.appendChild(cardEl(c, c === '??', false, p.deck));
    }

    const box = document.createElement('div');
    box.className = 'seat-box';
    // Tapping someone else's seat offers to stake them — computer players
    // included. A hover border is invisible on a touchscreen, so the seat
    // carries a small chip badge to say it can be tapped.
    if (!p.isMe && mySeat()) {
      box.classList.add('clickable');
      box.title = `Send chips to ${p.name}`;
      box.addEventListener('click', () => openTransfer(seat));

      const give = document.createElement('span');
      give.className = 'give-chip';
      give.textContent = '+';
      give.setAttribute('aria-hidden', 'true');
      box.appendChild(give);
    }

    const name = document.createElement('div');
    name.className = 'seat-name';
    name.textContent = p.name + (p.isMe ? ' (you)' : '');

    const chips = document.createElement('div');
    chips.className = 'seat-chips';
    chips.textContent = fmt(p.chips);

    box.append(name, chips);

    const res = results.get(p.id);
    if (res?.handName) {
      const hn = document.createElement('div');
      hn.className = 'hand-name';
      hn.textContent = res.handName;
      box.appendChild(hn);
    }
    if (res?.won > 0) {
      const won = document.createElement('div');
      won.className = 'won-badge';
      won.textContent = `+${fmt(res.won)}`;
      box.appendChild(won);
    }

    const tag = seatTag(p, state);
    if (tag) {
      const t = document.createElement('div');
      t.className = `seat-tag ${tag.cls}`;
      t.textContent = tag.text;
      box.appendChild(t);
    }

    if (acting && state.actionDeadline > now) {
      const total = app.config?.actionTimeoutMs || 45000;
      const left = Math.max(0, Math.min(100, ((state.actionDeadline - now) / total) * 100));
      const bar = document.createElement('div');
      // Timing out now shoves your whole stack, so the last stretch is red.
      bar.className = left < 30 ? 'timer urgent' : 'timer';
      bar.style.width = `${left}%`;
      box.appendChild(bar);
    }

    el.append(cards, box);

    // Outside the box: .seat-box clips its overflow for the timer bar.
    if (!p.isMe && app.isHost) {
      const kick = document.createElement('button');
      kick.className = 'kick-bot';
      kick.textContent = '×';
      kick.title = `Remove ${p.name}`;
      kick.addEventListener('click', (ev) => {
        ev.stopPropagation();
        send({ t: 'removebot', seat });
      });
      el.appendChild(kick);
    }

    if (state.button === seat) {
      const d = document.createElement('div');
      d.className = 'dealer-btn';
      d.textContent = 'D';
      d.title = 'Dealer button';
      el.appendChild(d);
    }

    if (p.bet > 0) {
      const pill = document.createElement('div');
      pill.className = 'bet-pill';
      pill.textContent = fmt(p.bet);
      el.appendChild(pill);
    }

    host.appendChild(el);
  }
}

function seatTag(p, state) {
  if (p.disconnected) return { cls: 'away', text: 'disconnected' };
  if (p.bot && !p.inHand && state.stage === 'idle') return { cls: 'bot', text: 'computer' };
  if (p.chips === 0 && !p.inHand) return { cls: 'away', text: 'out of chips' };
  if (p.allIn) return { cls: 'allin', text: 'all in' };
  if (p.folded) return { cls: '', text: 'folded' };
  if (p.sitOut) return { cls: 'away', text: 'sitting out' };
  if (p.lastAction && state.actingSeat !== p.seat) return { cls: '', text: p.lastAction };
  return null;
}

function renderActionBar(state, prev) {
  const me = mySeat();
  const legal = state.you?.legal;
  const controls = $('controls');
  const idle = $('idleControls');
  const waiting = $('waitingMsg');

  show($('sitOutBtn'), !!me);
  if (me) $('sitOutBtn').textContent = me.sitOut ? 'Sit back in' : 'Sit out';

  const canStart =
    !!me && (state.stage === 'idle' || state.stage === 'handover') &&
    state.seats.filter((s) => s && s.chips > 0 && !s.sitOut).length >= 2;
  const canRebuy = !!(me && me.chips === 0 && !me.inHand);
  // Offered whenever there is room and something in the vault; if a hand is
  // running the table queues it rather than refusing.
  const canAdd = !!(me && vault.balance() > 0 && me.chips < maxBuyIn());
  show($('addChipsBtn'), canAdd);
  show($('startBtn'), canStart);
  show($('rebuyBtn'), canRebuy);
  show(idle, canStart || canRebuy || canAdd);

  if (legal) {
    show(controls, true);
    waiting.textContent = '';

    // Reset the slider to the minimum each time the turn comes back around.
    if (state.actingSeat !== app.lastActingSeat || !app.betDirty) {
      app.betDirty = false;
      setBet(legal.minTo, false);
    }
    app.lastActingSeat = state.actingSeat;

    $('betRange').min = String(legal.minTo);
    $('betRange').max = String(legal.maxTo);
    $('betAmount').min = String(legal.minTo);
    $('betAmount').max = String(legal.maxTo);
    setBet(app.betTo, false);

    const canSize = legal.canBet || legal.canRaise;
    document.querySelector('.bet-controls').classList.toggle('show', canSize && legal.minTo < legal.maxTo);

    show($('checkBtn'), legal.canCheck);
    show($('callBtn'), !legal.canCheck);
    $('callBtn').disabled = !legal.canCall;
    $('callBtn').textContent = legal.canCall ? `Call ${fmt(legal.callAmount)}` : 'Call';
    show($('raiseBtn'), canSize);
    updateRaiseLabel();
  } else {
    show(controls, false);
    app.lastActingSeat = -2;
    waiting.textContent = waitingText(state, me);
  }
}

function waitingText(state, me) {
  if (!me) return 'Spectating — click an open seat to join the next hand.';
  if (me.chips === 0) return 'Out of chips. Top up to keep playing.';
  if (me.sitOut) return 'You are sitting out.';
  if (state.stage === 'handover') return 'Hand over — next one coming up.';
  if (state.stage === 'idle') return 'Waiting for players…';
  const acting = state.seats[state.actingSeat];
  if (acting) return `Waiting for ${acting.name}…`;
  return 'Dealing…';
}

function renderLog(state) {
  const el = $('logList');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = '';
  for (const entry of state.log) {
    const d = document.createElement('div');
    d.textContent = entry.text;
    el.appendChild(d);
  }
  if (atBottom) el.scrollTop = el.scrollHeight;
}

function renderChips(state) {
  const el = $('chipList');
  el.innerHTML = '';
  const players = state.seats.filter(Boolean).sort((a, b) => b.chips - a.chips);
  for (const p of players) {
    const row = document.createElement('div');
    row.className = 'chip-row';
    const left = document.createElement('span');
    left.textContent = p.name + (p.isMe ? ' (you)' : '');
    const right = document.createElement('span');
    right.innerHTML = `${fmt(p.chips)} <span class="net ${p.netResult >= 0 ? 'up' : 'down'}">(${p.netResult >= 0 ? '+' : ''}${fmt(p.netResult)})</span>`;
    row.append(left, right);
    el.appendChild(row);
  }
  if (!players.length) el.textContent = 'Nobody is seated yet.';
}

// ---------------------------------------------------------------- bits

function cardEl(card, hidden, highlight, deck) {
  const el = document.createElement('div');
  if (!card || card === '??' || hidden) {
    // Whose cards these are decides what the back looks like, so the design
    // is a class on the card rather than a setting on the page.
    el.className = `card back deck-${packs.safeDeck(deck)}` + (hidden ? ' small' : '');
    return el;
  }
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  el.className = 'card' + (RED_SUITS.has(suit) ? ' red' : '') + (highlight ? ' highlight' : '');
  el.innerHTML = `<div><div class="r">${rank}</div><div class="s">${SUIT_GLYPH[suit]}</div></div>`;
  return el;
}

function addChat(from, text, system) {
  if (!system && $('panel').classList.contains('hidden')) {
    app.unread = true;
    show($('chatDot'), true);
  }
  const list = $('chatList');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const d = document.createElement('div');
  d.className = 'chat-line' + (system ? ' system' : '');
  if (system) {
    d.textContent = text;
  } else {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${from}: `;
    d.append(who, document.createTextNode(text));
  }
  list.appendChild(d);
  while (list.childElementCount > 200) list.firstElementChild.remove();
  if (atBottom) list.scrollTop = list.scrollHeight;
}

function toast(message) {
  addChat('', message, true);
  const tabs = document.querySelectorAll('.ptab');
  if (tabs[0] && !tabs[0].classList.contains('active')) tabs[0].click();
}

/**
 * Chip counts for display. Millions and billions are abbreviated, because
 * "1,250,000,000" does not fit in a seat box and is harder to read at a
 * glance than "1.25B". Anything under a million stays exact, so ordinary
 * play reads precisely. Inputs and sliders always carry the real number.
 */
function fmt(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  const short = (x) => (Math.round(x * 100) / 100).toLocaleString('en-US');
  if (abs >= 1e15) return `${short(v / 1e15)}Q`;
  if (abs >= 1e12) {
    const trillions = Math.round((v / 1e12) * 100) / 100;
    if (Math.abs(trillions) >= 1000) return `${short(v / 1e15)}Q`;
    return `${short(trillions)}T`;
  }
  if (abs >= 1e9) {
    const billions = Math.round((v / 1e9) * 100) / 100;
    if (Math.abs(billions) >= 1000) return `${short(v / 1e12)}T`;
    return `${short(billions)}B`;
  }
  if (abs >= 1e6) {
    const millions = Math.round((v / 1e6) * 100) / 100;
    // 999,999,999 rounds to 1000M, which should read as 1B.
    if (Math.abs(millions) >= 1000) return `${short(v / 1e9)}B`;
    return `${short(millions)}M`;
  }
  return v.toLocaleString('en-US');
}

// Keep the action clock ticking smoothly between server pushes.
setInterval(() => {
  if (app.state?.actingSeat >= 0 && app.state.actionDeadline) renderSeats(app.state);
}, 500);

$('buildNo').textContent = String(BUILD);
$('lobbyBuild').textContent = String(BUILD);

show($('settingsModal'), false);
show($('adminModal'), false);
show($('loading'), false);
show($('game'), false);
show($('modal'), false);
show($('helpModal'), false);
show($('authScreen'), false);

// A previous session that never cashed out gets settled up now.
const stranded = vault.recoverStranded();

initLobby();
initGame();
initVaultUi();
initCodeBoxes();
initBackup();
initShare();
initFriends();
initPhoneHosting();
initAdmin();
requestPersistence();
initSettings();
initAuthUi();
watchFeltSpace();
window.addEventListener('resize', scheduleSizeFelt);
window.addEventListener('orientationchange', scheduleSizeFelt);
setAuthMode('in');

// With a Firebase project configured, sign-in comes first and the lobby waits.
if (cloud.isConfigured()) {
  show($('lobby'), false);
  show($('authScreen'), true);
  startCloud().catch(() => {
    authError('Could not load sign-in. Check the Firebase settings in firebase-config.js.');
  });
}

if (stranded > 0) {
  lobbyError('');
  const note = document.createElement('p');
  note.className = 'busy';
  note.textContent = `${fmt(stranded)} chips were still on a table last time — returned to your vault.`;
  $('lobbyVault').closest('.lobby-card').insertBefore(note, $('lobbyError'));
  paintVault();
}

// Opened an invite link with a saved name? Walk straight in.
if (codeFromUrl() && store.name) {
  $('nameInput').value = store.name;
  doJoin(codeFromUrl());
}

// The host's tab IS the table, so make closing it a deliberate act.
// Note: deliberately no pagehide/unload cash-out. pagehide also fires when a
// tab is merely backgrounded, which cashed players out mid-game and credited
// their stack twice. The stack is mirrored into storage on every state update
// instead, and recoverStranded() settles up on the next load.

window.addEventListener('beforeunload', (e) => {
  if (!app.isHost || !app.state) return;
  const seated = app.state.seats.filter(Boolean).length;
  if (seated < 2) return;
  e.preventDefault();
  e.returnValue = '';
});
