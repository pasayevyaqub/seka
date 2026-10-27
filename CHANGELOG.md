# Dəyişikliklər

## v2.8.0 — xal/balans məxfiliyi, masadan borc, mobil masa, çat tarixçəsi, sekadan keçən bank, onlayn status, "Şir", donmaya qarşı

- **Kart xalı yalnız baxandan sonra:** yeni `look` hərəkəti (versiyanı dəyişmir, başqalarına heç nə göndərmir); server `me.score`-u yalnız baxandan sonra (və raund bitəndə) göndərir. Botlar avtomatik "baxır".
- **Balans məxfiliyi:** otaq üzvlərinin və raund oyunçularının balansı yalnız özünə göndərilir; "Borca oyna" təklifinin "çatışmayan məbləği" yalnız iki tərəfə; hədiyyə alıcısı seçimində balans göstərilmir. Rəqib üçün bankdakı payı göstərilir.
- **Masadan borc:** oyunçu menyusu (Hədiyyə / Borc istə / Borc təklif et), masada gözləyən təkliflər zolağı və pəncərəsi, `GET /api/loans/pending`. Mövcud atomik + idempotent + otaq növbəsi ilə ardıcıl axın istifadə olunur.
- **Mobil masa:** oturacaqlar ellips boyunca faizlə; rəqibin kartları avatarın içəri tərəfində (sıx masada küncdə kiçik yelpazə); status/taymer/onlayn nişanları avatarın üzərində; xal nişanı və "Göstər" kartların yanında; kiçik ekran və landşaft üçün ayrıca ölçülər; toxunma sahələri böyüdüldü. `tools/ui-layout.cjs` ilə 91 kombinasiya yoxlanılıb.
- **Çat tarixçəsi:** 💬 açılan panel, oxunmamış sayı, qoşulandan sonrakı son 100 mesaj, yalnız otaq üzvlərinə.
- **Sekadan keçən bank:** qayda sənədləşdirilib (README 5d) və UI-da göstərilir (`sekaJoin.carried`, `carry`); uçot testləri (seka, ikinci seka, bölmə, cəkpot, çıxma, ləğv, borca oyna).
- **Onlayn status:** yaşıl/qırmızı nöqtə; botlarda yoxdur; bağlantı bərpasında yenilənir.
- **Səs:** "Səsi yoxla". Mikrofon (WebRTC) əlavə edilməyib — səbəb və TURN xərci README 9c-də.
- **"Şir" hədiyyəsi:** Migration 7 (`gift_types.share_pct`, `lion`), hədiyyə üzrə ayrıca faiz; istifadəçinin şəkli əsasında animasiya (portaldan tullanma, yal hərəkəti, nərilti, qızılı işıqlar, ~3,2 san), sintez səs, yüngül rejim, SVG ehtiyat variantı.
- **Donma/bağlantı:** PG vaxt limitləri və pool `error` dinləyicisi, taymer növbəsinin şişməsinin qarşısı, uzun növbə işlərinin loqu, ping bazasız, sürət limiti cədvəlinin təmizlənməsi, ping 15 san, klient ürək döyüntüsü + "yenidən qoşulur" zolağı, `/health` (baza yoxlaması ilə).
- **Testlər:** `test/v28-engine.test.js`, `test/v28-integration.test.js`; köhnə testlər yeni qaydalara uyğunlaşdırıldı.

## v2.7.1 — Admin paneli: canlı yenilənmədə formalar qorunur

- **Problem:** `refreshAdminList()` siyahını `innerHTML` ilə yenidən yaradırdı. Canlı "staff" bildirişi (məs. yeni kredit müraciəti) gələndə "Oyunçu əlavə et" və kredit qərarı formalarına yazılan mətn silinir, fokus itirdi.
- **Düzəliş:** admin siyahısı, tab başlıqları (gözləyən kredit sayı) və masa hədiyyəsi ayarları artıq `morph` ilə yerində yenilənir. Kredit kartları və formaları müraciət id-si ilə açarlanıb (`data-key`) — yeni müraciət yuxarı düşəndə və ya başqa müraciət siyahıdan çıxanda bir formanın yazıları başqasına keçmir.
- **`data-keep-dirty`:** admin formalarında istifadəçinin dəyişdirdiyi sahələrin (məs. məbləğ, yeni limit, bonus) üzərinə fokusda olmasalar belə yazılmır; toxunulmamış sahələr yeni dəyəri alır. Göndərmədən sonra `form.reset()` sahələri sıfırlayır.
- **morph:** yeni siyahıda olmayan açarlı elementlər əvvəlcədən silinir, fokuslu sahəni saxlayan element DOM-da köçürülmür (köçürmə blur edir və iPhone-da klaviaturanı bağlayır).
- **Yoxlama:** `tools/ui-admin-morph.cjs` (Playwright, real server və real staff bildirişləri ilə) və `test/admin-morph.test.js` (innerHTML-ə qayıdışın qarşısını alan statik test).

