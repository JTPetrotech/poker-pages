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

export const PACK_PRICE = 5000;

export const PACKS = [
  { id: 'cosmic', name: 'Cosmic', blurb: 'Deep space.' },
  { id: 'car', name: 'Cars', blurb: 'Things that go.' },
  { id: 'food', name: 'Food', blurb: 'Worth the trip.' },
  { id: 'sport', name: 'Sport', blurb: 'Game day.' },
  { id: 'weather', name: 'Weather', blurb: 'What the sky is doing.' },
  { id: 'arcade', name: 'Arcade', blurb: 'Quarters not included.' },
  {
    id: 'limited',
    name: 'Limited',
    stated: true,
    blurb: 'Fixed odds, and they are harsh. 98 opens in 100 are Bad. Milk and '
      + 'the Supra are 1 in 100 each, and this pack does not skip what you '
      + 'already own — so once you have Bad, and you will almost at once, '
      + 'those 98 opens give you a duplicate and nothing else. Reckon on '
      + 'around 250,000 chips before either rare one turns up.',
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

  { id: 'storm', name: 'Storm', pack: 'weather', rarity: 'common' },
  { id: 'sunny', name: 'Sunshine', pack: 'weather', rarity: 'common' },
  { id: 'rain', name: 'Rain', pack: 'weather', rarity: 'rare' },
  { id: 'snow', name: 'Snow', pack: 'weather', rarity: 'legendary' },
  { id: 'aurora', name: 'Aurora', pack: 'weather', rarity: 'ultra' },

  { id: 'pixel', name: 'Pixels', pack: 'arcade', rarity: 'common' },
  { id: 'stick', name: 'Joystick', pack: 'arcade', rarity: 'common' },
  { id: 'cart', name: 'Cartridge', pack: 'arcade', rarity: 'rare' },
  { id: 'boss', name: 'Boss Fight', pack: 'arcade', rarity: 'legendary' },
  { id: 'invader', name: 'Invader', pack: 'arcade', rarity: 'ultra' },

  // Limited draws on stated odds rather than on what you are missing, so
  // these three carry their own chances and they must add up to one.
  { id: 'bad', name: 'Bad', pack: 'limited', rarity: 'common', odds: 0.98 },
  { id: 'milk', name: 'Milk', pack: 'limited', rarity: 'milk', odds: 0.01 },
  { id: 'supra', name: 'Supra MK4', pack: 'limited', rarity: 'ultra', odds: 0.01 },
];

/** Shown on the tiles, rarest last. Milk is above ultra and is not sold. */
export const RARITIES = ['common', 'rare', 'legendary', 'ultra', 'milk'];

/**
 * Chip skins: what the chips themselves look like, as opposed to the card
 * backs above. Bought from their own pack and kept in their own list, so a
 * chip skin never takes a card skin's place in the backup code.
 *
 * Several of them move. The stylesheet stops every one of them for anyone
 * who has asked their device for less motion.
 */
export const CHIP_PACK = {
  id: 'chipskins',
  name: 'Chips',
  blurb: 'What your chips look like, on your bets and on every other screen '
    + 'at the table. Most of them move; every one of them holds still for '
    + 'anyone whose device asks for less motion.',
};

export const CHIP_SKINS = [
  { id: 'pink', name: 'Pink', rarity: 'free' },
  { id: 'triangle', name: 'Triangle', rarity: 'common' },
  { id: 'dashes', name: 'Spinner', rarity: 'common' },
  { id: 'pulse', name: 'Pulse', rarity: 'rare' },
  { id: 'neon', name: 'Neon', rarity: 'legendary' },
  { id: 'prism', name: 'Prism', rarity: 'ultra' },
  { id: 'bucket', name: 'Bucket', rarity: 'common' },
  { id: 'vinyl', name: 'Vinyl', rarity: 'common' },
  { id: 'candy', name: 'Candy', rarity: 'common' },
  { id: 'target', name: 'Target', rarity: 'common' },
  { id: 'melon', name: 'Watermelon', rarity: 'rare' },
  { id: 'ice', name: 'Ice', rarity: 'rare' },
  { id: 'lava', name: 'Lava', rarity: 'legendary' },
  { id: 'galaxy', name: 'Galaxy', rarity: 'ultra' },
  { id: 'eight', name: 'Eight Ball', rarity: 'ultra' },
  { id: 'coin', name: 'Coin', rarity: 'common' },
  { id: 'clover', name: 'Clover', rarity: 'common' },
  { id: 'steel', name: 'Steel', rarity: 'rare' },
  { id: 'nova', name: 'Nova', rarity: 'legendary' },
  { id: 'void', name: 'Void', rarity: 'ultra' },
];

/**
 * What a claim code hands over. Scanning one is the only route to anything
 * marked `claim`, so these skins sit outside the shop entirely.
 */
export const CLAIMS = {
  // Card skins only. There is no Milk chip: the code and the chip shop are
  // separate things, and this one is about the cards.
  'MILK-714': {
    name: 'the Milk card skin',
    decks: ['milk'],
    chips: [],
  },
};

export const CHIP_IDS = CHIP_SKINS.map((c) => c.id);
export const FREE_CHIP = 'pink';

const CHIP_BY_ID = new Map(CHIP_SKINS.map((c) => [c.id, c]));

export function chipById(id) {
  return CHIP_BY_ID.get(id) || null;
}

/** A chip skin anyone may safely be handed, however odd the id that arrived. */
export function safeChip(id) {
  return CHIP_BY_ID.has(id) ? id : FREE_CHIP;
}

/** The chip skins the pack can give you: not the free one, not claim-only. */
export function chipPackContents() {
  return CHIP_SKINS.filter((c) => c.id !== FREE_CHIP && !c.claim);
}

/** Draw a chip skin you do not have, the way a themed pack does. */
export function drawChip(owned, roll = Math.random()) {
  const pool = chipPackContents().filter((c) => !owned.includes(c.id));
  if (!pool.length) return null;
  return pick(pool, roll);
}

/**
 * Look up a claim code the way someone might type it: any capitalisation,
 * with or without the dash. Scanning one is exact; typing one is not.
 */
export function findClaim(text) {
  const want = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!want) return null;
  for (const [code, claim] of Object.entries(CLAIMS)) {
    if (code.replace(/[^0-9A-Z]/g, '') === want) return claim;
  }
  return null;
}

/** Every skin a claim code gives away, so a tile can say it costs nothing. */
export function claimable(kind) {
  const out = new Set();
  for (const claim of Object.values(CLAIMS)) {
    for (const id of claim[kind]) out.add(id);
  }
  return out;
}

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
 * How often each rarity comes up.
 *
 * A themed pack never hands over a design you already have, so these decide
 * the order you collect a pack in rather than whether a purchase is wasted.
 * Skewed hard towards the commons, so the ultra rare is now almost always
 * the last thing a pack gives up instead of a lucky second open.
 */
// Milk is never drawn from a pack, but a weight keeps the sums honest if
// one ever ends up in a pool by mistake.
const WEIGHT = { common: 40, rare: 10, legendary: 3, ultra: 1, milk: 1 };

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

