// Başlanğıc nöqtəsi: npm start
import { createApp } from './app.js';

// Gözlənilməyən xəta loga yazılır (parol/token yazılmır, yalnız mesaj və stack).
// unhandledRejection: proses davam edir. uncaughtException: vəziyyət etibarlı deyil — gözləyən baza yazılışlarını
// bitirməyə cəhd edib çıxırıq; Render prosesi yenidən başladır, yarımçıq raundlar açılışda ləğv edilib pul qaytarılır.
let app = null;
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.stack || e));
process.on('uncaughtException', async (e) => {
  console.error('uncaughtException:', e?.stack || e);
  try { await app?.shutdown(5000); } catch { /* yox */ }
  process.exit(1);
});

app = await createApp();
const port = await app.listen(Number(process.env.PORT) || 3000);
console.log(`Dairə işləyir: http://localhost:${port}`);

// Render yenidən deploy edəndə SIGTERM göndərir: gözləyən baza yazılışlarını bitirib çıxırıq
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig} alındı, server dayanır...`);
    try { await app.shutdown(8000); } catch (e) { console.error(e); }
    process.exit(0);
  });
}
