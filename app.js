import { HostNet, GuestNet } from './net.js?v=mvkibmqx';
import { TableHost } from './host.js?v=mvkibmqx';
import * as vault from './vault.js?v=mvkibmqx';
import * as cloud from './cloud.js?v=mvkibmqx';
import { bestHand } from './engine/hand.js?v=mvkibmqx';
import { cardValue, cardSuit, RANK_NAMES, RANK_PLURALS } from './engine/cards.js?v=mvkibmqx';

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
const BUILD = 16;

const SUIT_GLYPH = { c: '♣', d: '♦', h: '♥', s: '♠' };

// Chat input is matched against this digest rather than against a word, so
// the word itself appears nowhere in the published source.
const UNLOCK_DIGEST = '8dc622226665f3ee690092e4b76dcaadafe7cef33d752556bdfaf4449bb582f1';
const UNLOCK_GRANT = 100_000;

async function matchesUnlock(text) {
  try {
    const bytes = new TextEncoder().encode(text.toLowerCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === UNLOCK_DIGEST;
  } catch {
    return false;   // no subtle crypto (insecure origin): behave as no match
  }
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
  $('lobbyBusy').hidden = false;
  document.querySelectorAll('.lobby-card .primary, #soloBtn').forEach((b) => { b.disabled = true; });
  try {
    await attempt();
  } catch (err) {
    teardown();
    lobbyError(
      err.message === 'no-such-table'
        ? 'No table with that code. Check the code, or ask the host whether their tab is still open.'
        : err.message || 'Could not connect. Check your internet and try again.',
    );
  } finally {
    app.connecting = false;
    $('lobbyBusy').hidden = true;
    document.querySelectorAll('.lobby-card .primary, #soloBtn').forEach((b) => { b.disabled = false; });
  }
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
  const cfg = { smallBlind: 5, bigBlind: 10, startingStack: 1000, maxSeats: 6 };
  await hostTable(cfg);

  const buyIn = vault.withdraw(Math.min(cfg.startingStack, vault.balance()));
  app.pendingBuyIn = buyIn;
  vault.setAtTable(app.code, buyIn);
  paintVault();
  send({ t: 'sit', seat: 0, name: app.name, buyIn });

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
  return cfg.maxBuyIn || (cfg.startingStack || 1000) * 10;
}

function buyInBounds() {
  const cfg = app.config || {};
  const bal = vault.balance();
  if ((app.dialogMode === 'add' || app.dialogMode === 'send') && app.addBounds) {
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
  show($('modal'), true);
}

/** Reuse the buy-in dialog to bring more chips from the vault to the table. */
function openAddChips() {
  const me = mySeat();
  if (!me) return;
  app.dialogMode = 'add';
  app.dialogSeat = me.seat;

  const cfg = app.config || {};
  const bal = vault.balance();
  const queued = app.state?.you?.queuedChips || 0;
  const room = Math.max(0, maxBuyIn() - me.chips - queued);
  const max = Math.min(bal, room);

  $('modalTitle').textContent = 'Add chips';
  $('modalSub').innerHTML =
    `At the table <strong>${fmt(me.chips)}</strong> · Vault <strong>${fmt(bal)}</strong>`
    + (queued ? ` · <strong>${fmt(queued)}</strong> arriving after this hand` : '');
  modalError('');
  show($('botSection'), false);
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
  $('modalClose').addEventListener('click', closeSeatDialog);
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal')) closeSeatDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('helpModal').hidden) show($('helpModal'), false);
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

  $('sitConfirm').addEventListener('click', () => {
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
    send({ t: 'sit', seat, name: app.name, buyIn: taken });
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
  show($('helpModal'), true);
}

// ---------------------------------------------------------------- game shell

function enterGame() {
  show($('lobby'), false);
  show($('game'), true);
  $('codeLabel').textContent = app.code;
  show($('hostBadge'), app.isHost);
  $('blindsLabel').textContent = `${app.config.smallBlind} / ${app.config.bigBlind}`;
  paintVault();
  history.replaceState(null, '', `#${app.code}`);
  addChat('', 'Type "help" here for hand rankings.', true);
  document.title = `Side Pot · ${app.code}`;
  sizeFelt();
}

function initGame() {
  $('codeChip').addEventListener('click', async () => {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied — send it to your friends.');
    } catch {
      toast(link);
    }
  });

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

    // Handled here, before send(), so nothing goes over the wire and nobody
    // else sees it. The chips land in the vault, not on the table: adding to
    // a live stack mid-hand would break table stakes and show up in everyone
    // else's chip counts.
    if (!/\s/.test(text) && await matchesUnlock(text)) {
      vault.deposit(UNLOCK_GRANT);
      paintVault();
      toast(`+${fmt(UNLOCK_GRANT)} chips. Your vault is now ${fmt(vault.balance())}.`);
      return;
    }
    send({ t: 'chat', text });
  });

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
      cards.appendChild(cardEl(c, c === '??', false));
    }

    const box = document.createElement('div');
    box.className = 'seat-box';
    // Tapping someone else's seat offers to stake them.
    if (!p.isMe && mySeat()) {
      box.classList.add('clickable');
      box.title = `Send chips to ${p.name}`;
      box.addEventListener('click', () => openTransfer(seat));
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
      const bar = document.createElement('div');
      bar.className = 'timer';
      bar.style.width = `${Math.max(0, Math.min(100, ((state.actionDeadline - now) / total) * 100))}%`;
      box.appendChild(bar);
    }

    el.append(cards, box);

    // Outside the box: .seat-box clips its overflow for the timer bar.
    if (p.bot && app.isHost) {
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

function cardEl(card, hidden, highlight) {
  const el = document.createElement('div');
  if (!card || card === '??' || hidden) {
    el.className = 'card back' + (hidden ? ' small' : '');
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

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// Keep the action clock ticking smoothly between server pushes.
setInterval(() => {
  if (app.state?.actingSeat >= 0 && app.state.actionDeadline) renderSeats(app.state);
}, 500);

$('buildNo').textContent = String(BUILD);
$('lobbyBuild').textContent = String(BUILD);

show($('game'), false);
show($('modal'), false);
show($('helpModal'), false);
show($('authScreen'), false);

// A previous session that never cashed out gets settled up now.
const stranded = vault.recoverStranded();

initLobby();
initGame();
initVaultUi();
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
