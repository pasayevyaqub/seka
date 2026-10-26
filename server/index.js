// Başlanğıc nöqtəsi: npm start
import { createApp } from './app.js';

const app = await createApp();
const port = await app.listen(Number(process.env.PORT) || 3000);
console.log(`Seka işləyir: http://localhost:${port}`);

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
