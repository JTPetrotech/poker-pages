import { cardValue, cardSuit, RANK_NAMES, RANK_PLURALS } from './cards.js?v=mvlhciz3';

export const CATEGORIES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

/**
 * Score exactly five cards. Returns a comparable array:
 * [category, ...tiebreakers] — compare lexicographically, bigger wins.
 */
export function score5(cards) {
  const vals = cards.map(cardValue).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  // Groups ordered by how many of that rank, then by rank — so groups[0] is
  // always the most significant set (the quads, the trips, the top pair).
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const g = groups.map((e) => e[0]);

  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // the wheel, A-2-3-4-5
  }

  if (isFlush && straightHigh) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, g[0], g[1]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, g[0], g[1]];
  if (isFlush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, g[0], g[1], g[2]];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, g[0], g[1], g[2]];
  if (groups[0][1] === 2) return [1, g[0], g[1], g[2], g[3]];
  return [0, ...vals];
}

export function compareScores(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function combinations5(cards) {
  const out = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return out;
}

/**
 * Best five-card hand out of five, six or seven cards.
 * Returns { score, cards, name }.
 */
export function bestHand(cards) {
  if (cards.length < 5) throw new Error(`need at least 5 cards, got ${cards.length}`);
  let best = null;
  for (const combo of combinations5(cards)) {
    const score = score5(combo);
    if (!best || compareScores(score, best.score) > 0) best = { score, cards: combo };
  }
  return { ...best, name: describe(best.score) };
}

export function describe(score) {
  const [cat, a, b] = score;
  switch (cat) {
    case 8:
      return a === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[a]} high`;
    case 7: return `Four of a Kind, ${RANK_PLURALS[a]}`;
    case 6: return `Full House, ${RANK_PLURALS[a]} over ${RANK_PLURALS[b]}`;
    case 5: return `Flush, ${RANK_NAMES[a]} high`;
    case 4: return `Straight, ${RANK_NAMES[a]} high`;
    case 3: return `Three of a Kind, ${RANK_PLURALS[a]}`;
    case 2: return `Two Pair, ${RANK_PLURALS[a]} and ${RANK_PLURALS[b]}`;
    case 1: return `Pair of ${RANK_PLURALS[a]}`;
    default: return `${RANK_NAMES[a]} high`;
  }
}
