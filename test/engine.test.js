import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score3, handScore, isJackpot } from '../server/game/cards.js';
import { Round, GameError } from '../server/game/engine.js';

// 'TS' -> {r:'T', s:'S'}, '10H' -> {r:'10', s:'H'}
const c = (str) => ({ r: str.slice(0, -1), s: str.slice(-1) });
const h = (str) => str.split(' ').map(c);

test('xal hesablama', () => {
  assert.equal(score3(h('7S 7H 7D')), 21);
  assert.equal(score3(h('DS DH DC')), 30);
  assert.equal(score3(h('DS KS TS')), 31);
  assert.equal(score3(h('6H 7H 8H')), 21);
  assert.equal(score3(h('TS 9S 7H')), 20);
  assert.equal(score3(h('TS 9H 7D')), 11);
  assert.equal(score3(h('10C VC 6D')), 20);
  assert.equal(handScore(h('TS KS 6H 10S')), 31); // 4 kartdan ən yaxşı 3
});

test('cəkpot', () => {
  assert.ok(isJackpot(h('6S 6H 6D')));
  assert.ok(isJackpot(h('TS TH TD')));
  assert.ok(isJackpot(h('TS 7H TD TC')));
  assert.ok(!isJackpot(h('7S 7H 7D')));
});

const players = (n, bal = 1000) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, balance: bal }));
const dealer = (map) => (handNo, ids) => {
  const hands = map[handNo] || map[1];
  const out = {};
  ids.forEach((id) => { out[id] = h(hands[id]); });
  return out;
};
const sumDeltas = (effects) => effects.reduce((s, e) => s + e.delta, 0);
const balances = (r) => [...r.players.values()].map((p) => p.balance);

test('adi raund: oyun haqqı, xod, baxışma, qalib', () => {
  const r = new Round({
    players: players(3), settings: { ante: 10, minBet: 10 }, now: 0,
    dealer: dealer({ 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } }),
  });
  assert.equal(r.pot, 30);
  assert.equal(r.turn, 1);
  r.act(1, { type: 'xod', amount: 20 }, 0);
  assert.throws(() => r.act(1, { type: 'xod', amount: 20 }, 0), GameError); // növbə onda deyil
  assert.throws(() => r.act(2, { type: 'xod', amount: 10 }, 0), /Minimum/);
  r.act(2, { type: 'xod', amount: 20 }, 0);
  r.act(3, { type: 'xod', amount: 20 }, 0);
  // birinci dövr bitdi, P1 sağındakı (P3) ilə baxışır
  r.act(1, { type: 'baxis' }, 0);
  assert.equal(r.ps[3].status, 'lost');
  assert.equal(r.turn, 2);
  r.act(2, { type: 'baxis' }, 0); // P2 vs P1 → P1 udur
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [1]);
  assert.equal(sumDeltas(r.effects), 0);
  assert.equal(balances(r).reduce((a, b) => a + b), 3000);
});

test('baxışma birinci dövrdən əvvəl olmaz', () => {
  const r = new Round({ players: players(3), settings: {}, now: 0, dealer: dealer({ 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } }) });
  assert.throws(() => r.act(1, { type: 'baxis' }, 0), /ilk xod/);
});

test('hamı pas desə son qalan udur', () => {
  const r = new Round({ players: players(3), settings: { ante: 5 }, now: 0, dealer: dealer({ 1: { 1: 'TS KS DS', 2: '7H 8H 9C', 3: '6D 7D 8C' } }) });
  r.act(1, { type: 'pas' }, 0);
  r.act(2, { type: 'pas' }, 0);
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [3]);
  assert.equal(r.players.get(3).balance, 1010);
});

test('oyunum yoxdur + sağındakı da yoxdur → məcburi baxışma', () => {
  const r = new Round({
    players: players(3), settings: { ante: 10, minBet: 10 }, now: 0,
    dealer: dealer({ 1: { 1: 'TS KS DS', 2: '7H 8C 9D', 3: '6D 7S 9C' } }),
  });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'yox' }, 0);
  r.act(3, { type: 'yox' }, 0);
  r.act(1, { type: 'xod', amount: 10 }, 0);
  // P2-nin növbəsi: sağındakı P1-in oyunu var → seçim sərbəstdir
  assert.equal(r.turn, 2);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  // P3-ün növbəsi: sağındakı P2 "yox" → məcburi baxışma, P3(9) vs P2(9) bərabər → çağıran (P3) çıxır
  assert.equal(r.ps[3].status, 'lost');
  assert.equal(r.turn, 1);
});

