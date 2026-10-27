# Oyun xalı vahidi

- İnterfeys, bildirişlər və oyun mesajlarında balans vahidi “oyun xalı” oldu.
- Əskinas təsvirlərində valyuta işarəsi ulduzla, vahid “OYUN XALI” ilə əvəzləndi.
- Balans rəqəmləri, oyun qaydaları və verilənlər bazasının quruluşu dəyişdirilmədi.

# Dəyişikliklər

## v2.2.0 — maliyyə, sosial funksiyalar və yeni masa dizaynı

### Əsas yeniliklər
- **Qeydiyyat təsdiqsizdir** + bir dəfəlik qeydiyyat bonusu (standart 100 virtual oyun xalı, admin dəyişə bilər, yalnız gələcək qeydiyyatlara aiddir). Köhnə "gözləyən" hesablar aktiv olur, bonus almır.
- **Yeni mənfi balans yaranmır**: oyun, borc ödənişi, hədiyyə və admin çıxılması serverdə yoxlanılır. Köhnə mənfi balanslar silinmir, admin açıq şəkildə düzəldir.
- **Admin krediti** (təsdiqlə, limitlə, faizsiz, "Borcu ödə"), **oyunçular arası hədiyyə**, **müddətli borc** (qəbuldan sonra köçürmə, vaxtında avtomatik tutulma, qismən ödəniş, "Gecikib" statusu, ardıcıllıq: ən köhnə müddət, sonra kiçik ID).
- **Profil səhifəsi**, **admin panelində axtarış və bölmələr** (istifadəçilər, kredit, borclar, hədiyyələr), **bildirişlər**.
- **Demo**: 1 insan + 1–7 bot, hər girişdə 10 000 demo oyun xalı; əsas balansa təsir etmir.
- **Profil şəkli** (JPG/PNG/WebP ≤ 2 MB; serverdə yoxlanılır, kiçildilir, metadata silinir, bazada saxlanılır).
- **Emoji və çat** — oyunçunun avatarı üzərində 3 saniyəlik balon.
- **Xal**: saxlanılan 3 kartda 2 Tuz = 22. **Cəkpotlar**: 3×6 və 3 Tuz üçün ayrı məbləğ; 3 Tuz sahibi gizli seçim edir (aç / gizli saxla).

### Masa dizaynı (bu versiyanın son hissəsi)
- Oval yaşıl keçə, taxta/dəri kənar, qızılı detallar — CSS/SVG komponentləri; fon şəkli və görünməz düymə yoxdur.
- 2–8 oyunçu üçün oturacaq düzülüşü; avatar ətrafında vaxt halqası və saniyə sayğacı; ad, balans və banka qoyulan məbləğ.
- Bankda virtual əskinas yığını və dəqiq məbləğ. Əskinaslar orijinal çəkilib, üzərində "VİRTUAL" yazılıb.
- Böyük Pas / Baxış / Xod düymələri; Seka və bölmə təklifləri yalnız icazə olanda aktivdir; gizli 3 Tuz sahibində Pas kilidlidir.
- Klassik kartlar: J/Q/K/A indeksləri, iki başlı rəngli saray fiqurları, böyük suitli Tuz, klassik pip düzülüşü (server jurnalında da J/Q/K/A).
- Animasiyalar: paylama, kartın çevrilməsi, pulun banka və qalibə uçuşu. Yalnız serverin təsdiqlədiyi vəziyyətdən yaranır, yenidən çəkilmədə baştan başlamır.
- WebAudio səsləri (paylama, pul, qələbə, növbə), 🔊/🔇 düyməsi; səs ilk toxunuşdan sonra açılır.
- Telefon şaquli/üfüqi, planşet və kompüter görünüşü; iPhone safe area və klaviatura dəstəyi.
- Server görünüşünə yalnız hamıya açıq olan `put` (oyunçunun banka qoyduğu cəmi) əlavə olundu. Oyun qaydaları, balans hesablamaları və baza dəyişmədi.

### Baza
- **Migration 4** (avtomatik): `users.credit_debt`, `credit_limit`, `avatar`, `avatar_ver`; `transactions.counterparty_id`, `op_key`, `note`; yeni cədvəllər `op_keys`, `app_settings`, `credit_requests`, `loans`, `loan_payments`, `notifications`. Mövcud hesablar, şifrələr, balanslar və tarixçə qorunur. (Otaq ayarları bazada saxlanılmır; köhnə klient tək `jackpotAmount` göndərsə, server onu hər iki cəkpota tətbiq edir.)
- Yeni mühit dəyişəni yoxdur. Yeni asılılıq: `sharp` (profil şəkli).

