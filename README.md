# Seka — dostlar üçün onlayn kart oyunu

Real-time multiplayer Seka oyunudur. İnterfeys Azərbaycan dilindədir və mobil uyğundur. Otaqlar adlı ola bilər, açıq və ya gizli, istəyə görə şifrəli. Bütün məbləğlər **virtual oyun balansıdır** və oyun xalı kimi göstərilir. Real pul yatırma, nağdlaşdırma, faiz və ödəniş sistemi **yoxdur**.

Nə dəyişdiyini görmək üçün `CHANGELOG.md` faylına baxın. Cari versiya: **2.2.0**.

## 1. Öz kompüterinizdə işə salmaq
1. **Node.js** quraşdırın: https://nodejs.org (LTS, minimum 22.13).
2. Zip-i açın və həmin qovluqda bu iki əmri işə salın:
   ```
   npm install
   npm start
   ```
3. Brauzerdə **http://localhost:3000** ünvanını açın.
4. Admin hesabı: istifadəçi adı `admin`, şifrə `admin123`. Daxil olandan sonra şifrəni dərhal dəyişin.

Lokal məlumatlar `data/seka.db` (SQLite) faylında saxlanılır. Testləri işə salmaq üçün: `npm test`.

## 2. GitHub → Render → Neon quraşdırmasını yeniləmək

> **Yeni mühit dəyişəni lazım deyil.** `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` və `NODE_ENV` olduğu kimi qalır.
> Baza açılışda avtomatik yenilənir (Migration 4). Mövcud cədvəllərə yalnız yeni sütunlar, bazaya isə yeni cədvəllər əlavə olunur. Heç bir məlumat silinmir. Hesablar, şifrə hash-ləri, balanslar və tarixçə qalır.

### A. Ehtiyat nüsxə (tövsiyə olunur)
Neon panelində **Branches → Create branch** seçin, mənbə `main`, adı məsələn `backup-v2-1`. Problem olsa həmin nüsxəyə qayıtmaq olar.

### B. Kodu GitHub-a yükləmək (brauzerdən)
1. Zip-i açın.
2. GitHub-da repository-ni açın və **Add file → Upload files** seçin.
3. `seka` qovluğunun **içindəki** bütün fayl və qovluqları sürükləyib atın: `server`, `public`, `test`, `package.json`, `README.md`, `CHANGELOG.md`, `.gitignore`.
4. **Commit changes** düyməsini basın.

Eyni adlı fayllar üstünə yazılır. Silinməli köhnə fayl yoxdur. Yeni fayllar: `server/finance.js`, `server/debts.js`, `public/core.js`, `public/room.js`, `public/profile.js`, `public/admin.js` və testlər.

### C. Render
- Render dəyişikliyi görüb özü deploy edir. Etməsə, **Manual Deploy → Deploy latest commit** seçin.
- Build Command (`npm install`) və Start Command (`npm start`) dəyişmir.
- Bu versiyada profil şəkillərini emal etmək üçün **`sharp`** paketi əlavə olunub. Render onu `npm install` zamanı özü yükləyir, əlavə ayar lazım deyil.
- Deploy loglarında bu sətri görməlisiniz:
  ```
  Migration 4 yoxlanıldı/tətbiq edildi: v2.2: bonus, kredit, hədiyyə, oyunçu borcları, bildirişlər, avatar, idempotency
  ```

### D. Neon
Əlavə ayar lazım deyil.
- **Yeni cədvəllər:** `op_keys`, `app_settings`, `credit_requests`, `loans`, `loan_payments`, `notifications`.
- **`users` cədvəlinə əlavə olunan sütunlar:** `credit_debt`, `credit_limit`, `avatar`, `avatar_ver`.
- **`transactions` cədvəlinə əlavə olunan sütunlar:** `counterparty_id`, `op_key`, `note`.

Profil şəkilləri bazada saxlanılır (kiçildilmiş WebP, təxminən 5–20 KB), Render-in müvəqqəti diskində yox. Ona görə restart və ya deploy zamanı itmir.

