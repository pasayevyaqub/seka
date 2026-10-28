// v3.2 mühərrik testləri: Seka seçimi ("Bankı saxla" / "Pulu böl və 2× Seka oyna"), "Nəyəsə gəlir?" təklifi,
// baxış xalının raund sonunda göstərilməsi. Bütün pul hərəkətləri mühərrikdə (serverdə) hesablanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Round, TIMING } from '../server/game/engine.js';

const c = (str) => ({ r: str.slice(0, -1), s: str.slice(-1) });
const h = (str) => str.split(' ').map(c);
const players = (n, bals) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, balance: Array.isArray(bals) ? bals[i] : bals ?? 10_000 }));
const dealer = (map) => (handNo, ids) => { const hands = map[handNo] || map[1]; const out = {}; ids.forEach((id) => { out[id] = h(hands[id]); }); return out; };
const mk = (n, hands, settings = {}, bals) => new Round({ players: players(n, bals), settings: { ante: 10, minBet: 10, ...settings }, now: 0, dealer: dealer(hands) });
const money = (r) => [...r.players.values()].reduce((a, p) => a + p.balance, 0) + r.pot;
const bal = (r, id) => r.players.get(id).balance;
const effSum = (r) => r.drainEffects().reduce((m, e) => ({ ...m, [e.userId]: (m[e.userId] || 0) + e.delta }), {});