### Dəyişən fayllar
| Fayl | Dəyişiklik |
|---|---|
| `server/finance.js`, `server/debts.js` | **Yeni**: bonus, kredit, hədiyyə, borc, avtomatik tutulma, idempotency |
| `server/db.js`, `server/store.js` | Migration 4, təsdiqsiz qeydiyyat, şərtli (mənfiyə düşməyən) yazılışlar, avatar |
| `server/app.js`, `server/rooms.js` | Yeni API-lər, demo/bot sayı, emoji/çat, oyunla sinxron pul növbəsi |
| `server/game/engine.js`, `cards.js`, `bot.js` | 2 Tuz = 22, iki cəkpot, gizli 3 Tuz, `put`, J/Q/K/A etiketləri |
| `public/room.js` | Masa yenidən quruldu |
| `public/fx.js`, `public/sound.js`, `public/notes.js` | **Yeni**: animasiya, səs, virtual əskinaslar |
| `public/cards.js`, `public/index.html` | Klassik kart dəsti, J/Q/K/A, animasiya qatı |
| `public/core.js`, `profile.js`, `admin.js`, `app.js`, `style.css` | Modullara bölünmüş frontend, profil, admin, yeni dizayn |
| `test/finance.test.js`, `test/money-integration.test.js` | **Yeni** testlər |
| `test/engine.test.js`, `integration.test.js`, `batch.test.js` | v2.2 qaydaları və migration üçün yeniləndi |
| `README.md`, `VISUALS.md` | Təlimat; vizual materialların mənbəyi və lisenziyası |

## v2.1.0 — balans yazılışının etibarlılığı

### Düzəldilən problemlər
1. **Təkrar yazılış balansı iki dəfə dəyişirdi.** İndi hər yazılış paketinin sabit, unikal `batchId`-si var (`<raund uid>:<sıra nömrəsi>`). Paket `round_batches` cədvəlində `PRIMARY KEY` ilə qeyd olunur. Bu qeyd, balanslar, əməliyyat jurnalı, raund vəziyyəti və nəticələr **bir tranzaksiyadadır**. Eyni paket ardıcıl, paralel və ya "COMMIT oldu, cavab itdi" halında təkrar gələndə heç nə dəyişmir, yalnız cari balanslar qaytarılır. `batchId`-siz yazılış qəbul edilmir.
2. **Baza xətasında əməliyyat itirdi.** İndi təsdiqlənməmiş paket otağın növbəsində (`outbox`) sabit `batchId` ilə saxlanılır və silinmir. Yazılış alınmayanda:
   - Otaq **dondurulur**: oyunçu hərəkətləri, botlar, taymerlər (növbə vaxtı, təklif, kart atma, seka), raund başlatma, ayarlar və bot əlavəsi bloklanır.
   - Klientlər "⏳ Baza bağlantısı gözlənilir" görür. Ekranda **son təsdiqlənmiş vəziyyət** qalır, təsdiqlənməmiş nəticə göstərilmir. Balans yalnız bazada təsdiqləndikdən sonra yenilənir.
   - Təkrar cəhd: 5 dəfə tez (1, 2, 4, 8, 15 san), sonra hər 30 saniyədən bir, bağlantı qayıdana qədər.
   - Bərpadan sonra paketlər sıra ilə və **hər biri bir dəfə** yazılır. Gözləmə müddəti bütün son tarixlərə əlavə olunur, yəni oyunçunun növbə vaxtından çıxılmır.
   - Dondurulma zamanı otaqdan çıxma qəbul olunur, amma onun oyun nəticəsi (pas) bərpadan sonra icra edilir. Otaq bağlanmalıdırsa, əvvəl paketlər yazılır, sonra bağlanır. Bu müddətdə otaq açıq siyahıda görünmür.
   - **Bərpa mümkün olmadıqda** paket yaddaşda qalır və otaq dondurulmuş qalır, balans heç vaxt yarımçıq dəyişmir. Server dayanarsa (SIGTERM) əvvəl 8 saniyə yazmağa cəhd edilir. Yazılmamış paket itərsə, növbəti başlanğıcda həmin raund ləğv edilir və **yalnız bazaya həqiqətən yazılmış** qoyuluşlar qaytarılır. Yazılmamış hərəkət balansdan heç vaxt çıxılmamışdı, ona görə ziddiyyət yaranmır.
   - Server başlanğıcındakı qaytarma da paket kimi qeyd olunur (`<uid>:recovery`), ona görə iki dəfə icra olunmur. Bağlanmış raunda gec gələn pul paketi rədd edilir.

