import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score3, handScore, isJackpot, jackpotKind } from '../server/game/cards.js';
import { score3 as clientScore3 } from '../public/score.js';
import { Round, GameError, TIMING } from '../server/game/engine.js';

// 'TS' -> {r:'T', s:'S'}, '10H' -> {r:'10', s:'H'}
const c = (str) => ({ r: str.slice(0, -1), s: str.slice(-1) });
const h = (str) => str.split(' ').map(c);

const players = (n, bal = 1000) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, balance: bal }));
const dealer = (map) => (handNo, ids) => {
  const hands = map[handNo] || map[1];
  const out = {};
  ids.forEach((id) => { out[id] = h(hands[id]); });
  return out;
};
const total = (r) => [...r.players.values()].reduce((a, p) => a + p.balance, 0);
const mk = (n, hands, settings = {}, bal = 1000) => new Round({ players: players(n, bal), settings: { ante: 10, minBet: 10, ...settings }, now: 0, dealer: dealer(hands) });
const flowsOf = (r) => Object.fromEntries(r.result.flows.map((f) => [`${f.from}>${f.to}`, f.cents]));

// ---------------- xal ----------------
test('xal hesablama', () => {
  assert.equal(score3(h('7S 7H 7D')), 21);
  assert.equal(score3(h('DS DH DC')), 30);
  assert.equal(score3(h('DS KS TS')), 31);
  assert.equal(score3(h('6H 7H 8H')), 21);
  assert.equal(score3(h('TS 9S 7H')), 20);
  assert.equal(score3(h('TS 9H 7D')), 11);
  assert.equal(handScore(h('10C VC 6D')), 20);
});

test('cəkpot kombinasiyaları', () => {
  assert.ok(isJackpot(h('6S 6H 6D')));
  assert.ok(isJackpot(h('TS TH TD')));
  assert.ok(!isJackpot(h('7S 7H 7D')));
  assert.ok(!isJackpot(h('TS TH 6D')));
});

// ---------------- əsas axın ----------------
test('adi raund: oyun haqqı, xod, baxışma, qalib, kartlar nəticədə açılır', () => {
  const r = mk(3, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } });
  assert.equal(r.pot, 30);
  assert.equal(r.turn, 1);
  r.act(1, { type: 'xod', amount: 20 }, 0);
  assert.throws(() => r.act(1, { type: 'xod', amount: 20 }, 0), GameError);
  assert.throws(() => r.act(2, { type: 'xod', amount: 10 }, 0), /Minimum/);
  assert.throws(() => r.act(2, { type: 'baxis' }, 0), /ilk xod/);
  r.act(2, { type: 'xod', amount: 20 }, 0);
  r.act(3, { type: 'xod', amount: 20 }, 0);
  r.act(1, { type: 'baxis' }, 0); // P1 → P3
  assert.equal(r.ps[3].status, 'lost');
  // baxışan ikisi bir-birinin kartını görür, P2 görmür
  assert.ok(r.viewFor(1).players.find((p) => p.id === 3).cards);
  assert.equal(r.viewFor(2).players.find((p) => p.id === 3).cards, null);
  assert.equal(r.viewFor(2).players.find((p) => p.id === 1).cards, null);
  r.act(2, { type: 'baxis' }, 0); // P2 → P1
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [1]);
  assert.equal(r.result.how, 'compare');
  assert.deepEqual(r.result.shown.map((s) => [s.id, s.score]), [[1, 31], [2, 15]]);
  // izləyici (raundda olmayan) də nəticə kartlarını görür, amma P3-ünkünü yox
  const spectator = r.viewFor(99);
  assert.ok(spectator.players.find((p) => p.id === 1).cards);
  assert.equal(spectator.players.find((p) => p.id === 3).cards, null);
  assert.equal(total(r), 3000);
});

test('"Oyunum yoxdur" əmri artıq qəbul edilmir', () => {
  const r = mk(2, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } });
  assert.throws(() => r.act(1, { type: 'yox' }, 0), /Naməlum/);
  assert.equal(r.viewFor(1).me.canYox, undefined);
});