### Migration hesablarla nə edir
- Köhnə **"pending"** (təsdiq gözləyən) hesablar aktivləşir.
- **blocked** və **rejected** hesablar olduğu kimi qalır, avtomatik açılmır.
- Mövcud hesablara başlanğıc bonusu **verilmir**.
- Köhnə **mənfi balanslar** silinmir və krediti borcuna çevrilmir. Admin onları ayrıca görüb açıq təsdiqlə düzəldə bilər.

## 3. Qeydiyyat və bonus
- Qeydiyyatdan sonra hesab dərhal aktivdir, admin təsdiqi gözləmək lazım deyil.
- Yeni hesaba **100 virtual oyun xalı** başlanğıc bonusu verilir:
  - Bonus qeydiyyatla eyni tranzaksiyada yazılır və hər hesaba yalnız bir dəfə verilir.
  - Bonus borc və oyun qazancı sayılmır.
- Admin bonus məbləğini **Admin → Ayarlar** bölməsindən dəyişə bilər. Yeni məbləğ yalnız bundan sonrakı qeydiyyatlara tətbiq olunur.
- Qeydiyyat sürət məhdudiyyəti: bir IP-dən dəqiqədə 5, saatda 30 qeydiyyat.

## 4. Balans, kredit, hədiyyə, borc

**Ümumi qaydalar:**
- Əsas balans heç vaxt 0-dan aşağı düşmür. Oyun haqqı, xod, baxış, borc ödənişi, hədiyyə və admin çıxması serverdə yoxlanılır.
- Balans çatmayanda masada mesaj görünür və iki seçim təklif olunur: **💳 Kredit istə** və ya **🤖 Demo oyna**.
- Hər maliyyə sorğusunun **idempotency açarı** var. Təkrar klik, itmiş cavab və ya paralel sorğu əməliyyatı ikinci dəfə icra etmir.
- Bütün əməliyyatlar atomikdir: ya tam yazılır, ya heç biri. Balansı azaldan hər yazılış şərtlidir (`balance >= məbləğ`), ona görə eyni pul iki dəfə xərclənə bilməz.
- Oyunçu aktiv real raunddadırsa, onun balansını azaldan əməliyyatlar otağın oyun növbəsi ilə ardıcıl icra olunur:
  - Hədiyyə, borc vermə və ya ödəmə, avtomatik tutulma və admin çıxması məhz belə icra olunur.
  - Buna görə yaddaşdakı oyun balansı da dərhal yenilənir və növbəti xod köhnə balansla edilə bilməz.

**Admin krediti (faizsiz):**
- Oyunçu masadan çıxmadan və ya **Profilim** səhifəsindən "Kredit istə" ilə məbləğ göndərir.
- Hər oyunçunun bir gözləyən müraciəti ola bilər.
- İlkin kredit limiti 0-dır, amma limit 0 olsa da müraciət göndərmək olar. Admin təsdiq edəndə limit təyin edə və ya artıra bilər.
- Limit avtomatik kredit hüququ deyil: hər kredit admin təsdiqi tələb edir.
- Təsdiqdə məbləğ eyni tranzaksiyada əsas balansa və kredit borcuna yazılır. Qalan borc limiti keçə bilməz.
- Eyni müraciət iki dəfə təsdiqlənə bilməz.
- "Borcu ödə" düyməsi ilə borc əsas balansdan qaytarılır. Nə borc, nə balans mənfiyə düşür. Bu kreditin müddəti və avtomatik yığımı yoxdur.

