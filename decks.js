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

/**
 * What the shop pays for a spare.
 *
 * A pack can hand you something you already have, and the second copy and
 * every one after it is a spare rather than nothing. Twenty of them buy a
 * pack, so an open is never entirely wasted even when it repeats.
 */
export const SPARE_PRICE = 250;

export const PACKS = [
  { id: 'cosmic', name: 'Cosmic', blurb: 'Deep space.' },
  { id: 'car', name: 'Cars', blurb: 'Things that go.' },
  { id: 'food', name: 'Food', blurb: 'Worth the trip.' },
  { id: 'sport', name: 'Sport', blurb: 'Game day.' },
  { id: 'weather', name: 'Weather', blurb: 'What the sky is doing.' },
  { id: 'arcade', name: 'Arcade', blurb: 'Quarters not included.' },
  { id: 'ocean', name: 'Ocean', blurb: 'Down where the light stops.' },
  { id: 'mythic', name: 'Mythic', blurb: 'Old stories.' },
  { id: 'casino', name: 'Casino', blurb: 'The room itself.' },
  { id: 'music', name: 'Music', blurb: 'Turn it up.' },
  {
    id: 'limited',
    name: 'Limited',
    stated: true,
    blurb: 'Fixed odds, and they are harsh. 98 opens in 100 are Bad, and Milk '
      + 'and the Supra are 1 in 100 each — announced numbers rather than the '
      + 'weights the themed packs use, which is what makes this one its own '
      + 'thing. Reckon on around 250,000 chips before either rare one turns '
      + 'up, and on a pile of spare Bads to sell along the way.',
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

  { id: 'wave', name: 'Wave', pack: 'ocean', rarity: 'common' },
  { id: 'shell', name: 'Shell', pack: 'ocean', rarity: 'common' },
  { id: 'reef', name: 'Reef', pack: 'ocean', rarity: 'rare' },
  { id: 'shark', name: 'Shark', pack: 'ocean', rarity: 'legendary' },
  { id: 'deep', name: 'The Deep', pack: 'ocean', rarity: 'ultra' },

  { id: 'orb', name: 'Orb', pack: 'mythic', rarity: 'common' },
  { id: 'potion', name: 'Potion', pack: 'mythic', rarity: 'common' },
  { id: 'scroll', name: 'Scroll', pack: 'mythic', rarity: 'rare' },
  { id: 'crown', name: 'Crown', pack: 'mythic', rarity: 'legendary' },
  { id: 'dragoneye', name: 'Dragon Eye', pack: 'mythic', rarity: 'ultra' },

  // Limited draws on stated odds rather than on what you are missing, so
  // these three carry their own chances and they must add up to one.
  { id: 'bad', name: 'Bad', pack: 'limited', rarity: 'common', odds: 0.98 },
  { id: 'milk', name: 'Milk', pack: 'limited', rarity: 'milk', odds: 0.01 },
  { id: 'supra', name: 'Supra MK4', pack: 'limited', rarity: 'ultra', odds: 0.01 },

  // One milk skin in every themed pack, at a flat one in a thousand opens —
  // rarer than that pack's ultra rare, which is the point of the tier. They
  // share a creamy look so it reads across the table, and each one says
  // which pack it came out of.
  { id: 'milkyway', name: 'Milky Way', pack: 'cosmic', rarity: 'milk' },
  { id: 'milkfloat', name: 'Milk Float', pack: 'car', rarity: 'milk' },
  { id: 'milkshake', name: 'Milkshake', pack: 'food', rarity: 'milk' },
  { id: 'victorymilk', name: 'Victory Milk', pack: 'sport', rarity: 'milk' },
  { id: 'milksky', name: 'Milk Sky', pack: 'weather', rarity: 'milk' },
  { id: 'milktoken', name: 'Milk Token', pack: 'arcade', rarity: 'milk' },
  { id: 'milksea', name: 'Milky Sea', pack: 'ocean', rarity: 'milk' },
  { id: 'moonmilk', name: 'Moon Milk', pack: 'mythic', rarity: 'milk' },

  { id: 'dice', name: 'Dice', pack: 'casino', rarity: 'common' },
  { id: 'wheel', name: 'Roulette', pack: 'casino', rarity: 'common' },
  { id: 'slots', name: 'Slots', pack: 'casino', rarity: 'rare' },
  { id: 'ace', name: 'Ace High', pack: 'casino', rarity: 'legendary' },
  { id: 'highroller', name: 'High Roller', pack: 'casino', rarity: 'ultra' },
  { id: 'milkmoney', name: 'Milk Money', pack: 'casino', rarity: 'milk' },

  // Not 'note': .deck-note is already a class in the stylesheet, and a skin
  // whose id collides with one would paint the shop's own paragraph.
  { id: 'melody', name: 'Melody', pack: 'music', rarity: 'common' },
  { id: 'cassette', name: 'Cassette', pack: 'music', rarity: 'common' },
  { id: 'amp', name: 'Amp', pack: 'music', rarity: 'rare' },
  { id: 'guitar', name: 'Guitar', pack: 'music', rarity: 'legendary' },
  { id: 'encore', name: 'Encore', pack: 'music', rarity: 'ultra' },
  { id: 'milkvinyl', name: 'Milk Mix', pack: 'music', rarity: 'milk' },
];

/**
 * Shown on the tiles, rarest last.
 *
 * Milk is the top tier: one open in two hundred and fifty, against roughly
 * one in a hundred and ninety for an ultra rare. The order here is what the
 * tiles are sorted by, so it has to match the real chances rather than the
 * other way about.
 *
 * Limited is the exception, as it is to everything else: its three carry
 * their own announced odds and Milk is one in a hundred there.
 */
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
    + 'anyone whose device asks for less motion. Eclipse is the ultra rare at '
    + 'about 1 in 190, and Cream is the milk tier above it, at 1 in 250.',
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
  { id: 'copper', name: 'Copper', rarity: 'common' },
  { id: 'mint', name: 'Mint', rarity: 'common' },
  { id: 'honey', name: 'Honey', rarity: 'common' },
  { id: 'cherry', name: 'Cherry', rarity: 'common' },
  { id: 'tide', name: 'Tide', rarity: 'rare' },
  { id: 'storm', name: 'Storm', rarity: 'rare' },
  { id: 'ember', name: 'Ember', rarity: 'legendary' },
  { id: 'royal', name: 'Royal', rarity: 'legendary' },
  // Cream is the chip pack's milk tier, and the rarest thing it sells. It is
  // not the Milk card skin and has nothing to do with the claim code: that
  // one is about the cards alone.
  { id: 'cream', name: 'Cream', rarity: 'milk' },
  { id: 'eclipse', name: 'Eclipse', rarity: 'ultra' },
  { id: 'marble', name: 'Marble', rarity: 'common' },
  { id: 'camo', name: 'Camo', rarity: 'common' },
  { id: 'denim', name: 'Denim', rarity: 'common' },
  { id: 'dusk', name: 'Dusk', rarity: 'common' },
  { id: 'jade', name: 'Jade', rarity: 'rare' },
  { id: 'circuit', name: 'Circuit', rarity: 'rare' },
  { id: 'plasma', name: 'Plasma', rarity: 'legendary' },
  { id: 'tiger', name: 'Tiger', rarity: 'legendary' },
  { id: 'quasar', name: 'Quasar', rarity: 'ultra' },
  { id: 'mirror', name: 'Mirror', rarity: 'ultra' },
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

/** Draw a chip skin, the way a themed pack does. */
export function drawChip(roll = Math.random()) {
  return drawWithMilk(chipPackContents(), roll);
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
 * A pack draws from everything it holds, whether or not you have it already,
 * so these are the real chances of every open rather than an ordering.
 * Skewed hard towards the commons: an ultra rare is about one open in a
 * hundred and ninety, twice as hard as the one in ninety-four it started at.
 * It cannot go further without passing the milk skin above it, which is a
 * flat one in two hundred and fifty.
 */
// Milk is taken off the top by MILK_CHANCE and never reaches these weights,
// but one is kept here so a pool that somehow holds a milk skin still draws.
const WEIGHT = { common: 40, rare: 10, legendary: 3, ultra: 0.5, milk: 0.5 };

/**
 * The chance of the milk tier, per open, in every pack and in the chip pack.
 *
 * A flat one in two hundred and fifty rather than a weight, so it means the
 * same thing on every open. Everything else shares the remainder by weight,
 * which is where the ultra rare comes from at about one in a hundred and
 * ninety — so milk stays the rarest thing in any pack, which is what the
 * tier is for. Limited keeps its own announced odds and is untouched.
 */
export const MILK_CHANCE = 0.004;

/**
 * Draw from a pool where the milk tier gets its flat chance off the top.
 *
 * `roll` is rescaled rather than re-rolled, so one number still decides the
 * whole draw and the odds can be checked exactly. A pool with no milk skin
 * in it at all gives the whole chance back to the rest.
 */
function drawWithMilk(pool, roll) {
  if (!pool.length) return null;
  const milk = pool.filter((d) => d.rarity === 'milk');
  const rest = pool.filter((d) => d.rarity !== 'milk');
  const r = Math.min(Math.max(roll, 0), 0.999999);
  if (!rest.length) return pick(milk, r);
  if (!milk.length) return pick(rest, r);
  if (r < MILK_CHANCE) return pick(milk, r / MILK_CHANCE);
  return pick(rest, (r - MILK_CHANCE) / (1 - MILK_CHANCE));
}

/**
 * Pull one design out of a pack.
 *
 * Every open draws from the whole pack, so it can hand you something you
 * already have — that copy becomes a spare the shop will buy back. `roll` is
 * a number in [0, 1) so a draw can be tested without hoping a random one
 * goes the right way.
 */
export function drawFromPack(packId, roll = Math.random()) {
  return drawWithMilk(packContents(packId), roll);
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

