# Seka — dostlar üçün onlayn kart oyunu

Real-time multiplayer Seka oyunudur: interfeys Azərbaycan dilindədir, mobil uyğundur, otaqlar adlı, açıq/gizli və istəyə görə şifrəli ola bilər. Bütün məbləğlər **virtual oyun balansıdır** və AZN kimi göstərilir. Real ödəniş sistemi yoxdur.

Nə dəyişdiyini görmək üçün `CHANGELOG.md` faylına baxın. Cari versiya: 2.1.0.

## 1. Öz kompüterinizdə işə salmaq
1. **Node.js** (LTS, minimum 22.13) quraşdırın: https://nodejs.org
2. Zip-i açın və həmin qovluqda bu əmrləri yazın:
   ```
   npm install
   npm start
   ```
3. Brauzerdə **http://localhost:3000** ünvanını açın.
4. İlk dəfə admin hesabı ilə daxil olun: istifadəçi adı `admin`, şifrə `admin123`. Sonra şifrəni dərhal dəyişin.

Lokal məlumatlar `data/seka.db` (SQLite) faylında saxlanılır. Testləri işə salmaq üçün: `npm test`.

## 2. Mövcud GitHub → Render → Neon quraşdırmasını yeniləmək

> Bu yeniləmədə **yeni mühit dəyişəni lazım deyil**. Baza avtomatik yenilənir (migration): köhnə cədvəllərə yalnız yeni sütunlar və yeni cədvəllər əlavə olunur, heç nə silinmir. Hesablar, şifrələr, balanslar və əməliyyat tarixçəsi qalır.

### A. Əvvəlcə bazanın ehtiyat nüsxəsini götürün (tövsiyə olunur)
Neon panelində layihənizi açın, **Branches → Create branch** seçin. Mənbə `main` olsun, adı məsələn `backup-v1`. Bu, bazanın həmin anın tam surətidir; problem çıxsa ona qayıtmaq olar. Pulsuz planda da işləyir.

### B. Kodu GitHub-a yükləmək (brauzerdən, proqramsız)
1. Zip-i kompüterinizdə açın.
2. GitHub-da repository-nizi açın.
3. **Köhnə fayllar:** bu versiyada `server/index.js` qalır, amma əsas kod `server/app.js`-ə köçüb. Ən sadə yol yeni qovluğun bütün məzmununu üstünə yükləməkdir:
   - **Add file → Upload files** seçin.
   - Açdığınız `seka` qovluğunun **içindəki** bütün fayl və qovluqları (`server`, `public`, `test`, `package.json`, `README.md`, `CHANGELOG.md`, `.gitignore`) sürükləyib atın.
   - Aşağıda "Commit changes" düyməsini basın.
4. Eyni adlı fayllar avtomatik yenilənir. Silinməli köhnə fayl yoxdur.

### B (alternativ). Kompüterdə git varsa
```
cd sizin-repo-qovluğunuz
# zip-dəki faylları bura köçürün (üstünə yazın), sonra:
git add -A
git commit -m "Seka v2: təkliflər, seka kart atma, botlar, otaqlar, statistika"
git push
```