**Hədiyyə:**
- Alıcı ad və ya istifadəçi adı ilə axtarılır. Göndərməzdən əvvəl alıcı və məbləğ təsdiq üçün göstərilir.
- Məbləğ göndərənin balansından çıxılır və eyni tranzaksiyada alıcıya keçir.
- Özünüzə, bota və ya bloklanmış hesaba hədiyyə göndərmək olmaz.
- Hər iki tərəfin tarixçəsinə qarşı tərəf, məbləğ, tarix və qeyd yazılır. Alıcıya bildiriş gəlir.
- Hədiyyə borc yaratmır və udma/uduzma statistikasına daxil deyil.
- Admin hədiyyəsi sistemdən verilir, adminin öz balansından çıxılmır.

**Oyunçular arası borc:**
1. Borc verən alıcını, məbləği və qaytarma tarixini seçib təklif göndərir. Qaytarma tarixi ən azı 10 dəqiqə, ən çox 1 il sonra ola bilər.
2. Borc alan təklifdə bunları görür: borc verənin kim olduğu, məbləğ, son ödəmə vaxtı və avtomatik tutulma şərti.
3. Qəbul edilənə qədər pul köçmür və rezerv də olunmur.
4. Qəbul zamanı borc verənin balansı yenidən yoxlanılır, çatmasa borc yaranmır. Qəbul, köçürmə, borc qeydi və tarixçə bir tranzaksiyadadır.
5. Eyni təklifi iki dəfə qəbul etmək mümkün deyil.

Əlavə qaydalar:
- Təklifi borc alan rədd edə, borc verən isə qəbuldan əvvəl ləğv edə bilər.
- Son tarixi keçmiş təklif qəbul edilmir.
- Qəbul olunmuş borcun məbləği və müddəti dəyişdirilə bilməz.
- Faiz və cərimə yoxdur.
- Borc alan vaxtından əvvəl borcu tam və ya qismən ödəyə bilər.

**Son tarixdə avtomatik tutulma:**
- Borc borclunun mövcud əsas balansından tutulub borc verənə köçürülür.
- Balans çatmasa yalnız mövcud məbləğ tutulur, qalan hissə **"Gecikib"** statusunda qalır. Balansa sonradan daxil olan vəsaitdən (hədiyyə, oyun qazancı, kredit və s.) qalan borc avtomatik tutulur.
- Bir neçə borc varsa, əvvəl son tarixi köhnə olan, tarixlər eynidirsə ID-si kiçik olan ödənilir.
- Balans mənfiyə düşmür, avtomatik kredit yaranmır. Demo balansından tutulma olmur.
- Hər iki tərəfə məbləğ və qalan borc barədə bildiriş gəlir.
- Server yatıbsa və ya bağlı olubsa, açılışda vaxtı keçmiş borclar yoxlanılır. Tarixçəyə **faktiki icra vaxtı** yazılır; ödəniş son tarix anında edilmiş kimi göstərilmir.
- Tarixlər bazada UTC saxlanılır, ekranda Asia/Baku vaxtı ilə göstərilir.
- Zəncirvari ödənişlər (A B-yə, B C-yə borcludur) limitli növbə ilə emal olunur. Qarşılıqlı borclar sonsuz dövr yaratmır, ikiqat tutulma olmur.

## 5. Profilim və admin paneli
**Profilim** səhifəsində bunlar var:
- əsas balans; kredit borcu, limit və qalan limit;
- kimə nə qədər borclu olduğunuz və kimdən alacağınız (tarixlərlə);
- gözləyən təkliflər və kredit müraciəti; gecikmiş borclar;
- maliyyə tarixçəsi; kimdən nə qədər udduğunuz və uduzduğunuz;
- profil şəkli.

**Admin panelinin bölmələri:**
- **İstifadəçilər:** axtarış, süzgəclər, balans formasında "Əlavə et / Çıx" seçimi (məbləğ həmişə müsbət yazılır), hədiyyə, kredit limiti, mənfi balansı sıfırlama.
- **Kredit:** gözləyən müraciətləri qəbul və ya rədd etmək, oyunçular üzrə borc və limitlər, ümumi kredit borcu.
- **Borclar:** oyunçular arası borclar ayrıca göstərilir — borclu, borc verən, ilkin və qalan məbləğ, son tarix, status. Admin kreditləri ilə qarışmır.
- **Hədiyyələr**, **Əməliyyatlar**, **Nəticələr**, **Ayarlar** (bonus).

