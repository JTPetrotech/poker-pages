import { makeDeck, shuffle } from './cards.js?v=mvri0yrc';
import { bestHand, compareScores } from './hand.js?v=mvri0yrc';

export const STAGES = ['idle', 'preflop', 'flop', 'turn', 'river', 'showdown', 'handover'];

const STREET_AFTER = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown' };

/**
 * One poker table. Fully authoritative: the server owns the deck and every
 * chip. Clients only ever send intents (`fold`, `call`, `raise`) which this
 * class validates.
 */
export class Table {
  constructor(opts = {}) {
    this.id = opts.id || 'TABLE';
    this.smallBlind = opts.smallBlind ?? 5;
    this.bigBlind = opts.bigBlind ?? 10;
    this.startingStack = opts.startingStack ?? 1000;
    // A cap stops anyone sitting down with an absurd stack from their vault.
    this.maxBuyIn = opts.maxBuyIn ?? this.startingStack * 10;
    this.maxSeats = opts.maxSeats ?? 9;
    this.hostId = opts.hostId || null;
    // Meanie: running out of time shoves your stack instead of folding it.
    this.meanie = opts.meanie !== false;

    this.seats = new Array(this.maxSeats).fill(null);
    this.handNo = 0;
    this.stage = 'idle';
    this.button = -1;
    this.deck = [];
    this.community = [];
    this.potTotal = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.actingSeat = -1;
    this.lastAggressorSeat = -1;
    this.results = null;
    this.pots = [];
    this.log = [];
    // Things worth telling a specific player about, drained by the host.
    this.events = [];
    this.actionDeadline = 0;
  }

  // ---------------------------------------------------------------- players

  players() {
    return this.seats.filter(Boolean);
  }

  playerById(id) {
    return this.seats.find((p) => p && p.id === id) || null;
  }

  /** Players dealt into the current hand who haven't folded. */
  live() {
    return this.players().filter((p) => p.inHand && !p.folded);
  }

  /** Live players who still have chips behind, i.e. can still be asked to act. */
  actors() {
    return this.live().filter((p) => !p.allIn);
  }

  eligibleForHand() {
    return this.players().filter((p) => p.chips > 0 && !p.sitOut);
  }

