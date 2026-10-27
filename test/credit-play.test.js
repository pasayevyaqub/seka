// "Borca oyna" — iki aktiv insan oyunçu qalanda şərti (təminatsız) qoyuluş.
// Əsas yoxlama: şərti qoyuluşdan heç vaxt əlavə xal yaranmır, eyni məbləğ iki dəfə qazanc yazılmır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Round, TIMING } from '../server/game/engine.js';

const c = (str) => ({ r: str.slice(0, -1), s: str.slice(-1) });
const h = (str) => str.split(' ').map(c);
const WEAK = '6S 7C 9D';   // 9 xal
const STRONG = 'TH KH DH'; // 31 xal
function mk(bal1, bal2, hands = { 1: WEAK, 2: STRONG }, extra = {}) {
  const r = new Round({
    players: [{ id: 1, name: 'Yaqub', balance: bal1 }, { id: 2, name: 'Anar', balance: bal2 }],
    settings: { ante: 10, minBet: 10, turnSeconds: 60 }, now: 0,
    dealer: (handNo, ids) => Object.fromEntries(ids.map((id) => [id, h((extra[handNo] || hands)[id])])),
  });
  r.allowCredit = true;
  return r;
}
const bal = (r, id) => r.players.get(id).balance;
const realTotal = (r) => bal(r, 1) + bal(r, 2) + r.pot;
// DB-yə gedən effektlər — balans dəyişikliklərinin cəmi heç vaxt müsbət olmamalıdır (yeni xal yaranmır)
const allEffects = (r) => { r._all = (r._all || []).concat(r.drainEffects()); return r._all; };

test('qəbul → borclu uduzur: yalnız faktiki istifadə edilən şərti məbləğ borc olur, qalib real bankı alır', () => {
  const r = mk(10, 1000);              // Yaqub ante-dən sonra 0
  assert.equal(bal(r, 1), 0);
  assert.equal(r.viewFor(1, 0).me.canCreditOffer, true);
  assert.equal(r.viewFor(1, 0).me.creditShortfall, 10);
  assert.throws(() => r.act(1, { type: 'xod', amount: 100 }, 0), /Balans/);
  r.act(1, { type: 'creditOffer', limit: 200, dueDays: 7 }, 0);
  assert.equal(r.phase, 'creditOffer');
  assert.throws(() => r.act(1, { type: 'creditAccept', limit: 200 }, 0), /cavab gözlənilmir/); // özü qəbul edə bilməz
  r.act(2, { type: 'creditAccept', limit: 200 }, 1000);
  assert.throws(() => r.act(2, { type: 'creditAccept', limit: 200 }, 1000), /cavab gözlənilmir/); // təkrar qəbul
  r.act(1, { type: 'xod', amount: 100 }, 2000);   // 100 şərti
  assert.equal(bal(r, 1), 0);                     // balansa heç nə yazılmayıb
  assert.equal(r.creditPot, 100);
  assert.equal(r.pot, 20);                        // real bankda yalnız oyun haqları
  r.act(2, { type: 'xod', amount: 100 }, 3000);   // real
  r.act(1, { type: 'baxis' }, 4000);              // daha 100 şərti → limit 200 dolur
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.winners, [2]);
  assert.equal(r.result.payouts[2], 120);         // 10 + 10 + 100 — yalnız real bank
  assert.deepEqual(r.result.creditLoans, [{ borrower: 1, lender: 2, amount: 200, dueDays: 7 }]);
  assert.equal(bal(r, 2), 1000 - 10 - 100 + 120);
  assert.equal(bal(r, 1), 0);
  assert.equal(realTotal(r), 1010);               // real xal nə yarandı, nə itdi
  assert.ok(allEffects(r).reduce((a, e) => a + e.delta, 0) <= 0);
  // statistika yalnız real axınlardır
  assert.deepEqual(r.result.flows, [{ from: 1, to: 2, cents: 1000 }]);
});

test('borclu qalib gəlir: öz şərti qoyuluşu qazanc kimi yaranmır, borc yaranmır', () => {
  const r = mk(10, 1000, { 1: STRONG, 2: WEAK });
  r.act(1, { type: 'creditOffer', limit: 200, dueDays: 3 }, 0);
  r.act(2, { type: 'creditAccept', limit: 200 }, 0);
  r.act(1, { type: 'xod', amount: 100 }, 0);
  r.act(2, { type: 'xod', amount: 100 }, 0);
  r.act(1, { type: 'baxis' }, 0);
  assert.deepEqual(r.result.winners, [1]);
  assert.equal(r.result.payouts[1], 120);         // yalnız Anarın real qoyuluşları + oyun haqları
  assert.deepEqual(r.result.creditLoans, []);
  assert.equal(bal(r, 1), 120);
  assert.equal(bal(r, 2), 890);
  assert.equal(realTotal(r), 1010);
});