**İcazələr:**
- Moderator kredit müraciətlərinə baxa, balans dəyişə və hədiyyə verə bilər.
- Ayarları dəyişmək, rol vermək və mənfi balansı sıfırlamaq yalnız admin üçündür.
- Axtarış böyük/kiçik hərfə və Azərbaycan hərflərinə (İ/i, I/ı) uyğun işləyir. Siyahı yenilənəndə axtarış mətni və fokus itmir.

## 6. Oyun qaydaları
- **Kartlar:** 36 kart. 6–9 üzərindəki rəqəm qədər xal verir; 10, Valet, Dama və Karol 10 xal; Tuz 11 xal.
- **Xal hesablama:**
  - Yalnız eyni suitdəki kartlar toplanır.
  - Eyni dəyərli 3 kart cəmlə sayılır (7-7-7 = 21).
  - Saxlanılan 3 kartda **2 Tuz varsa əl 22 xaldır**.
  - Sekada atılan kart hesablanmır.
  - Server, klient və botlar eyni qaydanı istifadə edir; bu, testlə bütün kombinasiyalar üzrə yoxlanılır.
- **Hərəkətlər:** Xod, Baxış, Pas ("Oyunum yoxdur" yoxdur). Baxış hamı ilk xodunu edəndən sonra açılır.
- **2 oyunçu qalanda:** Seka və ya bankı bölmə təklif etmək olar. Təklif növbə vaxtını uzatmır və növbədə yalnız bir dəfə göndərilə bilər.
- **Seka:** hər oyunçuya 4 kart paylanır və hər kəs özü 1 kartı atır. Vaxt bitsə 4-cü kart avtomatik atılır.
- **Kartların açılması:** baxışma ilə bitən raundda kartlar və xallar nəticədə göstərilir. Pasla çıxanların kartları açılmır.

### Cəkpot (v2.2)
- 3 dənə 6 və 3 Tuz üçün **ayrı məbləğlər** var. Otaq ayarlarında "hər rəqibdən" tutulan məbləğ kimi göstərilir.
- **Köhnə ayardan keçid:** otaqlar yaddaşda saxlanılır, ona görə bazada keçid lazım deyil. Köhnə klient tək `jackpotAmount` göndərsə, server onu hər iki cəkpota tətbiq edir.
- **3 dənə 6:** dərhal açılır.
- **3 Tuz:** sahibi gizli seçim alır — "Cəkpotu aç" və ya "Gizli saxla, davam et".
  - Rəqiblərə heç bir bildiriş, jurnal yazısı və ya məlumat getmir. Bu, API və WebSocket cavabları üçün testlə yoxlanılır.
  - Cəkpot sahibi pas edə bilmir və səsvermə onu pas etmir.
- **Gizli 3 Tuz avtomatik açılır:**
  - sahibin növbə vaxtı bitəndə;
  - sahibin xoda balansı çatmayanda;
  - sahib baxışmada iştirak edəndə (kart üzə çıxmazdan əvvəl);
  - sahib otaqdan çıxanda (cəkpot səssiz ləğv olunmur);
  - raund başqa yolla bağlanmazdan əvvəl: son qalan, bank bölgüsü və ya Seka qərarı.
- **Ödəniş:**
  - Hər rəqibdən elan edilmiş məbləğ ilə rəqibin balansının **minimumu** tutulur. Çatışmayan hissə kredit və ya borc yaratmır.
  - Faktiki ödənilən məbləğ nəticədə göstərilir.
  - Cəkpot və bank qazancı ayrı qeydlərdir və hər biri bir dəfə hesablanır.
