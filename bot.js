import { makeDeck, cardValue, cardSuit } from './engine/cards.js?v=mvo3bhly';
import { bestHand, compareScores } from './engine/hand.js?v=mvo3bhly';

/**
 * Computer opponents.
 *
 * Two ideas do most of the work.
 *
 * First, opponents are not assumed to hold random cards. A player who raised
 * is holding something, and simulating against random hands is what makes a
 * naive bot call off its stack. Each opponent gets a range inferred from what
 * they have actually done this hand, and the simulation only deals them hands
 * inside it.
 *
 * Second, preflop is decided by hand strength and position rather than by
 * simulation. Against random hands almost anything looks playable heads-up,
 * which is exactly the leak that makes a bot easy to beat.
 */

const HIGH_CARD_POINTS = { 14: 10, 13: 8, 12: 7, 11: 6 };

/**
 * Chen's starting-hand formula. Cheap, and ranks the 169 starting hands
 * closely enough to drive both our own preflop play and opponent ranges.
 * Scale runs roughly 0 (72 offsuit) to 20 (pocket aces).
 */
export function chen(cards) {
  const v = cards.map(cardValue).sort((a, b) => b - a);
  const [hi, lo] = v;
  const suited = cardSuit(cards[0]) === cardSuit(cards[1]);

  let score = HIGH_CARD_POINTS[hi] ?? hi / 2;
  if (hi === lo) return Math.max(5, Math.ceil(score * 2));

  if (suited) score += 2;
  const gap = hi - lo - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;
  // Connected low cards make straights.
  if (gap <= 1 && hi < 12) score += 1;

  return Math.max(0, Math.ceil(score));
}

/** Roughly the Chen score that cuts off the top `pct` of starting hands. */
function rangeFloor(pct) {
  if (pct <= 0.05) return 11;
  if (pct <= 0.10) return 9;
  if (pct <= 0.15) return 8;
  if (pct <= 0.25) return 7;
  if (pct <= 0.35) return 6;
  if (pct <= 0.50) return 5;
  if (pct <= 0.70) return 3;
  return 0;
}

export const BOT_STYLES = {
  rock: {
    key: 'rock',
    label: 'Cautious',
    preflopNeed: 9,
    valueAt: 0.64,
    raiseAt: 0.82,
    callMargin: 1.15,
    bluff: 0.04,
    sizing: 0.55,
  },
  shark: {
    key: 'shark',
    label: 'Solid',
    preflopNeed: 7,
    valueAt: 0.56,
    raiseAt: 0.75,
    callMargin: 1.0,
    bluff: 0.12,
    sizing: 0.65,
  },
  maniac: {
    key: 'maniac',
    label: 'Wild',
    preflopNeed: 4,
    valueAt: 0.46,
    raiseAt: 0.66,
    callMargin: 0.8,
    bluff: 0.3,
    sizing: 0.85,
  },
  expert: {
    key: 'expert',
    label: 'Expert',
    preflopNeed: 7.5,
    valueAt: 0.53,
    raiseAt: 0.71,
    callMargin: 0.94,
    bluff: 0.2,
    sizing: 0.72,
    // Reads opponents tighter and varies its bet sizing, which makes it both
    // harder to run over and harder to put on a hand.
    sharpRead: true,
  },
};

export const BOT_NAMES = [
  'Ada', 'Boomer', 'Cash', 'Dusty', 'Echo', 'Fox', 'Gus', 'Hazel',
  'Ivy', 'Jett', 'Koko', 'Lefty', 'Mack', 'Nova',
];

/**
 * How wide a range an opponent is likely holding, judged from what they have
 * actually done this hand. The sharper styles credit them with less.
 */
function opponentRange(table, opponent, style) {
  const raised = table.lastAggressorSeat === opponent.seat;
  const sharp = style.sharpRead ? 0.85 : 1;

  if (!raised) {
    return opponent.committed > table.bigBlind ? 0.4 : 0.65;
  }

  // What a raise from THIS player is worth. Someone who raises a third of the
  // time is not representing much, and folding to them is the fastest way to
  // lose — which is exactly what the previous version did.
  const s = opponent.stats;
  const sample = s ? s.actions : 0;
  const raiseFreq = sample >= 12 ? s.raises / sample : null;

  let width = raiseFreq === null
    ? 0.2
    : Math.min(0.8, Math.max(0.08, raiseFreq * 1.9));

  // A reraise before the flop still means something, whoever is making it.
  if (table.community.length === 0 && table.currentBet > table.bigBlind * 3) {
    width *= 0.5;
  }

  return Math.min(0.9, width * sharp);
}

/**
 * Share of the pot this hand wins on average, dealing opponents hands from
 * their estimated ranges rather than at random. A tie counts as half.
 */
