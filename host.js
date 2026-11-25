import { Table } from './engine/game.js?v=mwvg4vrz';
import { decide, BOT_STYLES, BOT_NAMES } from './bot.js?v=mwvg4vrz';
import { safeDeck, safeChip, deckById, chipById, DECKS, CHIP_SKINS } from './decks.js?v=mwvg4vrz';

export const ACTION_TIMEOUT_MS = 45_000;

/**
 * The blind ladder, as multiples of the table's opening small blind.
 *
 * Roughly a half-step each level rather than a doubling, so a tournament
 * tightens steadily instead of lurching. The last rung repeats forever,
 * which is what stops a long heads-up going on all night.
 */
const BLIND_LADDER = [1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500, 800, 1200];

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}
const HANDOVER_DELAY_MS = 6_000;
const IDLE_START_DELAY_MS = 3_000;

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * How long a picture may be as the data URL that carries it: about 90KB of
 * image once the base64 is undone.
 *
 * It goes over the same data channel as the cards, and it is only ever shown
 * at thumbnail size or turned into a 132x186 card back, so there is nothing
 * to be had from more.
 */
export const PIC_MAX = 120_000;

// Only the formats a browser decodes as a plain bitmap. SVG is deliberately
// not among them: it is a document rather than a picture, and this one is
// about to be put on somebody else's screen.
const PIC_SHAPE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A picture that is safe to show, or null. Anything else is not a picture. */
export function safePic(value) {
  const pic = typeof value === 'string' ? value : '';
  if (!pic || pic.length > PIC_MAX) return null;
  return PIC_SHAPE.test(pic) ? pic : null;
}

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || 'Player';
}

/**
 * Runs a table inside the host player's browser. This is the Node server's
 * room logic, minus the sockets: `deliver(token, msg)` is handed in, so the
 * host's own messages go straight to its UI while everyone else's go over
 * WebRTC.
 */
export class TableHost {
  constructor({ code, options = {}, deliver, onIdea = null }) {
    this.code = code;
    this.deliver = deliver;
    // Where a suggestion goes once it reaches the host: the host's own
    // screen, since there is no server for it to be filed with.
    this.onIdea = onIdea;
    this.members = new Set();   // tokens currently attached
    this.startAt = 0;
    this.lastActingKey = '';
    this.timer = null;
    this.botActAt = 0;   // bots pause before acting so hands stay readable
    this.botSeq = 0;

    const smallBlind = clampInt(options.smallBlind, 1, 1_000_000, 5);
    let bigBlind = clampInt(options.bigBlind, 2, 2_000_000, 10);
    if (bigBlind <= smallBlind) bigBlind = smallBlind * 2;

    this.table = new Table({
      id: code,
      smallBlind,
      bigBlind,
      startingStack: clampInt(options.startingStack, 20, 1_000_000_000, 1000),
      // Deliberately far beyond anything a play-money game reaches, so the
      // cap is never what stops you moving your own chips about.
      maxBuyIn: clampInt(options.maxBuyIn, 20, 1_000_000_000_000_000, 1_000_000_000_000_000),
      maxSeats: clampInt(options.maxSeats, 2, 9, 6),
      meanie: options.meanie !== false,
    });
    this.table.minRaise = bigBlind;

    // A tournament is the same poker with three rules bolted on: one stack
    // each, blinds that climb, and you are out when it is gone.
    this.baseBlind = smallBlind;
    this.table.tourney = options.mode === 'tournament' ? {
      on: true,
      level: 0,
      smallBlind,
      bigBlind,
      levelMs: clampInt(options.levelMinutes, 1, 60, 5) * 60_000,
      // Set when the first hand is dealt, not when the table opens: nobody
      // should lose a level waiting for the last player to sit down.
      started: false,
      endsAt: 0,
      entries: 0,
      out: [],
      champion: null,
    } : null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 500);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  config() {
    return {
      smallBlind: this.table.smallBlind,
      bigBlind: this.table.bigBlind,
      startingStack: this.table.startingStack,
      // The client clamps buy-ins and top-ups to this; without it, it guessed
      // ten times the starting stack and silently capped everything there.
      maxBuyIn: this.table.maxBuyIn,
      maxSeats: this.table.maxSeats,
      meanie: this.table.meanie,
      actionTimeoutMs: ACTION_TIMEOUT_MS,
    };
  }