- **Bir neçə cəkpot eyni anda olsa** (məsələn 3×6 və 3 Tuz):
  - Hamısı birlikdə açılır və oturma sırası ilə emal olunur.
  - Cəkpot sahibləri bir-birinə ödəmir, bank sahiblər arasında bərabər bölünür.
  - Rəqibin balansı birinci sahibə ödəmədən sonra azalırsa, sonrakı sahib qalan balans qədər alır.

## 7. Demo, botlar, emoji və çat
- **Demo:** ayrıca məşq rejimidir.
  - Hər girişdə 10 000 virtual demo oyun xalı verilir; çıxıb yenidən girəndə qalıq yenə 10 000 olur.
  - Yalnız botlarla oynanılır. Bot sayını özünüz seçirsiniz: 1–7 bot, otaqda ən çox 8 yer.
  - Əsas balansa, borclara və statistikaya təsir etmir.
- **Botlar:**
  - Otaq sahibi raundlar arasında bot əlavə edib çıxara bilər. Bot olan otaq məşq rejimindədir.
  - Botun yanında həmişə "🤖 Bot" yazılır.
  - Botlar yalnız öz kartlarını və hamıya açıq məlumatı görür.
- **Emoji:** 😂 😎 😡 👏 🤝 🔥 😭. Oyunçunun şəklinin üzərində 3 saniyə görünür. Hər istifadəçi 3 saniyədə bir emoji göndərə bilər.
- **Çat:** mesaj şəklin üzərində 3 saniyə balon kimi görünür. Uzunluğu ən çox 120 simvoldur, HTML kimi deyil, mətn kimi göstərilir. Tarixçəni "Çat tarixçəsi" bölməsində görmək olar.
- Emoji və çat masanı yenidən çəkmir, ona görə yazılan məbləğ və seçimlər sıfırlanmır.

## 8. Profil şəkli
- JPG, PNG və ya WebP, ən çox 2 MB.
- Serverdə faylın həqiqi şəkil olduğu yoxlanılır. Şəkil 256×256 ölçüsünə kiçildilir, WebP formatına çevrilir və bütün metadata (EXIF, GPS) silinir.
- Masada, profildə və admin siyahısında göstərilir. Şəkil yoxdursa adın baş hərfi çıxır.

## 9. Masa, kartlar, animasiya və səs
- **Masa:** oval yaşıl keçə, taxta və dəri kənar, incə qızılı xətlər, ortada "SEKA" yazısı. Hamısı CSS və SVG ilə ayrıca komponent kimi qurulub — fon şəkli və görünməz düymə yoxdur.
- **Oturacaqlar:** 2–8 oyunçu masanın ətrafında düzülür. Hər oyunçuda avatar, ad, balans, kartların arxa üzü və banka qoyduğu məbləğ görünür. Növbəsi olan oyunçunun avatarı ətrafında vaxt halqası və saniyə sayğacı var. Sizin yeriniz masanın altındadır: avatarınız, böyük kartlarınız və "N xal" nişanı.
- **Bank:** masanın ortasında virtual əskinas yığını və dəqiq məbləğ ("Virtual oyun balansı" yazısı ilə). Əskinaslar bu layihə üçün çəkilib, üzərində "VİRTUAL" yazılıb; real pulun surəti deyil.
- **Düymələr:** böyük **Pas** (qırmızı), **Baxış** (göy), **Xod** (sarı, məbləğlə). "Seka təklif et" və "Bankı bölək" yalnız 2 oyunçu qalanda görünür və yalnız icazə olanda aktivdir. Gizli 3 Tuz sahibində Pas kilidlidir.
- **Üst panel:** geri, otağın adı, "N/8 oyunçu · Seka", otaq kodu (kopyalamaq üçün toxunun), "Virtual oyun balansı" və **+** (kredit müraciəti), səs, tam ekran, bildirişlər.
- **Alt panel:** 😊 emoji, mesaj sahəsi, ☰ çat tarixçəsi və oyun jurnalı.
- **Ekranlar:** telefon şaquli, telefon üfüqi (masa solda, düymələr sağda), planşet və kompüter. iPhone-un kəsik və alt zolağı (safe area) nəzərə alınır; klaviatura açılanda mesaj sətri klaviaturanın üstündə qalır.
- **Kartlar:** ənənəvi üslubda, ağ fon, yumru künclər. Küncdə klassik indekslər: **J** (Valet), **Q** (Dama), **K** (Karol), **A** (Tuz). Ürək və kərpic qırmızı, pika və xaç qara. Saray kartları iki başlı və rənglidir; Tuzun ortasında böyük suit var; 6–10 klassik düzülüşlə çəkilib. Daxili kodlar (V/D/K/T) dəyişməyib, bu yalnız görünüşdür.
- **Animasiyalar:** paylama (kartın arxa üzü göyərtədən oyunçuya uçur), açılan kartın çevrilməsi, xodda əskinasın oyunçudan banka, raund sonunda bankdan qalibə uçması. Yalnız serverin təsdiqlədiyi dəyişikliklər üçün işləyir. Ekran yenidən çəkiləndə animasiya baştan başlamır. Sistemdə "hərəkəti azalt" seçilibsə animasiya oynamır.
- **Səslər:** paylama, pul, qələbə və növbə səsi brauzerdə yaradılır (fayl yoxdur). İlk toxunuşdan sonra açılır; 🔊/🔇 düyməsi ilə söndürülür və seçim yadda qalır.
- **Gizlilik:** rəqibin kartı animasiya üçün belə klientə göndərilmir. Paylama yalnız arxa üzlə göstərilir; kartın üzü yalnız server onu sizə açanda görünür.
- Bütün vizual faylların mənbəyi və lisenziyası: `VISUALS.md`.