## v2.7.0 — Dairə: giriş nəzarəti, borc istə, borca oyna, seka 60 san, iPhone yazı düzəlişi

- **Ad və ikon:** saytın görünən adı **Dairə** (brauzer başlığı, giriş ekranı, menyu, əsas ekrana əlavə edilən tətbiq). Yeni ikon — sadə dairə motivi (kart/pul yoxdur). Giriş ekranında yalnız ad, istifadəçi adı və şifrə; masa, otaqlar və oyunçular yalnız daxil olduqdan sonra yüklənir. Oyun qaydalarında "seka" termini qalır.
- **Giriş:** açıq qeydiyyat bağlıdır (`/api/register` → 403); oyunçunu admin yaradır (bonus bir dəfə); "Oyunçu girişini aç/bağla" (bazada, restartdan sonra qalır; admin həmişə daxil olur; daxil olmuşları çıxarmır); bloklama və admin şifrə dəyişikliyi sessiyaları kəsir; son aktiv admin qorunur.
- **iPhone yazı/klaviatura:** tam `innerHTML` əvəzinə `morph` — aktiv input DOM-da qalır; mətn, kursor, seçim, fokus, kompozisiya qorunur; fon yeniləməsi fokus vermir; məcburi `scrollTo` silindi; `--vvh` yalnız dəyişəndə yazılır.
- **Seka:** qoşulma vaxtı 60 san (ayrı sabit `SEKA_JOIN_MS`); "Qoşulmuram"; qərar verməyən hüquqlu oyunçu varsa əsas oyunçular/botlar erkən başlada bilmir (serverdə yoxlanılır); vaxt bitəndə avtomatik davam.
- **Borc istə:** borc alan istəyir, borc verən təsdiqləyir (köçürmə və borc bir tranzaksiyada), rədd/geri götürmə; profildə "X-a borcum / Y-dan alacağım".
- **Borca oyna:** iki aktiv insan qalanda şərti (təminatsız) qoyuluş — 30 san cavab, taymer dayanır, limit yalnız yeni təsdiqlə artır, şərti qoyuluş ayrı uçot (masada 🧾 nişanı), uduzanda yalnız faktiki istifadə olunan hissə adi borc kimi yaranır (raundun son paketi ilə eyni tranzaksiyada), udanda borc yaranmır, bölmə/seka/ləğv/restart qaydaları (README 5b).
- **Bot nişanı** yenidən görünür. Lobbi siyahısı gizli vərəqdə sorğu göndərmir. Bank mərkəzi yığcam (əskinaslar solda, məbləğ sağda).
- **Baza:** Migration 6 — `player_login_open = 1` və `loans(status, lender_id)` indeksi; məlumat silinmir.

### Dəyişən fayllar
`server/game/engine.js` (borca oyna, seka 60 san), `server/game/bot.js`, `server/rooms.js`, `server/store.js`, `server/finance.js`, `server/app.js`, `server/db.js`; `public/morph.js` (**yeni**), `public/app.js`, `public/room.js`, `public/profile.js`, `public/admin.js`, `public/gifts.js`, `public/core.js`, `public/fx.js`, `public/style.css`, `public/index.html`, `public/manifest.webmanifest`, `public/icon.svg`; `test/credit-play.test.js` (**yeni**), `test/engine.test.js`, `test/bot.test.js`, `test/batch.test.js`, `test/integration.test.js`, `test/money-integration.test.js`; `tools/ui-peek.cjs`; `README.md`, `CHANGELOG.md`.

## v2.6.0 — kartın küncünü qaldırıb baxmaq (squeeze / peek)

