// Measures whether one bot style actually beats another, in big blinds per
// 100 hands. Stacks reset each hand so nobody busts and distorts the sample.
import { Table } from './engine/game.js';
import { decide } from './bot.js';

const STACK = 1000;
const BB = 10;

/** A baseline that calls anything and never raises — the classic punching bag. */
function station(table, player) {
  const legal = table.legalActions(player);
  if (legal.canCheck) return { action: 'check', amount: 0 };
  if (legal.canCall) return { action: 'call', amount: 0 };
  return { action: 'fold', amount: 0 };
}

function play(styleA, styleB, hands) {
  const t = new Table({ id: 'B', smallBlind: 5, bigBlind: BB, startingStack: STACK, maxSeats: 2 });
  t.sit('a', 'A', 0, { bot: true, botStyle: styleA === 'station' ? 'shark' : styleA });
  t.sit('b', 'B', 1, { bot: true, botStyle: styleB === 'station' ? 'shark' : styleB });
  const [A, B] = t.players();

  let netA = 0;
  for (let h = 0; h < hands; h++) {
    A.chips = STACK;
    B.chips = STACK;
    if (!t.startHand()) break;

    let guard = 0;
    while (t.inHandStage()) {
      if (++guard > 400) break;
      const p = t.seats[t.actingSeat];
      const brain = (p === A ? styleA : styleB) === 'station' ? station : decide;
      const move = brain(t, p);
      try {
        t.act(p.id, move.action, move.amount);
      } catch {
        t.act(p.id, t.legalActions(p).canCheck ? 'check' : 'fold');
      }
    }
    netA += A.chips - STACK;
  }
  return (netA / hands) * 100 / BB; // big blinds per 100 hands
}

const HANDS = Number(process.argv[2]) || 300;
const matches = [
  ['expert', 'station'],
  ['shark', 'station'],
  ['expert', 'maniac'],
  ['expert', 'rock'],
  ['shark', 'maniac'],
];

console.log(`${HANDS} hands per match, result in bb/100 for the first player\n`);
for (const [a, b] of matches) {
  const bb100 = play(a, b, HANDS);
  const verdict = bb100 > 0 ? 'wins' : 'loses';
  console.log(`  ${a.padEnd(8)} vs ${b.padEnd(8)}  ${bb100 >= 0 ? '+' : ''}${bb100.toFixed(1).padStart(7)} bb/100  (${verdict})`);
}
