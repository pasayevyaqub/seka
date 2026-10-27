// v2.8 mühərrik testləri: kart xalının məxfiliyi, balans məxfiliyi, sekadan keçən bankın uçotu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Round, TIMING } from '../server/game/engine.js';

const c = (str) => ({ r: str.slice(0, -1), s: str.slice(-1) });
const h = (str) => str.split(' ').map(c);
const players = (n, bal = 1000) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, balance: bal }));
const dealer = (map) => (handNo, ids) => {
  const hands = map[handNo] || map[1];
  const out = {};
  ids.forEach((id) => { out[id] = h(hands[id]); });
  return out;
};
const mk = (n, hands, settings = {}, bal = 1000) => new Round({ players: players(n, bal), settings: { ante: 10, minBet: 10, ...settings }, now: 0, dealer: dealer(hands) });
// pul saxlanır: balanslar + real bank həmişə sabit (şərti/borca qoyuluş real xal deyil)
const money = (r) => [...r.players.values()].reduce((a, p) => a + p.balance, 0) + r.pot;

// ---------------- 1) kart xalı yalnız baxandan sonra ----------------
test('öz xalım kartlara baxmamışdan əvvəl göndərilmir; "look" versiyanı dəyişmir; raund sonunda görünür', () => {
  const r = mk(3, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } });
  const v0 = r.viewFor(1);
  assert.equal(v0.me.score, null);
  assert.equal(v0.me.looked, false);
  assert.ok(v0.me.cards, 'öz kartlarım küncdən baxmaq üçün göndərilir');
  assert.equal(v0.players.find((p) => p.id === 1).score, null);
  // rəqiblər nə kartımı, nə xalımı görür
  for (const o of [2, 3]) {
    const pv = r.viewFor(o).players.find((p) => p.id === 1);
    assert.equal(pv.cards, null); assert.equal(pv.score, null);
  }
  const ver = r.version;
  r.act(1, { type: 'look' }, 0);
  assert.equal(r.version, ver, 'baxmaq başqalarına heç nə dəyişmir');
  assert.equal(r.viewFor(1).me.score, 31);
  assert.equal(r.viewFor(2).players.find((p) => p.id === 1).score, null);
  // baxmayan P2 raund bitəndə öz xalını görür (nəticədə açılma qaydası)
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'baxis' }, 0); // P1 → P3
  assert.equal(r.viewFor(2).me.score, null);
  r.act(2, { type: 'baxis' }, 0); // P2 → P1
  assert.equal(r.phase, 'finished');
  assert.equal(r.viewFor(2).me.score, 15);
  // baxışmada iştirak etməyən P3 kartları P2-yə açılmır
  assert.equal(r.viewFor(2).players.find((p) => p.id === 3).cards, null);
});

test('seka: yeni əl — "baxdım" sıfırlanır; kart atma mərhələsində xal yoxdur', () => {
  const r = mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C' } });
  r.act(1, { type: 'look' }, 0);
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaStart' }, 0);
  assert.equal(r.viewFor(1).me.looked, false);
  r.act(1, { type: 'discard', index: 3 }, 0);
  r.act(2, { type: 'discard', index: 3 }, 0);
  assert.equal(r.viewFor(1).me.score, null);
  r.act(1, { type: 'look' }, 0);
  assert.equal(r.viewFor(1).me.score, 31);
});

test('botlar avtomatik "baxır" (bot qərarı öz xalına əsaslanır)', () => {
  const r = new Round({ players: [{ id: 1, name: 'A', balance: 100 }, { id: -1, name: 'Bot', balance: 100 }], settings: { ante: 10, minBet: 10 }, now: 0, dealer: dealer({ 1: { 1: 'TS KS DS', '-1': '7H 8H 9C' } }) });
  assert.equal(r.viewFor(-1).me.score, 15);
  assert.equal(r.viewFor(1).me.score, null);
});

// ---------------- 8) balans məxfiliyi ----------------
test('başqasının dəqiq balansı görünüşə düşmür, öz balansım düşür; risk məlumatı (bankdakı payı) görünür', () => {
  const r = mk(3, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } }, {}, 777);
  r.act(1, { type: 'xod', amount: 40 }, 0);
  const v = r.viewFor(2);
  assert.equal(v.players.find((p) => p.id === 2).balance, 767);
  for (const id of [1, 3]) assert.equal(v.players.find((p) => p.id === id).balance, null);
  assert.equal(v.players.find((p) => p.id === 1).put, 50);
  assert.ok(!JSON.stringify(v).includes('727'), 'P1-in balansı (727) heç bir sahədə yoxdur');
});