- **Öz kartlarım əvvəlcə üzü bağlıdır.** Kartın yuxarı küncündən tutub diaqonal sürüşdürəndə künc barmağın hərəkəti qədər qatlanır. Altdan kağızın üz tərəfi, üzərində kartın rəqəmi və işarəsi görünür. Qatda işıq, qıvrım xəttində kölgə, arxa üzün üstündə qatın kölgəsi var.
- Barmağı buraxanda, toxunma ləğv olunanda, pəncərə fokusu itəndə və ya pointer capture itəndə kart yumşaq animasiya ilə (~0.23 san) örtülür. Hər kart ayrıca açılır; sol və sağ yuxarı küncün ikisindən də tutmaq olur.
- **Pointer Events + pointer capture:** capture `#app`-dan kənardakı daimi elementdədir. Barmaq tutulu qalarkən masa yenilənsə də (botlar oynayanda) baxış kəsilmir.
- **Səhifə sürüşməsi:** yalnız kartın üzərində bloklanır (`touch-action: none` yalnız `.peek-card`-da).
- **"Göstər / Ört" düyməsi** (👁): kartları yalnız sizin ekranınızda açır və yenidən örtür. Raund bitəndə öz kartlarınız açıq görünür.
- **İlk istifadə izahı:** "Küncü sürüşdür, karta bax — Buraxanda yenə örtülür". İlk baxışdan sonra bir daha göstərilmir.
- **Sadə rejim:** azaldılmış hərəkət, ☰ → Animasiyalar söndürülüb və ya çox zəif cihaz (1 nüvə, < 1 GB yaddaş) olduqda kartı basıb saxlayanda açılır, buraxanda bağlanır.
- **"N xal" nişanı** kartlara baxdıqdan sonra (hamısına küncdən baxanda və ya "Göstər" ilə) görünür.
- **Atma mərhələsi (4 kart):** kartlara küncdən baxmaq seçim etmir. Atılacaq kartı ayrıca "At" düyməsi ilə seçirsiniz, sonra "Seçilmiş kartı at" ilə təsdiqləyirsiniz.
- **Məxfilik və qaydalar:** baxmaq serverə heç nə göndərmir, xod sayılmır, növbəni dəyişmir, rəqiblərə heç nə açmır. Rəqiblərin kartları əvvəlki kimi klientə göndərilmir. Serverdə "kartına baxıb-baxmamaq" (kor oyun / baxış haqqı) qaydası yoxdur — buna görə qeydə alınacaq bir şey yoxdur. Raund sonunda kartların açılması mövcud qayda ilə işləyir.
- **Kod:** effekt ayrıca modulda (`public/peek.js`). Xarici kitabxana yoxdur — CSS clip-path, SVG və bir az JavaScript həndəsəsi.

### Dəyişən fayllar
`public/peek.js` (**yeni**), `public/room.js` (əl, "At" və "Göstər" düymələri, izah), `public/app.js` (quraşdırma, yenidən çəkilmədən sonra baxışın bərpası), `public/style.css`, `tools/ui-peek.cjs` (**yeni**, brauzer yoxlaması — Playwright tələb edir, layihənin asılılığı deyil), `README.md`, `CHANGELOG.md`, `package.json`.

## v2.5.0 — istinad şəklinə uyğunlaşdırılmış masa

- **Oturacaqlar:** oyunçu sayına görə sabit düzülüş (2–8), istinad şəklindəki kimi: yuxarı orta, sol/sağ yuxarı, sol/sağ aşağı, mən aşağı ortada. Üfüqi ekran və kompüterdə oturacaqlar ellips boyunca, avatar solda, ad/balans/kartlar sağda.
- **Botlar:** emoji əvəzinə orijinal SVG robot avatarı. Şəkli olmayan oyunçular üçün qızılı halqalı baş hərf avatarı (şəkil yükləyən oyunçunun öz şəkli görünür).
- **Masa:** qalın tikişli dəri kənar, mis bəzəklər, tünd yaşıl keçə, ortada solğun dairəvi naxış. Ətrafda bəzəklər: fənər, armudu stəkanda çay, qoz-fındıq qabı, oyma qutu, yarpaqlar (orijinal SVG, kliki tutmur).
- **Bank:** "BANK" və məbləğ, altında səliqəli krem/yaşıl "XAL" əskinas dəstəsi.
- **Üst panel:** xətti ikonlar (geri, səs, tam ekran, sikkələr). Otaq adına toxunanda otaq menyusu açılır (bildirişlər, profil, səs, animasiya, çat, jurnal); bildiriş sayı 👥 ikonunda.
- **Alt hissə:** idarə paneli bir çərçivədə ([− xal +] · Pas · Baxış · Xod et), altında son hədiyyə sətri ("👑 Yaqub → Anar · Masa kralı"), sonra 😊 · mesaj · 🎁 · yaşıl göndər düyməsi.
- Serif şrift (Georgia) adlarda, məbləğlərdə və düymələrdə; vaxt halqası qızılı.
- Oyun qaydaları, balanslar, baza və hədiyyə sistemi dəyişməyib. Yeni migration yoxdur.