test('baxışma: güclü əl qalib gəlir', () => {
  const r = new Round({
    players: players(3), settings: { ante: 10, minBet: 10 }, now: 0,
    dealer: dealer({ 1: { 1: '9S 8S 6H', 2: '6C 7C 8D', 3: 'TD 10D 6S' } }),
  });
  // xallar: P1=17, P2=13, P3=21
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'pas' }, 0);
  // P2 xod, P3 P2 ilə baxışır
  r.act(2, { type: 'xod', amount: 10 }, 0);
  assert.equal(r.turn, 3);
  r.act(3, { type: 'baxis' }, 0);
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [3]);
});

test('bərabər baxışma razılıqla → şərik qalib olanda bank bölünür', () => {
  const r = new Round({
    players: players(3), settings: { ante: 10, minBet: 10 }, now: 0,
    dealer: dealer({ 1: { 1: '9S 8S 6H', 2: '9C 8C 7D', 3: 'TD 10D 6S' } }),
  });
  // P1=17, P2=17, P3=21
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'baxis', tieOffer: true }, 0); // P2 → P1
  assert.equal(r.phase, 'tieOffer');
  assert.throws(() => r.act(3, { type: 'tieAccept' }, 0));
  r.act(1, { type: 'tieAccept' }, 0);
  assert.equal(r.ps[2].status, 'attached');
  assert.equal(r.ps[2].attachedTo, 1);
  assert.equal(r.turn, 3);
  // P3 xod edir, P1 P3 ilə baxışır və uduzur → P2 də heç nə almır
  r.act(3, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'baxis' }, 0);
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [3]);
});

test('şərik: partnyor udanda bank bərabər bölünür', () => {
  const r = new Round({
    players: players(3), settings: { ante: 10, minBet: 10 }, now: 0,
    dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6S' } }),
  });
  // P1=21, P2=21, P3=17
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'baxis', tieOffer: true }, 0);
  r.act(1, { type: 'tieAccept' }, 0);
  r.act(3, { type: 'baxis' }, 0); // P3 vs P1 → P1 udur
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners.sort(), [1, 2]);
  const pot = 30 + 40 + 10 + 10; // ante + 4 xod + 2 baxışma
  assert.equal(r.result.payouts[1] + r.result.payouts[2], pot);
  assert.equal(r.result.payouts[1], pot / 2);
});

test('rədd edilmiş bərabərlik → çağıran çıxır', () => {
  const r = new Round({
    players: players(3), settings: {}, now: 0,
    dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6S' } }),
  });
  ['xod', 'xod', 'xod', 'xod'].forEach((_, i) => r.act([1, 2, 3, 1][i], { type: 'xod', amount: 10 }, 0));
  r.act(2, { type: 'baxis', tieOffer: true }, 0);
  r.act(1, { type: 'tieDecline' }, 0);
  assert.equal(r.ps[2].status, 'lost');
});

test('son iki nəfər bərabər → bölmək', () => {
  const r = new Round({
    players: players(2), settings: { ante: 10 }, now: 0,
    dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } }),
  });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'baxis' }, 0);
  assert.equal(r.phase, 'tieDecision');
  r.act(1, { type: 'tieVote', choice: 'seka' }, 0);
  r.act(2, { type: 'tieVote', choice: 'bol' }, 0);
  assert.equal(r.phase, 'finished');
  assert.equal(r.result.payouts[1], 25);
  assert.equal(r.result.payouts[2], 25);
});

test('Seka: bərabər → qoşulma (ante×2) → 4 kart', () => {
  const r = new Round({
    players: players(3), settings: { ante: 10, minBet: 10 }, now: 0,
    dealer: dealer({
      1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6S' },
      2: { 1: '7S 8S 9H 10C', 2: 'TD KD DD 6C', 3: '6H 7H 8H 9S' },
    }),
  });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'pas' }, 0);
  r.act(1, { type: 'baxis' }, 0); // P1 vs P2: 21 = 21
  assert.equal(r.phase, 'tieDecision');
  r.act(1, { type: 'tieVote', choice: 'seka' }, 0);
  r.act(2, { type: 'tieVote', choice: 'seka' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  const potBefore = r.pot;
  assert.throws(() => r.act(1, { type: 'sekaJoin' }, 0));
  r.act(3, { type: 'sekaJoin' }, 0);
  assert.equal(r.pot, potBefore + 20);
  r.act(2, { type: 'sekaStart' }, 0);
  assert.equal(r.phase, 'betting');
  assert.equal(r.isSeka, true);
  assert.equal(r.ps[1].cards.length, 4);
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(3, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'pas' }, 0);
  r.act(2, { type: 'baxis' }, 0); // P2(31) vs P1? yox, P1 pas → sağındakı P3(21)
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [2]);
  assert.equal(balances(r).reduce((a, b) => a + b), 3000);
});

