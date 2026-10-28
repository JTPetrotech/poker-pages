/**
 * The card skin catalogue.
 *
 * Classic is yours from the start. Everything else comes out of a pack bought
 * with chips, and the design you are using travels to the other players, so
 * what you pull is something they actually see.
 *
 * The artwork itself lives in the stylesheet — every id here has a matching
 * `.deck-<id>` rule — so a design is nothing but a name, a pack and a rarity.
 * The host validates against `DECK_IDS` before passing anyone's choice on,
 * because an id becomes a CSS class and nothing from the network is trusted.
 */

export const PACK_PRICE = 1000;

export const PACKS = [
  { id: 'cosmic', name: 'Cosmic', blurb: 'Deep space.' },
  { id: 'car', name: 'Cars', blurb: 'Things that go.' },
  { id: 'food', name: 'Food', blurb: 'Worth the trip.' },
  { id: 'sport', name: 'Sport', blurb: 'Game day.' },
  {
    id: 'limited',
    name: 'Limited',
    stated: true,
    blurb: 'Fixed odds, and they are harsh. 98 opens in 100 are Bad. Milk and '
      + 'the Supra are 1 in 100 each, and this pack does not skip what you '
      + 'already own — so once you have Bad, and you will almost at once, '
      + 'those 98 opens give you a duplicate and nothing else. Reckon on '
      + 'around 50,000 chips before either rare one turns up.',
  },
];

/**
 * Order matters: a design's position here is its bit in the backup code, so
 * new designs go on the end and nothing is ever removed or reordered.
 */
export const DECKS = [
  { id: 'classic', name: 'Classic', pack: null, rarity: 'free' },

  { id: 'planet', name: 'Planet', pack: 'cosmic', rarity: 'common' },
  { id: 'nebula', name: 'Nebula', pack: 'cosmic', rarity: 'common' },
  { id: 'comet', name: 'Comet', pack: 'cosmic', rarity: 'rare' },
  { id: 'rocket', name: 'Rocket', pack: 'cosmic', rarity: 'legendary' },

  { id: 'checker', name: 'Checker', pack: 'car', rarity: 'common' },
  { id: 'taxi', name: 'Taxi', pack: 'car', rarity: 'common' },
  { id: 'hauler', name: 'Hauler', pack: 'car', rarity: 'rare' },
  { id: 'racer', name: 'Racer', pack: 'car', rarity: 'legendary' },

  { id: 'pizza', name: 'Pizza', pack: 'food', rarity: 'common' },
  { id: 'burger', name: 'Burger', pack: 'food', rarity: 'common' },
  { id: 'donut', name: 'Donut', pack: 'food', rarity: 'rare' },
  { id: 'sushi', name: 'Sushi', pack: 'food', rarity: 'legendary' },

  { id: 'pitch', name: 'Pitch', pack: 'sport', rarity: 'common' },
  { id: 'hoops', name: 'Hoops', pack: 'sport', rarity: 'common' },
  { id: 'tennis', name: 'Tennis', pack: 'sport', rarity: 'rare' },
  { id: 'trophy', name: 'Trophy', pack: 'sport', rarity: 'legendary' },

  // One ultra rare in each pack. These four are real pictures rather than a
  // pattern, which is what makes them worth chasing — see tools/make-backs.
  { id: 'galaxy', name: 'Galaxy', pack: 'cosmic', rarity: 'ultra' },
  { id: 'strip', name: 'Night Drive', pack: 'car', rarity: 'ultra' },
  { id: 'melon', name: 'Watermelon', pack: 'food', rarity: 'ultra' },
  { id: 'stadium', name: 'Floodlights', pack: 'sport', rarity: 'ultra' },

  // Retired with the pack it came in. It stays in the list because a skin's
  // place here is its bit in the backup code, and pulling one out would
  // shift every skin after it and make older codes read back as the wrong
  // ones. Anyone who pulled it keeps it, and admin can still hand it out.
  { id: 'jackpot', name: 'Jackpot', pack: null, rarity: 'ultra' },

  // Limited draws on stated odds rather than on what you are missing, so
  // these three carry their own chances and they must add up to one.
  { id: 'bad', name: 'Bad', pack: 'limited', rarity: 'common', odds: 0.98 },
  { id: 'milk', name: 'Milk', pack: 'limited', rarity: 'ultra', odds: 0.01 },
  { id: 'supra', name: 'Supra MK4', pack: 'limited', rarity: 'ultra', odds: 0.01 },
];

/** Shown on the tiles, brightest last. */
export const RARITIES = ['common', 'rare', 'legendary', 'ultra'];

export const DECK_IDS = DECKS.map((d) => d.id);

export const FREE_DECK = 'classic';

const BY_ID = new Map(DECKS.map((d) => [d.id, d]));

export function deckById(id) {
  return BY_ID.get(id) || null;
}

export function packContents(packId) {
  return DECKS.filter((d) => d.pack === packId);
}

/** A design anyone may safely be handed, however odd the id that arrived. */
export function safeDeck(id) {
  return BY_ID.has(id) ? id : FREE_DECK;
}

/**
 * How often each rarity comes up. A pack never hands over a design you
 * already have — every thousand chips buys something new — so these only
 * decide the order you tend to collect a pack in, not whether you waste a
 * purchase.
 */
const WEIGHT = { common: 10, rare: 5, legendary: 2, ultra: 1 };

/**
 * Pull one design out of a pack.
 *
 * `owned` is what you already have, and `roll` is a number in [0, 1) so the
 * draw can be tested without hoping a random one goes the right way. Returns
 * null when the pack holds nothing new.
 */
export function drawFromPack(packId, owned, roll = Math.random()) {
  const pool = packContents(packId).filter((d) => !owned.includes(d.id));
  if (!pool.length) return null;

  return pick(pool, roll);
}

/** Weighted choice from a pool that is already known to be non-empty. */
function pick(pool, roll) {
  const total = pool.reduce((sum, d) => sum + (WEIGHT[d.rarity] || 1), 0);
  let mark = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const d of pool) {
    mark -= WEIGHT[d.rarity] || 1;
    if (mark < 0) return d;
  }
  return pool[pool.length - 1];
}

/**
 * Draw from a pack that advertises its own odds.
 *
 * Unlike the themed packs this does not skip what you already own: 98 in 100
 * really is 98 in 100, every single time, which is the only way those numbers
 * can mean what they say. A repeat is a possible outcome, and the dialog
 * warns about it before you press anything.
 */
export function drawStated(packId, roll = Math.random()) {
  const pool = packContents(packId);
  let mark = Math.min(Math.max(roll, 0), 0.999999);
  for (const d of pool) {
    mark -= d.odds || 0;
    if (mark < 0) return d;
  }
  return pool[pool.length - 1];
}