### Dəyişən fayllar
`public/room.js`, `public/style.css`, `public/core.js` (avatarlar), `public/notes.js`, `public/giftfx.js` (hədiyyə sətri), `public/decor.js` (**yeni**), `README.md`, `VISUALS.md`, `CHANGELOG.md`.

## v2.4.0 — mobil masa görünüşü (istinad şəkli əsasında)

- **Masa:** brauzerdə yaradılan keçə toxuması (SVG filtrləri, xarici şəkil yoxdur), tikişli dəri kənar, yan tərəflərdə mis bəzək, yumşaq kölgələr, taxta fon.
- **Oturacaqlar:** avatarlar masanın içində, kənara yaxın düzülür: avatar → ad → balans → kartlar. Sizin yeriniz aşağıda ortadadır, kartlarınız masanın aşağı kənarının üstündə, "N xal" nişanı ilə. Aşağıdakı boş sahə aradan qaldırıldı. Üfüqi ekranda avatarınız kartlarınızın soluna keçir.
- **Vaxt halqası:** növbəsi olan oyunçunun avatarında halqa və yanında "N san".
- **Kartlar:** klassik J/Q/K (iki başlı, rəngli fiqurlar) qalır. Arxa üz yeniləndi: qızılı haşiyə, tünd yaşıl sahə, səkkizguşəli ulduz medalyonu. Paylananda kartlar göyərtədən sürüşür, öz kartlarınız yerinə çatanda çevrilir (3D), rəqibin kartı açılanda çevrilir.
- **Xal:** bütün məbləğlər "10 000 xal" kimi göstərilir (əvvəl "AZN" yazılırdı; balanslar dəyişmir — yalnız yazılış). Bankdakı virtual əskinaslarda "XAL" və ulduz var. Xod qoyulanda əskinas oyunçudan banka uçur.
- **Məşq zolağı:** "🎓 Məşq rejimi · əsas balansa təsir etmir".
- **İdarə:** tək sıra — [− 10 xal +] · Pas · Baxış · Xod et (48 px hündürlük). Kartları örtmür. Növbə sizdə deyilsə: "Növbə: Ad · N san" və lazım olanda "Pas səsi".
- **Alt sətir:** 😊 · mesaj · 🎁 (hədiyyə — masadakı oyunçunu seçmək) · ☰ (bildirişlər, profil, səs, animasiyalar, çat və jurnal). Bildiriş sayı ☰ üzərində görünür.
- **Üst panel:** ‹ geri · 👥 otaq adı · kod · 🔊 · ⛶ · 🪙 balans (real otaqda toxunanda kredit müraciəti). Yazılar kəsilmir.
- **Səslər:** paylama (hər kart), öz kartlarınızın və rəqib kartlarının açılması. 🔊 ilə və ☰ menyusunda söndürülür.
- **Animasiya:** oyun idarəsinə mane olmur. "Hərəkəti azalt" və ya "Animasiyalar: söndürülüb" seçilibsə oynamır. Alt bildirişlər (toast) otaqda yuxarıda göstərilir və düymələri örtmür.
- Oyun qaydaları, balans hesablamaları, baza və hədiyyə sistemi dəyişməyib. Yeni migration yoxdur.

### Dəyişən fayllar
`public/room.js`, `public/style.css`, `public/cards.js` (arxa üz), `public/notes.js` (XAL), `public/fx.js` (paylama + çevrilmə), `public/gifts.js` (🎁 düyməsi), `public/app.js`, `public/core.js` (xal), `public/admin.js`, `public/profile.js`, server mesajları (`server/*.js` — "AZN" → "xal"), `test/finance.test.js` (mesaj mətni), `README.md`, `VISUALS.md`.

## v2.3.0 — animasiyalı masa hədiyyələri