### C. Render
- Render GitHub-dakı dəyişikliyi görüb avtomatik yenidən deploy edir. Etməsə, **Manual Deploy → Deploy latest commit** seçin.
- Build Command `npm install`, Start Command `npm start` olaraq qalır.
- Mövcud mühit dəyişənləri (`DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `NODE_ENV=production`) dəyişmir.
- Deploy loglarında bu sətirləri görməlisiniz:
  ```
  Baza: PostgreSQL
  Migration 1 tətbiq edildi: ilkin sxem (v1)
  Migration 2 tətbiq edildi: v2: əməliyyat növü, raundlar, qarşılıqlı nəticələr
  Seka işləyir: ...
  ```
  "Migration 1" mövcud cədvəlləri dəyişmir, sadəcə qeyd edir. Sonrakı deploylarda migration sətirləri görünmür.
- Admin hesabı artıq bazada olduğu üçün yenidən yaradılmır. Köhnə admin şifrəniz qüvvədə qalır.

### D. Neon
Əlavə ayar lazım deyil. Bütün dəyişiklikləri tətbiq özü edir: `schema_migrations`, `rounds`, `round_flows`, `round_batches` cədvəlləri və `transactions` cədvəlinə 4 yeni sütun. v2.0-dan v2.1-ə keçəndə loglarda yalnız `Migration 3 tətbiq edildi` sətri görünür.

## 3. Əsas qaydalar (v2)
- 36 kart. Xallar: 6–9 üzərindəki rəqəm qədər, 10/Valet/Dama/Karol 10, Tuz 11. Yalnız eyni suitdəki kartlar toplanır, eyni dəyərli 3 kart cəmlə sayılır (7-7-7 = 21).
- **Cəkpot:** 3 dənə 6 və ya 3 dənə Tuz. Raund dərhal bitir, cəkpot sahibi bankı alır və digər oyunçuların hər biri ona cəkpot məbləğini ödəyir.
- Növbə saat istiqamətində gedir. Seçimlər: **Xod**, **Baxış**, **Pas**. ("Oyunum yoxdur" ləğv edilib.)
- **Baxış** hamı ilk xodunu edəndən sonra açılır. Bu, interfeysdə yazılır. Baxışan oyunçu cari xod qədər ödəyir və sağındakı (əvvəlki) oyunçu ilə müqayisə olunur. Xalı az olan çıxır; bərabər xalda çağıran çıxır. İstisna: "eyni xala baxaq" təklifi qəbul olunubsa çağıran rəqibin şəriki olur və rəqib qalib gəlsə bank bölünür.
- **2 oyunçu qalanda** növbəsi gələn oyunçu "Seka təklif et" və ya "Bankı bölməyi təklif et" düyməsini basa bilər:
  - Təklif qəbul edilərsə, bölmədə bank yarı bölünür, Sekada isə bank saxlanılır və Seka mərhələsinə keçilir.
  - Rədd edilərsə və ya vaxt bitərsə oyun davam edir.
  - Təklif növbə vaxtını uzatmır. Hər növbədə yalnız 1 təklif göndərmək olar. Növbənin bitməsinə 5 saniyədən az qalıbsa təklif göndərmək olmaz.
- Son baxışmada xallar bərabərdirsə: hər ikisi "Seka" seçsə Seka oynanılır, əks halda bank bölünür (köhnə qayda kimi).
- **Seka:**
  1. Bank saxlanılır. Əvvəlki raundun iştirakçıları oyun haqqının 2 qatını ödəyib qoşula bilər.
  2. Hər kəsə 4 kart paylanır. Hər oyunçu **özü 1 kartı atır**, xal və cəkpot qalan 3 karta görə hesablanır. Atılan kart rəqiblərə göstərilmir.
  3. Hamı seçmədən xod mərhələsi başlamır.
  4. Seçim vaxtı (30 san) bitsə, seçməyən oyunçunun **4-cü (sonuncu paylanan) kartı** avtomatik atılır. Sistem ən yaxşı kartları seçmir.
  5. Bağlantısı kəsilən oyunçu üçün də vaxt bitəndə eyni qayda işləyir. Otaqdan çıxan oyunçu pas sayılır, qalanlar davam edir.
- **Kartların açılması:**
  - Raund baxışma ilə bitibsə, qalibin və uduzanın kartları və xalları nəticədə hamıya göstərilir.
  - Pasla və ya bölmə təklifi ilə bitən raundda kartlar açılmır.
  - Oyun gedərkən başqasının kartını yalnız onunla baxışan oyunçu görür.
- **Vaxt:** növbə vaxtı bitəndə qalan oyunçuların yarısı "pas" səsi versə, oyunçu pas edilir. Botlar da bu səsverməyə qatılır.

## 4. Demo və botlar
- Yeni qeydiyyatdan keçən istifadəçi dərhal daxil ola bilir, amma **yalnız demo rejimində** botlarla oynayır. Real balans və statistika görmür, başqa otaqlara qoşula bilmir. Admin təsdiq edən kimi real oyun avtomatik açılır.
- **"Kompüterlə oyna":** bot olan otaq **məşq rejimindədir**. Hər kəs virtual məşq balansı (1000 AZN) ilə oynayır, real balans dəyişmir və nəticələr statistikaya yazılmır. Bu, kiminsə botları udaraq admin nəzarəti olmadan real balans qazanmasının qarşısını alır.
- Otaq sahibi raundlar arasında ⚙️ Ayarlardan bot əlavə edib çıxara bilər. Botun adının yanında həmişə "🤖 Bot" yazılır.
- Botlar serverdə işləyir, hər hərəkətdən əvvəl qısa fasilə verir və **yalnız öz görünüşünü** (öz kartları + hamıya açıq məlumat) görür.

## 5. Qarşılıqlı nəticələr: kim kimdən nə qədər udub
**Hesablama metodu.** Hər real raund bitəndə:
1. Hər oyunçunun bu raundda banka qoyduğu cəmi məbləğ götürülür: oyun haqqı, xodlar, baxışma, sekaya qoşulma, seka zamanı daşınan bank da daxil.
2. Bank qaliblərə paylanır: tək qalib, bölmə, şəriklik və ya cəkpotda bir neçə qalib ola bilər.
3. Hər oyunçunun qoyduğu məbləğ qaliblər arasında **onların bankdan aldığı paya mütənasib** bölünür. Məsələn bank 50 AZN-dir, A 40, B 10 qoyub və bölmə ilə hər biri 25 alır. Onda A-nın 40-ının yarısı (20) B-yə, B-nin 10-unun yarısı (5) A-ya yazılır. Nəticədə A — B yekunu −15 AZN olur.
4. Qalibin öz qoyduğu payın özünə qayıdan hissəsi heç kimə yazılmır.
5. Cəkpot ödənişləri ödəyəndən cəkpot sahibinə birbaşa yazılır.
6. Qəpiklərin yuvarlaqlaşdırılması elə aparılır ki, hər oyunçunun bütün axınlarının cəmi onun balans dəyişikliyinə **dəqiq** bərabər olsun.

**Nə daxil deyil:** ləğv edilmiş raundlar (pul qaytarılır), admin balans əlavələri və mənfi balans sıfırlamaları, botlu/demo raundlar.

**Nə vaxtdan:** qeydlər bu yeniləmədən sonrakı raundlardan başlayır. Köhnə əməliyyatlarda kimin kimə uduzduğu yazılmadığı üçün onlardan statistika qurulmur.

**Təkrar hesablamaya qarşı:** raundun pul yazılışları və nəticəsi tək tranzaksiyada saxlanılır. Raund bazada "active" vəziyyətindən yalnız bir dəfə çıxa bilir, `round_flows` cədvəlində isə unikal açar var.

## 6. Admin
- Yeni qeydiyyatların təsdiqi və rəddi, balans əlavəsi/çıxılması, ad və şifrə dəyişmə, bloklama, rollar (moderator).
- **Mənfi balansı sıfırla** (yalnız admin):
  - Əvvəlcə təsdiq soruşulur.
  - Tarixçəyə əvvəlki balans, düzəliş məbləği, icra edən admin və vaxt yazılır.
  - Oyunçu davam edən real raunddadırsa sıfırlama rədd edilir: raund bitəndən sonra edilməlidir.
  - Paralel iki sorğudan yalnız biri keçir.
  - Köhnə udma/uduzma tarixçəsi silinmir.
- "Nəticələr" bölməsində bütün oyunçuların qarşılıqlı nəticələri görünür.

## 7. Tam ekran
- Otaqda ⤢ düyməsi var.
  - Fullscreen API dəstəklənən brauzerlərdə (Android Chrome, kompüter) həqiqi tam ekran açılır.
  - Dəstəklənməyən brauzerlərdə (məs. iPhone Safari) interfeys sıxlaşdırılmış görünüşə keçir və xəta çıxmır.
- iPhone-da həqiqi tam ekran üçün Safari-də **Paylaş → Əsas ekrana əlavə et** seçin. Saytı o ikonla açanda brauzer paneli görünmür.

## 8. Balansın qorunması (baza xətası)
- Real raundda hər pul hərəkəti paketə yığılır və sabit ID ilə bazaya **atomik** yazılır. Eyni paket iki dəfə tətbiq oluna bilməz.
- Baza cavab verməsə otaq dondurulur və "⏳ Baza bağlantısı gözlənilir" yazısı görünür. Heç nə etmək lazım deyil: bağlantı qayıdan kimi oyun özü davam edir və gözləmə vaxtı növbə vaxtından çıxılmır.
- Server bu vəziyyətdə dayansa, növbəti başlanğıcda yarımçıq raund ləğv edilir və bazaya yazılmış qoyuluşlar geri qaytarılır.

## 9. Texniki
- `server/game/engine.js`: oyun mühərriki (bütün qaydalar serverdə).
- `server/game/bot.js`: bot qərarları.
- `server/rooms.js`: otaqlar, şifrə, botlar, məşq rejimi, versiya yoxlaması (köhnə/təkrar kliklər rədd olunur).
- `server/store.js`, `server/db.js`: baza, migration-lar, atomik tranzaksiyalar, server yenidən başlayanda yarımçıq raundun pulunun qaytarılması.
- `server/app.js`: HTTP API + WebSocket. Başlanğıc nöqtəsi `server/index.js`-dir.
- `public/`: frontend (build addımı yoxdur).
- Testlər `test/` qovluğundadır: `npm test`.
