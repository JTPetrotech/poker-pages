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

## Accounts

Without a Firebase project configured the site runs with no sign-in at all,
and the vault is saved in whichever browser you played in. Configure one and
sign-in becomes required, and your chips follow you to any device.

### Setting it up (about 10 minutes, free, no card)

1. Go to <https://console.firebase.google.com> and **Add project**. Any name.
   Decline Google Analytics — nothing here needs it.
2. In the left sidebar: **Build → Authentication → Get started**, choose
   **Email/Password**, switch the first toggle on, **Save**.
3. **Build → Firestore Database → Create database**. Pick a location near you
   and start in **production mode** (the rules below replace the defaults).
4. Open the **Rules** tab and paste this, then **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /players/{uid} {
         allow read: if request.auth != null;
         allow write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   This is what actually protects the data: anyone signed in can read a
   profile, but only you can write your own.
5. **Project settings** (the gear) → scroll to **Your apps** → the `</>` web
   icon. Register the app, and copy the `firebaseConfig` object it shows you.
6. Paste those values into `firebase-config.js`, then run `node build.js` and
   commit.
7. **Authentication → Settings → Authorized domains** → add
   `jtpetrotech.github.io`, or sign-in is refused from the live site.

The config values are public by design — they identify the project, they do
not grant access. They are meant to sit in client code.

### What accounts change

- Sign-in is required before the lobby.
- The vault lives on the account, so it follows you between devices.
- Your display name comes from the account rather than being typed each time.
- Writes are debounced: a stack changes on every action, and one network
  round trip per chip would be slow and wasteful.

If the account cannot be reached mid-session, the game keeps running on the
local copy rather than interrupting a hand.

## Vault

Your chips live in a **vault** between games. You take some out to buy into a
table and they go back when you cash out, so a good night actually counts for
something. It starts at 10,000 and reloads free when it runs dry.

The vault is saved in your browser, which means it is per device: your
Chromebook vault and your phone vault are separate, and clearing site data
resets it. Carrying one balance across devices needs real accounts, which
needs a server this site doesn't have.

## Playing on your own

**Play against 4 computer players** on the lobby screen deals you straight into
a table with four bots of mixed styles. It still has a table code, and a seat
is left spare, so a friend can join partway through if one turns up.

## Computer players

The host can fill any empty seat with a bot: **Cautious**, **Solid**, **Wild**
or **Expert**. Three things drive how they play.

**They estimate equity by simulation.** Several hundred times a decision, the
bot deals out the rest of the board and the opponents' cards and counts how
often it ends up winning. That number is then weighed against the pot odds it
is being offered.

**They do not assume you hold random cards.** Each opponent is given a range
inferred from what they have actually done, and the simulation only deals them
hands inside it. Crucially the range depends on *who* is raising: a player who
raises a third of the time is not representing much, and the bots track how
often each opponent actually raises to work that out.

**Preflop is decided by hand strength and position**, not simulation. Against
random hands nearly everything looks playable heads-up, which is the leak that
makes a naive bot easy to beat.

Expert reads opponents tighter than the others and varies its bet sizing so it
is harder to put on a hand.

### Measuring them

```bash
node bench.js 1200
```

pits the styles against each other and against a baseline that calls
everything, reporting big blinds per 100 hands. Run it after any change to
`bot.js`: an early version of the range modelling made the bots fold so much
that the reckless Wild bot beat them by 119 bb/100, which no unit test would
ever have caught.

Expect noise. Heads-up matches with deep stacks swing wildly — if two seat
orders disagree by 60 bb/100, the result is variance, not a finding. Measuring
against a fixed, non-adapting opponent is far more stable than bot-vs-bot.

## Playing

- Share the invite link (the `Table ABCD` chip at the top copies it) or read out the 4-letter code.
- Click a seat to choose your buy-in and sit down. Hands deal automatically once two players are seated.
- Hosts can click any empty seat to add a computer player, and the small × on a bot removes it.
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
test/run.js    tests — `node test/run.js`
build.js       stamps a version onto module URLs — run before committing
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

## Deploying a change

GitHub Pages caches assets for ten minutes and browsers hold ES modules longer,
so an update can otherwise leave a host and a guest running different versions
of the code against each other. Stamp the module URLs before you commit:

```bash
node build.js
node test/run.js
git commit -am "..." && git push
```

### The one cache you cannot stamp

`build.js` stamps the stylesheet and every module, so those update instantly.
`index.html` cannot stamp itself, and GitHub Pages serves it with a ten-minute
cache that cannot be overridden. So for up to ten minutes after a deploy, a
browser that has been here before may still load the previous page, which
points at the previous assets.

A hard refresh (Ctrl+Shift+R) gets it immediately. First-time visitors always
get the current version.