test('pasla bitən raundda kartlar açılmır', () => {
  const r = mk(3, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } }, { ante: 5 });
  r.act(1, { type: 'pas' }, 0);
  r.act(2, { type: 'pas' }, 0);
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [3]);
  assert.deepEqual(r.result.shown, []);
  for (const viewer of [1, 2, 99]) for (const p of r.viewFor(viewer).players) if (p.id !== viewer) assert.equal(p.cards, null);
});

test('baxış seçimi: ilk dövrdən əvvəl bağlı, sonra açıq', () => {
  const r = mk(3, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } });
  assert.equal(r.viewFor(1).me.canBaxis, false);
  assert.match(r.viewFor(1).me.baxisHint, /ilk xod/);
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'xod', amount: 10 }, 0);
  assert.equal(r.viewFor(1).me.canBaxis, true);
  assert.equal(r.viewFor(1).me.baxisTarget, 3);
});

// ---------------- 2 oyunçu təklifləri ----------------
const two = (s = {}) => mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C' } }, s);

test('bölmə təklifi qəbul → bank yarı bölünür, kartlar açılmır', () => {
  const r = two();
  r.act(1, { type: 'xod', amount: 30 }, 0);
  r.act(2, { type: 'offerSplit' }, 0);
  assert.equal(r.phase, 'offer');
  assert.throws(() => r.act(2, { type: 'offerAccept' }, 0), /cavab/);
  r.act(1, { type: 'offerAccept' }, 0);
  assert.equal(r.phase, 'finished');
  assert.equal(r.result.how, 'split');
  assert.equal(r.result.payouts[1], 25);
  assert.equal(r.result.payouts[2], 25);
  assert.deepEqual(r.result.shown, []);
  assert.equal(total(r), 2000);
});

test('təklif rədd → oyun davam edir, növbə vaxtı uzanmır, bölgü yaranmır', () => {
  const r = two({ turnSeconds: 60 });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  const dl = r.turnDeadline;
  r.act(2, { type: 'offerSeka' }, 1000);
  assert.ok(r.pending.deadline <= dl);
  r.act(1, { type: 'offerDecline' }, 2000);
  assert.equal(r.phase, 'betting');
  assert.equal(r.turn, 2);
  assert.equal(r.turnDeadline, dl);
  assert.equal(r.pot, 30);
  // eyni növbədə ikinci təklif olmaz
  assert.throws(() => r.act(2, { type: 'offerSplit' }, 3000), /artıq təklif/);
  assert.equal(r.viewFor(2, 3000).me.canOffer, false);
  r.act(2, { type: 'xod', amount: 10 }, 3000);
  // yeni növbədə yenidən olar
  assert.equal(r.viewFor(1, 3000).me.canOffer, true);
});

test('təklifə vaxtında cavab verilməsə rədd sayılır; vaxt azdırsa təklif olmaz', () => {
  const r = two({ turnSeconds: 60 });
  r.act(1, { type: 'offerSplit' }, 0);
  r.tick(TIMING.OFFER_MS + 1);
  assert.equal(r.phase, 'betting');
  assert.equal(r.turn, 1);
  assert.equal(r.pot, 20);
  const r2 = two({ turnSeconds: 60 });
  assert.throws(() => r2.act(1, { type: 'offerSeka' }, 57_000), /vaxt azdır/);
});

test('təklif yalnız 2 oyunçu qalanda və yalnız növbəsi olana', () => {
  const r = mk(3, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } });
  assert.throws(() => r.act(1, { type: 'offerSplit' }, 0), /2 oyunçu/);
  const r2 = two();
  assert.throws(() => r2.act(2, { type: 'offerSplit' }, 0), /Növbə/);
});

