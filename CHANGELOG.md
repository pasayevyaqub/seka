# Dəyişikliklər

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
| `public/app.js` | AZN göstərilməsi, otaq siyahısı, ad/görünmə/şifrə formu, "Kompüterlə oyna", demo lobbisi, kart atma interfeysi, təklif düymələri və cavablar, Baxış izahı, nəticə bölməsi (kartlar və xallar), tam ekran və alternativi, "Nəticələrim", admin "Nəticələr" və "Mənfi balansı sıfırla" |
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
