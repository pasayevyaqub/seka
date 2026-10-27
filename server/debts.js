// Vaxtı çatmış oyunçular arası borcların avtomatik tutulması.
//  * Tək işçi (eyni anda bir emal), limitli növbə: bir dövrdə ən çox MAX_PER_RUN borclu.
//  * Hər borclu öz real otağının növbəsində emal olunur (rooms.moneyOp) — aktiv oyunun yaddaş balansı ilə ziddiyyət yoxdur.
//  * Borc verən pul aldıqda onun da gecikmiş borcu ola bilər → o da növbəyə düşür (zəncir). Rekursiya yoxdur:
//    hər ödəniş ümumi qalıq borcu azaldır, növbə isə dövr başına limitlidir — qarşılıqlı borclar sonsuz dövr yaratmır.
//  * Server yatıbsa/bağlı olubsa, açılışda bütün vaxtı keçmiş borclar yoxlanılır; əməliyyat vaxtı FAKTİKİ icra anıdır.
export const MAX_PER_RUN = 50;

export class DebtWorker {
  constructor(finance, rooms, { intervalMs = 30_000, onPayments = null } = {}) {
    this.finance = finance;
    this.rooms = rooms;
    this.queue = new Set();
    this.running = null;
    this.onPayments = onPayments;
    this.timer = setInterval(() => this.scan(), intervalMs);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); clearTimeout(this.soon); }

  kick(userId) {
    if (!(userId > 0)) return;
    this.queue.add(userId);
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.run(), 50);
    this.soon.unref?.();
  }

  async scan() {
    try {
      for (const id of await this.finance.dueBorrowers()) this.queue.add(id);
    } catch (e) { console.error('Borc yoxlaması alınmadı:', e.message); return; }
    return this.run();
  }

  async run() {
    if (this.running) return this.running.then(() => (this.queue.size ? this.run() : undefined));
    this.running = (async () => {
      let n = 0;
      while (this.queue.size && n < MAX_PER_RUN) {
        const id = this.queue.values().next().value;
        this.queue.delete(id);
        n++;
        try {
          const res = await this.rooms.moneyOp(id, () => this.finance.collectDue(id));
          for (const nt of res.notify || []) this.rooms.send(nt.userId, { t: 'notify', kind: nt.kind, text: nt.text });
          if (res.payments?.length) {
            this.onPayments?.(res.payments);
            for (const p of res.payments) this.queue.add(p.lenderId); // borc verənin də gecikmiş borcu ola bilər
          }
        } catch (e) {
          // məs. otaq baza gözləyir — növbəti dövrdə yenidən cəhd edilir
          if (!/Baza bağlantısı/.test(e.message)) console.error(`Borc tutulması (${id}) alınmadı:`, e.message);
        }
      }
    })();
    try { await this.running; } finally { this.running = null; }
    if (this.queue.size) { this.soon = setTimeout(() => this.run(), 1000); this.soon.unref?.(); }
  }
}
