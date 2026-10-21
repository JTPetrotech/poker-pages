import { score5, compareScores, bestHand } from '../engine/hand.js';
import { Table } from '../engine/game.js';
import { makeDeck, shuffle } from '../engine/cards.js';

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

// ------------------------------------------------------------------ report

console.log('\n');
for (const f of failures) {
  console.error(`FAIL  ${f.name}\n      ${f.err.message}\n`);
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