test('Seka təklifi qəbul → bank saxlanılır, 4 kart, oyunçu özü kart atır', () => {
  const r = mk(3, {
    1: { 1: '7S 8C 9D', 2: 'TC KC 7D', 3: '6H 7H 9S' },
    2: { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C', 3: '9S 9H 10D 7C' },
  });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  const pot = r.pot;
  assert.equal(pot, 50);
  r.act(3, { type: 'sekaJoin' }, 0);
  assert.equal(r.pot, 70);
  r.act(1, { type: 'sekaStart' }, 0);
  assert.equal(r.phase, 'discard');
  // hamı seçmədən xod olmaz
  assert.throws(() => r.act(1, { type: 'xod', amount: 10 }, 0), /xod etmək olmaz/);
  const v1 = r.viewFor(1);
  assert.equal(v1.me.hand.length, 4);
  assert.equal(v1.me.mustDiscard, true);
  assert.equal(v1.me.cards, null);
  r.act(1, { type: 'discard', index: 0 }, 0); // TS-i atır (pis seçim — sistem düzəltmir)
  assert.throws(() => r.act(1, { type: 'discard', index: 1 }, 0), /Artıq/);
  assert.deepEqual(r.ps[1].cards, h('KS DS 6H'));
  assert.equal(handScore(r.ps[1].cards), 20);
  // atılan kart rəqibə göndərilmir
  const v2 = r.viewFor(2);
  assert.equal(JSON.stringify(v2).includes('"discarded":{'), false);
  r.act(2, { type: 'discard', index: 3 }, 0);
  r.act(3, { type: 'discard', index: 3 }, 0);
  assert.equal(r.phase, 'betting');
  assert.equal(r.ps[2].cards.length, 3);
});

test('kart atma vaxtı bitdi → 4-cü kart avtomatik atılır (ən yaxşı seçilmir)', () => {
  const r = two();
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'offerSeka' }, 0);
  r.act(1, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaStart' }, 0);
  assert.equal(r.phase, 'discard');
  r.act(2, { type: 'discard', index: 0 }, 0);
  r.tick(TIMING.DISCARD_MS + 1);
  assert.equal(r.phase, 'betting');
  // qayda həmişə 4-cü kartdır (ən yaxşı seçim axtarılmır)
  assert.deepEqual(r.ps[1].discarded, c('6H'));
});

test('kart atma zamanı oyunçu çıxsa oyun kilidlənmir', () => {
  const r = mk(3, {
    1: { 1: '7S 8C 9D', 2: 'TC KC 7D', 3: '6H 7H 9S' },
    2: { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C', 3: '9S 9H 10D 7C' },
  });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  r.act(3, { type: 'sekaJoin' }, 0);
  r.act(2, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 3 }, 0);
  r.act(2, { type: 'discard', index: 3 }, 0);
  r.removePlayer(3, 0); // P3 seçmədən çıxdı → qalanlar davam edir
  assert.equal(r.phase, 'betting');
  r.removePlayer(2, 0);
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [1]);
  assert.equal(total(r), 3000);
});

test('sekada cəkpot saxlanılan 3 karta əsaslanır', () => {
  const r = mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: '6S 6H 6D TC', 2: '7H 8C 9D 10C' } }, { jackpotSix: 100, jackpotAce: 100 });
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 0 }, 0); // 6S atdı → 6H 6D TC — cəkpot deyil
  r.act(2, { type: 'discard', index: 3 }, 0);
  assert.equal(r.phase, 'betting');
  const r2 = mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: '6S 6H 6D TC', 2: '7H 8C 9D 10C' } }, { jackpotSix: 100, jackpotAce: 100 });
  r2.act(1, { type: 'offerSeka' }, 0);
  r2.act(2, { type: 'offerAccept' }, 0);
  r2.act(1, { type: 'sekaStart' }, 0);
  r2.act(1, { type: 'discard', index: 3 }, 0); // TC atdı → 6-6-6 cəkpot
  r2.act(2, { type: 'discard', index: 3 }, 0);
  assert.equal(r2.result.how, 'jackpot');
  assert.equal(r2.players.get(1).balance, 1000 - 10 + 20 + 100);
  assert.deepEqual(r2.result.shown.map((s) => s.id), [1]);
});