  broadcastState() {
    this.drainEvents();
    const now = Date.now();
    for (const token of this.members) {
      this.deliver(token, { t: 'state', now, state: this.table.snapshot(token) });
    }
  }

  /** Deliver per-player notices the table raised, then clear them. */
  drainEvents() {
    const { events } = this.table;
    while (events.length) {
      const e = events.shift();
      if (e.type === 'added') this.deliver(e.id, { t: 'added', amount: e.amount });
      else if (e.type === 'queued') this.deliver(e.id, { t: 'queued', amount: e.amount });
      else this.deliver(e.id, { t: e.type, amount: e.amount, who: e.who });
    }
  }

  broadcast(msg) {
    for (const token of this.members) this.deliver(token, msg);
  }

  handle(token, msg) {
    try {
      this.#handle(token, msg);
    } catch (err) {
      this.deliver(token, { t: 'error', message: err.message || 'Something went wrong.' });
    }
  }

  #handle(token, msg) {
    const { table } = this;

    if (msg.t === 'hello') {
      this.members.add(token);
      const name = cleanName(msg.name);
      const existing = table.playerById(token);
      if (existing) {
        existing.disconnected = false;
        existing.sitOut = false;
        existing.name = name;
        table.pushLog(`${name} reconnected.`);
      }
      if (!table.hostId) table.hostId = token;
      this.deliver(token, { t: 'joined', token, code: this.code, name, config: this.config() });
      this.broadcastState();
      return;
    }

    if (!this.members.has(token)) return;

