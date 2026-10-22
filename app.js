import { HostNet, GuestNet } from './net.js?v=mvk4xk3p';
import { TableHost } from './host.js?v=mvk4xk3p';
import * as vault from './vault.js?v=mvk4xk3p';

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

const SUIT_GLYPH = { c: '♣', d: '♦', h: '♥', s: '♠' };
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
    case 'cashout':
      cashOut(msg.amount, 'stand');
      break;
    case 'chat':
      addChat(msg.from, msg.text);
      break;
    case 'error': {
      // A rejected sit leaves chips in limbo — put them straight back.
      if (app.pendingBuyIn) {
        vault.deposit(app.pendingBuyIn);
        app.pendingBuyIn = 0;
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

function openSeatDialog(seat) {
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
  document.title = `Poker Night · ${app.code}`;
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

  $('panelToggle').addEventListener('click', () => $('panel').classList.toggle('hidden'));
  // On a phone the table is what matters; chat is a tap away.
  if (window.innerWidth < 860) $('panel').classList.add('hidden');

  for (const tab of document.querySelectorAll('.ptab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.ppanel').forEach((p) => {
        p.classList.toggle('active', p.id === `ppanel-${tab.dataset.ptab}`);
      });
    });
  }

  $('chatForm').addEventListener('submit', (e) => {
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
  show($('startBtn'), canStart);
  show($('rebuyBtn'), canRebuy);
  show(idle, canStart || canRebuy);

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