test('qismən balans: əvvəl mövcud xal, sonra təsdiqlənmiş şərti hissə', () => {
  const r = mk(40, 1000);                         // ante-dən sonra 30
  assert.equal(r.viewFor(1, 0).me.canCreditOffer, false); // 10-luq xoda balans çatır
  r.act(1, { type: 'xod', amount: 30 }, 0);       // tam real
  r.act(2, { type: 'xod', amount: 100 }, 0);
  assert.equal(r.viewFor(1, 0).me.creditShortfall, 100);
  r.act(1, { type: 'creditOffer', limit: 100, dueDays: 7 }, 0);
  r.act(2, { type: 'creditAccept', limit: 100 }, 0);
  r.act(1, { type: 'xod', amount: 100 }, 0);      // 0 real + 100 şərti
  assert.equal(r.creditContrib[1], 100);
  assert.equal(r.contrib[1], 40);
  r.act(2, { type: 'pas' }, 0);                   // Anar pas → Yaqub qalib
  assert.deepEqual(r.result.creditLoans, []);
  assert.equal(bal(r, 1), 10 + 30 + 10 + 100);    // real bank: 10+10 ante, 30, 100
  assert.equal(realTotal(r), 1040);
});

test('rədd və cavabsızlıq: balansı çatmayan avtomatik pas; növbə taymeri təklif müddətində dayanır', () => {
  const r1 = mk(10, 1000);
  r1.act(1, { type: 'creditOffer', limit: 50, dueDays: 7 }, 0);
  r1.act(2, { type: 'creditDecline' }, 0);
  assert.equal(r1.phase, 'finished');
  assert.deepEqual(r1.result.winners, [2]);
  assert.deepEqual(r1.result.creditLoans, []);

  const r2 = mk(10, 1000);
  // növbənin 50-ci saniyəsində təklif (10 san qalıb), 30 san cavab yoxdur
  r2.act(1, { type: 'creditOffer', limit: 50, dueDays: 7 }, 50_000);
  assert.equal(r2.tick(50_000 + TIMING.CREDIT_OFFER_MS - 1), false);
  assert.throws(() => r2.act(2, { type: 'votePas' }, 70_000), /səsvermə/); // paralel qərar yoxdur
  assert.equal(r2.tick(50_000 + TIMING.CREDIT_OFFER_MS), true);
  assert.deepEqual(r2.result.winners, [2]);

  const r3 = mk(10, 1000);
  r3.act(1, { type: 'creditOffer', limit: 50, dueDays: 7 }, 50_000);
  r3.act(2, { type: 'creditAccept', limit: 50 }, 70_000);
  assert.equal(r3.turnDeadline, 70_000 + TIMING.CREDIT_MIN_RESUME_MS); // qalan 10 san → ən azı 15 san
});

test('limit özbaşına artmır: limitdən çox qoymaq olmaz, artırmaq üçün yeni təsdiq lazımdır', () => {
  const r = mk(10, 1000);
  r.act(1, { type: 'creditOffer', limit: 50, dueDays: 7 }, 0);
  r.act(2, { type: 'creditAccept', limit: 50 }, 0);
  assert.throws(() => r.act(1, { type: 'xod', amount: 60 }, 0), /Balans/);
  r.act(1, { type: 'xod', amount: 50 }, 0);
  r.act(2, { type: 'xod', amount: 80 }, 0);
  assert.throws(() => r.act(1, { type: 'xod', amount: 80 }, 0), /Balans/);
  assert.throws(() => r.act(1, { type: 'creditOffer', limit: 50, dueDays: 7 }, 0), /böyük olmalıdır/);
  r.act(1, { type: 'creditOffer', limit: 130, dueDays: 7 }, 0);
  // köhnə məbləğlə gələn (köhnəlmiş) qəbul işləmir
  assert.throws(() => r.act(2, { type: 'creditAccept', limit: 50 }, 0), /dəyişib/);
  r.act(2, { type: 'creditAccept', limit: 130 }, 0);
  r.act(1, { type: 'xod', amount: 80 }, 0);
  assert.equal(r.creditDeal.used, 130);
  // limit artırılması rədd edilsə, köhnə razılaşma qalır, balans çatmırsa pas
  r.act(2, { type: 'xod', amount: 100 }, 0);
  r.act(1, { type: 'creditOffer', limit: 300, dueDays: 7 }, 0);
  r.act(2, { type: 'creditDecline' }, 0);
  assert.equal(r.phase, 'finished');
  assert.deepEqual(r.result.creditLoans, [{ borrower: 1, lender: 2, amount: 130, dueDays: 7 }]);
});

