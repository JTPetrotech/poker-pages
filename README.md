# ♠ Poker Night

Play-money No-Limit Texas Hold'em with your friends, in the browser.
No server, no accounts, nothing to install.

**Play: https://jtpetrotech.github.io/poker-pages/**

## How it works

One player creates a table and becomes the **host**. Their browser runs the
game — shuffling, dealing, tracking chips — and everyone else connects
straight to it over WebRTC. The only thing in the middle is a broker that
introduces two browsers to each other; once connected, cards go peer to peer.

That has one consequence worth knowing: **the host's tab is the table.** If the
host closes it, the game ends for everyone. The page warns before that happens.

## Playing

- Share the invite link (the `Table ABCD` chip at the top copies it) or read out the 4-letter code.
- Click a seat to sit down. Hands deal automatically once two people are seated.
- Keyboard during your turn: `F` fold, `C` check/call, `R` bet/raise.
- 45 seconds to act, then you check if it's free, otherwise you fold.
- Out of chips? **Top up** returns you to the starting stack.

## Layout

```
index.html     the page
app.js         UI and both sides of the connection
net.js         WebRTC transport (PeerJS) — host and guest
host.js        runs the table in the host's tab
engine/        the poker rules, with no knowledge of networking
  game.js      table state machine: blinds, betting, side pots, payouts
  hand.js      5-to-7-card hand evaluation
  cards.js     deck and shuffle
test/run.js    36 tests — `node test/run.js`
```

The engine is shared with the server version of this game and is covered by the
same tests, including fuzzers that play thousands of random hands checking that
chips are never created or destroyed and no card is dealt twice.

## Honest limits

- **The host can see everyone's cards if they go looking.** Their browser is
  dealing, so it necessarily knows the deck. Fine among friends; this is not a
  game to play against strangers for anything that matters.
- **Some networks block peer-to-peer connections.** Home internet is almost
  always fine; locked-down school or office WiFi sometimes isn't.
- **Nothing is saved.** When the host's tab closes, the table is gone.