export function equity(hole, board, opponentRanges, sims = 240) {
  const known = new Set([...hole, ...board]);
  const pool = makeDeck().filter((c) => !known.has(c));
  const count = opponentRanges.length;
  const toCome = 5 - board.length;
  const need = count * 2 + toCome;
  if (need > pool.length) return 0.5;

  const floors = opponentRanges.map(rangeFloor);
  let total = 0;

  for (let i = 0; i < sims; i++) {
    const d = pool.slice();
    let idx = 0;
    const draw = () => {
      const k = idx + Math.floor(Math.random() * (d.length - idx));
      [d[idx], d[k]] = [d[k], d[idx]];
      return d[idx++];
    };

    const full = board.slice();
    for (let j = 0; j < toCome; j++) full.push(draw());

    const mine = bestHand([...hole, ...full]).score;
    let tie = false;
    let lost = false;

    for (let o = 0; o < count; o++) {
      let a = draw();
      let b = draw();
      // Redraw until the hand fits their range. The cap used to be 10, which
      // sounds generous but is not: a top-5% range qualifies about one draw
      // in twenty, so ten tries found one only 40% of the time and the rest
      // fell through to a random hand — quietly undoing the range modelling.
      for (let attempt = 0; attempt < 60 && chen([a, b]) < floors[o]; attempt++) {
        idx -= 2;
        a = draw();
        b = draw();
      }
      const theirs = bestHand([a, b, ...full]).score;
      const cmp = compareScores(theirs, mine);
      if (cmp > 0) { lost = true; break; }
      if (cmp === 0) tie = true;
    }

    if (lost) continue;
    total += tie ? 0.5 : 1;
  }
  return total / sims;
}


/**
 * What the live opponents have shown us so far. Folding too often and raising
 * too often are both exploitable, and in opposite directions: one invites
 * stealing, the other demands calling down lighter.
 */
function readOpponents(table, player) {
  const opps = table.live().filter((p) => p !== player && !p.allIn);
  let folds = 0;
  let raises = 0;
  let seen = 0;
  for (const o of opps) {
    const st = o.stats;
    if (st && st.actions >= 12) {
      folds += st.folds / st.actions;
      raises += st.raises / st.actions;
      seen++;
    }
  }
  // Neutral defaults until there is enough of a sample to mean anything.
  return seen
    ? { foldFreq: folds / seen, raiseFreq: raises / seen, known: true }
    : { foldFreq: 0.35, raiseFreq: 0.15, known: false };
}

function jitter(scale = 0.03) {
  return (Math.random() - 0.5) * 2 * scale;
}

/** How many live players still act after this one on this street. */
function playersBehind(table, player) {
  const live = table.live().filter((p) => !p.allIn);
  const order = (seat) => (seat - table.button + table.maxSeats) % table.maxSeats;
  const mine = order(player.seat);
  let behind = 0;
  for (const p of live) {
    if (p !== player && order(p.seat) > mine) behind++;
  }
  return behind;
}

/**
 * Preflop: hand strength weighed against position and the action so far.
 * Deliberately not simulation-based — against random hands nearly everything
 * looks playable, and that is the leak that makes a bot easy to beat.
 */
function preflop(table, player, legal, style) {
  const score = chen(player.cards);
  const opponents = Math.max(1, table.live().length - 1);
  const behind = playersBehind(table, player);
  const facingRaise = table.currentBet > table.bigBlind;
  const bigRaise = table.currentBet > table.bigBlind * 3;

  // More players to get through means a stronger hand is needed; acting late
  // means fewer surprises behind us, so we can play wider.
  let need = style.preflopNeed + opponents * 0.7 - (opponents - behind) * 0.4;

  // Scale with how big the raise actually is, rather than a flat penalty.
  // A min-raise should not fold out the same hands a shove does.
  if (facingRaise) {
    const raiseSize = table.currentBet / table.bigBlind;
    need += Math.min(4.5, 0.8 + raiseSize * 0.45);
  }

  // Heads-up you must defend far wider — folding most hands hands over the
  // blinds every orbit, which no postflop edge can make up for.
  if (opponents === 1) need -= 2.4;

  // Closing the action for a small price is a discount worth taking.
  if (legal.canCall && legal.callAmount <= table.bigBlind) need -= 1.2;

  // And who is doing the raising matters as much as the raise. A player who
  // raises a third of the time is not showing a premium hand, and treating
  // them as if they were is how a tight bot bleeds out.
  const aggressor = table.seats[table.lastAggressorSeat];
  if (facingRaise && aggressor && aggressor !== player && aggressor.stats) {
    const { actions, raises } = aggressor.stats;
    if (actions >= 12) {
      const freq = raises / actions;
      need -= Math.min(3.8, Math.max(0, (freq - 0.12) * 12));
    }
  }

  // Against someone who folds constantly, open far wider — their folding is
  // the whole reason to be in the pot, and not attacking it is a bigger leak
  // than any individual bad call.
  const read = readOpponents(table, player);
  if (!facingRaise && read.known) {
    need -= Math.min(3, Math.max(0, (read.foldFreq - 0.35) * 9));
  }

  need += jitter(0.6);

  const canRaise = legal.canBet || legal.canRaise;
  const pot = table.displayPot();
  const raiseTo = (mult) => {
    const target = Math.round(table.currentBet * mult + pot * 0.35);
    return Math.max(legal.minTo, Math.min(legal.maxTo, target));
  };

  if (score >= need + 4 && canRaise) {
    return { action: legal.canBet ? 'bet' : 'raise', amount: raiseTo(3) };
  }
  if (score >= need + 1.5 && canRaise && Math.random() < 0.5) {
    return { action: legal.canBet ? 'bet' : 'raise', amount: raiseTo(2.5) };
  }
  if (score >= need) {
    if (legal.canCall) return { action: 'call', amount: 0 };
    if (legal.canCheck) return { action: 'check', amount: 0 };
  }
  if (legal.canCheck) return { action: 'check', amount: 0 };

  // Cheap enough to see a flop with a hand that can flop something big.
  if (legal.canCall && legal.callAmount <= table.bigBlind && score >= need - 2) {
    return { action: 'call', amount: 0 };
  }
  return { action: 'fold', amount: 0 };
}

