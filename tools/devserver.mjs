// YALNIZ LOKAL YOXLAMA ÜÇÜN: giriş sürət limiti yüksək olan server (brauzer yoxlama skriptləri çox giriş edir).
// İstifadə: DATA_DIR=/tmp/seka-test PORT=3520 node tools/devserver.mjs   — Render-də İŞƏ SALMAYIN.
import { createApp } from '../server/app.js';
const app = await createApp({ limits: { register: 1e6, login: 1e6 } });
const port = await app.listen(Number(process.env.PORT) || 3520);
console.log(`Test serveri: http://localhost:${port}`);
