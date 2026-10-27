import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Round } from '../server/game/engine.js';
import { decide, chooseDiscard } from '../server/game/bot.js';
import { score3 } from '../server/game/cards.js';

const c = (str) => ({ r: str.slice(0, -1), s: str.slice(-1) });
const h = (str) => str.split(' ').map(c);
const BOT = -1;

function round(hands, n = 2) {
  const players = [{ id: BOT, name: 'Bot 1', balance: 1000 }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, balance: 1000 }))];
  return new Round({ players, settings: { ante: 10, minBet: 10 }, now: 0, dealer: (no, ids) => Object.fromEntries(ids.map((id) => [id, h((hands[no] || hands[1])[id])])) });
}

test('bot kart atanda öz 4 kartından ən yaxşı 3-ü saxlayır', () => {
  const hand = h('TS 6H KS DS');
  const i = chooseDiscard(hand);
  assert.equal(score3(hand.filter((_, k) => k !== i)), 31);
});

test('bot yalnız öz görünüşünü alır: rəqib kartları görünüşdə yoxdur', () => {
  const r = round({ 1: { [BOT]: 'TS KS DS', 1: '7H 8H 9C' } });
  const v = r.viewFor(BOT, 0);
  assert.deepEqual(v.me.cards, h('TS KS DS'));
  assert.equal(v.players.find((p) => p.id === 1).cards, null);
  assert.equal(JSON.stringify(v).includes('"9C"') || JSON.stringify(v).includes('"r":"9","s":"C"'), false);
  const a = decide(v, BOT, {}, 0);
  assert.ok(['xod', 'baxis', 'pas', 'offerSeka', 'offerSplit'].includes(a.type));
});

test('bot təkliflərə cavab verir, seka qərarı verir, kart atır', () => {
  const r = round({ 1: { [BOT]: '7S 8C 9D', 1: 'TC KC 7D' }, 2: { [BOT]: 'TS KS DS 6H', 1: '7H 8C 9D 6C' } });
  // insan (P1) növbəsi deyil — bot birinci gedir; bot xod etsin
  r.act(BOT, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'offerSeka' }, 0);
  const a = decide(r.viewFor(BOT, 0), BOT, {}, 0);
  assert.ok(a.type === 'offerAccept' || a.type === 'offerDecline');
  r.act(BOT, { type: 'offerAccept' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  // qoşulmaq hüququ olan başqa oyunçu yoxdur — əsas oyunçu bot başlada bilər
  assert.deepEqual(r.viewFor(BOT, 0).sekaJoin.waiting, []);
  assert.equal(decide(r.viewFor(BOT, 15_000), BOT, {}, 15_000).type, 'sekaStart');
  r.act(BOT, { type: 'sekaStart' }, 15_000);
  const d = decide(r.viewFor(BOT, 15_000), BOT, {}, 15_000);
  assert.equal(d.type, 'discard');
  r.act(BOT, d, 15_000);
  assert.equal(score3(r.ps[BOT].cards), 31);
});

test('bot vaxtı keçən insana "pas" səsi verir (oyun kilidlənmir)', () => {
  const r = round({ 1: { [BOT]: '7S 8C 9D', 1: 'TC KC 7D' } });
  r.act(BOT, { type: 'xod', amount: 10 }, 0);
  const late = r.turnDeadline + 1;
  const a = decide(r.viewFor(BOT, late), BOT, {}, late);
  assert.equal(a.type, 'votePas');
  r.act(BOT, a, late);
  assert.equal(r.phase, 'finished');
});

test('yalnız botların oynadığı 300 raund həmişə bitir', () => {
  for (let g = 0; g < 300; g++) {
    const n = 2 + (g % 5);
    const players = Array.from({ length: n }, (_, i) => ({ id: -(i + 1), name: `Bot ${i + 1}`, balance: 1000 }));
    const r = new Round({ players, settings: { ante: 5, minBet: 5 }, now: 0 });
    const mem = new Map();
    let t = 0;
    for (let k = 0; k < 2000 && r.phase !== 'finished'; k++) {
      t += 1000;
      let acted = false;
      for (const p of players) {
        const key = `${p.id}:${r.handNo}`;
        if (!mem.has(key)) mem.set(key, {});
        const a = decide(r.viewFor(p.id, t), p.id, mem.get(key), t);
        if (!a) continue;
        try { r.act(p.id, a, t); acted = true; break; } catch { if (r.phase === 'betting' && r.turn === p.id) { r.act(p.id, { type: 'pas' }, t); acted = true; break; } }
      }
      if (!acted) r.tick(t + 60_000);
    }
    assert.equal(r.phase, 'finished', `raund ${g}`);
    assert.equal([...r.players.values()].reduce((s, p) => s + p.balance, 0), n * 1000);
  }
});