  sit(id, name, seat, opts = {}) {
    if (seat < 0 || seat >= this.maxSeats) throw new Error('No such seat.');
    if (this.seats[seat]) throw new Error('That seat is taken.');
    const existing = this.playerById(id);
    if (existing) throw new Error('You are already seated.');
    // Players bring their own buy-in from their vault; the table only enforces
    // that it sits between one big blind and the table maximum.
    const requested = Number(opts.buyIn);
    const buyIn = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.max(Math.floor(requested), this.bigBlind), this.maxBuyIn)
      : this.startingStack;
    this.seats[seat] = {
      id,
      name,
      seat,
      bot: !!opts.bot,
      botStyle: opts.botStyle || null,
      chips: buyIn,
      cards: [],
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      hasActed: false,
      inHand: false,
      sitOut: false,
      disconnected: false,
      revealed: false,
      lastAction: null,
      handsPlayed: 0,
      netResult: 0,
      // Running tally of how this player actually behaves, so opponents can
      // tell a raise from someone who raises constantly from a real one.
      queuedChips: 0,
      queuedRemoval: 0,
      pendingTransfers: [],
      stats: { actions: 0, raises: 0, calls: 0, folds: 0 },
    };
    this.pushLog(`${name} sat down in seat ${seat + 1} with ${buyIn}.`);
    return this.seats[seat];
  }

  stand(id) {
    const p = this.playerById(id);
    if (!p) return null;
    // Standing up mid-hand forfeits the hand, exactly like leaving a live table.
    if (p.inHand && !p.folded && this.inHandStage()) {
      p.folded = true;
      p.lastAction = 'fold';
      this.pushLog(`${p.name} left the table and forfeits the hand.`);
    }
    this.seats[p.seat] = null;
    this.pushLog(`${p.name} left the table.`);
    if (this.inHandStage()) {
      if (this.actingSeat === p.seat) this.actingSeat = -1;
      this.settleOrAdvance();
    }
    return p;
  }

  rebuy(id, amount) {
    const p = this.playerById(id);
    if (!p) throw new Error('You are not seated.');
    if (p.chips > 0) throw new Error('You still have chips.');
    if (p.inHand && this.inHandStage()) throw new Error('Wait for the hand to finish.');
    const requested = Number(amount);
    const topUp = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.max(Math.floor(requested), this.bigBlind), this.maxBuyIn)
      : this.startingStack;
    p.chips = topUp;
    p.netResult -= topUp;
    p.sitOut = false;
    this.pushLog(`${p.name} topped up with ${topUp}.`);
  }

  /**
   * Bring more chips from the vault to the table.
   *
   * Asking during a hand you are still contesting does not fail — it queues,
   * and the chips arrive when the hand ends. That is how a real table works,
   * and refusing outright meant the control was unusable for anyone who plays
   * most of their hands to the end.
   */
  addChips(id, amount) {
    const p = this.playerById(id);
    if (!p) throw new Error('You are not seated.');

    const queued = p.queuedChips || 0;
    const room = this.maxBuyIn - p.chips - queued;
    if (room <= 0) throw new Error('You are already at the table maximum.');

    const want = Math.min(Math.floor(Number(amount) || 0), room);
    if (want <= 0) throw new Error('Nothing to add.');

    if (p.inHand && !p.folded && this.inHandStage()) {
      p.queuedChips = queued + want;
      this.pushLog(`${p.name} will add ${want} chips after this hand.`);
      this.events.push({ type: 'queued', id: p.id, amount: want });
      return { queued: want };
    }

    this.giveChips(p, want);
    return { added: want };
  }

  giveChips(p, amount) {
    p.chips += amount;
    p.netResult -= amount;
    p.sitOut = false;
    this.pushLog(`${p.name} adds ${amount} chips.`);
    this.events.push({ type: 'added', id: p.id, amount });
  }

  /**
   * Take chips off the table and back to the vault.
   *
   * A cardroom calls this "going south" and forbids it, because leaving with
   * your winnings mid-session is unfair to the people you won them from. Here
   * it is just moving your own play money about, and the same timing rule
   * applies as everywhere else: not out of a stack that is being bet.
   */
  removeChips(id, amount) {
    const p = this.playerById(id);
    if (!p) throw new Error('You are not seated.');
    if (p.chips <= 0) throw new Error('You have no chips at the table.');

    const want = Math.min(Math.floor(Number(amount) || 0), p.chips);
    if (want <= 0) throw new Error('Enter an amount to take back.');

    if (p.inHand && !p.folded && this.inHandStage()) {
      p.queuedRemoval = (p.queuedRemoval || 0) + want;
      this.pushLog(`${p.name} will take ${want} off the table after this hand.`);
      this.events.push({ type: 'queued-remove', id: p.id, amount: want });
      return { queued: want };
    }

    return { removed: this.takeChips(p, want) };
  }

  takeChips(p, amount) {
    const moved = Math.min(amount, p.chips);
    if (moved <= 0) return 0;
    p.chips -= moved;
    // Chips taken off the table are yours again, so they count back.
    p.netResult += moved;
    this.pushLog(`${p.name} takes ${moved} chips off the table.`);
    this.events.push({ type: 'removed', id: p.id, amount: moved });
    return moved;
  }

  /**
   * Move chips from one player's stack to another's.
   *
   * Not something a real cardroom allows — it is chip dumping — but this is a
   * friendly play-money game, and staking a friend who busted is the point.
   * Asking mid-hand queues until the hand ends, for the same reason a top-up
   * does: stacks must not move while they are being bet.
   */
  transferChips(fromId, toSeat, amount) {
    const from = this.playerById(fromId);
    const to = this.seats[toSeat];
    if (!from) throw new Error('You are not seated.');
    if (!to) throw new Error('Nobody is sitting there.');
    if (to === from) throw new Error('That is your own seat.');

    const want = Math.floor(Number(amount) || 0);
    if (want <= 0) throw new Error('Enter an amount to send.');

    if (this.inHandStage()) {
      from.pendingTransfers = from.pendingTransfers || [];
      from.pendingTransfers.push({ toSeat, amount: want });
      this.pushLog(`${from.name} will send ${want} to ${to.name} after this hand.`);
      this.events.push({ type: 'queued-send', id: from.id, amount: want, who: to.name });
      return { queued: want };
    }

    return { sent: this.settleTransfer(from, to, want) };
  }

  /** The actual movement, clamped by what the sender has and the table cap. */
  settleTransfer(from, to, amount) {
    const room = Math.max(0, this.maxBuyIn - to.chips);
    const moved = Math.min(amount, from.chips, room);
    if (moved <= 0) {
      if (room <= 0) throw new Error(`${to.name} is already at the table maximum.`);
      throw new Error('You do not have that many chips.');
    }
    from.chips -= moved;
    to.chips += moved;
    // Chips given away are a loss to you and a gain to them, so the running
    // results still add up across the table.
    from.netResult -= moved;
    to.netResult += moved;
    to.sitOut = false;
    this.pushLog(`${from.name} sends ${moved} chips to ${to.name}.`);
    this.events.push({ type: 'sent', id: from.id, amount: moved, who: to.name });
    this.events.push({ type: 'received', id: to.id, amount: moved, who: from.name });
    return moved;
  }

  /**
   * Move another player's chips to yourself. Everything the ordinary transfer
   * does — clamping, the mid-hand queue, the log line, the running results —
   * applies here too; only the direction is unusual.
   */
  seizeChips(byId, fromSeat, amount) {
    const to = this.playerById(byId);
    if (!to) throw new Error('You are not seated.');
    const from = this.seats[fromSeat];
    if (!from) throw new Error('Nobody is sitting there.');
    if (from === to) throw new Error('That is your own seat.');
    const want = amount === 'all' ? from.chips : amount;
    return this.transferChips(from.id, to.seat, want);
  }

  /** Release anything that was queued while a hand was running. */
  releaseQueuedChips() {
    for (const p of this.players()) {
      const queue = p.pendingTransfers;
      if (queue && queue.length) {
        p.pendingTransfers = [];
        for (const { toSeat, amount } of queue) {
          const to = this.seats[toSeat];
          if (!to || to === p) continue;
          try {
            this.settleTransfer(p, to, amount);
          } catch {
            // They busted out or the seat filled up; nothing to move.
          }
        }
      }

      if (p.queuedRemoval) {
        const take = p.queuedRemoval;
        p.queuedRemoval = 0;
        this.takeChips(p, take);
      }

      if (!p.queuedChips) continue;
      const room = Math.max(0, this.maxBuyIn - p.chips);
      const amount = Math.min(p.queuedChips, room);
      p.queuedChips = 0;
      if (amount > 0) this.giveChips(p, amount);
    }
  }

  setSitOut(id, value) {
    const p = this.playerById(id);
    if (!p) return;
    p.sitOut = !!value;
    this.pushLog(`${p.name} is ${value ? 'sitting out' : 'back in'}.`);
  }

  inHandStage() {
    return ['preflop', 'flop', 'turn', 'river'].includes(this.stage);
  }

  // ---------------------------------------------------------------- seat walking

  /** First seat strictly after `from` (wrapping) whose player matches `pred`. */
  nextSeat(from, pred) {
    for (let i = 1; i <= this.maxSeats; i++) {
      const s = (from + i + this.maxSeats) % this.maxSeats;
      const p = this.seats[s];
      if (p && pred(p)) return s;
    }
    return -1;
  }

  // ---------------------------------------------------------------- hand flow

  startHand() {
    const eligible = this.eligibleForHand();
    if (eligible.length < 2) {
      this.stage = 'idle';
      return false;
    }

    this.handNo++;
    this.deck = shuffle(makeDeck());
    this.community = [];
    this.potTotal = 0;
    this.pots = [];
    this.results = null;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastAggressorSeat = -1;

    for (const p of this.players()) {
      p.cards = [];
      p.bet = 0;
      p.committed = 0;
      p.folded = false;
      p.allIn = false;
      p.hasActed = false;
      p.revealed = false;
      p.lastAction = null;
      p.inHand = p.chips > 0 && !p.sitOut;
      if (p.inHand) p.handsPlayed++;
    }

    this.button = this.nextSeat(this.button, (p) => p.inHand);
    const headsUp = this.live().length === 2;

    // Heads-up: the button posts the small blind and acts first preflop.
    const sbSeat = headsUp ? this.button : this.nextSeat(this.button, (p) => p.inHand);
    const bbSeat = this.nextSeat(sbSeat, (p) => p.inHand);

    this.postBlind(this.seats[sbSeat], this.smallBlind, 'small blind');
    this.postBlind(this.seats[bbSeat], this.bigBlind, 'big blind');

    this.currentBet = Math.max(this.seats[sbSeat].bet, this.seats[bbSeat].bet);
    this.minRaise = this.bigBlind;
    this.sbSeat = sbSeat;
    this.bbSeat = bbSeat;

    for (const p of this.live()) {
      p.cards = [this.deck.pop(), this.deck.pop()];
    }

    this.stage = 'preflop';
    this.pushLog(`--- Hand #${this.handNo} --- button: ${this.seats[this.button].name}`);

    // Point at the big blind and let settleOrAdvance step to the first player who
    // owes action: under the gun with three or more, the button when heads-up.
    this.actingSeat = bbSeat;
    this.settleOrAdvance();
    return true;
  }

  postBlind(p, amount, label) {
    const posted = this.commit(p, amount);
    p.lastAction = label;
    this.pushLog(`${p.name} posts the ${label}: ${posted}${p.allIn ? ' (all in)' : ''}`);
  }

  /** Move chips from a stack into their bet for this street. Returns the amount actually moved. */
  commit(p, amount) {
    const moved = Math.max(0, Math.min(Math.floor(amount), p.chips));
    p.chips -= moved;
    p.bet += moved;
    p.committed += moved;
    if (p.chips === 0) p.allIn = true;
    return moved;
  }

  // ---------------------------------------------------------------- actions

  legalActions(p) {
    if (!p || !this.inHandStage() || this.actingSeat !== p.seat) return null;
    const toCall = Math.max(0, this.currentBet - p.bet);
    const canCall = toCall > 0 && p.chips > 0;
    const maxTo = p.bet + p.chips; // the highest "raise to" they can reach
    const opening = this.currentBet === 0;
    const minRaiseTo = Math.min(maxTo, this.currentBet + this.minRaise);
    const minBet = Math.min(maxTo, this.bigBlind);
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall,
      callAmount: Math.min(toCall, p.chips),
      // You can only open a bet when nobody has bet; otherwise it's a raise.
      canBet: opening && p.chips > 0,
      canRaise: !opening && maxTo > this.currentBet,
      minTo: opening ? minBet : minRaiseTo,
      maxTo,
      potTotal: this.displayPot(),
    };
  }

  /**
   * Apply a player action. `action` is fold | check | call | bet | raise | allin.
   * `amount` for bet/raise is the total to raise *to* on this street.
   */
  act(id, action, amount = 0) {
    const p = this.playerById(id);
    if (!p) throw new Error('You are not seated.');
    if (!this.inHandStage()) throw new Error('No betting right now.');
    if (this.actingSeat !== p.seat) throw new Error('Not your turn.');

    const legal = this.legalActions(p);
    const toCall = Math.max(0, this.currentBet - p.bet);

    switch (action) {
      case 'fold': {
        p.folded = true;
        p.lastAction = 'fold';
        this.pushLog(`${p.name} folds.`);
        break;
      }
      case 'check': {
        if (toCall > 0) throw new Error(`You cannot check, ${toCall} to call.`);
        p.lastAction = 'check';
        this.pushLog(`${p.name} checks.`);
        break;
      }
      case 'call': {
        if (toCall <= 0) throw new Error('Nothing to call — check instead.');
        const paid = this.commit(p, toCall);
        p.lastAction = 'call';
        this.pushLog(`${p.name} calls ${paid}${p.allIn ? ' (all in)' : ''}.`);
        break;
      }
      case 'bet':
      case 'raise':
      case 'allin': {
        const target = action === 'allin' ? legal.maxTo : Math.floor(amount);
        if (!Number.isFinite(target)) throw new Error('Bad amount.');
        if (target <= p.bet) throw new Error('Raise must be more than you already have in.');
        if (target > legal.maxTo) throw new Error('You do not have that many chips.');
        const isAllIn = target === legal.maxTo;
        // A short all-in is always allowed; anything else must clear the minimum.
        if (!isAllIn && target < legal.minTo) {
          throw new Error(`Minimum is ${legal.minTo}.`);
        }
        const prevBet = this.currentBet;
        this.commit(p, target - p.bet);
        if (p.bet > prevBet) {
          const increment = p.bet - prevBet;
          // A short all-in doesn't raise the minimum for players behind.
          if (increment >= this.minRaise) this.minRaise = increment;
          this.currentBet = p.bet;
          this.lastAggressorSeat = p.seat;
          // A genuine raise reopens the action for everyone still behind.
          for (const o of this.live()) {
            if (o !== p && !o.allIn) o.hasActed = false;
          }
          p.lastAction = prevBet === 0 ? 'bet' : 'raise';
          this.pushLog(
            `${p.name} ${prevBet === 0 ? 'bets' : 'raises to'} ${p.bet}${p.allIn ? ' (all in)' : ''}.`,
          );
        } else {
          p.lastAction = 'call';
          this.pushLog(`${p.name} calls ${p.bet} (all in).`);
        }
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    if (p.stats) {
      p.stats.actions++;
      if (p.lastAction === 'fold') p.stats.folds++;
      else if (p.lastAction === 'call') p.stats.calls++;
      else if (p.lastAction === 'bet' || p.lastAction === 'raise') p.stats.raises++;
    }

    p.hasActed = true;
    this.settleOrAdvance();
  }

  /**
   * The clock ran out.
   *
   * With meanie on, a player who is simply slow gets shoved all in. Someone
   * whose connection has dropped is folded either way: they are not choosing
   * to be away, and taking their stack for a lost signal would be unfair.
   */
  timeoutAct() {
    const p = this.seats[this.actingSeat];
    if (!p) return;

    const foldOrCheck = () => {
      const toCall = Math.max(0, this.currentBet - p.bet);
      this.act(p.id, toCall === 0 ? 'check' : 'fold');
    };

    if (p.disconnected) {
      this.pushLog(`${p.name} is disconnected.`);
      foldOrCheck();
      return;
    }

    if (!this.meanie) {
      this.pushLog(`${p.name} ran out of time.`);
      foldOrCheck();
      return;
    }

    this.pushLog(`${p.name} ran out of time — all in.`);
    this.act(p.id, 'allin');
  }

  // ---------------------------------------------------------------- street transitions

  /** The single place that decides "who's next, or is this street over?". */
  settleOrAdvance() {
    const live = this.live();
    if (live.length <= 1) {
      this.endByFold(live[0]);
      return;
    }

    const actors = this.actors();
    const settled = actors.every((p) => p.hasActed && p.bet === this.currentBet);

    if (!settled) {
      const next = this.nextSeat(
        this.actingSeat < 0 ? this.button : this.actingSeat,
        (p) => p.inHand && !p.folded && !p.allIn && !(p.hasActed && p.bet === this.currentBet),
      );
      if (next >= 0) {
        this.actingSeat = next;
        return;
      }
    }

    this.collectBets();

    // With at most one player able to act, no betting is left — run it out.
    if (this.actors().length <= 1) {
      this.runOutBoard();
      this.showdown();
      return;
    }

    this.nextStreet();
  }

  /** End of street: refund any uncalled chips, then sweep bets into the pot. */
  collectBets() {
    const bets = this.players().filter((p) => p.bet > 0);
    if (bets.length > 1) {
      const sorted = bets.map((p) => p.bet).sort((a, b) => b - a);
      const top = sorted[0];
      const second = sorted[1];
      if (top > second) {
        const owners = bets.filter((p) => p.bet === top);
        if (owners.length === 1) {
          const [owner] = owners;
          const refund = top - second;
          owner.chips += refund;
          owner.bet -= refund;
          owner.committed -= refund;
          if (owner.chips > 0) owner.allIn = false;
          this.pushLog(`${refund} returned to ${owner.name} (uncalled).`);
        }
      }
    }
    for (const p of this.players()) {
      this.potTotal += p.bet;
      p.bet = 0;
      p.hasActed = false;
      if (p.lastAction !== 'fold') p.lastAction = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
  }

  nextStreet() {
    const next = STREET_AFTER[this.stage];
    if (next === 'showdown') {
      this.showdown();
      return;
    }
    this.dealStreet(next);
    this.stage = next;
    this.lastAggressorSeat = -1;
    // Same trick as preflop: sit on the button so the step lands on the first
    // live player to its left.
    this.actingSeat = this.button;
    this.settleOrAdvance();
  }

  dealStreet(street) {
    this.deck.pop(); // burn card, as at a real table
    const n = street === 'flop' ? 3 : 1;
    for (let i = 0; i < n; i++) this.community.push(this.deck.pop());
    this.pushLog(`${street.toUpperCase()}: ${this.community.join(' ')}`);
  }

  runOutBoard() {
    let street = STREET_AFTER[this.stage];
    while (street && street !== 'showdown') {
      this.dealStreet(street);
      this.stage = street;
      street = STREET_AFTER[street];
    }
  }

  // ---------------------------------------------------------------- pots & payouts

  /** What the UI should show as "the pot": collected chips plus live bets. */
  displayPot() {
    return this.potTotal + this.players().reduce((s, p) => s + p.bet, 0);
  }

  /**
   * Split everything committed this hand into a main pot plus side pots.
   * Pot boundaries come from the all-in amounts of players still in the hand;
   * chips from folded players simply sink into the lowest pots.
   */
  buildPots() {
    const contributors = this.players().filter((p) => p.committed > 0);
    const levels = [...new Set(this.live().map((p) => p.committed))]
      .filter((v) => v > 0)
      .sort((a, b) => a - b);

    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of contributors) {
        amount += Math.min(p.committed, level) - Math.min(p.committed, prev);
      }
      const eligible = this.live().filter((p) => p.committed >= level);
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }

    // Anything above the top live commitment can only come from folded players.
    const accounted = pots.reduce((s, x) => s + x.amount, 0);
    const total = contributors.reduce((s, p) => s + p.committed, 0);
    if (total > accounted && pots.length) pots[pots.length - 1].amount += total - accounted;

    // Merge neighbouring pots that have identical eligibility — purely cosmetic.
    const merged = [];
    for (const pot of pots) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.eligible.length === pot.eligible.length &&
        last.eligible.every((p, i) => p === pot.eligible[i])
      ) {
        last.amount += pot.amount;
      } else {
        merged.push({ ...pot });
      }
    }
    return merged;
  }

  showdown() {
    this.stage = 'showdown';
    this.actingSeat = -1;
    const live = this.live();

    const scored = new Map();
    for (const p of live) {
      const hand = bestHand([...p.cards, ...this.community]);
      scored.set(p, hand);
      p.revealed = true;
    }

    const pots = this.buildPots();
    const payouts = new Map();

    pots.forEach((pot, idx) => {
      let best = null;
      for (const p of pot.eligible) {
        const s = scored.get(p).score;
        if (!best || compareScores(s, best) > 0) best = s;
      }
      const winners = pot.eligible.filter((p) => compareScores(scored.get(p).score, best) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;

      // Odd chips go to the first winner left of the button, as per house rules.
      const ordered = [...winners].sort(
        (a, b) => this.seatOrderFromButton(a.seat) - this.seatOrderFromButton(b.seat),
      );
      for (const w of ordered) {
        let amt = share;
        if (remainder > 0) {
          amt += 1;
          remainder -= 1;
        }
        w.chips += amt;
        payouts.set(w, (payouts.get(w) || 0) + amt);
      }
      pot.winners = ordered.map((w) => w.id);
      pot.label = idx === 0 ? 'Main pot' : `Side pot ${idx}`;
      this.pushLog(
        `${pot.label} (${pot.amount}) → ${ordered.map((w) => w.name).join(', ')} with ${scored.get(ordered[0]).name}.`,
      );
    });

    this.pots = pots.map((p) => ({
      label: p.label,
      amount: p.amount,
      winners: p.winners,
      eligible: p.eligible.map((e) => e.id),
    }));

    this.results = {
      kind: 'showdown',
      board: [...this.community],
      hands: live.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        cards: p.cards,
        handName: scored.get(p).name,
        best: scored.get(p).cards,
        won: payouts.get(p) || 0,
      })),
    };

    for (const p of live) p.netResult += (payouts.get(p) || 0);
    this.finishHand();
  }

  endByFold(winner) {
    this.collectBets();
    this.actingSeat = -1;
    if (winner) {
      winner.chips += this.potTotal;
      winner.netResult += this.potTotal;
      this.pushLog(`${winner.name} wins ${this.potTotal} — everyone else folded.`);
      this.results = {
        kind: 'fold',
        board: [...this.community],
        hands: [{ id: winner.id, name: winner.name, seat: winner.seat, cards: null, handName: null, won: this.potTotal }],
      };
      this.pots = [{ label: 'Main pot', amount: this.potTotal, winners: [winner.id], eligible: [winner.id] }];
    }
    this.finishHand();
  }

  finishHand() {
    this.releaseQueuedChips();
    this.potTotal = 0;
    this.currentBet = 0;
    this.stage = 'handover';
    for (const p of this.players()) {
      p.inHand = false;
      p.bet = 0;
      if (p.chips === 0) p.sitOut = false; // leave them seated so they can top up
    }
  }

  /** Distance in seats from the button's *left*, which is where odd chips start. */
  seatOrderFromButton(seat) {
    return (seat - this.button - 1 + this.maxSeats) % this.maxSeats;
  }

  pushLog(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }

  // ---------------------------------------------------------------- serialisation

  /** The view of the table for one specific player — hole cards are hidden. */
  snapshot(viewerId) {
    const viewer = this.playerById(viewerId);
    return {
      id: this.id,
      stage: this.stage,
      handNo: this.handNo,
      button: this.button,
      maxSeats: this.maxSeats,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      startingStack: this.startingStack,
      maxBuyIn: this.maxBuyIn,
      meanie: this.meanie,
      community: this.community,
      pot: this.displayPot(),
      potTotal: this.potTotal,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      actingSeat: this.actingSeat,
      actionDeadline: this.actionDeadline,
      hostId: this.hostId,
      results: this.results,
      pots: this.pots,
      seats: this.seats.map((p) => {
        if (!p) return null;
        const mine = viewer && p.id === viewer.id;
        return {
          id: p.id,
          name: p.name,
          seat: p.seat,
          chips: p.chips,
          bet: p.bet,
          committed: p.committed,
          folded: p.folded,
          allIn: p.allIn,
          inHand: p.inHand,
          sitOut: p.sitOut,
          bot: !!p.bot,
          disconnected: p.disconnected,
          lastAction: p.lastAction,
          handsPlayed: p.handsPlayed,
          netResult: p.netResult,
          isMe: !!mine,
          // Only ever send real cards to their owner, or at showdown.
          cards: mine || p.revealed ? p.cards : p.cards.map(() => '??'),
        };
      }),
      you: viewer
        ? {
            id: viewer.id,
            seat: viewer.seat,
            chips: viewer.chips,
            cards: viewer.cards,
            legal: this.legalActions(viewer),
            queuedChips: viewer.queuedChips || 0,
          }
        : null,
      log: this.log.slice(-40),
    };
  }
}