// P1: 31 (TS KS DS), P2: 21 (TC KC 7D → 10+10+... ), P3 pas edir
const FIRST = { 1: '7S 8C 9D', 2: 'TC KC 7D', 3: '6H 7H 9S', 4: '8S 8H 10C' };
const SEKA = { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C', 3: '9S 9H 10D 7C', 4: '6S 7S 8D 9C' };

// iki oyunçu qalana qədər: P1 və P2 xod edir (xod məbləği böyük — bank böyüsün), qalanlar pas
function twoLeft(n = 3, bet = 10, bals) {
  const r = mk(n, { 1: FIRST, 2: SEKA }, {}, bals);
  r.act(1, { type: 'xod', amount: bet }, 0);
  r.act(2, { type: 'xod', amount: bet }, 0);
  for (let id = 3; id <= n; id++) r.act(id, { type: 'pas' }, 0);
  return r;
}

const hi = (rr) => { rr.ps[1].cards = h('TS KS DS'); rr.ps[2].cards = h('7H 8C 9D'); return rr; }; // P1 xalı çoxdur

// ---------------- 1) Seka: "Bankı saxla" / "Pulu böl və 2× Seka oyna" ----------------
test('seka seçimi: hər iki "Bankı saxla" → bank qalır, qoşulma minimumu = bankdakı məbləğ (məs. 5000)', () => {
  const r = twoLeft(3, 2485, [10_000, 10_000, 9_000]); // bank: 3×10 + 2×2485 = 5000
  const m0 = money(r);
  assert.equal(r.pot, 5000);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.phase, 'sekaChoice');
  assert.throws(() => r.act(3, { type: 'sekaChoice', choice: 'keep' }, 0), /gözlənilmir/);
  r.act(1, { type: 'sekaChoice', choice: 'keep' }, 0);
  assert.throws(() => r.act(1, { type: 'sekaChoice', choice: 'split' }, 0), /Artıq/); // ikinci dəfə olmaz
  assert.equal(r.phase, 'sekaChoice');
  r.act(2, { type: 'sekaChoice', choice: 'keep' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  assert.equal(r.sekaJoin.mode, 'keep');
  assert.equal(r.sekaJoin.cost, 5000);
  assert.equal(r.pot, 5000);
  const b3 = bal(r, 3);
  r.act(3, { type: 'sekaJoin' }, 0);
  assert.equal(bal(r, 3), b3 - 5000);
  assert.equal(r.pot, 10_000);
  assert.throws(() => r.act(3, { type: 'sekaJoin' }, 0), /Artıq/); // ikiqat tutulmur
  assert.equal(money(r), m0);
});

test('seka "Bankı saxla": balansı bankdakı məbləğə çatmayan oyunçu qoşula bilmir', () => {
  const r = twoLeft(3, 2485, [10_000, 10_000, 4_000]);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaChoice', choice: 'keep' }, 0); r.act(2, { type: 'sekaChoice', choice: 'keep' }, 0);
  assert.deepEqual(r.sekaWaiting(), []);
  assert.throws(() => r.act(3, { type: 'sekaJoin' }, 0), /limiti/);
});

test('seka "Pulu böl və 2× Seka oyna": bank yarıya bölünür, sonra hamı 2× oyun haqqı qoyur; xal itmir və yaranmır', () => {
  const r = twoLeft(3, 10);
  const m0 = money(r);
  assert.equal(r.pot, 50);
  const b1 = bal(r, 1); const b2 = bal(r, 2); const b3 = bal(r, 3);
  r.drainEffects();
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaChoice', choice: 'split' }, 0); r.act(2, { type: 'sekaChoice', choice: 'split' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  assert.equal(r.sekaJoin.mode, 'split');
  // 50 → 25 + 25; sonra hər əsas oyunçu 20 qoyur
  assert.equal(bal(r, 1), b1 + 25 - 20); assert.equal(bal(r, 2), b2 + 25 - 20);
  assert.equal(r.pot, 40);
  assert.equal(r.sekaJoin.cost, 20);
  r.act(3, { type: 'sekaJoin' }, 0);
  assert.equal(bal(r, 3), b3 - 20);
  assert.equal(r.pot, 60);
  assert.equal(money(r), m0);
  const eff = effSum(r);
  assert.deepEqual(eff, { 1: 5, 2: 5, 3: -20 });
  // seka əli: hamı kart atır, P1 xod, digərləri pas → P1 60 + 10 alır
  r.act(1, { type: 'sekaStart' }, 0);
  for (const id of [1, 2, 3]) r.act(id, { type: 'discard', index: 3 }, 0);
  r.act(1, { type: 'xod', amount: 10 }, 0); r.act(2, { type: 'pas' }, 0); r.act(3, { type: 'pas' }, 0);
  assert.deepEqual(r.result.winners, [1]);
  assert.equal(r.result.payouts[1], 70);
  assert.equal(money(r), m0);
  // qarşılıqlı nəticə (axınlar): hər oyunçunun cəmi (bölgü + seka əli) raund əvvəlindən balans dəyişikliyinə bərabərdir
  const net = {};
  for (const f of r.result.flows) { net[f.from] = (net[f.from] || 0) - f.cents; net[f.to] = (net[f.to] || 0) + f.cents; }
  for (const id of [1, 2, 3]) assert.equal(net[id] || 0, (bal(r, id) - 10_000) * 100, `P${id}`);
});

test('seka seçimi razılaşmayanda: xalı çox olanın seçimi; xallar bərabərdirsə təklifi alanın seçimi', () => {
  // P1 31 xal, P2 daha az (təklif: P1 → P2). P1 "böl", P2 "saxla" → xalı çox olan P1 → böl
  const r = hi(twoLeft(3, 10));
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaChoice', choice: 'split' }, 0); r.act(2, { type: 'sekaChoice', choice: 'keep' }, 0);
  assert.equal(r.sekaJoin.mode, 'split');
  assert.ok(r.log.some((l) => /xalı çox olan P1/.test(l.msg)));
  // tərsi: P1 "saxla", P2 "böl" → P1 → saxla
  const r2 = hi(twoLeft(3, 10));
  r2.act(1, { type: 'offerSeka' }, 0); r2.act(2, { type: 'offerAccept' }, 0);
  r2.act(2, { type: 'sekaChoice', choice: 'split' }, 0); r2.act(1, { type: 'sekaChoice', choice: 'keep' }, 0);
  assert.equal(r2.sekaJoin.mode, 'keep');
  // bərabər xal (baxışmada bərabərlik → hər ikisi "Seka"): təklifi alan (baxılan) P2 seçir
  const r3 = mk(2, { 1: { 1: 'TS 9S 6H', 2: 'TC 9C 6D' }, 2: SEKA });
  r3.act(1, { type: 'xod', amount: 10 }, 0); r3.act(2, { type: 'xod', amount: 10 }, 0);
  r3.act(1, { type: 'baxis' }, 0);
  assert.equal(r3.phase, 'tieDecision');
  r3.act(1, { type: 'tieVote', choice: 'seka' }, 0); r3.act(2, { type: 'tieVote', choice: 'seka' }, 0);
  assert.equal(r3.phase, 'sekaChoice');
  r3.act(1, { type: 'sekaChoice', choice: 'keep' }, 0); r3.act(2, { type: 'sekaChoice', choice: 'split' }, 0);
  assert.equal(r3.sekaJoin.mode, 'split');
  assert.ok(r3.log.some((l) => /təklifi alan P2/.test(l.msg)));
  // kimin seçiminin üstün olduğu (xalı çox olan) görünüşdə yoxdur
  const r4 = twoLeft(3, 10); r4.act(1, { type: 'offerSeka' }, 0); r4.act(2, { type: 'offerAccept' }, 0);
  for (const id of [1, 2, 3]) assert.equal(r4.viewFor(id).pending.chooser, undefined);
});

test('seka seçimi: vaxt bitəndə — bir seçim varsa o, heç kim seçməyibsə "Bankı saxla"; çıxan oyunçu uduzur', () => {
  const r = twoLeft(3, 10);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(2, { type: 'sekaChoice', choice: 'split' }, 0);
  assert.equal(r.tick(TIMING.DECISION_MS - 1), false);
  assert.equal(r.tick(TIMING.DECISION_MS), true);
  assert.equal(r.sekaJoin.mode, 'split');
  const r2 = hi(twoLeft(3, 10));
  r2.act(1, { type: 'offerSeka' }, 0); r2.act(2, { type: 'offerAccept' }, 0);
  r2.tick(TIMING.DECISION_MS);
  assert.equal(r2.sekaJoin.mode, 'keep');
  const r3 = twoLeft(3, 10); const m0 = money(r3);
  r3.act(1, { type: 'offerSeka' }, 0); r3.act(2, { type: 'offerAccept' }, 0);
  r3.removePlayer(1, 0);
  assert.equal(r3.phase, 'finished'); assert.deepEqual(r3.result.winners, [2]); assert.equal(money(r3), m0);
});

test('seka "böl" sonra raund ləğv olunarsa: yalnız bölgüdən sonrakı qoyuluşlar qaytarılır, xal itmir', () => {
  const r = twoLeft(3, 10); const m0 = money(r);
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaChoice', choice: 'split' }, 0); r.act(2, { type: 'sekaChoice', choice: 'split' }, 0);
  r.act(3, { type: 'sekaJoin' }, 0);
  const before = { 1: bal(r, 1), 2: bal(r, 2), 3: bal(r, 3) };
  r.abort();
  assert.equal(bal(r, 1), before[1] + 20); assert.equal(bal(r, 2), before[2] + 20); assert.equal(bal(r, 3), before[3] + 20);
  assert.equal(money(r), m0);
});

// ---------------- 2) "Nəyəsə gəlir?" ----------------
test('"Nəyəsə gəlir?": yalnız növbəsi olan, yalnız 2 oyunçu qalanda; təklif çata yazılır', () => {
  const r3 = mk(3, { 1: FIRST, 2: SEKA });
  r3.act(1, { type: 'xod', amount: 10 }, 0);
  assert.throws(() => r3.act(2, { type: 'offerAny' }, 0), /2 oyunçu/);
  const r = twoLeft(3, 10);
  assert.equal(r.turn, 1);
  assert.throws(() => r.act(2, { type: 'offerAny' }, 0), /Növbə/);
  r.act(1, { type: 'offerAny' }, 0);
  assert.equal(r.phase, 'offer'); assert.equal(r.pending.kind, 'any'); assert.equal(r.pending.to, 2);
  assert.deepEqual(r.chatOut.map((x) => x.userId), [1]);
  assert.match(r.chatOut[0].text, /nəyəsə gəlir/i);
  assert.throws(() => r.act(3, { type: 'offerReply', choice: 'split' }, 0), /gözlənilmir/);
  assert.throws(() => r.act(1, { type: 'offerReply', choice: 'split' }, 0), /gözlənilmir/);
  assert.throws(() => r.act(2, { type: 'offerAccept' }, 0), /Seçim edin/);
  assert.throws(() => r.act(2, { type: 'offerReply', choice: 'xyz' }, 0), /Yanlış/);
});

test('"Nəyəsə gəlir?" → "Heç nəyə gəlmirəm, davam elə": təklif bağlanır, növbəli oyunçu xod/pas/baxış edə bilir', () => {
  for (const next of ['xod', 'pas', 'baxis']) {
    const r = twoLeft(3, 10); const m0 = money(r);
    r.act(1, { type: 'offerAny' }, 0);
    r.act(2, { type: 'offerReply', choice: 'no' }, 0);
    assert.equal(r.phase, 'betting'); assert.equal(r.turn, 1); assert.equal(r.pending, null);
    assert.equal(r.chatOut.at(-1).text, 'Heç nəyə gəlmirəm, davam elə');
    assert.throws(() => r.act(1, { type: 'offerAny' }, 0), /artıq təklif/); // eyni növbədə təkrar yox
    assert.throws(() => r.act(2, { type: 'offerReply', choice: 'seka' }, 0), /gözlənilmir/); // cavab ikinci dəfə emal olunmur
    r.act(1, { type: next, amount: 10 }, 0);
    assert.notEqual(r.phase, 'offer');
    assert.equal(money(r), m0);
  }
});

test('"Nəyəsə gəlir?" → "½ bölək": bank bərabər bölünür; → "Seka": seka seçiminə keçir (təklifi alan = cavab verən)', () => {
  const r = twoLeft(3, 10); const m0 = money(r);
  const b1 = bal(r, 1); const b2 = bal(r, 2);
  r.act(1, { type: 'offerAny' }, 0);
  r.act(2, { type: 'offerReply', choice: 'split' }, 0);
  assert.equal(r.phase, 'finished'); assert.equal(r.result.how, 'split');
  assert.equal(bal(r, 1), b1 + 25); assert.equal(bal(r, 2), b2 + 25);
  assert.equal(money(r), m0);
  const s = twoLeft(3, 10);
  s.act(1, { type: 'offerAny' }, 0);
  s.act(2, { type: 'offerReply', choice: 'seka' }, 0);
  assert.equal(s.phase, 'sekaChoice'); assert.equal(s.pending.receiver, 2);
  // vaxt bitdi, cavab yoxdur → təklif rədd sayılır, oyun davam edir
  const t = twoLeft(3, 10);
  t.act(1, { type: 'offerAny' }, 0);
  t.tick(t.pending.deadline);
  assert.equal(t.phase, 'betting'); assert.equal(t.turn, 1);
});

// ---------------- 3) Baxış nəticəsi raund sonunda ----------------
test('baxış: az xallı uduzur; xallar raund bitənə qədər gizli; bərabər xal qərarında xal yalnız iki tərəfə', () => {
  const r = mk(4, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C', 4: '6S 7C 9H' } });
  for (const id of [1, 2, 3, 4]) r.act(id, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'baxis' }, 0); // P1 → P4
  assert.equal(r.ps[4].status, 'lost');
  for (const id of [2, 3]) {
    const v = r.viewFor(id);
    assert.equal(v.result, null);
    assert.equal(v.players.find((p) => p.id === 1).score, null); assert.equal(v.players.find((p) => p.id === 4).score, null);
  }
  r.act(2, { type: 'pas' }, 0); r.act(3, { type: 'pas' }, 0);
  assert.equal(r.phase, 'finished');
  const res = r.viewFor(3).result;
  assert.equal(res.compares.length, 1);
  assert.equal(res.compares[0].aScore, 31);
  assert.ok(r.log.some((l) => /P1-in baxış vaxtı xalı 31 idi/.test(l.msg)));
  // bərabərlik qərarı: score sahəsi üçüncü şəxsə göndərilmir
  const t = mk(3, { 1: { 1: '7H 8C 9D', 2: 'TC 9C 6D', 3: 'TS 9S 6H' }, 2: SEKA });
  for (const id of [1, 2, 3]) t.act(id, { type: 'xod', amount: 10 }, 0);
  t.act(1, { type: 'pas' }, 0);
  t.act(2, { type: 'baxis' }, 0);
  assert.equal(t.phase, 'tieDecision');
  assert.equal(t.viewFor(1).pending.score, undefined);
  assert.equal(t.viewFor(2).pending.score, 20);
  assert.ok(!t.log.some((l) => /\b20\b/.test(l.msg)));
});