test('hər iki tərəfin balansı çatmır: kreditor öz növbəsində təklif edə bilməz, yeni şərti xal yaranmır', () => {
  const r = mk(10, 60);                           // Anar ante-dən sonra 50
  r.act(1, { type: 'creditOffer', limit: 200, dueDays: 7 }, 0);
  r.act(2, { type: 'creditAccept', limit: 200 }, 0);
  r.act(1, { type: 'xod', amount: 100 }, 0);
  assert.equal(r.viewFor(2, 0).me.canAffordMin, false);
  assert.equal(r.viewFor(2, 0).me.canCreditOffer, false);
  assert.throws(() => r.act(2, { type: 'creditOffer', limit: 100, dueDays: 7 }, 0), /qarşı tərəf/);
  assert.throws(() => r.act(2, { type: 'xod', amount: 100 }, 0), /Balans/);
  r.act(2, { type: 'pas' }, 0);                   // Anar yalnız pas edə bilər — mövcud bank qorunur
  assert.deepEqual(r.result.winners, [1]);
  assert.deepEqual(r.result.creditLoans, []);
  assert.equal(bal(r, 1), 20);                    // iki oyun haqqı
  assert.equal(realTotal(r), 70);
});

test('bankın bölünməsi: şərti qoyuluş real bankın nisbəti ilə bağlanır (borclunun payı ləğv, qarşı tərəfinki borc)', () => {
  const r = mk(10, 1000);
  r.act(1, { type: 'creditOffer', limit: 101, dueDays: 7 }, 0);
  r.act(2, { type: 'creditAccept', limit: 101 }, 0);
  r.act(1, { type: 'xod', amount: 101 }, 0);
  r.act(2, { type: 'xod', amount: 101 }, 0);
  r.act(1, { type: 'offerSplit' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.result.how, 'split');
  assert.equal(r.result.payouts[1] + r.result.payouts[2], 121);
  assert.deepEqual(r.result.creditLoans, [{ borrower: 1, lender: 2, amount: 50, dueDays: 7 }]); // 101 × 60/121 → 50 (aşağı)
  assert.equal(realTotal(r), 1010);
});

test('seka: şərti qoyuluşlar sekadan əvvəl bağlanır, növbəti əlinə gizli borc kimi keçmir', () => {
  const r = mk(10, 1000, { 1: WEAK, 2: STRONG }, { 2: { 1: 'TS KS DS 6H', 2: '7H 8C 9D 6C' } });
  r.act(1, { type: 'creditOffer', limit: 100, dueDays: 5 }, 0);
  r.act(2, { type: 'creditAccept', limit: 100 }, 0);
  r.act(1, { type: 'xod', amount: 100 }, 0);
  r.act(2, { type: 'xod', amount: 100 }, 0);
  r.act(1, { type: 'offerSeka' }, 0);
  r.act(2, { type: 'offerAccept' }, 0);
  assert.equal(r.phase, 'sekaJoin');
  assert.equal(r.creditPot, 0);
  assert.equal(r.creditDeal, null);
  assert.deepEqual(r.creditLoans, [{ borrower: 1, lender: 2, amount: 50, dueDays: 5 }]);
  // əsas oyunçular dərhal başlada bilir — qoşulmaq hüququ olan başqa oyunçu yoxdur
  r.act(1, { type: 'sekaStart' }, 0);
  r.act(1, { type: 'discard', index: 3 }, 0);
  r.act(2, { type: 'discard', index: 3 }, 0);
  // yeni əldə Yaqubun balansı yoxdur və köhnə limit bağlanıb — davam etmək üçün yeni təsdiq lazım olardı
  assert.equal(r.viewFor(1, 0).me.creditLeft, 0);
  assert.equal(r.viewFor(1, 0).me.canCreditOffer, true);
  r.act(1, { type: 'pas' }, 0);
  assert.deepEqual(r.result.winners, [2]);
  assert.equal(r.result.payouts[2], 120);        // əvvəlki əldən qalan real bank qorunub
  assert.deepEqual(r.result.creditLoans, [{ borrower: 1, lender: 2, amount: 50, dueDays: 5 }]); // yalnız bir dəfə
  assert.equal(realTotal(r), 1010);
});

test('ləğv: şərti borc silinir, real qoyuluşlar qaytarılır', () => {
  const r = mk(10, 1000);
  r.act(1, { type: 'creditOffer', limit: 100, dueDays: 7 }, 0);
  r.act(2, { type: 'creditAccept', limit: 100 }, 0);
  r.act(1, { type: 'xod', amount: 100 }, 0);
  r.abort();
  assert.deepEqual(r.result.creditLoans, []);
  assert.equal(bal(r, 1), 10);
  assert.equal(bal(r, 2), 1000);
  assert.equal(r.creditPot, 0);
});

test('bot və ya demo/məşq: borca oyun işləmir', () => {
  const r = mk(10, 1000);
  r.allowCredit = false;
  assert.equal(r.viewFor(1, 0).me.canCreditOffer, false);
  assert.throws(() => r.act(1, { type: 'creditOffer', limit: 100, dueDays: 7 }, 0), /real otaqda/);
  const b = new Round({ players: [{ id: 1, name: 'Y', balance: 10 }, { id: -1, name: 'Bot', balance: 1000 }], settings: { ante: 10, minBet: 10 }, now: 0 });
  b.allowCredit = true;
  assert.throws(() => b.act(1, { type: 'creditOffer', limit: 100, dueDays: 7 }, 0), /iki aktiv/);
});