// ---------------- 5) sekadan qalan bank ----------------
function sekaSetup(n = 3, hands2 = { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C', 3: '9S 9H 10D 7C', 4: '6S 7S 8D 9C' }, settings = {}) {
  const first = { 1: '7S 8C 9D', 2: 'TC KC 7D', 3: '6H 7H 9S', 4: '8S 8H 10C' };
  const r = mk(n, { 1: first, 2: hands2 }, settings);
  return r;
}

test('seka: bank TAM keçir (10 haqq → 20 qoşulma), əsas oyunçular əlavə ödəmir, qalib hamısını alır', () => {
  const r = sekaSetup(3);
  const m0 = money(r);
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  assert.equal(r.pot, 50); // 3×10 haqq + 2×10 xod
  assert.equal(r.sekaJoin.carried, 50);
  assert.equal(r.sekaJoin.cost, 20); // 2 × oyun haqqı
  const b1 = r.players.get(1).balance; const b2 = r.players.get(2).balance;
  r.act(3, { type: 'sekaJoin' }, 0);
  assert.equal(r.pot, 70);
  assert.equal(r.players.get(1).balance, b1); assert.equal(r.players.get(2).balance, b2); // əsaslar ödəmir
  r.act(1, { type: 'sekaStart' }, 0);
  for (const id of [1, 2, 3]) r.act(id, { type: 'discard', index: 3 }, 0);
  assert.equal(r.viewFor(1).carry.pot, 50);
  r.act(1, { type: 'xod', amount: 10 }, 0); // bank 80
  r.act(2, { type: 'pas' }, 0);
  r.act(3, { type: 'pas' }, 0);
  assert.deepEqual(r.result.winners, [1]);
  assert.equal(r.result.payouts[1], 80);
  assert.equal(r.pot, 0);
  assert.equal(money(r), m0, 'heç bir xal itmədi və yaranmadı');
  // axınlar: hər kəsin qoyduğu qalibə
  const flows = Object.fromEntries(r.result.flows.map((f) => [`${f.from}>${f.to}`, f.cents]));
  assert.deepEqual(flows, { '2>1': 2000, '3>1': 3000 });
});

test('seka: raund başlayandan sonra otağa gələn oyunçu sekaya qoşula bilmir (cari bankdan pay almır)', () => {
  const r = sekaSetup(2);
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  // id 99 raundda deyil — mühərrik onu tanımır
  assert.throws(() => r.act(99, { type: 'sekaJoin' }, 0), /qoşula bilməzsiniz/);
  assert.deepEqual(r.sekaJoin.eligible, []);
});

test('seka əlində yenə bərabərlik → ikinci seka: bank yenə tam keçir, sonda bölünür', () => {
  const r = mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: 'TS 9S 7H 6C', 2: 'TC 9C 7D 6D' }, 3: { 1: 'DS DH 7C 6C', 2: '9S 9H 7S 6S' } });
  const m0 = money(r);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0); r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 3 }, 0); r.act(2, { type: 'discard', index: 3 }, 0);
  r.act(1, { type: 'xod', amount: 10 }, 0); r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'baxis' }, 0); // 20 = 20 → bərabər
  assert.equal(r.phase, 'tieDecision');
  r.act(1, { type: 'tieVote', choice: 'seka' }, 0); r.act(2, { type: 'tieVote', choice: 'seka' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  assert.equal(r.sekaJoin.carried, 50);
  assert.equal(r.viewFor(1).carry.hands, 2);
  r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 3 }, 0); r.act(2, { type: 'discard', index: 3 }, 0);
  r.act(1, { type: 'offerSplit' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.result.how, 'split');
  assert.deepEqual(r.result.payouts, { 1: 25, 2: 25 });
  assert.equal(money(r), m0);
});

test('seka: tək sayda bank bölünəndə 1 xal itmir (ilk tərəfə düşür)', () => {
  const r = mk(3, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D', 3: '6H 7H 9S' }, 2: { 1: 'TS 9S 7H 6C', 2: 'TC 9C 7D 6D', 3: '6S 7S 8D 9C' } });
  const m0 = money(r);
  r.act(1, { type: 'xod', amount: 11 }, 0);
  r.act(2, { type: 'xod', amount: 11 }, 0);
  r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(3, { type: 'sekaSkip' }, 0);
  r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 3 }, 0); r.act(2, { type: 'discard', index: 3 }, 0);
  r.act(1, { type: 'offerSplit' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.result.payouts[1] + r.result.payouts[2], 52);
  assert.equal(money(r), m0);
});