    switch (msg.t) {
      case 'sit':
        if (this.#tourneyRunning()) {
          throw new Error('The tournament has started. Watch this one out, or open another table.');
        }
        table.sit(token, cleanName(msg.name), clampInt(msg.seat, 0, table.maxSeats - 1, 0), {
          // One stack each, the same for everybody. That is most of what
          // makes a tournament a tournament.
          buyIn: table.tourney ? table.startingStack : (Number(msg.buyIn) || table.startingStack),
          deck: safeDeck(msg.deck),
          chip: safeChip(msg.chip),
        });
        this.#scheduleStart(IDLE_START_DELAY_MS);
        break;
      // A card back becomes a CSS class on everyone else's screen, so an id
      // that is not in the catalogue turns into Classic rather than being
      // passed along.
      case 'deck':
        table.setDeck(token, safeDeck(msg.deck));
        break;
      case 'chip':
        table.setChip(token, safeChip(msg.chip));
        break;
      // Passing a spare skin to somebody else at the table. The table does
      // not know who owns what — collections live in each player's own
      // browser — so this only carries the offer across. The sender takes
      // the spare out of their own vault when the confirmation comes back,
      // which is why a gift this refuses costs nothing.
      case 'gift': {
        const from = table.playerById(token);
        if (!from) throw new Error('Sit down before giving anything away.');
        const seat = clampInt(msg.seat, 0, table.maxSeats - 1, -1);
        const to = table.seats[seat];
        if (!to) throw new Error('Nobody is sitting there.');
        if (to === from) throw new Error('That is your own seat.');
        if (to.bot) throw new Error('A computer player has no use for it.');
        const kind = msg.kind === 'chip' ? 'chip' : 'deck';
        const id = String(msg.id || '');
        const skin = kind === 'chip' ? chipById(id) : deckById(id);
        if (!skin) throw new Error('That is not a skin.');
        this.deliver(to.id, { t: 'gifted', kind, id, name: skin.name, from: from.name });
        this.deliver(from.id, { t: 'giftsent', kind, id, name: skin.name, to: to.name });
        table.pushLog(`${from.name} gave ${to.name} a skin.`);
        break;
      }
      // Chips out of one vault and into another, which is a different thing
      // from 'transfer': that moves stacks that are on the table, while this
      // never touches the game. The table only carries the message, because
      // a vault lives in its own browser and no stack changes size here.
      case 'giftchips': {
        const from = table.playerById(token);
        if (!from) throw new Error('Sit down before giving anything away.');
        const seat = clampInt(msg.seat, 0, table.maxSeats - 1, -1);
        const to = table.seats[seat];
        if (!to) throw new Error('Nobody is sitting there.');
        if (to === from) throw new Error('That is your own seat.');
        if (to.bot) throw new Error('A computer player has no use for them.');
        const amount = Math.floor(Number(msg.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('Enter an amount to send.');
        }
        this.deliver(to.id, { t: 'gotchips', amount, from: from.name });
        this.deliver(from.id, { t: 'chipssent', amount, to: to.name });
        table.pushLog(`${from.name} sent ${to.name} chips from their vault.`);
        break;
      }
      case 'stand': {
        // Tell them what they're walking away with, so it reaches their vault.
        const seated = table.playerById(token);
        const cashOut = seated ? seated.chips : 0;
        // Walking out of a tournament is still a finish, and it takes the
        // place you would have had. The chips go home with them: there is no
        // server here to hold a prize pool, and chips nobody can reach would
        // just vanish from the game.
        if (seated && this.#tourneyRunning()) {
          const t = table.tourney;
          const place = table.players().length;
          t.out.push({ name: seated.name, place });
          table.pushLog(`${seated.name} walked away, out in ${ordinal(place)}.`);
        }
        table.stand(token);
        this.deliver(token, { t: 'cashout', amount: cashOut });
        break;
      }
      case 'addbot':
        this.#addBot(msg.style, clampInt(msg.seat, 0, table.maxSeats - 1, 0));
        this.#scheduleStart(IDLE_START_DELAY_MS);
        break;
      case 'removebot': {
        const seat = clampInt(msg.seat, 0, table.maxSeats - 1, 0);
        const who = table.seats[seat];
        if (!who) break;
        // Anyone may clear a bot they added; only the host may remove a
        // person, since that decides who is allowed at their table.
        if (!who.bot && token !== table.hostId) {
          throw new Error('Only the host can remove a player.');
        }
        if (who === table.playerById(token)) {
          throw new Error('Use Leave to get up yourself.');
        }
        if (!who.bot) {
          // Send their chips home before the seat goes, or they would have to
          // wait for the stranded-chips recovery to notice.
          this.deliver(who.id, { t: 'cashout', amount: who.chips });
          this.deliver(who.id, { t: 'error', message: 'The host removed you from the table.' });
        }
        table.stand(who.id);
        break;
      }
      case 'action':
        table.act(token, String(msg.action), Number(msg.amount) || 0);
        break;
      // Everything that moves chips on or off the table is a cash-game
      // thing. In a tournament you play the stack you bought in with, and
      // the only way to get more is to win them.
      case 'rebuy':
        if (table.tourney) throw new Error('No rebuys — one stack each, and you play it.');
        table.rebuy(token, Number(msg.amount) || table.startingStack);
        this.#scheduleStart(IDLE_START_DELAY_MS);
        break;
      case 'addchips':
        if (table.tourney) throw new Error('No topping up in a tournament.');
        table.addChips(token, msg.amount);
        break;
      case 'removechips':
        if (table.tourney) throw new Error('Chips stay on the table until you are out.');
        table.removeChips(token, msg.amount);
        break;
      case 'take':
        if (table.tourney) throw new Error('Not in a tournament.');
        table.seizeChips(token, clampInt(msg.fromSeat, 0, table.maxSeats - 1, 0), msg.amount);
        break;
      case 'transfer':
        if (table.tourney) throw new Error('Not in a tournament.');
        table.transferChips(token, clampInt(msg.toSeat, 0, table.maxSeats - 1, 0), msg.amount);
        break;
      case 'sitout':
        table.setSitOut(token, !!msg.value);
        break;
      case 'start':
        if (table.stage === 'idle' || table.stage === 'handover') this.#scheduleStart(0);
        break;
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 200);
        if (!text) return;
        const p = table.playerById(token);
        this.broadcast({ t: 'chat', from: p ? p.name : 'spectator', text, at: Date.now() });
        return;
      }
      // A suggestion goes to the host alone rather than to the table: it is
      // for whoever can act on it, and it is not a thing to be shouted.
      case 'idea': {
        const text = String(msg.text || '').trim().slice(0, 400);
        // A picture on its own is a suggestion too: "make this a skin" does
        // not need any words to go with it.
        const pic = safePic(msg.pic);
        if (!text && !pic) return;
        // Seated, they are whoever is in that seat; standing in the lobby,
        // they are whatever name they gave, since there is no seat to ask.
        const p = table.playerById(token);
        const from = p ? p.name : cleanName(msg.name || 'spectator');
        this.onIdea?.({ from, text, pic, at: Date.now() });
        this.deliver(token, { t: 'ideaok', id: String(msg.id || '').slice(0, 40) });
        return;
      }
      default:
        return;
    }

    if (table.stage === 'handover') this.#scheduleStart(HANDOVER_DELAY_MS);
    this.broadcastState();
  }

  /** A guest's connection dropped: sit them out but keep the seat warm. */
  disconnect(token) {
    this.members.delete(token);
    const p = this.table.playerById(token);
    if (p) {
      p.disconnected = true;
      p.sitOut = true;
      this.table.pushLog(`${p.name} disconnected.`);
    }
    this.broadcastState();
  }

  #addBot(styleKey, seat) {
    const { table } = this;
    if (table.seats[seat]) throw new Error('That seat is taken.');
    const style = BOT_STYLES[styleKey] ? styleKey : 'shark';
    const taken = new Set(table.players().map((p) => p.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) || `Bot${++this.botSeq}`;
    const id = `bot:${seat}:${++this.botSeq}`;
    // Give each computer player a card back nobody at the table is already
    // using, so you can tell whose cards are whose at a glance. Once the
    // catalogue runs out they start repeating, which only happens at a table
    // fuller than the game allows.
    const worn = new Set(table.players().map((p) => p.deck));
    const free = DECKS.filter((d) => !worn.has(d.id));
    const pool = free.length ? free : DECKS;
    const deck = pool[(seat * 3 + this.botSeq) % pool.length].id;
    const chip = CHIP_SKINS[(seat * 2 + this.botSeq) % CHIP_SKINS.length].id;
    table.sit(id, name, seat, {
      bot: true, botStyle: style, buyIn: table.startingStack, deck, chip,
    });
  }

  /** Let a bot act once its thinking pause is up. */
  #runBot(now) {
    const { table } = this;
    if (!table.inHandStage() || table.actingSeat < 0) return false;
    const p = table.seats[table.actingSeat];
    if (!p || !p.bot) return false;
    if (now < this.botActAt) return false;

    let move;
    try {
      move = decide(table, p);
    } catch {
      move = { action: 'check', amount: 0 };
    }
    try {
      table.act(p.id, move.action, move.amount);
    } catch {
      // Whatever it wanted was not legal after all — do the safe thing.
      try {
        const legal = table.legalActions(p);
        table.act(p.id, legal && legal.canCheck ? 'check' : 'fold');
      } catch { /* the hand moved on without us */ }
    }
    return true;
  }

  #scheduleStart(delay) {
    const { table } = this;
    if (table.inHandStage()) return;
    if (table.eligibleForHand().length < 2) {
      this.startAt = 0;
      return;
    }
    const at = Date.now() + delay;
    if (!this.startAt || at < this.startAt) this.startAt = at;
  }

  /** The blinds at a given level, from the ladder above. */
  #blindsFor(level) {
    const step = BLIND_LADDER[Math.min(level, BLIND_LADDER.length - 1)];
    const sb = this.baseBlind * step;
    return { sb, bb: sb * 2 };
  }

  /**
   * The tournament clock. Returns true when something changed.
   *
   * Blinds only ever go up between hands. Putting them up mid-pot would
   * change the price of a bet somebody has already decided to call.
   */
  #tourneyTick(now) {
    const t = this.table.tourney;
    if (!t || !t.on || t.champion) return false;
    const { table } = this;

    if (!t.started) {
      if (table.handNo === 0) return false;
      t.started = true;
      t.entries = table.players().length;
      t.endsAt = now + t.levelMs;
      table.pushLog(`Tournament under way — ${t.entries} players, ${t.smallBlind}/${t.bigBlind}.`);
      return true;
    }

    if (now < t.endsAt || table.inHandStage()) return false;

    t.level++;
    const { sb, bb } = this.#blindsFor(t.level);
    table.smallBlind = sb;
    table.bigBlind = bb;
    table.minRaise = bb;
    t.smallBlind = sb;
    t.bigBlind = bb;
    t.endsAt = now + t.levelMs;
    table.pushLog(`Level ${t.level + 1} — blinds ${sb}/${bb}.`);
    return true;
  }

  /**
   * Everyone with nothing left is out, and is told where they finished.
   *
   * Places count up from the bottom, so the first out of six finishes
   * sixth. Two busting on the same hand both take the lower place, which is
   * the kind reading and saves comparing who started the hand shorter.
   */
  #tourneyBust() {
    const t = this.table.tourney;
    if (!t || !t.on || !t.started || t.champion) return false;
    const { table } = this;
    const broke = table.players().filter((p) => p.chips <= 0);
    if (!broke.length) return false;

    const seated = table.players().length;
    broke.forEach((p, i) => {
      const place = seated - i;
      t.out.push({ name: p.name, place });
      table.pushLog(`${p.name} is out in ${ordinal(place)}.`);
      if (!p.bot) {
        this.deliver(p.id, { t: 'knockedout', place, of: t.entries });
        // Nothing to bank, but it has to be said, or their own browser goes
        // on believing there are chips of theirs stranded at this table.
        this.deliver(p.id, { t: 'cashout', amount: 0 });
      }
      table.stand(p.id);
    });

    const left = table.players();
    if (left.length === 1 && t.entries > 1) {
      const won = left[0];
      t.champion = { name: won.name, chips: won.chips };
      table.pushLog(`${won.name} wins it, with all ${won.chips} chips.`);
      if (!won.bot) this.deliver(won.id, { t: 'wontourney', chips: won.chips, of: t.entries });
    }
    return true;
  }

  /** True while a tournament is being played, rather than set up or over. */
  #tourneyRunning() {
    const t = this.table.tourney;
    return !!(t && t.on && t.started && !t.champion);
  }

  tick() {
    const { table } = this;
    const now = Date.now();
    let dirty = false;
    if (this.#tourneyTick(now)) dirty = true;

    const key = `${table.handNo}:${table.stage}:${table.actingSeat}`;
    if (table.inHandStage() && table.actingSeat >= 0) {
      if (key !== this.lastActingKey) {
        this.lastActingKey = key;
        table.actionDeadline = now + ACTION_TIMEOUT_MS;
        const acting = table.seats[table.actingSeat];
        // A beat of "thought" so the table doesn't snap through hands.
        this.botActAt = acting && acting.bot ? now + 700 + Math.random() * 900 : 0;
        dirty = true;
      } else if (this.#runBot(now)) {
        dirty = true;
      } else if (now > table.actionDeadline) {
        try {
          table.timeoutAct();
        } catch { /* the hand moved on; next tick re-reads state */ }
        dirty = true;
      }
    } else if (this.lastActingKey) {
      this.lastActingKey = '';
      table.actionDeadline = 0;
    }

    if (table.stage === 'handover' && !this.startAt) {
      if (this.#tourneyBust()) dirty = true;
      this.#scheduleStart(HANDOVER_DELAY_MS);
    }

    if (this.startAt && now >= this.startAt && !table.inHandStage()) {
      this.startAt = 0;
      if (table.eligibleForHand().length >= 2) {
        table.startHand();
        dirty = true;
      } else if (table.stage !== 'idle') {
        table.stage = 'idle';
        dirty = true;
      }
    }

    if (dirty) this.broadcastState();
  }
}
