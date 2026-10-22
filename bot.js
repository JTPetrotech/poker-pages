import { makeDeck } from './engine/cards.js?v=mvis3p31';
import { bestHand, compareScores } from './engine/hand.js?v=mvis3p31';

/**
 * Computer opponents.
 *
 * Rather than scripting "raise with aces", each bot estimates how often its
 * hand actually wins by dealing out the rest of the board and the opponents'
 * cards a few hundred times. That number is then weighed against the pot odds
 * it's being offered, which is the real decision in poker.
 */

export const BOT_STYLES = {
  rock: {
    key: 'rock',
    label: 'Cautious',
    // Needs a clear edge to put money in, and rarely bluffs.
    valueAt: 0.66,
    raiseAt: 0.84,
    callMargin: 1.18,
    bluff: 0.03,
    sizing: 0.5,
  },
  shark: {
    key: 'shark',
    label: 'Solid',
    valueAt: 0.58,
    raiseAt: 0.78,
    callMargin: 1.0,
    bluff: 0.1,
    sizing: 0.65,
  },
  maniac: {
    key: 'maniac',
    label: 'Wild',
    valueAt: 0.48,
    raiseAt: 0.7,
    callMargin: 0.85,
    bluff: 0.26,
    sizing: 0.85,
  },
};

export const BOT_NAMES = [
  'Ada', 'Boomer', 'Cash', 'Dusty', 'Echo', 'Fox', 'Gus', 'Hazel',
  'Ivy', 'Jett', 'Koko', 'Lefty', 'Mack', 'Nova',
];

/**
 * Share of the pot this hand wins on average, by simulation.
 * A tie counts as half, which is what a split pot is worth.
 */
export function equity(hole, board, opponents, sims = 240) {
  const known = new Set([...hole, ...board]);
  const pool = makeDeck().filter((c) => !known.has(c));
  const toCome = 5 - board.length;
  const need = opponents * 2 + toCome;
  if (need > pool.length) return 0.5;

  let total = 0;
  for (let i = 0; i < sims; i++) {
    // Partial shuffle — only as many cards as this simulation consumes.
    const d = pool.slice();
    for (let j = 0; j < need; j++) {
      const k = j + Math.floor(Math.random() * (d.length - j));
      [d[j], d[k]] = [d[k], d[j]];
    }

    let idx = 0;
    const full = board.slice();
    for (let j = 0; j < toCome; j++) full.push(d[idx++]);

    const mine = bestHand([...hole, ...full]).score;
    let tie = false;
    let lost = false;
    for (let o = 0; o < opponents; o++) {
      const theirs = bestHand([d[idx++], d[idx++], ...full]).score;
      const cmp = compareScores(theirs, mine);
      if (cmp > 0) { lost = true; break; }
      if (cmp === 0) tie = true;
    }
    if (lost) continue;
    total += tie ? 0.5 : 1;
  }
  return total / sims;
}

function jitter(scale = 0.04) {
  return (Math.random() - 0.5) * 2 * scale;
}

/**
 * Pick an action for `player`. Returns `{action, amount}` ready for Table.act.
 * Always returns something legal — when in doubt it checks, never folds for free.
 */
export function decide(table, player) {
  const legal = table.legalActions(player);
  if (!legal) return { action: 'check', amount: 0 };

  const style = BOT_STYLES[player.botStyle] || BOT_STYLES.shark;
  const opponents = Math.max(1, table.live().length - 1);
  const pot = table.displayPot();
  const toCall = legal.callAmount;

  // Fewer simulations preflop: six opponents' hole cards is a lot of dealing
  // and the decision is coarser there anyway.
  const sims = table.community.length === 0 ? 160 : 280;
  const eq = equity(player.cards, table.community, opponents, sims) + jitter();

  // The share of the pot we'd need to win for a call to break even.
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  const canRaise = legal.canBet || legal.canRaise;
  const raiseTo = (fraction) => {
    const target = Math.round(table.currentBet + (pot + toCall) * fraction);
    return Math.max(legal.minTo, Math.min(legal.maxTo, target));
  };

  // --- nobody has bet: check or take the lead -----------------------------
  if (legal.canCheck) {
    const strong = eq > style.valueAt;
    const bluffing = !strong && Math.random() < style.bluff;
    if (canRaise && (strong || bluffing)) {
      const size = strong ? style.sizing : style.sizing * 0.6;
      return { action: legal.canBet ? 'bet' : 'raise', amount: raiseTo(size) };
    }
    return { action: 'check', amount: 0 };
  }

  // --- facing a bet -------------------------------------------------------
  if (canRaise && eq > style.raiseAt) {
    // Shove rather than make a raise that leaves a token amount behind.
    const target = raiseTo(style.sizing + 0.25);
    const leftOver = legal.maxTo - target;
    return { action: 'raise', amount: leftOver < table.bigBlind * 2 ? legal.maxTo : target };
  }

  if (eq >= potOdds * style.callMargin && legal.canCall) {
    return { action: 'call', amount: 0 };
  }

  // Calling a tiny bet closes the hand out cheaply; folding here is a leak.
  if (legal.canCall && toCall <= Math.max(table.bigBlind, pot * 0.06) && eq > 0.3) {
    return { action: 'call', amount: 0 };
  }

  return { action: 'fold', amount: 0 };
}