test('bərabər xal qaydası qalır: son baxışma bərabər → seka/bölmə qərarı', () => {
  const r = mk(2, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'baxis' }, 0);
  assert.equal(r.phase, 'tieDecision');
  assert.throws(() => r.act(1, { type: 'offerSplit' }, 0), /xod etmək olmaz/);
  r.act(1, { type: 'tieVote', choice: 'seka' }, 0);
  assert.throws(() => r.act(1, { type: 'tieVote', choice: 'bol' }, 0), /Artıq/);
  r.act(2, { type: 'tieVote', choice: 'bol' }, 0);
  assert.equal(r.result.how, 'split');
  assert.equal(r.result.payouts[1], 25);
  assert.equal(r.result.shown.length, 2);
});

test('eyni xala baxaq: şərik, partnyor udanda bank bölünür', () => {
  const r = mk(3, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6S' } });
  [1, 2, 3, 1].forEach((id) => r.act(id, { type: 'xod', amount: 10 }, 0));
  r.act(2, { type: 'baxis', tieOffer: true }, 0);
  r.act(1, { type: 'tieAccept' }, 0);
  assert.equal(r.ps[2].status, 'attached');
  r.act(3, { type: 'baxis' }, 0); // P3(17) vs P1(21)
  assert.deepEqual(r.result.winners.sort(), [1, 2]);
  const pot = 30 + 40 + 10 + 10;
  assert.equal(r.result.payouts[1] + r.result.payouts[2], pot);
  assert.equal(r.result.payouts[1], pot / 2);
});

test('vaxt bitdi → səsvermə ilə pas', () => {
  const r = mk(4, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6C', 4: '7S 8C 9H' } }, { turnSeconds: 60 });
  assert.throws(() => r.act(2, { type: 'votePas' }, 30_000), /Vaxt/);
  r.act(2, { type: 'votePas' }, 61_000);
  assert.throws(() => r.act(2, { type: 'votePas' }, 61_000), /Artıq/);
  r.act(3, { type: 'votePas' }, 61_000);
  assert.equal(r.ps[1].status, 'folded');
  assert.equal(r.turn, 2);
});

test('balans 0-dan aşağı düşmür; maksimum xod', () => {
  const r = mk(2, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } }, {}, 100);
  assert.throws(() => r.act(1, { type: 'xod', amount: 91 }, 0), /Balans/);
  r.act(1, { type: 'xod', amount: 90 }, 0);
  assert.equal(r.players.get(1).balance, 0);
  // oyun haqqına çatmayan raunda qoşulmur
  assert.throws(() => new Round({ players: [{ id: 1, name: 'a', balance: 5 }, { id: 2, name: 'b', balance: 100 }], settings: { ante: 10 }, now: 0 }), /oyun haqqına/);
  const r2 = mk(2, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } }, { maxBet: 50 });
  assert.throws(() => r2.act(1, { type: 'xod', amount: 60 }, 0), /Maksimum/);
});

test('versiya hər dəyişiklikdə artır (köhnə klik yoxlaması üçün)', () => {
  const r = two();
  const v = r.version;
  r.act(1, { type: 'xod', amount: 10 }, 0);
  assert.ok(r.version > v);
  const v2 = r.version;
  assert.equal(r.tick(1), false);
  assert.equal(r.version, v2);
});

// ---------------- qarşılıqlı nəticə axınları ----------------
test('axınlar: qalibin öz payı özünə yazılmır', () => {
  const r = mk(3, { 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } });
  r.act(1, { type: 'xod', amount: 20 }, 0);
  r.act(2, { type: 'pas' }, 0);
  r.act(3, { type: 'pas' }, 0);
  assert.deepEqual(flowsOf(r), { '2>1': 1000, '3>1': 1000 });
});

