/**
 * Browser-to-browser transport, standing in for the WebSocket server.
 *
 * One player's tab is the host: it owns the deck and the chips, exactly as the
 * Node server did. Everyone else connects straight to it over WebRTC. The
 * PeerJS broker is used only to introduce two browsers to each other; once the
 * connection is up, cards never pass through anyone else's machine.
 */

// Namespaced so a 4-letter table code can't collide with some other PeerJS app.
const PREFIX = 'poker-night-v1-';

export const peerIdFor = (code) => PREFIX + code.toUpperCase();

const PEER_OPTIONS = { debug: 0 };

function waitForPeerJs() {
  if (typeof window.Peer === 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (typeof window.Peer === 'function') {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 10000) {
        clearInterval(timer);
        reject(new Error('Could not load the connection library.'));
      }
    }, 50);
  });
}

/** The host side: accepts connections and tracks one per player token. */
export class HostNet {
  constructor({ code, onMessage, onLeave, onStatus }) {
    this.code = code;
    this.onMessage = onMessage;
    this.onLeave = onLeave;
    this.onStatus = onStatus || (() => {});
    this.conns = new Map(); // token -> DataConnection
    this.peer = null;
  }

  async start() {
    await waitForPeerJs();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(peerIdFor(this.code), PEER_OPTIONS);
      this.peer = peer;

      peer.on('open', () => {
        this.onStatus('ready');
        resolve(this.code);
      });

      peer.on('connection', (conn) => this.#accept(conn));

      peer.on('error', (err) => {
        if (err && err.type === 'unavailable-id') {
          // Someone already holds this table code on the broker.
          reject(new Error('code-taken'));
          return;
        }
        if (err && err.type === 'peer-unavailable') return; // a guest vanished
        this.onStatus('error', err);
      });

      peer.on('disconnected', () => {
        this.onStatus('reconnecting');
        try { peer.reconnect(); } catch { /* the next tick retries */ }
      });
    });
  }

  #accept(conn) {
    let token = null;
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      // The first message claims an identity; everything after rides on it.
      if (msg.t === 'hello') {
        token = String(msg.token || '').slice(0, 64);
        if (!token) return;
        const prior = this.conns.get(token);
        if (prior && prior !== conn) {
          try { prior.close(); } catch { /* already gone */ }
        }
        this.conns.set(token, conn);
      }
      if (!token) return;
      this.onMessage(token, msg);
    });

    conn.on('close', () => {
      if (token && this.conns.get(token) === conn) {
        this.conns.delete(token);
        this.onLeave(token);
      }
    });

    conn.on('error', () => { /* close fires right after */ });
  }

  sendTo(token, msg) {
    const conn = this.conns.get(token);
    if (conn && conn.open) {
      try { conn.send(msg); } catch { /* dropped; next broadcast resyncs */ }
    }
  }

  destroy() {
    try { this.peer?.destroy(); } catch { /* already torn down */ }
  }
}

/** The guest side: one connection to the host, with retries. */
export class GuestNet {
  constructor({ code, token, name, onMessage, onStatus }) {
    this.code = code;
    this.token = token;
    this.name = name;
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.peer = null;
    this.conn = null;
    this.closed = false;
    this.attempt = 0;
  }

  async start() {
    await waitForPeerJs();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PEER_OPTIONS);
      this.peer = peer;
      let settled = false;

      peer.on('open', () => this.#connect(
        () => { if (!settled) { settled = true; resolve(); } },
        (err) => { if (!settled) { settled = true; reject(err); } },
      ));

      peer.on('error', (err) => {
        if (err && err.type === 'peer-unavailable') {
          const e = new Error('no-such-table');
          if (!settled) { settled = true; reject(e); }
          else this.onStatus('down');
          return;
        }
        this.onStatus('error', err);
      });

      peer.on('disconnected', () => {
        if (this.closed) return;
        this.onStatus('down');
        try { peer.reconnect(); } catch { /* retried below */ }
      });
    });
  }

  #connect(resolve, reject) {
    const conn = this.peer.connect(peerIdFor(this.code), { reliable: true });
    this.conn = conn;

    const failTimer = setTimeout(() => {
      if (!conn.open) reject(new Error('no-such-table'));
    }, 12000);

    conn.on('open', () => {
      clearTimeout(failTimer);
      this.attempt = 0;
      this.onStatus('ready');
      conn.send({ t: 'hello', token: this.token, name: this.name });
      resolve();
    });

    conn.on('data', (msg) => {
      if (msg && typeof msg === 'object') this.onMessage(msg);
    });

    conn.on('close', () => {
      clearTimeout(failTimer);
      if (this.closed) return;
      this.onStatus('down');
      this.#retry();
    });

    conn.on('error', () => clearTimeout(failTimer));
  }

  #retry() {
    if (this.closed) return;
    this.attempt = Math.min(this.attempt + 1, 6);
    setTimeout(() => {
      if (this.closed || !this.peer || this.peer.destroyed) return;
      this.#connect(() => {}, () => this.#retry());
    }, 500 * 2 ** (this.attempt - 1));
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(msg); } catch { /* retry loop will resync */ }
    }
  }

  destroy() {
    this.closed = true;
    try { this.peer?.destroy(); } catch { /* already torn down */ }
  }
}