### Dəyişən fayllar
| Fayl | Dəyişiklik |
|---|---|
| `server/store.js` | `applyRoundBatch()` idempotent oldu: `batchId` məcburidir, `round_batches` qeydi və bütün yazılışlar eyni tranzaksiyadadır, bağlanmış raunda pul yazılmır. `recoverActiveRounds()` idempotent oldu və `contrib`-i tranzaksiya daxilində yenidən oxuyur |
| `server/db.js` | Migration 3: `round_batches` cədvəli (`batch_id` PRIMARY KEY) və `transactions.batch_id` sütunu |
| `server/rooms.js` | Paket növbəsi (`outbox`), sıra ilə yazılış, dondurma və təkrar cəhd, son təsdiqlənmiş görünüşün göndərilməsi, çıxma/bağlanma/taymer/bot qoruması, `flushAll()` |
| `server/game/engine.js` | `shiftDeadlines()`: gözləmə müddəti son tarixlərə əlavə olunur |
| `server/app.js`, `server/index.js` | `shutdown()` və SIGTERM/SIGINT zamanı gözləyən paketlərin yazılması; test üçün təkrar cəhd intervalları |
| `public/app.js`, `public/style.css` | "Baza bağlantısı gözlənilir" banneri, hərəkət düymələri gizlədilir |
| `test/batch.test.js` | **Yeni**: paketin ardıcıl və paralel təkrarı, eyni raundda fərqli paketlər, rollback, COMMIT-dən sonra cavab itkisi, bərpa, v1 bazasından migration |
| `test/integration.test.js` | +5 test: baza dayananda insan hərəkətinin və botun bloklanması, bərpadan sonra bir dəfə yazılış, cavab itkisi, çıxma və bağlanma, çökmə + qaytarma |

## v2.0.0

### Dəyişən fayllar
| Fayl | Nə dəyişdi |
|---|---|
| `server/game/engine.js` | Yenidən yazıldı: "Oyunum yoxdur" və məcburi baxış silindi; 2 oyunçuda Seka/bölmə təklifləri (vaxtı uzatmır, növbədə 1 dəfə); seka zamanı 4 kartdan özün 1-ni atırsan (vaxt bitəndə 4-cü kart atılır); nəticədə yalnız baxışma ilə müəyyənləşən kartlar açılır; bank tərəflər arasında bölünür; qarşılıqlı nəticə axınları (qəpiklə, dəqiq yuvarlaqlaşdırma); versiya sayğacı |
| `server/game/bot.js` | **Yeni.** Bot qərarları: xod/baxış/pas, təkliflər və cavablar, seka, kart atma, gecikən insana "pas" səsi. Yalnız öz görünüşünü görür |
| `server/rooms.js` | Otaq adı, açıq/gizli, şifrə (scrypt hash, 5 səhv cəhd / 5 dəq limiti), açıq otaqlar siyahısı, botlar və məşq rejimi, demo otaqlar, köhnə/təkrar kliklərin rədd edilməsi (versiya), atomik raund yazılışı, admin balans dəyişikliyinin raunda delta ilə tətbiqi |
| `server/store.js` | Təsdiq gözləyən istifadəçi daxil olur (demo); atomik balans əməliyyatları; mənfi balansın sıfırlanması (paralel sorğulara qarşı müqayisə ilə); raund qeydləri və qarşılıqlı nəticələr; server yenidən başlayanda yarımçıq raund pulunun qaytarılması |
| `server/db.js` | Migration sistemi (`schema_migrations`), `db.tx()` atomik tranzaksiyalar (PostgreSQL və SQLite), yeni cədvəllər `rounds`, `round_flows`, `transactions` cədvəlinə yeni sütunlar `kind`, `prev_balance`, `round_uid` |
| `server/app.js` | **Yeni** (köhnə `index.js`-in yerinə): yeni API-lər `/api/rooms`, `/api/my-stats`, `/api/admin/stats`, `/api/admin/users/:id/reset-negative`; demo istifadəçi üçün məhdudiyyətlər; testlər üçün `createApp()` |
| `server/index.js` | Yalnız serveri işə salır |
| `public/app.js` | oyun xalı göstərilməsi, otaq siyahısı, ad/görünmə/şifrə formu, "Kompüterlə oyna", demo lobbisi, kart atma interfeysi, təklif düymələri və cavablar, Baxış izahı, nəticə bölməsi (kartlar və xallar), tam ekran və alternativi, "Nəticələrim", admin "Nəticələr" və "Mənfi balansı sıfırla" |
| `public/style.css` | Yeni komponentlərin stilləri, kompakt mobil görünüş, tam ekran alternativi |
| `public/index.html` | Tam ekran üçün manifest və iPhone meta-teqləri |
| `public/score.js`, `public/manifest.webmanifest`, `public/icon.svg` | **Yeni**: klientdə xal göstərişi, ana ekrana əlavə etmək üçün manifest və ikon |
| `test/engine.test.js` | Yeni qaydalara uyğunlaşdırıldı və genişləndirildi (24 test) |
| `test/bot.test.js` | **Yeni** (5 test) |
| `test/integration.test.js` | **Yeni**: server + WebSocket + baza (8 test) |

### Bazaya edilən dəyişikliklər (avtomatik, məlumat silmir)
- `schema_migrations`: hansı migration-ların tətbiq edildiyini saxlayır.
- `transactions` cədvəlinə əlavə sütunlar:
  - `kind`: `game`, `admin`, `reset` və ya `refund`
  - `prev_balance`: əməliyyatdan əvvəlki balans
  - `round_uid`: əməliyyatın aid olduğu raund
- `rounds`: hər real raundun vəziyyəti və kimin nə qoyduğu.
- `round_flows`: kim kimə nə qədər uduzub (qəpiklə).
