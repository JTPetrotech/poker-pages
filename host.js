import { Table } from './engine/game.js';

export const ACTION_TIMEOUT_MS = 45_000;
const HANDOVER_DELAY_MS = 6_000;
const IDLE_START_DELAY_MS = 3_000;

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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
  constructor({ code, options = {}, deliver }) {
    this.code = code;
    this.deliver = deliver;
    this.members = new Set();   // tokens currently attached
    this.startAt = 0;
    this.lastActingKey = '';
    this.timer = null;

    const smallBlind = clampInt(options.smallBlind, 1, 10_000, 5);
    let bigBlind = clampInt(options.bigBlind, 2, 20_000, 10);
    if (bigBlind <= smallBlind) bigBlind = smallBlind * 2;

    this.table = new Table({
      id: code,
      smallBlind,
      bigBlind,
      startingStack: clampInt(options.startingStack, 20, 1_000_000, 1000),
      maxSeats: clampInt(options.maxSeats, 2, 9, 6),
    });
    this.table.minRaise = bigBlind;
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
      maxSeats: this.table.maxSeats,
      actionTimeoutMs: ACTION_TIMEOUT_MS,
    };
  }

  broadcastState() {
    const now = Date.now();
    for (const token of this.members) {
      this.deliver(token, { t: 'state', now, state: this.table.snapshot(token) });
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
        table.sit(token, cleanName(msg.name), clampInt(msg.seat, 0, table.maxSeats - 1, 0));
        this.#scheduleStart(IDLE_START_DELAY_MS);
        break;
      case 'stand':
        table.stand(token);
        break;
      case 'action':
        table.act(token, String(msg.action), Number(msg.amount) || 0);
        break;
      case 'rebuy':
        table.rebuy(token);
        this.#scheduleStart(IDLE_START_DELAY_MS);
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

  tick() {
    const { table } = this;
    const now = Date.now();
    let dirty = false;

    const key = `${table.handNo}:${table.stage}:${table.actingSeat}`;
    if (table.inHandStage() && table.actingSeat >= 0) {
      if (key !== this.lastActingKey) {
        this.lastActingKey = key;
        table.actionDeadline = now + ACTION_TIMEOUT_MS;
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

    if (table.stage === 'handover' && !this.startAt) this.#scheduleStart(HANDOVER_DELAY_MS);

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