### Yeniliklər
- Masada oyunçunun şəklinə toxunanda "Hədiyyə göndər" açılır: 🃏 Kart yağışı (100 xal), 👑 Masa kralı (300), 🔥 Odlu Tuz (1 000). Qiymət və alana keçəcək xal əvvəlcədən göstərilir, təsdiqdən sonra göndərilir.
- Alana ilkin olaraq qiymətin 30%-i keçir (aşağı yuvarlaqlaşdırılır), qalanı dövriyyədən çıxır. Admin faizi (0–100), qiymətləri və aktivliyi dəyişir. Köhnə əməliyyatlar dəyişmir.
- Animasiyalar orijinal SVG/CSS/Canvas ilə hazırlanıb (`public/giftfx.js`), xarici fayl yoxdur. Kliki tutmur, növbə ilə və məhdud növbədə göstərilir, bitəndə təmizlənir. Səs və animasiya ayrı-ayrı söndürülür (☰ menyusu), "hərəkəti azalt" seçiminə hörmət edilir.
- Alana gələn xal vaxtı çatmış borclara eyni tranzaksiyada tutulur. Bildirişdə gələn xal, borca tutulan hissə və qalan balans ayrıca göstərilir.
- Profil: "Göndərdiyim hədiyyələr" və "Aldığım hədiyyələr". Admin: "Masa hədiyyələri" bölməsi (axtarış, siyahı, ayarlar).
- Qadağalar: özünə, bota, masada olmayana, demo/botlu otaqda göndərmək olmaz.
- Təhlükəsizlik: server yoxlaması, tək tranzaksiya, idempotency açarı, şərtli çıxılma (mənfi balans yoxdur), aktiv raundda otaq növbəsi. WebSocket hadisəsi yalnız uğurlu ilk icradan sonra göndərilir, təkrar sorğuda göndərilmir, yaddaşda saxlanılmır.
- Kiçik düzəliş: alt bildirişlər (toast) artıq düymələrə toxunmağa mane olmur.

### Baza
- **Migration 5** (avtomatik, SQLite və PostgreSQL): yeni cədvəllər `gift_types` (ilkin 3 hədiyyə), `table_gifts`; `app_settings.gift_share_pct = 30`. Mövcud cədvəllərə toxunulmur.

### Dəyişən fayllar
| Fayl | Dəyişiklik |
|---|---|
| `server/db.js` | Migration 5 |
| `server/finance.js` | `sendTableGift`, `setGiftSettings`, `giftTypes`, `giftSharePct`, profil/admin siyahıları; `collectDue` → `collectDueIn` (eyni tranzaksiyada çağırmaq üçün) |
| `server/app.js` | `GET /api/table-gifts`, `POST /api/table-gift`, `GET /api/admin/table-gifts`, `POST /api/admin/table-gifts/settings` |
| `server/rooms.js` | `giftEvent` (otağa animasiya hadisəsi), `roomOfOrNull` |
| `public/giftfx.js` | **Yeni**: animasiyalar, növbə, bildiriş, animasiya seçimi |
| `public/gifts.js` | **Yeni**: hədiyyə göndərmə pəncərəsi |
| `public/room.js`, `public/app.js`, `public/fx.js`, `public/sound.js`, `public/style.css` | Avatar → hədiyyə, ☰ menyusunda səs/animasiya düymələri, hədiyyə səsləri, stillər |
| `public/profile.js`, `public/admin.js`, `public/core.js` | Hədiyyə tarixçəsi, admin bölməsi, əməliyyat növləri |
| `test/table-gifts.test.js` | **Yeni**: 8 test |
| `test/money-integration.test.js` | +2 test (aktiv raund, WebSocket hadisəsi, demo/bot, admin) |
| `test/batch.test.js` | Migration 5 yoxlaması |

## v2.2.0 — maliyyə, sosial funksiyalar və yeni masa dizaynı

### Əsas yeniliklər
- **Qeydiyyat təsdiqsizdir** + bir dəfəlik qeydiyyat bonusu (standart 100 virtual AZN, admin dəyişə bilər, yalnız gələcək qeydiyyatlara aiddir). Köhnə "gözləyən" hesablar aktiv olur, bonus almır.
- **Yeni mənfi balans yaranmır**: oyun, borc ödənişi, hədiyyə və admin çıxılması serverdə yoxlanılır. Köhnə mənfi balanslar silinmir, admin açıq şəkildə düzəldir.
- **Admin krediti** (təsdiqlə, limitlə, faizsiz, "Borcu ödə"), **oyunçular arası hədiyyə**, **müddətli borc** (qəbuldan sonra köçürmə, vaxtında avtomatik tutulma, qismən ödəniş, "Gecikib" statusu, ardıcıllıq: ən köhnə müddət, sonra kiçik ID).
- **Profil səhifəsi**, **admin panelində axtarış və bölmələr** (istifadəçilər, kredit, borclar, hədiyyələr), **bildirişlər**.
- **Demo**: 1 insan + 1–7 bot, hər girişdə 10 000 demo AZN; əsas balansa təsir etmir.
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