test('axınlar: bölmədə hər kəsin qoyduğu payı bankdan aldığı paya mütənasib gedir', () => {
  const r = two();
  r.act(1, { type: 'xod', amount: 30 }, 0); // P1: 40, P2: 10 → bank 50
  r.act(2, { type: 'offerSplit' }, 0);
  r.act(1, { type: 'offerAccept' }, 0);
  // hər biri 25 alır: P1-in 40-ının yarısı (20) P2-yə, P2-nin 10-unun yarısı (5) P1-ə
  assert.deepEqual(flowsOf(r), { '1>2': 2000, '2>1': 500 });
});

test('axınlar: seka daşınan bank, cəkpot, ləğv', () => {
  // seka: P3 birinci əldə pas deyib sekaya qoşulmur — onun 10-u final qalibinə gedir
  const r = mk(3, {
    1: { 1: '7S 8C 9D', 2: 'TC KC 7D', 3: '6H 7H 9S' },
    2: { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C' },
  });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 3 }, 0);
  r.act(2, { type: 'discard', index: 3 }, 0);
  r.act(1, { type: 'pas' }, 0);
  assert.deepEqual(r.result.winners, [2]);
  assert.deepEqual(flowsOf(r), { '1>2': 2000, '3>2': 1000 });
  // cəkpot
  const j = mk(3, { 1: { 1: '6S 6H 6D', 2: 'TC KC 7D', 3: '9D 8D 6C' } }, { jackpotSix: 100, jackpotAce: 100 });
  assert.deepEqual(flowsOf(j), { '2>1': 11000, '3>1': 11000 });
  // ləğv — axın yoxdur, pul qaytarılır
  const a = mk(3, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6C' } });
  a.act(1, { type: 'xod', amount: 50 }, 0);
  a.abort();
  assert.deepEqual(a.result.flows, []);
  assert.equal(total(a), 3000);
  assert.equal(a.players.get(1).balance, 1000);
});