test('seka vaxtı bitəndə avtomatik başlayır, qərar verilməsə bölünür', () => {
  const r = new Round({ players: players(2), settings: {}, now: 0, dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } }) });
  r.act(1, { type: 'xod', amount: 10 }, 0);
  r.act(2, { type: 'xod', amount: 10 }, 0);
  r.act(1, { type: 'baxis' }, 0);
  r.act(1, { type: 'tieVote', choice: 'seka' }, 0);
  r.tick(31_000);
  assert.equal(r.phase, 'finished');
});

test('cəkpot: raund dərhal bitir, digərləri məbləği ödəyir', () => {
  const r = new Round({
    players: players(3), settings: { ante: 10, jackpotAmount: 100 }, now: 0,
    dealer: dealer({ 1: { 1: '6S 6H 6D', 2: 'TC KC 7D', 3: '9D 8D 6C' } }),
  });
  assert.equal(r.phase, 'finished');
  assert.equal(r.result.how, 'jackpot');
  assert.equal(r.players.get(1).balance, 1000 - 10 + 30 + 200);
  assert.equal(r.players.get(2).balance, 1000 - 10 - 100);
  assert.equal(balances(r).reduce((a, b) => a + b), 3000);
});

test('vaxt bitdi → səsvermə ilə pas', () => {
  const r = new Round({ players: players(4), settings: { turnSeconds: 60 }, now: 0, dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D', 3: '9D 8D 6C', 4: '7S 8C 9H' } }) });
  assert.equal(r.turn, 1);
  assert.throws(() => r.act(2, { type: 'votePas' }, 30_000), /Vaxt/);
  r.act(2, { type: 'votePas' }, 61_000);
  assert.equal(r.ps[1].status, 'active');
  r.act(3, { type: 'votePas' }, 61_000);
  assert.equal(r.ps[1].status, 'folded');
  assert.equal(r.turn, 2);
});

test('mənfi balans: limitsiz və limitli', () => {
  const r = new Round({ players: players(2, 0), settings: { ante: 10 }, now: 0, dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } }) });
  r.act(1, { type: 'xod', amount: 500 }, 0);
  assert.equal(r.players.get(1).balance, -510);
  const r2 = new Round({ players: players(2, 0), settings: { ante: 10, debtLimit: 100 }, now: 0, dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } }) });
  assert.throws(() => r2.act(1, { type: 'xod', amount: 500 }, 0), /limit/);
});

test('maksimum xod limiti', () => {
  const r = new Round({ players: players(2), settings: { maxBet: 50 }, now: 0, dealer: dealer({ 1: { 1: 'TS KS 6H', 2: 'TC KC 7D' } }) });
  assert.throws(() => r.act(1, { type: 'xod', amount: 60 }, 0), /Maksimum/);
  r.act(1, { type: 'xod', amount: 50 }, 0);
});

test('təsadüfi raundlar: pul itmir', () => {
  for (let g = 0; g < 300; g++) {
    const n = 2 + (g % 7);
    const r = new Round({ players: players(n), settings: { ante: 5, minBet: 5, jackpotAmount: 50 }, now: 0 });
    let guard = 0;
    while (r.phase !== 'finished' && guard++ < 500) {
      if (r.phase === 'betting') {
        const id = r.turn;
        const opts = ['xod', 'pas'];
        if (!r.ps[id].declared) opts.push('yox');
        if (r.firstCircleDone()) opts.push('baxis', 'baxis');
        const t = opts[Math.floor(Math.random() * opts.length)];
        r.act(id, { type: t, amount: r.minXod() + (Math.random() < 0.3 ? 5 : 0), tieOffer: Math.random() < 0.5 }, 0);
      } else if (r.phase === 'tieOffer') {
        r.act(r.pending.o, { type: Math.random() < 0.5 ? 'tieAccept' : 'tieDecline' }, 0);
      } else if (r.phase === 'tieDecision') {
        r.act(r.pending.a, { type: 'tieVote', choice: 'seka' }, 0);
        r.act(r.pending.b, { type: 'tieVote', choice: Math.random() < 0.7 ? 'seka' : 'bol' }, 0);
      } else if (r.phase === 'sekaJoin') {
        for (const id of r.sekaJoin.eligible) if (Math.random() < 0.5) r.act(id, { type: 'sekaJoin' }, 0);
        r.act(r.sekaJoin.base[0], { type: 'sekaStart' }, 0);
      }
    }
    assert.equal(r.phase, 'finished', `oyun ${g} bitmədi`);
    assert.equal(r.pot, 0);
    assert.equal(balances(r).reduce((a, b) => a + b), n * 1000);
  }
});