/**
 * Pick an action for `player`. Returns `{action, amount}` ready for Table.act.
 * Always returns something legal — when in doubt it checks, never folds free.
 */
export function decide(table, player) {
  const legal = table.legalActions(player);
  if (!legal) return { action: 'check', amount: 0 };

  const style = BOT_STYLES[player.botStyle] || BOT_STYLES.shark;

  if (table.community.length === 0) return preflop(table, player, legal, style);

  const opponents = table.live().filter((p) => p !== player);
  const ranges = opponents.map((o) => opponentRange(table, o, style));
  const pot = table.displayPot();
  const toCall = legal.callAmount;

  const eq = equity(player.cards, table.community, ranges, 260) + jitter();
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  const canRaise = legal.canBet || legal.canRaise;
  const behind = playersBehind(table, player);
  // Position: with nobody left to act we can bet thinner and bluff more.
  const positional = behind === 0 ? 0.04 : 0;

  const read = readOpponents(table, player);
  // Someone who folds a lot should be bet at more often.
  const stealBonus = read.known ? Math.max(0, (read.foldFreq - 0.35) * 0.9) : 0;
  // Someone who raises a lot is bluffing some of it, so call down lighter.
  const callMargin = read.known
    ? style.callMargin * Math.max(0.6, 1 - Math.max(0, read.raiseFreq - 0.15) * 1.6)
    : style.callMargin;

  const raiseTo = (fraction) => {
    // The sharp styles vary their sizing so it reveals less.
    const spread = style.sharpRead ? fraction * (0.8 + Math.random() * 0.45) : fraction;
    const target = Math.round(table.currentBet + (pot + toCall) * spread);
    return Math.max(legal.minTo, Math.min(legal.maxTo, target));
  };

  // --- nobody has bet ------------------------------------------------------
  if (legal.canCheck) {
    const strong = eq > style.valueAt - positional;
    // Bluffing only works against few opponents who are able to fold.
    const foldable = opponents.filter((o) => !o.allIn).length;
    const bluffOdds = style.bluff * (foldable <= 2 ? 1 : 0.3) + positional + stealBonus;
    const bluffing = !strong && eq > 0.2 && Math.random() < bluffOdds;

    if (canRaise && (strong || bluffing)) {
      return {
        action: legal.canBet ? 'bet' : 'raise',
        amount: raiseTo(strong ? style.sizing : style.sizing * 0.65),
      };
    }
    return { action: 'check', amount: 0 };
  }

  // --- facing a bet --------------------------------------------------------
  if (canRaise && eq > style.raiseAt - positional) {
    const target = raiseTo(style.sizing + 0.25);
    const leftOver = legal.maxTo - target;
    // Don't raise to leave a token stack behind; just commit.
    return { action: 'raise', amount: leftOver < table.bigBlind * 2 ? legal.maxTo : target };
  }

  if (eq >= potOdds * callMargin && legal.canCall) {
    return { action: 'call', amount: 0 };
  }

  // A small enough price is worth paying with any real equity.
  if (legal.canCall && toCall <= Math.max(table.bigBlind, pot * 0.06) && eq > 0.28) {
    return { action: 'call', amount: 0 };
  }

  return { action: 'fold', amount: 0 };
}