test('axınlar: tək qəpik də itmir (3-ə bölünməyən bank)', () => {
  const r = mk(3, { 1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6S' } }, { ante: 7, minBet: 7 });
  [1, 2, 3, 1].forEach((id) => r.act(id, { type: 'xod', amount: 7 }, 0));
  r.act(2, { type: 'baxis', tieOffer: true }, 0);
  r.act(1, { type: 'tieAccept' }, 0);
  r.act(3, { type: 'baxis' }, 0);
  const sum = r.result.flows.reduce((s, f) => s + f.cents, 0);
  const selfShare = Object.entries(r.contrib).reduce((s, [id, cc]) => s + cc * 100 * (r.result.payouts[id] || 0) / r.result.payouts[1] / 2, 0);
  assert.ok(sum > 0 && selfShare > 0);
  // hər oyunçunun axın + özünə qalan payı = qoyduğu
  for (const [id, cc] of Object.entries(r.contrib)) {
    const out = r.result.flows.filter((f) => String(f.from) === id).reduce((s, f) => s + f.cents, 0);
    assert.ok(out <= cc * 100);
  }
});

// ---------------- təsadüfi sınaq ----------------
test('təsadüfi raundlar: pul itmir, oyun bitir, axınlar balansla uyğundur', () => {
  for (let g = 0; g < 400; g++) {
    const n = 2 + (g % 7);
    const r = new Round({ players: players(n), settings: { ante: 5, minBet: 5, jackpotSix: 50, jackpotAce: 70 }, now: 0 });
    let guard = 0;
    const rnd = (k) => Math.floor(Math.random() * k);
    while (r.phase !== 'finished' && guard++ < 800) {
      if (r.phase === 'betting') {
        const id = r.turn;
        const opts = ['xod', 'xod', 'pas'];
        if (r.firstCircleDone()) opts.push('baxis', 'baxis');
        if (r.active().length === 2 && !r.offerUsed) opts.push('offerSeka', 'offerSplit');
        let t = opts[rnd(opts.length)];
        if (r.isSecretHolder(id) && t === 'pas') t = Math.random() < 0.5 ? 'jackpotOpen' : 'xod';
        if (r.secretAce && !r.secretAce.decided && Math.random() < 0.3) { r.act(r.secretAce.holder, { type: Math.random() < 0.5 ? 'jackpotHide' : 'jackpotOpen' }, 0); continue; }
        r.act(id, { type: t, amount: r.minXod() + (Math.random() < 0.3 ? 5 : 0), tieOffer: Math.random() < 0.5 }, 0);
      } else if (r.phase === 'offer') {
        r.act(r.pending.to, { type: Math.random() < 0.5 ? 'offerAccept' : 'offerDecline' }, 0);
      } else if (r.phase === 'tieOffer') {
        r.act(r.pending.o, { type: Math.random() < 0.5 ? 'tieAccept' : 'tieDecline' }, 0);
      } else if (r.phase === 'tieDecision') {
        r.act(r.pending.a, { type: 'tieVote', choice: 'seka' }, 0);
        r.act(r.pending.b, { type: 'tieVote', choice: Math.random() < 0.7 ? 'seka' : 'bol' }, 0);
      } else if (r.phase === 'sekaJoin') {
        for (const id of r.sekaJoin.eligible) if (!r.sekaJoin.joined.includes(id) && Math.random() < 0.5) r.act(id, { type: 'sekaJoin' }, 0);
        const base = r.sekaJoin.base.filter((x) => !r.left.has(x));
        if (Math.random() < 0.1) r.removePlayer(base[0], 0);
        else r.act(base[0], { type: 'sekaStart' }, 0);
      } else if (r.phase === 'discard') {
        const waiting = r.active().filter((id) => !r.ps[id].cards);
        if (Math.random() < 0.15) r.tick(Date.now() + TIMING.DISCARD_MS * 10);
        else r.act(waiting[0], { type: 'discard', index: rnd(4) }, 0);
      }
    }
    assert.equal(r.phase, 'finished', `oyun ${g} bitmədi`);
    assert.equal(r.pot, 0);
    assert.equal(total(r), n * 1000);
    // axın balansı: hər oyunçunun xalis axını = balans dəyişikliyi
    const net = {};
    for (const f of r.result.flows) { net[f.from] = (net[f.from] || 0) - f.cents; net[f.to] = (net[f.to] || 0) + f.cents; }
    for (const p of r.players.values()) assert.equal(net[p.id] || 0, (p.balance - 1000) * 100, `oyun ${g} oyunçu ${p.id}`);
  }
});


// ---------------- v2.2: 2 Tuz, ayrı cəkpotlar, gizli 3 Tuz ----------------
test('2 Tuz = 22 xal; server və klient hesablaması eynidir', () => {
  assert.equal(score3(h('TS TH 7D')), 22);
  assert.equal(score3(h('TS TH KS')), 22);
  assert.equal(score3(h('TS TH TD')), 33);
  assert.equal(jackpotKind(h('TS TH TD')), 'ace');
  assert.equal(jackpotKind(h('6S 6H 6D')), 'six');
  assert.equal(jackpotKind(h('TS TH 6D')), null);
  // bütün 3 kartlıq kombinasiyalarda server = klient
  const deck = [];
  for (const s2 of ['S', 'H', 'D', 'C']) for (const r of ['6', '7', '8', '9', '10', 'V', 'D', 'K', 'T']) deck.push({ r, s: s2 });
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) for (let k = j + 1; k < deck.length; k++) {
    const c3 = [deck[i], deck[j], deck[k]];
    assert.equal(clientScore3(c3), score3(c3));
  }
  // sekada atılan kart sayılmır
  const r = mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC KC 7D' }, 2: { 1: 'TS TH 6H 6C', 2: '7H 8C 9D 10C' } });
  r.act(1, { type: 'offerSeka' }, 0); r.act(2, { type: 'offerAccept' }, 0); r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 0 }, 0); // TS atıldı → TH 6H 6C = 12 (♥ 11+6=17)
  assert.equal(handScore(r.ps[1].cards), 17);
});