## 10. Tam ekran
- Otaqda ⤢ düyməsi var. Fullscreen API dəstəklənən brauzerlərdə həqiqi tam ekran açılır.
- iPhone Safari-də sıxlaşdırılmış görünüş açılır. Həqiqi tam ekran üçün Safari-də **Paylaş → Əsas ekrana əlavə et** seçin.

## 11. Balansın qorunması (baza xətası)
- **Oyun yazılışları:** hər oyun pul hərəkəti sabit paket ID-si ilə atomik yazılır. Eyni paket iki dəfə tətbiq olunmur.
- **Baza cavab verməyəndə:**
  - Otaq dondurulur və "⏳ Baza bağlantısı gözlənilir" yazısı görünür.
  - Oyunçu hərəkətləri, botlar, taymerlər və həmin oyunçunun pul əməliyyatları gözləyir.
  - Bağlantı qayıdandan sonra hamısı bir dəfə yazılır.
- **Server çöksə:** növbəti açılışda yarımçıq raund ləğv edilir və yalnız bazaya yazılmış qoyuluşlar geri qaytarılır.

## 12. Texniki
- `server/game/engine.js`: oyun mühərriki — cəkpotlar və gizli 3 Tuz burada.
- `server/game/cards.js`: xal hesablaması.
- `server/game/bot.js`: bot qərarları.
- `server/finance.js`: bonus, kredit, hədiyyə, borc, avtomatik tutulma, idempotency.
- `server/debts.js`: avtomatik borc tutulması işçisi.
- `server/rooms.js`: otaqlar; botlar, emoji və çat; oyunla sinxron pul növbəsi.
- `server/store.js`, `server/db.js`: baza, migration-lar, tranzaksiyalar.
- `server/app.js`: HTTP API və WebSocket.
- `public/`: frontend modulları (`core`, `room`, `profile`, `admin`, `app`), kartlar (`cards.js`), virtual əskinaslar (`notes.js`), animasiyalar (`fx.js`), səslər (`sound.js`) və xal (`score.js`).
- Testlər `test/` qovluğundadır. Hamısını işə salmaq üçün: `npm test`. PostgreSQL üzərində: `TEST_DATABASE_URL=postgres://... npm test` (`batch`, `finance`, `integration` və `money-integration` faylları).
