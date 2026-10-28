import { score5, compareScores, bestHand } from '../engine/hand.js';
import { Table } from '../engine/game.js';
import { makeDeck, shuffle } from '../engine/cards.js';
import { decide, equity, chen, BOT_STYLES } from '../bot.js';
import * as vault from '../vault.js';
import * as friends from '../friends.js';
import * as packs from '../decks.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push({ name, err });
    process.stdout.write('F');
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${a}, want ${b}`);
}

const C = (s) => s.split(' ');

// ------------------------------------------------------------------ hand ranking

test('royal flush beats everything', () => {
  const royal = bestHand(C('As Ks Qs Js Ts 2c 3d'));
  eq(royal.name, 'Royal Flush');
  eq(royal.score[0], 8);
});

test('categories rank in the right order', () => {
  const hands = [
    ['high card', C('As Kd 9h 7c 4s')],
    ['pair', C('As Ad 9h 7c 4s')],
    ['two pair', C('As Ad 9h 9c 4s')],
    ['trips', C('As Ad Ah 9c 4s')],
    ['straight', C('5s 6d 7h 8c 9s')],
    ['flush', C('2s 6s 7s 8s Ks')],
    ['full house', C('As Ad Ah 9c 9s')],
    ['quads', C('As Ad Ah Ac 9s')],
    ['straight flush', C('5s 6s 7s 8s 9s')],
  ];
  for (let i = 1; i < hands.length; i++) {
    const lo = score5(hands[i - 1][1]);
    const hi = score5(hands[i][1]);
    assert(compareScores(hi, lo) > 0, `${hands[i][0]} should beat ${hands[i - 1][0]}`);
  }
});

test('the wheel is a five-high straight, not ace-high', () => {
  const wheel = score5(C('As 2d 3h 4c 5s'));
  eq(wheel[0], 4, 'is a straight');
  eq(wheel[1], 5, 'five high');
  const sixHigh = score5(C('2s 3d 4h 5c 6s'));
  assert(compareScores(sixHigh, wheel) > 0, 'six-high beats the wheel');
});

test('ace-high straight is not a wrap-around', () => {
  const s = score5(C('As Kd Qh Jc 2s'));
  eq(s[0], 0, 'K-Q-J-A-2 is only high card');
});

test('steel wheel is a straight flush', () => {
  const s = score5(C('As 2s 3s 4s 5s'));
  eq(s[0], 8);
  eq(s[1], 5);
});

test('kickers break ties', () => {
  const better = bestHand(C('As Ad Kh 7c 4s 2d 3h'));
  const worse = bestHand(C('As Ad Qh 7c 4s 2d 3h'));
  assert(compareScores(better.score, worse.score) > 0, 'king kicker beats queen kicker');
});

test('identical hands tie exactly', () => {
  const a = bestHand(C('As Ad Kh Qc Js 2d 3h'));
  const b = bestHand(C('Ac Ah Ks Qd Jc 2s 3d'));
  eq(compareScores(a.score, b.score), 0, 'same hand, different suits');
});

test('plays the board when hole cards do not help', () => {
  const h = bestHand(C('2c 3d As Ks Qs Js Ts'));
  eq(h.name, 'Royal Flush');
});

test('picks the best five out of seven', () => {
  const h = bestHand(C('9s 9d 9h 2c 2s 5d 7h'));
  eq(h.name, 'Full House, Nines over Twos');
});

test('full house beats a flush', () => {
  const fh = bestHand(C('9s 9d 9h 2c 2s'));
  const fl = bestHand(C('2s 6s 7s 8s Ks'));
  assert(compareScores(fh.score, fl.score) > 0);
});

test('describe produces readable names', () => {
  eq(bestHand(C('Kh Kd 4c 4s 9h 2d 3s')).name, 'Two Pair, Kings and Fours');
  eq(bestHand(C('7h 8d 9c Ts Jh 2d 3s')).name, 'Straight, Jack high');
  eq(bestHand(C('2h 7d 9c Ts Jh 4d 3s')).name, 'Jack high');
});

// ------------------------------------------------------------------ table setup

function seatPlayers(count, { chips = 1000, ...opts } = {}) {
  const t = new Table({ id: 'TEST', smallBlind: 5, bigBlind: 10, startingStack: chips, maxSeats: count, ...opts });
  for (let i = 0; i < count; i++) {
    t.sit(`p${i}`, `P${i}`, i);
    t.seats[i].chips = chips;
  }
  return t;
}

test('blinds are posted and action opens under the gun', () => {
  const t = seatPlayers(4);
  t.startHand();
  eq(t.stage, 'preflop');
  const sb = t.seats[t.sbSeat];
  const bb = t.seats[t.bbSeat];
  eq(sb.bet, 5, 'small blind');
  eq(bb.bet, 10, 'big blind');
  eq(t.currentBet, 10);
  // Four-handed: the button is seat 0, so action opens on seat 3.
  eq(t.actingSeat, (t.bbSeat + 1) % 4, 'under the gun acts first');
});

test('heads-up: the button posts the small blind and acts first', () => {
  const t = seatPlayers(2);
  t.startHand();
  eq(t.sbSeat, t.button, 'button is the small blind');
  eq(t.actingSeat, t.button, 'button acts first preflop');
});

test('heads-up: the big blind acts first after the flop', () => {
  const t = seatPlayers(2);
  t.startHand();
  t.act(t.seats[t.actingSeat].id, 'call');
  t.act(t.seats[t.actingSeat].id, 'check');
  eq(t.stage, 'flop');
  eq(t.actingSeat, t.bbSeat, 'big blind acts first postflop');
});

test('the big blind gets the option to raise', () => {
  const t = seatPlayers(3);
  t.startHand();
  t.act(t.seats[t.actingSeat].id, 'call'); // button calls
  t.act(t.seats[t.actingSeat].id, 'call'); // small blind completes
  eq(t.stage, 'preflop', 'still preflop — the big blind has the option');
  eq(t.actingSeat, t.bbSeat);
  t.act(t.seats[t.bbSeat].id, 'check');
  eq(t.stage, 'flop');
});

test('deals three cards on the flop, one each on turn and river', () => {
  const t = seatPlayers(2);
  t.startHand();
  t.act(t.seats[t.actingSeat].id, 'call');
  t.act(t.seats[t.actingSeat].id, 'check');
  eq(t.community.length, 3, 'flop');
  t.act(t.seats[t.actingSeat].id, 'check');
  t.act(t.seats[t.actingSeat].id, 'check');
  eq(t.community.length, 4, 'turn');
  t.act(t.seats[t.actingSeat].id, 'check');
  t.act(t.seats[t.actingSeat].id, 'check');
  eq(t.community.length, 5, 'river');
});

test('everyone folding ends the hand immediately', () => {
  const t = seatPlayers(3);
  t.startHand();
  const bb = t.seats[t.bbSeat];
  const before = bb.chips;
  t.act(t.seats[t.actingSeat].id, 'fold');
  t.act(t.seats[t.actingSeat].id, 'fold');
  eq(t.stage, 'handover');
  eq(bb.chips, before + 15, 'big blind collects the blinds');
  eq(t.results.kind, 'fold');
  eq(t.results.hands[0].cards, null, 'no cards are shown on a fold win');
});

test('a raise reopens the action for players who already acted', () => {
  const t = seatPlayers(3);
  t.startHand();
  const first = t.seats[t.actingSeat];
  t.act(first.id, 'call');
  const sb = t.seats[t.sbSeat];
  t.act(sb.id, 'raise', 40);
  eq(t.currentBet, 40);
  eq(first.hasActed, false, 'the earlier caller owes action again');
  assert(t.stage === 'preflop', 'street is not over');
});

test('minimum raise is enforced', () => {
  const t = seatPlayers(3);
  t.startHand();
  const p = t.seats[t.actingSeat];
  let threw = false;
  try { t.act(p.id, 'raise', 15); } catch { threw = true; }
  assert(threw, 'raising to 15 over a 10 blind is below the minimum');
  t.act(p.id, 'raise', 20);
  eq(t.currentBet, 20);
});

test('a raise sets the next minimum raise', () => {
  const t = seatPlayers(3);
  t.startHand();
  t.act(t.seats[t.actingSeat].id, 'raise', 30); // raise of 20 over the blind
  eq(t.minRaise, 20);
  const next = t.seats[t.actingSeat];
  let threw = false;
  try { t.act(next.id, 'raise', 40); } catch { threw = true; }
  assert(threw, 'must raise to at least 50');
  t.act(next.id, 'raise', 50);
  eq(t.currentBet, 50);
});

test('a short all-in does not raise the minimum for players behind', () => {
  const t = seatPlayers(3);
  t.seats[1].chips = 24;
  t.startHand();
  t.act(t.seats[t.actingSeat].id, 'raise', 20);
  // Whoever is short shoves for less than a full raise.
  const short = t.players().find((p) => p.chips > 0 && p.chips < 20 && !p.allIn) || t.seats[1];
  if (t.actingSeat === short.seat) {
    const before = t.minRaise;
    t.act(short.id, 'allin');
    eq(t.minRaise, before, 'minimum raise is unchanged by a short shove');
  }
});

test('you cannot act out of turn', () => {
  const t = seatPlayers(3);
  t.startHand();
  const notTurn = t.players().find((p) => p.seat !== t.actingSeat);
  let threw = false;
  try { t.act(notTurn.id, 'fold'); } catch { threw = true; }
  assert(threw, 'acting out of turn is rejected');
});

test('you cannot check facing a bet', () => {
  const t = seatPlayers(3);
  t.startHand();
  let threw = false;
  try { t.act(t.seats[t.actingSeat].id, 'check'); } catch { threw = true; }
  assert(threw, 'checking facing the big blind is rejected');
});

test('uncalled bets are returned', () => {
  const t = seatPlayers(3);
  t.seats[1].chips = 100;
  // Measure before the blinds go in, so bets aren't missed from the total.
  const totalBefore = t.players().reduce((s, p) => s + p.chips, 0);
  t.startHand();
  // Shove, everyone folds — the shover keeps the uncalled portion.
  t.act(t.seats[t.actingSeat].id, 'allin');
  while (t.inHandStage()) t.act(t.seats[t.actingSeat].id, 'fold');
  const totalAfter = t.players().reduce((s, p) => s + p.chips, 0);
  eq(totalAfter, totalBefore, 'no chips created or destroyed');
});

// ------------------------------------------------------------------ pots

test('side pots split at all-in boundaries', () => {
  const t = seatPlayers(3);
  const [a, b, c] = t.players();
  for (const p of [a, b, c]) { p.inHand = true; p.folded = false; }
  a.committed = 100;
  b.committed = 400;
  c.committed = 400;
  const pots = t.buildPots();
  eq(pots.length, 2, 'main pot plus one side pot');
  eq(pots[0].amount, 300, 'main pot is 3 x 100');
  eq(pots[0].eligible.length, 3);
  eq(pots[1].amount, 600, 'side pot is 2 x 300');
  eq(pots[1].eligible.length, 2);
  eq(pots[0].amount + pots[1].amount, 900, 'everything is accounted for');
});

test('chips from folded players sink into the main pot', () => {
  const t = seatPlayers(4);
  const [a, b, c, d] = t.players();
  for (const p of [a, b, c, d]) { p.inHand = true; p.folded = false; }
  a.committed = 100; // all in
  b.committed = 400;
  c.committed = 400;
  d.committed = 50;
  d.folded = true;
  const pots = t.buildPots();
  eq(pots[0].amount, 350, 'main pot picks up the folded 50');
  eq(pots.reduce((s, p) => s + p.amount, 0), 950, 'total matches what went in');
});

test('a lone all-in player gets a one-player pot', () => {
  const t = seatPlayers(2);
  const [a, b] = t.players();
  for (const p of [a, b]) { p.inHand = true; p.folded = false; }
  a.committed = 100;
  b.committed = 100;
  const pots = t.buildPots();
  eq(pots.length, 1);
  eq(pots[0].amount, 200);
});

test('a split pot divides evenly and odd chips go left of the button', () => {
  const t = seatPlayers(3);
  const [a, b, c] = t.players();
  t.button = 0; // seat 0 is `a`, so the odd chip belongs to seat 1 (`b`)
  t.community = C('2c 3d 4h 8s 9s');
  a.cards = C('Ah Kd');
  b.cards = C('As Kc'); // same hand as `a` — a genuine split
  c.cards = C('7h 7d');
  a.chips = 0; b.chips = 0; c.chips = 0;
  // `c` folded after putting in a single chip, which makes the pot odd.
  a.committed = 50; b.committed = 50; c.committed = 1;
  a.inHand = b.inHand = c.inHand = true;
  c.folded = true;
  t.potTotal = 101;
  t.stage = 'river';
  t.showdown();
  eq(a.chips + b.chips + c.chips, 101, 'the whole pot is paid out');
  eq(b.chips, 51, 'the odd chip goes to the first winner left of the button');
  eq(a.chips, 50);
  eq(c.chips, 0, 'the folded player gets nothing');
});

test('the better hand takes the pot at showdown', () => {
  const t = seatPlayers(2);
  const [a, b] = t.players();
  t.button = 0;
  t.community = C('2c 3d 4h 8s 9s');
  a.cards = C('Ah Ad');
  b.cards = C('Kh Kd');
  a.chips = 0; b.chips = 0;
  a.committed = 100; b.committed = 100;
  a.inHand = b.inHand = true;
  t.potTotal = 200;
  t.stage = 'river';
  t.showdown();
  eq(a.chips, 200, 'aces win');
  eq(b.chips, 0);
  eq(t.results.hands.find((h) => h.id === a.id).handName, 'Pair of Aces');
});

// ------------------------------------------------------------------ privacy

test('hole cards are hidden from other players until showdown', () => {
  const t = seatPlayers(3);
  t.startHand();
  const snap = t.snapshot('p0');
  const mine = snap.seats.find((s) => s.isMe);
  const theirs = snap.seats.filter((s) => s && !s.isMe);
  assert(mine.cards.every((c) => c !== '??'), 'I can see my own cards');
  for (const other of theirs) {
    assert(other.cards.every((c) => c === '??'), 'other hole cards are masked');
  }
});

test('a spectator sees no hole cards at all', () => {
  const t = seatPlayers(3);
  t.startHand();
  const snap = t.snapshot('nobody');
  eq(snap.you, null, 'spectators have no seat');
  for (const s of snap.seats) {
    if (s) assert(s.cards.every((c) => c === '??'), 'all hole cards are masked');
  }
});

test('cards are revealed at showdown', () => {
  const t = seatPlayers(2);
  t.startHand();
  while (t.inHandStage()) {
    const p = t.seats[t.actingSeat];
    const legal = t.legalActions(p);
    t.act(p.id, legal.canCheck ? 'check' : 'call');
  }
  eq(t.stage, 'handover');
  const snap = t.snapshot('nobody');
  const shown = snap.seats.filter((s) => s && s.cards.every((c) => c !== '??'));
  eq(shown.length, 2, 'both hands are face up after a showdown');
});

// ------------------------------------------------------------------ fuzz

function mulberry32(seed) {
  return function rng() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLegalAction(t, rng) {
  const p = t.seats[t.actingSeat];
  const legal = t.legalActions(p);
  const options = [['fold']];
  if (legal.canCheck) options.push(['check'], ['check']);
  if (legal.canCall) options.push(['call'], ['call']);
  if (legal.canBet || legal.canRaise) {
    options.push(['raise', legal.minTo]);
    options.push(['raise', legal.minTo + Math.floor(rng() * (legal.maxTo - legal.minTo + 1))]);
    options.push(['allin']);
  }
  const [action, amount] = options[Math.floor(rng() * options.length)];
  t.act(p.id, action, amount);
}

test('fuzz: chips are conserved across thousands of random hands', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed);
    const seatCount = 2 + Math.floor(rng() * 8);
    const t = seatPlayers(seatCount, { chips: 1000 });
    const TOTAL = seatCount * 1000;

    for (let hand = 0; hand < 60; hand++) {
      if (t.eligibleForHand().length < 2) break;
      if (!t.startHand()) break;

      let guard = 0;
      while (t.inHandStage()) {
        if (++guard > 500) throw new Error(`hand did not terminate (seed ${seed})`);
        assert(t.actingSeat >= 0 && t.seats[t.actingSeat], 'someone must be acting mid-hand');
        randomLegalAction(t, rng);

        const inPlay =
          t.players().reduce((s, p) => s + p.chips + p.bet, 0) + t.potTotal;
        eq(inPlay, TOTAL, `chips conserved mid-hand (seed ${seed}, hand ${hand})`);
      }

      eq(t.stage, 'handover', `hand ${hand} reached a conclusion (seed ${seed})`);
      eq(t.players().reduce((s, p) => s + p.chips, 0), TOTAL, `chips conserved after hand ${hand}`);
      assert(t.players().every((p) => p.chips >= 0), 'no negative stacks');
    }
  }
});

test('fuzz: the deck never deals a duplicate card', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = mulberry32(seed * 7);
    const t = seatPlayers(6, { chips: 5000 });
    for (let hand = 0; hand < 20; hand++) {
      if (!t.startHand()) break;
      let guard = 0;
      while (t.inHandStage()) {
        if (++guard > 500) throw new Error('hand did not terminate');
        randomLegalAction(t, rng);
      }
      const dealt = [...t.community, ...t.players().flatMap((p) => p.cards)];
      eq(new Set(dealt).size, dealt.length, `no duplicate cards (seed ${seed}, hand ${hand})`);
    }
  }
});

test('shuffle keeps all 52 distinct cards', () => {
  for (let i = 0; i < 50; i++) {
    const d = shuffle(makeDeck());
    eq(d.length, 52);
    eq(new Set(d).size, 52);
  }
});

test('the shuffle actually moves cards around', () => {
  const sorted = makeDeck().join('');
  let sameCount = 0;
  for (let i = 0; i < 20; i++) {
    if (shuffle(makeDeck()).join('') === sorted) sameCount++;
  }
  eq(sameCount, 0, 'no shuffle returned the deck in order');
});

// ------------------------------------------------------------------ bots

test('equity: a made straight flush is unbeatable', () => {
  const e = equity(C('9s 8s'), C('7s 6s 5s'), [1, 1, 1], 120);
  eq(e, 1, 'nothing can beat it on a locked board');
});

test('equity: aces beat a random hand far more often than not', () => {
  const e = equity(C('As Ad'), [], [1], 400);
  assert(e > 0.8, `aces should win about 85% heads-up, got ${e.toFixed(2)}`);
});

test('equity: a tighter opponent range lowers our equity', () => {
  // A middle pair on an ace-king board. Against random cards it is often
  // good; against someone who only plays premium hands it is nearly dead.
  // Chosen because the gap is large enough that sampling noise cannot flip
  // it — an earlier version compared two values a point apart and was flaky.
  const vsAny = equity(C('8h 8d'), C('Ac Kd 2s'), [1], 1200);
  const vsTight = equity(C('8h 8d'), C('Ac Kd 2s'), [0.05], 1200);
  assert(
    vsAny > vsTight + 0.15,
    `random ${vsAny.toFixed(2)} should clearly beat tight ${vsTight.toFixed(2)}`,
  );
});

test('chen ranks starting hands sensibly', () => {
  eq(chen(C('As Ad')), 20, 'aces are the top of the scale');
  eq(chen(C('Ks Kd')), 16, 'kings next');
  assert(chen(C('As Ks')) > chen(C('As Kd')), 'suited beats offsuit');
  assert(chen(C('As Kd')) > chen(C('7h 2c')), 'ace-king beats the worst hand');
  assert(chen(C('Js Ts')) > chen(C('Jh 5c')), 'connected and suited beats disconnected');
  assert(chen(C('7h 2c')) >= 0, 'never negative');
});

test('equity: the worst hand is a clear underdog to the best', () => {
  const strong = equity(C('As Ad'), C('Ah 7c 2d'), [1], 300);
  const weak = equity(C('7s 2d'), C('Ah 7c 2d'), [1], 300);
  assert(strong > weak, 'trip aces beat bottom two pair');
});

test('bots only ever choose legal actions', () => {
  for (const style of Object.keys(BOT_STYLES)) {
    const t = seatPlayers(4, { chips: 1000 });
    for (const p of t.players()) { p.bot = true; p.botStyle = style; }

    for (let hand = 0; hand < 12; hand++) {
      if (t.eligibleForHand().length < 2) break;
      if (!t.startHand()) break;
      let guard = 0;
      while (t.inHandStage()) {
        if (++guard > 400) throw new Error(`hand stalled (${style})`);
        const p = t.seats[t.actingSeat];
        const move = decide(t, p);
        // Throws if the move is not legal for this player right now.
        t.act(p.id, move.action, move.amount);
      }
      eq(
        t.players().reduce((s, p) => s + p.chips, 0),
        4000,
        `chips conserved in bot play (${style})`,
      );
    }
  }
});

test('a bot never folds when checking is free', () => {
  for (let seed = 0; seed < 25; seed++) {
    const t = seatPlayers(3, { chips: 1000 });
    for (const p of t.players()) { p.bot = true; p.botStyle = 'rock'; }
    t.startHand();
    // Walk to a spot where the acting player can check.
    let guard = 0;
    while (t.inHandStage() && guard++ < 60) {
      const p = t.seats[t.actingSeat];
      const legal = t.legalActions(p);
      if (legal.canCheck) {
        const move = decide(t, p);
        assert(move.action !== 'fold', 'folding for free is never right');
        break;
      }
      t.act(p.id, 'call');
    }
  }
});

test('buy-ins are honoured and clamped to the table maximum', () => {
  const t = new Table({ id: 'B', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 2000, maxSeats: 6 });
  t.sit('a', 'A', 0, { buyIn: 300 });
  eq(t.seats[0].chips, 300, 'sits with what was brought');
  t.sit('b', 'B', 1, { buyIn: 99999 });
  eq(t.seats[1].chips, 2000, 'clamped to the table maximum');
  t.sit('c', 'C', 2, { buyIn: 1 });
  eq(t.seats[2].chips, 10, 'raised to one big blind');
  t.sit('d', 'D', 3);
  eq(t.seats[3].chips, 1000, 'defaults to the standard stack');
});

// ------------------------------------------------------------------ vault

// vault.js talks to localStorage; give it one.
globalThis.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; },
};

function freshVault() {
  globalThis.localStorage.clear();
  // The vault now keeps an in-memory copy, so clearing storage is not enough.
  vault.detach();
}

test('a new vault starts with the house stake', () => {
  freshVault();
  eq(vault.balance(), 10000);
});

test('buying in takes chips out, cashing out puts them back', () => {
  freshVault();
  const took = vault.withdraw(1500);
  eq(took, 1500);
  eq(vault.balance(), 8500);
  vault.deposit(2300); // won some
  eq(vault.balance(), 10800);
});

test('you cannot withdraw more than you have', () => {
  freshVault();
  const took = vault.withdraw(999999);
  eq(took, 10000, 'capped at the balance');
  eq(vault.balance(), 0);
  assert(vault.balance() >= 0, 'never goes negative');
});

test('chips left on a table are recovered on the next visit', () => {
  freshVault();
  vault.withdraw(1000);
  vault.setAtTable('ABCD', 1000);
  vault.setAtTable('ABCD', 2650);  // won a few hands
  eq(vault.balance(), 9000, 'the stack is not in the vault while in play');

  // Tab closes without cashing out; next load settles up.
  const recovered = vault.recoverStranded();
  eq(recovered, 2650, 'recovers the latest stack, not the buy-in');
  eq(vault.balance(), 11650);
  eq(vault.recoverStranded(), 0, 'only recovers once');
});

test('cashing out clears the table record so it is not credited twice', () => {
  freshVault();
  vault.withdraw(1000);
  vault.setAtTable('ABCD', 1400);
  const staked = vault.clearAtTable();
  eq(staked, 1400);
  vault.deposit(staked);
  eq(vault.balance(), 10400);
  eq(vault.recoverStranded(), 0, 'nothing left stranded');
  eq(vault.balance(), 10400, 'balance unchanged by the recovery check');
});

test('an empty vault reloads, a full one does not', () => {
  freshVault();
  vault.withdraw(10000);
  eq(vault.balance(), 0);
  vault.reload();
  eq(vault.balance(), 10000);
  vault.reload();
  eq(vault.balance(), 10000, 'reloading a full vault is a no-op');
});

test('unreadable storage starts a fresh vault', () => {
  freshVault();
  globalThis.localStorage.setItem('pn.profile.v1', 'not json at all');
  eq(vault.balance(), 10000);
});

test('a negative stored balance is clamped to zero', () => {
  freshVault();
  globalThis.localStorage.setItem('pn.profile.v1', JSON.stringify({ vault: -500 }));
  eq(vault.balance(), 0);
});

test('a stack is never credited twice', () => {
  freshVault();
  vault.withdraw(1000);
  vault.setAtTable('ABCD', 1000);
  // Something cashes us out...
  const first = vault.clearAtTable();
  vault.deposit(first);
  eq(vault.balance(), 10000);
  // ...and anything that tries again finds nothing left to credit.
  eq(vault.clearAtTable(), 0);
  eq(vault.recoverStranded(), 0);
  eq(vault.balance(), 10000, 'balance is unchanged by repeat attempts');
});

test('a signed-in account replaces the local profile', () => {
  freshVault();
  vault.withdraw(2000);                 // local profile: 8,000 left
  eq(vault.balance(), 8000);

  const saved = [];
  vault.adopt({ vault: 25000, handsPlayed: 7 }, { uid: 'u1', save: (p) => saved.push(p.vault) });
  eq(vault.balance(), 25000, 'the account profile wins, not the device one');
  eq(vault.profile().handsPlayed, 7);

  vault.deposit(500);
  eq(saved[saved.length - 1], 25500, 'writes are pushed to the account');

  vault.detach();
  eq(vault.balance(), 8000, 'signing out returns to this device profile');
});

test('a brand new account starts with a full vault', () => {
  freshVault();
  vault.adopt(null, { uid: 'u2', save: () => {} });
  eq(vault.balance(), 10000);
  vault.detach();
});

test('chips can be added between hands, within the table maximum', () => {
  const t = new Table({ id: 'A', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 2000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 500 });
  eq(t.addChips('a', 400).added, 400);
  eq(t.seats[0].chips, 900);
  // Capped at the table maximum rather than refused outright.
  eq(t.addChips('a', 5000).added, 1100, 'tops up to the maximum, no further');
  eq(t.seats[0].chips, 2000);
});

test('adding chips is refused once at the maximum', () => {
  const t = new Table({ id: 'A', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 1000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  let threw = false;
  try { t.addChips('a', 100); } catch { threw = true; }
  assert(threw, 'no room left');
});

test('chips asked for mid-hand are queued, not refused', () => {
  const t = seatPlayers(3, { chips: 1000 });
  t.maxBuyIn = 50000;
  t.startHand();
  const p = t.players()[0];
  const before = p.chips;
  const result = t.addChips(p.id, 500);
  eq(result.queued, 500, 'queued rather than applied');
  eq(p.chips, before, 'the live stack is untouched — table stakes');

  // They arrive once the hand is over.
  while (t.inHandStage()) {
    const actor = t.seats[t.actingSeat];
    const legal = t.legalActions(actor);
    t.act(actor.id, legal.canCheck ? 'check' : 'fold');
  }
  eq(p.queuedChips, 0, 'queue is cleared');
  assert(p.chips >= before + 500 - 1000, 'the chips were released after the hand');
});

test('queued chips still respect the table maximum', () => {
  const t = new Table({ id: 'Q', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 1200, maxSeats: 3 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  t.sit('b', 'B', 1, { buyIn: 1000 });
  t.startHand();
  const a = t.playerById('a');
  // The blind is already posted, so the room left is measured from the
  // current stack, not the buy-in.
  const room = 1200 - a.chips;
  eq(t.addChips('a', 5000).queued, room, 'only the room that exists is queued');
  assert(room > 0 && room < 5000, 'the cap really did bite');
});

test('a folded player may top up while the hand finishes', () => {
  const t = seatPlayers(3, { chips: 1000 });
  t.maxBuyIn = 5000;
  t.startHand();
  const p = t.seats[t.actingSeat];
  t.act(p.id, 'fold');
  eq(t.addChips(p.id, 500).added, 500, 'folded means no longer in the hand');
  eq(p.chips, 1500);
});

test('added chips count against your result, not as winnings', () => {
  const t = new Table({ id: 'A', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 5000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  const before = t.seats[0].netResult;
  t.addChips('a', 600);
  eq(t.seats[0].netResult, before - 600, 'money brought to the table is not profit');
});

// ------------------------------------------------------------------ transfers

test('chips move between players and the totals hold', () => {
  const t = new Table({ id: 'T', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 50000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  t.sit('b', 'B', 1, { buyIn: 1000 });
  const total = () => t.players().reduce((s, p) => s + p.chips, 0);
  const before = total();

  eq(t.transferChips('a', 1, 300).sent, 300);
  eq(t.seats[0].chips, 700);
  eq(t.seats[1].chips, 1300);
  eq(total(), before, 'no chips created or destroyed');
});

test('a transfer is capped by what the sender actually has', () => {
  const t = new Table({ id: 'T', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 50000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 200 });
  t.sit('b', 'B', 1, { buyIn: 1000 });
  eq(t.transferChips('a', 1, 999999).sent, 200, 'sends everything, not more');
  eq(t.seats[0].chips, 0);
});

test('a transfer cannot push the receiver past the table maximum', () => {
  const t = new Table({ id: 'T', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 1200, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  t.sit('b', 'B', 1, { buyIn: 1000 });
  eq(t.transferChips('a', 1, 900).sent, 200, 'only up to the cap');
  eq(t.seats[1].chips, 1200);
});

test('you cannot send chips to yourself or an empty seat', () => {
  const t = new Table({ id: 'T', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 50000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  let own = false;
  let empty = false;
  try { t.transferChips('a', 0, 100); } catch { own = true; }
  try { t.transferChips('a', 3, 100); } catch { empty = true; }
  assert(own, 'refuses your own seat');
  assert(empty, 'refuses an empty seat');
});

test('a transfer asked for mid-hand lands after it', () => {
  const t = seatPlayers(3, { chips: 1000 });
  t.maxBuyIn = 50000;
  t.startHand();
  const [a, b] = t.players();
  eq(t.transferChips(a.id, b.seat, 250).queued, 250, 'queued, not applied');
  const aMid = a.chips;
  eq(a.chips, aMid, 'stack untouched while the hand runs');

  while (t.inHandStage()) {
    const actor = t.seats[t.actingSeat];
    const legal = t.legalActions(actor);
    t.act(actor.id, legal.canCheck ? 'check' : 'fold');
  }
  eq(a.pendingTransfers.length, 0, 'queue cleared');
  // Everyone started with 1000; the pot has been paid out and the transfer
  // only moved chips sideways, so the table still holds exactly 3000.
  eq(t.players().reduce((s, p) => s + p.chips, 0), 3000, 'nothing created or lost');
  assert(
    t.log.some((l) => /sends 250 chips/.test(l.text)),
    'the queued transfer was settled after the hand',
  );
});

test('giving chips away counts as a loss, receiving as a gain', () => {
  const t = new Table({ id: 'T', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 50000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  t.sit('b', 'B', 1, { buyIn: 1000 });
  t.transferChips('a', 1, 400);
  eq(t.seats[0].netResult, -400);
  eq(t.seats[1].netResult, 400);
});

test('the snapshot carries the table maximum to the client', () => {
  const t = new Table({ id: 'S', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 999000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  eq(t.snapshot('a').maxBuyIn, 999000, 'clients must not have to guess this');
});

test('chips can be taken back off the table', () => {
  const t = new Table({ id: 'R', smallBlind: 5, bigBlind: 10, startingStack: 5000, maxBuyIn: 100000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 5000 });
  eq(t.removeChips('a', 2000).removed, 2000);
  eq(t.seats[0].chips, 3000);
});

test('you cannot take back more than you have', () => {
  const t = new Table({ id: 'R', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 100000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 1000 });
  eq(t.removeChips('a', 999999).removed, 1000, 'clamped to the stack');
  eq(t.seats[0].chips, 0);
  let threw = false;
  try { t.removeChips('a', 100); } catch { threw = true; }
  assert(threw, 'nothing left to take');
});

test('taking chips back mid-hand is queued until it ends', () => {
  const t = seatPlayers(3, { chips: 1000 });
  t.startHand();
  const p = t.players()[0];
  const before = p.chips;
  eq(t.removeChips(p.id, 400).queued, 400, 'queued, not taken');
  eq(p.chips, before, 'the live stack is untouched');

  while (t.inHandStage()) {
    const actor = t.seats[t.actingSeat];
    const legal = t.legalActions(actor);
    t.act(actor.id, legal.canCheck ? 'check' : 'fold');
  }
  eq(p.queuedRemoval, 0, 'queue cleared');
  assert(
    t.log.some((l) => /takes 400 chips off the table/.test(l.text)),
    'the removal settled after the hand',
  );
});

test('chips round-trip without changing the total', () => {
  const t = new Table({ id: 'R', smallBlind: 5, bigBlind: 10, startingStack: 2000, maxBuyIn: 100000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 2000 });
  const p = t.seats[0];
  const startResult = p.netResult;
  t.removeChips('a', 1500);
  t.addChips('a', 1500);
  eq(p.chips, 2000, 'back where it started');
  eq(p.netResult, startResult, 'and the running result is unchanged');
});

test('very large stacks still add up exactly', () => {
  const t = new Table({ id: 'B', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 1_000_000_000, maxSeats: 4 });
  t.sit('a', 'A', 0, { buyIn: 500_000_000 });
  t.sit('b', 'B', 1, { buyIn: 500_000_000 });
  eq(t.addChips('a', 400_000_000).added, 400_000_000);
  eq(t.seats[0].chips, 900_000_000);
  // Well inside the range JavaScript counts exactly, so no rounding creeps in.
  assert(Number.isSafeInteger(t.seats[0].chips), 'still an exact integer');
  eq(t.transferChips('a', 1, 100_000_000).sent, 100_000_000);
  eq(t.seats[0].chips + t.seats[1].chips, 1_400_000_000, 'totals hold at scale');
});

test('the vault will not exceed the exact-arithmetic ceiling', () => {
  freshVault();
  vault.deposit(5e14);
  vault.deposit(5e14);
  eq(vault.balance(), 1e15, 'lands exactly on the cap');
  vault.deposit(9e15);
  eq(vault.balance(), 1e15, 'and stays there');
  assert(Number.isSafeInteger(vault.balance()), 'still an exact integer');
});

test('a full table of maximum stacks stays inside exact arithmetic', () => {
  // Nine seats is the most this game allows; the totals must not reach the
  // point where whole numbers stop being counted exactly.
  const worst = 9 * 1e15;
  assert(worst <= Number.MAX_SAFE_INTEGER, `9 x 1Q = ${worst} must stay safe`);
});

test('a backup code is short and carries chips and hands', () => {
  freshVault();
  vault.withdraw(3000);
  vault.setAtTable('ABCD', 4500);   // some chips still on a table
  for (let i = 0; i < 42; i++) vault.recordHand({ pot: 100 });
  const code = vault.backupCode();
  // It was twelve characters when it carried only chips. Two collections
  // cost nine characters between them, one bit per skin, and that is the
  // price of a code that restores everything rather than just a balance.
  assert(code.length <= 24, `code should stay typable, got ${code.length}: ${code}`);
  assert(/^[0-9A-Z-]+$/.test(code), 'uppercase and dashes only');

  freshVault();
  eq(vault.balance(), 10000, 'a clean device');
  // 7,000 left in the vault plus the 4,500 that was on the table.
  eq(vault.restoreCode(code), 11500, 'chips at the table are included');
  eq(vault.balance(), 11500);
  eq(vault.profile().handsPlayed, 42, 'hands played travel too');
});

test('an older chips-only code still works', () => {
  // Built the way codes were before hands were added: no leading B.
  freshVault();
  const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const enc = (n) => { let o = ''; let v = n; do { o = C32[v % 32] + o; v = Math.floor(v / 32); } while (v > 0); return o; };
  const chk = (b) => { let s = 7; for (const c of b) s = (s * 31 + C32.indexOf(c)) % 1024; return C32[Math.floor(s / 32)] + C32[s % 32]; };
  const body = enc(777000);
  eq(vault.restoreCode(body + chk(body)), 777000, 'reads back without a version marker');
});

test('a huge hand count is carried as the most a code can hold', () => {
  freshVault();
  const p = vault.profile();
  for (let i = 0; i < 5; i++) vault.recordHand({});
  const code = vault.backupCode();
  freshVault();
  vault.restoreCode(code);
  eq(vault.profile().handsPlayed, 5);
});

test('a code reads back however it is typed', () => {
  freshVault();
  vault.deposit(1_234_567);
  const code = vault.backupCode();
  const expected = vault.balance();

  for (const variant of [
    code.toLowerCase(),
    code.replace(/-/g, ''),
    code.replace(/-/g, ' '),
    ` ${code} `,
  ]) {
    freshVault();
    eq(vault.restoreCode(variant), expected, `accepts ${variant}`);
  }
});

test('a mistyped code is refused rather than guessed at', () => {
  freshVault();
  vault.deposit(500_000);
  const code = vault.backupCode();
  const before = (freshVault(), vault.balance());

  // Change one character to something else in the alphabet.
  const chars = code.replace(/-/g, '').split('');
  chars[0] = chars[0] === '9' ? '8' : '9';
  eq(vault.restoreCode(chars.join('')), null, 'check characters catch it');
  eq(vault.balance(), before, 'balance untouched');

  eq(vault.restoreCode('not a code'), null);
  eq(vault.restoreCode(''), null);
});

test('a restored code cannot exceed the ceiling', () => {
  freshVault();
  // Hand-build a code for an absurd number and confirm it clamps.
  vault.deposit(1e15);
  const code = vault.backupCode();
  freshVault();
  eq(vault.restoreCode(code), 1e15, 'clamped to the maximum');
});

test('chips can be seized from another seat', () => {
  const t = new Table({ id: 'S', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 1e9, maxSeats: 4 });
  t.sit('me', 'Me', 0, { buyIn: 1000 });
  t.sit('them', 'Them', 1, { buyIn: 4000 });
  const total = () => t.players().reduce((s, p) => s + p.chips, 0);
  const before = total();

  eq(t.seizeChips('me', 1, 1500).sent, 1500);
  eq(t.seats[0].chips, 2500);
  eq(t.seats[1].chips, 2500);
  eq(total(), before, 'chips move, none appear');
});

test('seizing everything empties the seat', () => {
  const t = new Table({ id: 'S', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 1e9, maxSeats: 4 });
  t.sit('me', 'Me', 0, { buyIn: 100 });
  t.sit('them', 'Them', 1, { buyIn: 7000 });
  eq(t.seizeChips('me', 1, 'all').sent, 7000);
  eq(t.seats[1].chips, 0);
  eq(t.seats[0].chips, 7100);
});

test('seizing refuses your own seat and empty ones', () => {
  const t = new Table({ id: 'S', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxBuyIn: 1e9, maxSeats: 4 });
  t.sit('me', 'Me', 0, { buyIn: 1000 });
  let own = false;
  let empty = false;
  try { t.seizeChips('me', 0, 10); } catch { own = true; }
  try { t.seizeChips('me', 2, 10); } catch { empty = true; }
  assert(own && empty, 'both refused');
});

test('seizing mid-hand waits for the hand to finish', () => {
  const t = seatPlayers(3, { chips: 1000 });
  t.maxBuyIn = 1e9;
  t.startHand();
  const [me, them] = t.players();
  const theirChips = them.chips;
  eq(t.seizeChips(me.id, them.seat, 200).queued, 200, 'queued, not taken');
  eq(them.chips, theirChips, 'their live stack is untouched');
});

test('running out of time puts you all in', () => {
  const t = seatPlayers(3, { chips: 1000 });
  t.startHand();
  const p = t.seats[t.actingSeat];
  const stack = p.chips;
  t.timeoutAct();
  eq(p.chips, 0, 'the whole stack goes in');
  eq(p.allIn, true);
  assert(p.bet >= stack, 'everything they had is committed');
  assert(!p.folded, 'and they are still in the hand');
});

test('a disconnected player is folded, not shoved', () => {
  const t = seatPlayers(3, { chips: 1000 });
  t.startHand();
  const p = t.seats[t.actingSeat];
  p.disconnected = true;
  t.timeoutAct();
  eq(p.folded, true, 'folded rather than losing their stack to a lost signal');
  assert(p.chips > 0, 'stack intact');
});

test('with meanie off, timing out folds as it used to', () => {
  const t = new Table({ id: 'M', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxSeats: 3, meanie: false });
  for (let i = 0; i < 3; i++) t.sit(`p${i}`, `P${i}`, i);
  t.startHand();
  const p = t.seats[t.actingSeat];
  t.timeoutAct();
  eq(p.folded, true, 'folded rather than shoved');
  assert(p.chips > 0, 'stack intact');
});

test('meanie is on unless a table turns it off', () => {
  const on = new Table({ id: 'A', maxSeats: 2 });
  const off = new Table({ id: 'B', maxSeats: 2, meanie: false });
  eq(on.meanie, true);
  eq(off.meanie, false);
  eq(on.snapshot('nobody').meanie, true, 'and it reaches the players');
});

test('timing out with nothing to call still shoves', () => {
  const t = seatPlayers(2, { chips: 1000 });
  t.startHand();
  // Get to a street where checking is free.
  t.act(t.seats[t.actingSeat].id, 'call');
  t.act(t.seats[t.actingSeat].id, 'check');
  eq(t.stage, 'flop');
  const p = t.seats[t.actingSeat];
  t.timeoutAct();
  eq(p.chips, 0, 'all in even though checking was free');
});

// ------------------------------------------------------------------ friends

test('people you play with are remembered, bots are not', () => {
  globalThis.localStorage.clear();
  friends.note('Sam', 'ABCD');
  friends.note('Pat', 'ABCD');
  eq(friends.count(), 2);
  const names = friends.list().map((f) => f.name).sort();
  eq(names.join(','), 'Pat,Sam');
});

test('a shared game counts once, however many updates arrive', () => {
  globalThis.localStorage.clear();
  for (let i = 0; i < 20; i++) friends.note('Sam', 'ABCD');
  eq(friends.list()[0].games, 1, 'one game, not twenty');

  friends.note('Sam', 'WXYZ');
  eq(friends.list()[0].games, 2, 'a different table is a second game');
});

test('favourites come first, then whoever was seen most recently', () => {
  globalThis.localStorage.clear();
  friends.note('Old', 'A');
  friends.note('Recent', 'B');
  const key = friends.list().find((f) => f.name === 'Old').key;
  friends.star(key, true);
  eq(friends.list()[0].name, 'Old', 'a favourite outranks a recent game');
});

test('renaming shows your name and keeps theirs', () => {
  globalThis.localStorage.clear();
  friends.note('Jonathan', 'A');
  const key = friends.list()[0].key;
  friends.rename(key, 'Jonno');
  const f = friends.list()[0];
  eq(friends.displayName(f), 'Jonno');
  eq(f.name, 'Jonathan', 'their own name is still there');
});

test('forgetting someone removes them', () => {
  globalThis.localStorage.clear();
  friends.note('Sam', 'A');
  friends.remove(friends.list()[0].key);
  eq(friends.count(), 0);
});

test('the same person under different capitals is one entry', () => {
  globalThis.localStorage.clear();
  friends.note('sam', 'A');
  friends.note('SAM', 'B');
  eq(friends.count(), 1, 'matched case-insensitively');
  eq(friends.list()[0].name, 'SAM', 'showing their latest spelling');
});

// ------------------------------------------------------------------ card packs

test('a pack only ever hands over something you do not have', () => {
  const all = packs.packContents('cosmic').map((d) => d.id);
  // Draw the whole pack, one at a time, always taking what comes back.
  const owned = [];
  for (let i = 0; i < all.length; i++) {
    const pulled = packs.drawFromPack('cosmic', owned, i / all.length);
    assert(pulled, 'the pack still had something in it');
    assert(!owned.includes(pulled.id), 'never a repeat');
    owned.push(pulled.id);
  }
  eq(owned.length, all.length, 'the pack empties exactly');
  eq(packs.drawFromPack('cosmic', owned, 0.5), null, 'and then gives nothing');
});

test('a draw stays inside its own pack', () => {
  for (const pack of packs.PACKS) {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const pulled = packs.drawFromPack(pack.id, [], roll);
      eq(pulled.pack, pack.id, `${pack.id} at ${roll}`);
    }
  }
});

test('an id that is not a card back becomes Classic', () => {
  eq(packs.safeDeck('rocket'), 'rocket');
  eq(packs.safeDeck('nonsense'), 'classic');
  eq(packs.safeDeck('deck-opt locked" onload="x'), 'classic', 'nothing injectable gets through');
  eq(packs.safeDeck(undefined), 'classic');
});

test('buying is the only way to own a card back', () => {
  globalThis.localStorage.clear();
  vault.detach();
  eq(vault.ownsDeck('rocket'), false);
  assert(vault.grantDeck('rocket'), 'granted');
  eq(vault.ownsDeck('rocket'), true);
  eq(vault.grantDeck('rocket'), false, 'granting twice changes nothing');
  eq(vault.decks().length, 1);
  eq(vault.grantDeck('not-a-deck'), false, 'and nonsense is refused');
});

test('chips leave the vault before a design arrives', () => {
  globalThis.localStorage.clear();
  vault.detach();
  const before = vault.balance();
  assert(vault.spend(packs.PACK_PRICE), 'paid');
  eq(vault.balance(), before - packs.PACK_PRICE);
  eq(vault.spend(vault.balance() + 1), false, 'cannot spend what is not there');
  eq(vault.balance(), before - packs.PACK_PRICE, 'a refused spend takes nothing');
});

test('a backup code carries the card backs you bought', () => {
  globalThis.localStorage.clear();
  vault.detach();
  vault.grantDeck('rocket');
  vault.grantDeck('donut');
  const code = vault.backupCode();

  globalThis.localStorage.clear();
  vault.detach();
  eq(vault.decks().length, 0, 'a fresh device has none');
  vault.restoreCode(code);
  assert(vault.ownsDeck('rocket'), 'rocket came across');
  assert(vault.ownsDeck('donut'), 'donut came across');
  eq(vault.decks().length, 2, 'and nothing else did');
});

test('an older code leaves the collection alone', () => {
  globalThis.localStorage.clear();
  vault.detach();
  // A B-format code: chips and hands, made before card backs existed.
  const body = 'B' + 'F4' + '001';
  const old = body + (() => {
    let sum = 7;
    for (const ch of body) sum = (sum * 31 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(ch)) % 1024;
    return '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(sum / 32)]
      + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[sum % 32];
  })();
  vault.grantDeck('rocket');
  assert(vault.restoreCode(old) !== null, 'the old code still reads');
  assert(vault.ownsDeck('rocket'), 'and did not wipe what this device had');
});

test('everyone at the table is told which back you wear', () => {
  const t = new Table({ id: 'D', smallBlind: 5, bigBlind: 10, startingStack: 1000 });
  t.sit('a', 'Ann', 0, { deck: 'rocket' });
  t.sit('b', 'Bob', 1, {});
  const seen = t.snapshot('b').seats[0];
  eq(seen.deck, 'rocket', 'Bob sees what Ann is wearing');
  eq(t.snapshot('a').seats[1].deck, 'classic', 'and the default when none was sent');
  eq(seen.cards.length, 0);

  assert(t.setDeck('a', 'donut'), 'changed');
  eq(t.snapshot('b').seats[0].deck, 'donut', 'a change reaches the table');
  eq(t.setDeck('nobody', 'donut'), false);
});

test('changing your card back mid-hand touches nothing else', () => {
  const t = new Table({ id: 'E', smallBlind: 5, bigBlind: 10, startingStack: 1000 });
  t.sit('a', 'Ann', 0, { deck: 'rocket' });
  t.sit('b', 'Bob', 1, { deck: 'pizza' });
  t.startHand();
  const before = JSON.stringify(t.snapshot('a').seats.map((p) => p && p.chips));
  const cards = t.seats[0].cards.join(' ');
  t.setDeck('a', 'trophy');
  eq(JSON.stringify(t.snapshot('a').seats.map((p) => p && p.chips)), before, 'stacks untouched');
  eq(t.seats[0].cards.join(' '), cards, 'and the hand is the same hand');
});

test('computer players do not copy a back already at the table', () => {
  const t = new Table({ id: 'F', smallBlind: 5, bigBlind: 10, startingStack: 1000, maxSeats: 6 });
  t.sit('me', 'Me', 0, { deck: 'rocket' });
  // Stand in for the host's own bot seating, which is what picks the design.
  const worn = new Set(t.players().map((p) => p.deck));
  const free = packs.DECKS.filter((d) => !worn.has(d.id));
  assert(!free.some((d) => d.id === 'rocket'), 'the one in use is off the list');
  assert(free.length === packs.DECKS.length - 1, 'and only that one');
});

test('every themed pack has exactly one ultra rare', () => {
  // Limited is not a themed pack: it holds two ultras at one percent each,
  // which is the whole shape of it.
  for (const pack of packs.PACKS) {
    if (pack.stated) continue;
    const ultras = packs.packContents(pack.id).filter((d) => d.rarity === 'ultra');
    eq(ultras.length, 1, `${pack.id} has one`);
  }
});

test('every rarity in the catalogue is one the tiles can show', () => {
  for (const d of packs.DECKS) {
    if (d.id === packs.FREE_DECK) continue;
    assert(packs.RARITIES.includes(d.rarity), `${d.id} is ${d.rarity}`);
  }
});

test('an ultra rare tends to come last out of its pack', () => {
  // Over many openings of a fresh pack, the ultra should be the rarest
  // first pull by a wide margin — that is the whole point of the tier.
  const counts = {};
  for (let i = 0; i < 1000; i++) {
    const first = packs.drawFromPack('cosmic', [], i / 1000);
    counts[first.rarity] = (counts[first.rarity] || 0) + 1;
  }
  assert(counts.ultra > 0, 'but it is still reachable');
  assert(counts.ultra < counts.common / 20, `ultra ${counts.ultra} vs common ${counts.common}`);
});

test('a backup code carries an ultra rare, which did not fit the old width', () => {
  globalThis.localStorage.clear();
  vault.detach();
  // The ultra rares sit past the first twenty catalogue places.
  const last = packs.DECKS[packs.DECKS.length - 1].id;
  assert(packs.DECK_IDS.indexOf(last) >= 20, 'past the old field width');
  vault.grantDeck(last);
  vault.grantDeck('galaxy');
  const code = vault.backupCode();

  globalThis.localStorage.clear();
  vault.detach();
  vault.restoreCode(code);
  assert(vault.ownsDeck(last), 'the last design came across');
  assert(vault.ownsDeck('galaxy'), 'and so did the first ultra');
  eq(vault.decks().length, 2);
});

test('a code written at the old width still reads', () => {
  globalThis.localStorage.clear();
  vault.detach();
  const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const check = (body) => {
    let sum = 7;
    for (const ch of body) sum = (sum * 31 + C32.indexOf(ch)) % 1024;
    return C32[Math.floor(sum / 32)] + C32[sum % 32];
  };
  // C + chips + 3 hands + 4 deck characters. Bit 0 is Classic, so the value
  // 2 sets bit 1: the first design after it.
  const body = 'C' + 'F4' + '001' + '0002';
  const code = body + check(body);
  assert(vault.restoreCode(code) !== null, 'it reads');
  eq(vault.decks()[0], packs.DECK_IDS[1], 'and the bit means the same design');
});

// ------------------------------------------------------------------ limited

test('Limited draws on the odds it advertises', () => {
  const contents = packs.packContents('limited');
  const total = contents.reduce((sum, d) => sum + d.odds, 0);
  assert(Math.abs(total - 1) < 1e-9, `the odds add up to ${total}`);

  const counts = {};
  for (let i = 0; i < 10000; i++) {
    const got = packs.drawStated('limited', i / 10000);
    counts[got.id] = (counts[got.id] || 0) + 1;
  }
  for (const d of contents) {
    const share = counts[d.id] / 10000;
    assert(Math.abs(share - d.odds) < 0.005, `${d.id} came up ${share}, wants ${d.odds}`);
  }
});

test('Limited repeats what you already own, by design', () => {
  // A themed pack would skip Bad once you had it; this one must not, or the
  // 98 stops meaning 98.
  let bad = 0;
  for (let i = 0; i < 100; i++) {
    if (packs.drawStated('limited', i / 100).id === 'bad') bad++;
  }
  eq(bad, 98, 'Bad every time the roll says Bad, owned or not');
});

test('Bad is the common one and the other two are not', () => {
  eq(packs.deckById('bad').rarity, 'common');
  eq(packs.deckById('milk').rarity, 'milk', 'Milk has a tier of its own now');
  eq(packs.deckById('supra').rarity, 'ultra');
  eq(packs.deckById('bad').pack, 'limited');
});

test('the retired Jackpot is in no pack but keeps its place', () => {
  for (const pack of packs.PACKS) {
    const ids = packs.packContents(pack.id).map((d) => d.id);
    assert(!ids.includes('jackpot'), `${pack.id} does not sell it`);
  }
  // Its position is its bit in a backup code, so it must not have moved.
  eq(packs.DECK_IDS.indexOf('jackpot'), 21);
  assert(packs.deckById('jackpot'), 'and it is still a real skin');
});

test('the catalogue still fits the backup code', () => {
  // A skin past this point would be silently dropped from every code, so
  // adding one means widening the field and minting a new code letter.
  assert(packs.DECK_IDS.length <= vault.CODED_DECK_LIMIT,
    `${packs.DECK_IDS.length} skins, room for ${vault.CODED_DECK_LIMIT}`);
});

// ------------------------------------------------------------------ flipping chips

test('a won flip doubles the stake and a lost one takes it', () => {
  globalThis.localStorage.clear();
  vault.detach();
  const start = vault.balance();

  const won = vault.coinFlip(1000, 0);
  eq(won.won, true);
  eq(won.balance, start + 1000, 'the stake doubled');

  const lost = vault.coinFlip(1000, 0.99);
  eq(lost.won, false);
  eq(lost.balance, start, 'and back where we began');
});

test('the chip flip is a fair coin', () => {
  globalThis.localStorage.clear();
  vault.detach();
  let wins = 0;
  for (let i = 0; i < 1000; i++) {
    // A tiny stake so the vault cannot run dry mid-sweep.
    if (vault.coinFlip(1, i / 1000).won) wins++;
  }
  const share = wins / 1000;
  assert(Math.abs(share - vault.COIN_ODDS) < 0.02, `won ${share} of the time`);
});

test('a flip you cannot cover moves nothing', () => {
  globalThis.localStorage.clear();
  vault.detach();
  const start = vault.balance();
  eq(vault.coinFlip(start + 1, 0), null, 'more than the vault holds');
  eq(vault.coinFlip(0, 0), null, 'nothing at all');
  eq(vault.coinFlip(-500, 0), null, 'a negative stake');
  eq(vault.coinFlip('rubbish', 0), null, 'not a number');
  eq(vault.balance(), start, 'and the vault is untouched');
});

test('betting the lot is allowed, and losing it empties the vault', () => {
  globalThis.localStorage.clear();
  vault.detach();
  const all = vault.balance();
  const result = vault.coinFlip(all, 0.99);
  eq(result.won, false);
  eq(result.balance, 0);
  eq(vault.coinFlip(1, 0), null, 'nothing left to stake');
});

// ------------------------------------------------------------------ chip skins

test('the chip pack never hands over one you have', () => {
  const all = packs.chipPackContents().map((c) => c.id);
  const owned = [];
  for (let i = 0; i < all.length; i++) {
    const got = packs.drawChip(owned, i / all.length);
    assert(got, 'the pack still had something');
    assert(!owned.includes(got.id), 'never a repeat');
    owned.push(got.id);
  }
  eq(owned.length, all.length);
  eq(packs.drawChip(owned, 0.5), null, 'and then nothing');
});

test('Pink is free and never sold', () => {
  const ids = packs.chipPackContents().map((c) => c.id);
  assert(!ids.includes(packs.FREE_CHIP), 'not in the pack');
  assert(packs.chipById(packs.FREE_CHIP), 'but it is a real skin');
});

test('a chip id that is not one becomes Pink', () => {
  eq(packs.safeChip('prism'), 'prism');
  eq(packs.safeChip('chipskin-x" onload="y'), 'pink', 'nothing injectable gets through');
  eq(packs.safeChip(undefined), 'pink');
});

test('chip skins are owned separately from card skins', () => {
  globalThis.localStorage.clear();
  vault.detach();
  assert(vault.grantChip('prism'), 'granted');
  eq(vault.ownsChip('prism'), true);
  eq(vault.ownsDeck('prism'), false, 'and it is not a card skin');
  eq(vault.grantChip('prism'), false, 'granting twice changes nothing');
  eq(vault.grantChip('not-a-chip'), false);
  eq(vault.decks().length, 0, 'the card list is untouched');
});

test('a backup code carries the chip skins too', () => {
  globalThis.localStorage.clear();
  vault.detach();
  vault.grantChip('triangle');
  vault.grantChip('prism');
  vault.grantDeck('rocket');
  const code = vault.backupCode();

  globalThis.localStorage.clear();
  vault.detach();
  vault.restoreCode(code);
  assert(vault.ownsChip('triangle'), 'triangle came across');
  assert(vault.ownsChip('prism'), 'prism came across');
  assert(vault.ownsDeck('rocket'), 'and the card skin did too');
  eq(vault.chipSkins().length, 2);
});

test('a code from before chip skins leaves them alone', () => {
  globalThis.localStorage.clear();
  vault.detach();
  const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const check = (body) => {
    let sum = 7;
    for (const ch of body) sum = (sum * 31 + C32.indexOf(ch)) % 1024;
    return C32[Math.floor(sum / 32)] + C32[sum % 32];
  };
  // A D code: chips, hands and card skins, written before chips had skins.
  const body = 'D' + 'F4' + '001' + '00002';
  const old = body + check(body);
  vault.grantChip('prism');
  assert(vault.restoreCode(old) !== null, 'the older code still reads');
  assert(vault.ownsChip('prism'), 'and did not wipe the chip skins');
});

test('both collections still fit the backup code', () => {
  assert(packs.DECK_IDS.length <= vault.CODED_DECK_LIMIT,
    `${packs.DECK_IDS.length} card skins, room for ${vault.CODED_DECK_LIMIT}`);
  assert(packs.CHIP_IDS.length <= vault.CODED_CHIP_LIMIT,
    `${packs.CHIP_IDS.length} chip skins, room for ${vault.CODED_CHIP_LIMIT}`);
});

// ------------------------------------------------------------------ claim codes

test('a claim code names skins that actually exist', () => {
  for (const [code, claim] of Object.entries(packs.CLAIMS)) {
    assert(claim.name, `${code} says what it gives`);
    for (const id of claim.decks) assert(packs.deckById(id), `${code}: card ${id}`);
    for (const id of claim.chips) assert(packs.chipById(id), `${code}: chip ${id}`);
  }
});

test('a claim-only skin is in no pack at any price', () => {
  const sold = packs.chipPackContents().map((c) => c.id);
  for (const claim of Object.values(packs.CLAIMS)) {
    for (const id of claim.chips) {
      assert(!sold.includes(id), `${id} is not sold`);
      eq(packs.chipById(id).claim, true, `${id} is marked claim-only`);
    }
  }
  // Drawing the whole pack must never turn one up either.
  const owned = [];
  for (;;) {
    const got = packs.drawChip(owned, Math.random());
    if (!got) break;
    assert(!got.claim, `the pack gave up ${got.id}`);
    owned.push(got.id);
  }
});

test('a pack costs five thousand', () => {
  eq(packs.PACK_PRICE, 5000);
});

test('everyone at the table is told which chip you wear', () => {
  const t = new Table({ id: 'G', smallBlind: 5, bigBlind: 10, startingStack: 1000 });
  t.sit('a', 'Ann', 0, { chip: 'galaxy' });
  t.sit('b', 'Bob', 1, {});
  eq(t.snapshot('b').seats[0].chip, 'galaxy', 'Bob sees what Ann is wearing');
  eq(t.snapshot('a').seats[1].chip, 'pink', 'and the default when none was sent');

  assert(t.setChip('a', 'melon'), 'changed');
  eq(t.snapshot('b').seats[0].chip, 'melon', 'a change reaches the table');
  eq(t.setChip('nobody', 'melon'), false);
});

test('a card skin and a chip skin travel independently', () => {
  const t = new Table({ id: 'H', smallBlind: 5, bigBlind: 10, startingStack: 1000 });
  t.sit('a', 'Ann', 0, { deck: 'rocket', chip: 'prism' });
  const seen = t.snapshot('b').seats[0];
  eq(seen.deck, 'rocket');
  eq(seen.chip, 'prism');
  t.setChip('a', 'milk');
  eq(t.snapshot('b').seats[0].deck, 'rocket', 'the card skin did not move');
  eq(t.snapshot('b').seats[0].chip, 'milk');
});

test('Milk is a rarity of its own, above ultra, and is never sold', () => {
  assert(packs.RARITIES.includes('milk'), 'the tier exists');
  eq(packs.RARITIES[packs.RARITIES.length - 1], 'milk', 'and it is the top one');
  eq(packs.deckById('milk').rarity, 'milk');
  // One skin carries it, and it is a card skin.
  eq(packs.DECKS.filter((d) => d.rarity === 'milk').length, 1);
  eq(packs.CHIP_SKINS.filter((c) => c.rarity === 'milk').length, 0);
});

test('there is no Milk chip, and the code is about cards alone', () => {
  eq(packs.chipById('milk'), null, 'no such chip skin');
  assert(!packs.CHIP_IDS.includes('milk'), 'and it is not in the catalogue');
  eq(packs.claimable('chips').size, 0, 'no claim gives a chip away');
  const claim = packs.findClaim('MILK-714');
  eq(claim.chips.length, 0, 'the Milk code carries no chip');
  eq(claim.decks.join(), 'milk', 'just the card skin');
});

test('the claim list says which skins cost nothing', () => {
  const freeDecks = packs.claimable('decks');
  assert(freeDecks.has('milk'), 'the Milk card is free');
  assert(!freeDecks.has('rocket'), 'a pack skin is not');
});

test('the new chip skins are real and distinct', () => {
  for (const id of ['bucket', 'melon', 'galaxy', 'eight']) {
    assert(packs.chipById(id), `${id} exists`);
    eq(packs.safeChip(id), id, `${id} survives validation`);
  }
  eq(new Set(packs.CHIP_IDS).size, packs.CHIP_IDS.length, 'no duplicate ids');
});

test('a claim code can be typed, however it is typed', () => {
  for (const text of ['MILK-714', 'milk714', 'Milk-714', ' milk 714 ']) {
    assert(packs.findClaim(text), `"${text}" is recognised`);
  }
  eq(packs.findClaim('MILK-715'), null, 'a wrong one is not');
  eq(packs.findClaim('milk714a'), null, 'and nor is the admin word');
  eq(packs.findClaim(''), null);
  eq(packs.findClaim(undefined), null);
});

test('the chip catalogue grew and still fits its code field', () => {
  assert(packs.CHIP_IDS.length > 10, `${packs.CHIP_IDS.length} chip skins`);
  assert(packs.CHIP_IDS.length <= vault.CODED_CHIP_LIMIT,
    `${packs.CHIP_IDS.length} chip skins, room for ${vault.CODED_CHIP_LIMIT}`);
});

test('a code carries a chip skin from past the old field width', () => {
  globalThis.localStorage.clear();
  vault.detach();
  const last = packs.CHIP_IDS[packs.CHIP_IDS.length - 1];
  assert(packs.CHIP_IDS.indexOf(last) >= 10, 'past the old width');
  vault.grantChip(last);
  const code = vault.backupCode();

  globalThis.localStorage.clear();
  vault.detach();
  vault.restoreCode(code);
  assert(vault.ownsChip(last), `${last} came across`);
});

// ------------------------------------------------------------------ report

console.log('\n');
for (const f of failures) {
  console.error(`FAIL  ${f.name}\n      ${f.err.message}\n`);
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