test('3 dənə 6: dərhal açılır, hər rəqibdən min(məbləğ, balans) tutulur, mənfi yox', () => {
  const r = new Round({
    players: [{ id: 1, name: 'A', balance: 1000 }, { id: 2, name: 'B', balance: 50 }, { id: 3, name: 'C', balance: 1000 }],
    settings: { ante: 10, jackpotSix: 100, jackpotAce: 500 }, now: 0,
    dealer: dealer({ 1: { 1: '6S 6H 6D', 2: 'TC KC 7D', 3: '9D 8D 6C' } }),
  });
  assert.equal(r.result.how, 'jackpot');
  const jp = r.result.jackpots[0];
  assert.equal(jp.kind, 'six');
  assert.deepEqual(jp.payments.map((p) => [p.from, p.declared, p.paid]), [[2, 100, 40], [3, 100, 100]]);
  assert.equal(r.players.get(2).balance, 0);
  assert.equal(r.players.get(1).balance, 1000 - 10 + 30 + 140);
  assert.equal(total(r), 2050);
});

test('gizli 3 Tuz: rəqiblərə heç nə görünmür, sahib pas edə bilmir, sonda açılır', () => {
  const r = mk(3, { 1: { 1: '7S 8C 9D', 2: 'TC TH TD', 3: '9H 8H 6C' } }, { jackpotAce: 200 });
  const before = JSON.stringify(r.viewFor(1, 0));
  assert.equal(r.viewFor(2, 0).me.secretJackpot.kind, 'ace');
  for (const v of [1, 3, 99]) {
    const js = JSON.stringify(r.viewFor(v, 0));
    assert.ok(!/"secretJackpot":\{/.test(js));
    assert.ok(!/Tuz|cəkpot|CƏKPOT/i.test(JSON.stringify(r.viewFor(v, 0).log)));
    assert.equal(r.viewFor(v, 0).players.find((p) => p.id === 2).cards, null);
  }
  r.act(2, { type: 'jackpotHide' }, 0);
  assert.equal(JSON.stringify(r.viewFor(1, 0)), before, 'gizli seçim başqalarının görünüşünü dəyişməməlidir');
  r.act(1, { type: 'xod', amount: 10 }, 0);
  assert.throws(() => r.act(2, { type: 'pas' }, 0), /pas edə bilməz/);
  assert.equal(r.viewFor(2, 0).me.canPas, false);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'pas' }, 0); // yalnız sahib qalır → raund bağlanmazdan əvvəl cəkpot açılır
  assert.equal(r.result.how, 'jackpot');
  assert.deepEqual(r.result.winners, [2]);
  assert.deepEqual(r.result.jackpots[0].payments.map((p) => p.paid), [200, 200]);
  assert.ok(r.result.shown.some((x) => x.id === 2 && x.score === 33));
  assert.equal(total(r), 3000);
  // cəkpot və bank ayrı qeydlərdir, hər biri bir dəfə
  const kinds = r.effects.filter((e) => e.userId === 2 && e.delta > 0).map((e) => e.reason).sort();
  assert.deepEqual(kinds, ['Bank udu', 'Cəkpot (3 Tuz)', 'Cəkpot (3 Tuz)']);
});

test('gizli 3 Tuz: səsvermə pas etmir, vaxt bitəndə, baxışmada, çıxanda və bölmədə açılır', () => {
  const H = { 1: { 1: '7S 8C 9D', 2: 'TC TH TD', 3: '9H 8H 6C' } };
  // səsvermə
  let r = mk(3, H, { jackpotAce: 50, turnSeconds: 60 });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'votePas' }, 61_000); // 3 aktivdən 1 səs kifayətdir
  assert.equal(r.ps[2].status, 'active');
  assert.equal(r.result.how, 'jackpot');
  // vaxt bitdi (tick)
  r = mk(3, H, { jackpotAce: 50, turnSeconds: 60 });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.tick(61_000);
  assert.equal(r.result.how, 'jackpot');
  // baxışma (gizli kart üzə çıxmazdan əvvəl açılır)
  r = mk(3, H, { jackpotAce: 50 });
  [1, 2, 3].forEach((id) => r.act(id, { type: 'xod', amount: 10 }, 0));
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'baxis' }, 0);
  assert.equal(r.result.how, 'jackpot');
  // sahib otaqdan çıxır — cəkpot ləğv olunmur
  r = mk(3, H, { jackpotAce: 50 });
  r.removePlayer(2, 0);
  assert.equal(r.result.how, 'jackpot');
  assert.equal(r.result.jackpots[0].total, 100);
  // 2 nəfər: bölmə təklifi qəbul → əvvəl cəkpot açılır, bank sahibə
  r = mk(2, { 1: { 1: '7S 8C 9D', 2: 'TC TH TD' } }, { jackpotAce: 50 });
  r.act(1, { type: 'offerSplit' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.result.how, 'jackpot');
  assert.equal(r.result.payouts[2], 20);
});