test('seka: cəkpot seka əlində — keçən bank cəkpot sahibinə, rəqib cəkpot haqqını ödəyir', () => {
  const r = mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: '6S 6H 6D TC', 2: '7H 8C 9D 10C' } }, { jackpotSix: 100 });
  const m0 = money(r);
  r.act(1, { type: 'xod', amount: 30 }, 0);
  r.act(2, { type: 'offerSeka' }, 0); r.act(1, { type: 'offerAccept' }, 0); r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 3 }, 0); r.act(2, { type: 'discard', index: 3 }, 0);
  assert.equal(r.result.how, 'jackpot');
  assert.equal(r.result.payouts[1], 50);
  assert.equal(r.players.get(1).balance, 1000 - 40 + 50 + 100);
  assert.equal(money(r), m0);
});

test('seka: əsas oyunçu qoşulma vaxtı çıxır → qalan əsas + qoşulan oynayır; çıxanın payı bankda qalır', () => {
  const r = sekaSetup(3);
  const m0 = money(r);
  r.act(1, { type: 'xod', amount: 10 }, 0); r.act(2, { type: 'xod', amount: 10 }, 0); r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(3, { type: 'sekaJoin' }, 0);
  r.removePlayer(2, 0);
  r.tick(TIMING.SEKA_JOIN_MS + 1);
  assert.equal(r.phase, 'discard');
  assert.deepEqual(r.active().sort(), [1, 3]);
  r.act(1, { type: 'discard', index: 3 }, 0); r.act(3, { type: 'discard', index: 3 }, 0);
  r.act(1, { type: 'pas' }, 0);
  assert.deepEqual(r.result.winners, [3]);
  assert.equal(r.result.payouts[3], 70);
  assert.equal(money(r), m0);
});

test('seka: hamı çıxsa raund ləğv olunur, hər kəsə qoyduğu qaytarılır (xal itmir)', () => {
  const r = sekaSetup(3);
  r.act(1, { type: 'xod', amount: 10 }, 0); r.act(2, { type: 'xod', amount: 10 }, 0); r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(3, { type: 'sekaJoin' }, 0);
  r.removePlayer(3, 0); r.removePlayer(1, 0); r.removePlayer(2, 0);
  r.tick(TIMING.SEKA_JOIN_MS + 1);
  assert.equal(r.result.how, 'aborted');
  for (const id of [1, 2, 3]) assert.equal(r.players.get(id).balance, 1000);
});

test('seka: raund ləğvi (server/otaq bağlanması) — seka zamanı qoyulanlar da qaytarılır', () => {
  const r = sekaSetup(3);
  r.act(1, { type: 'xod', amount: 10 }, 0); r.act(2, { type: 'xod', amount: 10 }, 0); r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(3, { type: 'sekaJoin' }, 0); r.act(1, { type: 'sekaStart' }, 0);
  r.abort();
  for (const id of [1, 2, 3]) assert.equal(r.players.get(id).balance, 1000);
});

test('seka + "Borca oyna": şərti qoyuluş sekadan ƏVVƏL bağlanır, keçən bank yalnız real xaldır (ikiqat sayılmır)', () => {
  const r = new Round({
    players: [{ id: 1, name: 'A', balance: 15 }, { id: 2, name: 'B', balance: 500 }],
    settings: { ante: 10, minBet: 10 }, now: 0,
    dealer: dealer({ 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C' } }),
  });
  r.allowCredit = true;
  const m0 = money(r);
  // A-nın oyun haqqından sonra 5 xalı qalır — xoda çatmır, borca oyun təklif edir
  r.act(1, { type: 'creditOffer', limit: 100, dueDays: 7 }, 0);
  r.act(2, { type: 'creditAccept', limit: 100 }, 0);
  r.act(1, { type: 'xod', amount: 30 }, 0); // 5 real + 25 borca
  assert.equal(r.creditPot, 25);
  r.act(2, { type: 'xod', amount: 30 }, 0);
  const realPot = r.pot;
  assert.equal(realPot, 10 + 10 + 5 + 30);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.creditPot, 0, 'şərti qoyuluş bağlandı');
  assert.equal(r.sekaJoin.carried, realPot, 'keçən bankda borca xal yoxdur');
  // borclunun öz payı ləğv, qarşı tərəfin payı (yarı, aşağı yuvarlaq) borc
  assert.deepEqual(r.creditLoans.map((l) => [l.borrower, l.lender, l.amount]), [[1, 2, 12]]);
  assert.equal(money(r), m0);
});