test('gizli 3 Tuz: sahibin xoda balansı çatmırsa cəkpot avtomatik açılır', () => {
  const r = new Round({
    players: [{ id: 1, name: 'A', balance: 1000 }, { id: 2, name: 'B', balance: 15 }],
    settings: { ante: 10, minBet: 10, jackpotAce: 30 }, now: 0,
    dealer: dealer({ 1: { 1: '7S 8C 9D', 2: 'TC TH TD' } }),
  });
  r.act(1, { type: 'xod', amount: 10 }, 0); // B-nin növbəsi: balans 5 < 10
  assert.equal(r.result.how, 'jackpot');
  assert.equal(r.players.get(2).balance, 5 + 30 + 30); // qalıq + bank (10+10+10) + cəkpot
});

test('eyni əldə 3 dənə 6 və 3 Tuz: hər ikisi oturma sırası ilə açılır, sahiblər bir-birinə ödəmir', () => {
  const r = mk(3, { 1: { 1: 'TS TH TD', 2: '6S 6H 6D', 3: '9H 8H 7C' } }, { jackpotSix: 100, jackpotAce: 300 });
  assert.equal(r.result.how, 'jackpot');
  assert.deepEqual(r.result.jackpots.map((j) => [j.holder, j.kind, j.total]), [[1, 'ace', 300], [2, 'six', 100]]);
  assert.equal(r.result.payouts[1] + r.result.payouts[2], 30);
  assert.equal(total(r), 3000);
});

// ---------------- v2.2 dizayn: masada göstərilən açıq məlumat ----------------
test('view: "put" (banka qoyulan) açıqdır, rəqib kartları isə gizli qalır; kart etiketləri J/Q/K/A', async () => {
  const { cardLabel } = await import('../server/game/cards.js');
  const r = mk(3, { 1: { 1: '7S 8S 9H', 2: 'DS KS 6H', 3: '6C 7C 8D' } });
  r.start(0);
  const v1 = r.viewFor(1, 0);
  for (const p of v1.players) assert.ok(p.put >= 10);
  assert.equal(v1.players.reduce((a, p) => a + p.put, 0), v1.pot);
  assert.equal(v1.players.find((p) => p.id === 2).cards, null);
  assert.equal(v1.players.find((p) => p.id === 3).cards, null);
  const turn = r.turn;
  const before = v1.players.find((p) => p.id === turn).put;
  r.act(turn, { type: 'xod', amount: r.minXod() }, 0);
  const v2 = r.viewFor(1, 0);
  assert.equal(v2.players.find((p) => p.id === turn).put, before + v1.minXod);
  assert.equal(v2.players.reduce((a, p) => a + p.put, 0), v2.pot);
  assert.ok(!JSON.stringify(r.viewFor(2, 0)).includes('"r":"7","s":"S"'), 'P1-in kartı P2-yə getməməlidir');
  assert.equal(cardLabel(c('TS')), 'A♠');
  assert.equal(cardLabel(c('VH')), 'J♥');
  assert.equal(cardLabel(c('DD')), 'Q♦');
  assert.equal(cardLabel(c('10C')), '10♣');
});
