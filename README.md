# Dairə — dostlar üçün onlayn kart oyunu (Seka qaydaları ilə)

Saytın görünən adı **Dairə**-dir. Oyunun özü Seka qaydaları ilə oynanılır və oyun daxilində "seka" termini saxlanılıb. Real-time multiplayer oyundur. İnterfeys Azərbaycan dilindədir və mobil uyğundur. Otaqlar adlı ola bilər, açıq və ya gizli, istəyə görə şifrəli. Bütün məbləğlər **virtual oyun balansıdır** və **xal** kimi göstərilir (v2.4-dən əvvəl "AZN" yazılırdı; məbləğlər eynidir). Real pul yatırma, nağdlaşdırma, faiz və ödəniş sistemi **yoxdur**.

Nə dəyişdiyini görmək üçün `CHANGELOG.md` faylına baxın. Cari versiya: **2.8.0**.

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
> Baza açılışda avtomatik yenilənir (v2.2 üçün Migration 4, v2.3 üçün Migration 5). Mövcud cədvəllərə yalnız yeni sütunlar, bazaya isə yeni cədvəllər əlavə olunur. Heç bir məlumat silinmir. Hesablar, şifrə hash-ləri, balanslar və tarixçə qalır.

### A. Ehtiyat nüsxə (tövsiyə olunur)
Neon panelində **Branches → Create branch** seçin, mənbə `main`, adı məsələn `backup-v2-1`. Problem olsa həmin nüsxəyə qayıtmaq olar.

### B. Kodu GitHub-a yükləmək (brauzerdən)
1. Zip-i açın.
2. GitHub-da repository-ni açın və **Add file → Upload files** seçin.
3. `seka` qovluğunun **içindəki** bütün fayl və qovluqları sürükləyib atın: `server`, `public`, `test`, `package.json`, `README.md`, `CHANGELOG.md`, `.gitignore`.
4. **Commit changes** düyməsini basın.

Eyni adlı fayllar üstünə yazılır. Silinməli köhnə fayl yoxdur. v2.3-də yeni fayllar: `public/giftfx.js`, `public/gifts.js`, `test/table-gifts.test.js` (v2.2-dən gəlirsinizsə). v2.2-də yeni olanlar: `server/finance.js`, `server/debts.js`, `public/core.js`, `public/room.js`, `public/profile.js`, `public/admin.js`, `public/fx.js`, `public/sound.js`, `public/notes.js`, `VISUALS.md`.

### C. Render
- Render dəyişikliyi görüb özü deploy edir. Etməsə, **Manual Deploy → Deploy latest commit** seçin.
- Build Command (`npm install`) və Start Command (`npm start`) dəyişmir.
- Bu versiyada profil şəkillərini emal etmək üçün **`sharp`** paketi əlavə olunub. Render onu `npm install` zamanı özü yükləyir, əlavə ayar lazım deyil.
- Deploy loglarında bu sətri görməlisiniz:
  ```
  Migration 4 yoxlanıldı/tətbiq edildi: v2.2: bonus, kredit, hədiyyə, oyunçu borcları, bildirişlər, avatar, idempotency
  Migration 5 yoxlanıldı/tətbiq edildi: v2.3: masa hədiyyələri (animasiyalı), qiymətlər və alana keçən faiz
  ```

### D. Neon
Əlavə ayar lazım deyil.
- **Yeni cədvəllər:** `op_keys`, `app_settings`, `credit_requests`, `loans`, `loan_payments`, `notifications` (v2.2); `gift_types`, `table_gifts` (v2.3). `app_settings`-ə `gift_share_pct = 30` əlavə olunur. Mövcud cədvəllərə v2.3-də heç nə əlavə olunmur.
- **`users` cədvəlinə əlavə olunan sütunlar:** `credit_debt`, `credit_limit`, `avatar`, `avatar_ver`.
- **`transactions` cədvəlinə əlavə olunan sütunlar:** `counterparty_id`, `op_key`, `note`.

Profil şəkilləri bazada saxlanılır (kiçildilmiş WebP, təxminən 5–20 KB), Render-in müvəqqəti diskində yox. Ona görə restart və ya deploy zamanı itmir.

### Migration hesablarla nə edir
- Köhnə **"pending"** (təsdiq gözləyən) hesablar aktivləşir.
- **blocked** və **rejected** hesablar olduğu kimi qalır, avtomatik açılmır.
- Mövcud hesablara başlanğıc bonusu **verilmir**.
- Köhnə **mənfi balanslar** silinmir və krediti borcuna çevrilmir. Admin onları ayrıca görüb açıq təsdiqlə düzəldə bilər.

## 3. Giriş, hesablar və bonus
- **Açıq qeydiyyat bağlıdır.** Ümumi linki (məs. WhatsApp qrupuna) göndərə bilərsiniz — link şifrəsiz giriş vermir; hər kəs öz istifadəçi adı və şifrəsi ilə daxil olur. Birdəfəlik/şifrəsiz dəvət sistemi yoxdur.
- **Oyunçunu admin yaradır:** Admin → Ayarlar → "Oyunçu əlavə et": görünən ad, unikal istifadəçi adı, ilkin şifrə. Şifrəni oyunçuya şəxsən göndərin. Oyunçu daxil olandan sonra "Profilim → Şifrəni dəyiş" ilə dəyişə bilər.
- **Başlanğıc bonusu** (Admin → Ayarlar, standart 100 xal) hər yeni hesaba yalnız bir dəfə, hesabla eyni tranzaksiyada yazılır. Mövcud hesablara yenidən verilmir.
- **Oyunçu girişini aç/bağla** (Admin → Ayarlar):
  - Açıq: aktiv hesablar istifadəçi adı və şifrə ilə daxil olur.
  - Bağlı: adi oyunçuların **yeni** girişləri dayanır. Admin (və moderator) həmişə daxil olur. Açıq qeydiyyat hər iki rejimdə bağlıdır.
  - Bağlamaq artıq daxil olmuş oyunçuları çıxarmır. Kimisə dərhal çıxarmaq üçün həmin hesabı bloklayın — bloklananda sessiyaları və aktiv bağlantıları dərhal etibarsız olur. Admin oyunçunun şifrəsini dəyişəndə də köhnə sessiyalar bağlanır.
  - Ayar bazada saxlanılır, server yenidən başlayanda qalır.
- **Son aktiv admin qorunur:** öz statusunu/rolunu dəyişmək olmaz; sonuncu aktiv adminin bloklanmasına və ya rolunun silinməsinə server icazə vermir.
- Giriş sürət məhdudiyyəti (rate-limit) yaddaşda müvəqqətidir; IP, yer və cihaz məlumatı bazaya yazılmır və heç yerdə göstərilmir.

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

## 5a. Oyunçular arası borc: "Borc istə" və "Borc ver"
- **Borc istə** (Profilim və ya masada oyunçunun şəklinə toxunub): kimdən, məbləğ, qaytarma vaxtı. Təsdiqlənənə qədər heç kimin balansı və borcu dəyişmir.
- Borc verən **təsdiqləyəndə** xal onun mövcud balansından sizə keçir və borc eyni tranzaksiyada yaranır. Balans çatmırsa təsdiq alınmır. Təkrar/paralel təsdiq ikinci dəfə işləmir. Rədd etmək və ya (istəyən tərəfindən) geri götürmək mümkündür.
- **Borc ver** (köhnə yol) da qalır: borc verən təklif edir, borc alan qəbul edir.
- Qismən və tam qaytarmaq olur. Müddət çatanda qalan borc mövcud balansdan avtomatik tutulur; çatmasa qismən tutulur ("Gecikib"), qalanı sonrakı daxilolmalardan. Mənfi balans və yeni kredit yaranmır. Faiz yoxdur.
- Profildə qarşı tərəfə görə cəm görünür: "Anara borcum: 100 xal", "Yaqubdan alacağım: 100 xal". Admin krediti ayrıca bölmədədir.
- Özünə, bota və demo hesabına borc qadağandır.

## 5b. İki nəfər qalanda "Borca oyna"
Adi borc köçürməsindən fərqli **oyun daxili** mexanizmdir.
- **Nə vaxt:** raundda yalnız iki aktiv insan oyunçu qalıb, otaq real otaqdır (bot və demo yoxdur), növbəsi olanın balansı növbəti xoda çatmır (və ya o, əvvəl razılaşdırdığı limiti artırmaq istəyir).
- **Təklif:** "🤝 Borca oyna" — çatışmayan məbləğ, ümumi əlavə risk limiti və qaytarma müddəti (1–30 gün) açıq göstərilir. Qarşı tərəf 30 saniyə ərzində qəbul edir və ya rədd edir. Təklif gözlənərkən növbə taymeri dayanır (sonra ən azı 15 saniyə qalır); bu müddətdə "pas səsi" və vaxt bitməsi işləmir.
- **Rədd / cavabsızlıq:** balansı (və əvvəlki limiti) xoda çatmayan oyunçu avtomatik pas olur.
- **Limit özbaşına artmır:** limitdən artıq qoymaq olmaz; artırmaq üçün yeni məbləğə ayrıca təsdiq lazımdır. Təkrar sorğu və ya bağlantının bərpası təklifi ikinci dəfə qəbul etmir (köhnəlmiş məbləğlə gələn qəbul rədd olunur).
- **Qoyuluş:** əvvəl mövcud real balans, çatmayan hissə təsdiqlənmiş limitdən ("şərti qoyuluş"). Şərti qoyuluş balans kimi heç kimə yazılmır və bankda ayrıca uçotdadır (masada 🧾 zolaqlı "borca" nişanı ilə).
- **Hədiyyə** yalnız real balansdan göndərilir — şərti limit hədiyyə üçün işləmir.
- **Hər iki tərəfin balansı çatmırsa:** razılaşma yalnız bir istiqamətdə ola bilər; qarşı tərəf yeni şərti xal yarada bilmir və balansı çatmırsa yalnız pas edə bilər — mövcud bank qorunaraq raund bitir.

**Hesablaşma (mənbə → təyinat), nümunələrlə:**
1. Yaqub 0 xal, Anar 1 000 xal. Oyun haqqı 10+10 (real bank 20). Anar Yaquba 200-dək borca oynamağı qəbul edir.
   Yaqub xod 100 (şərti), Anar xod 100 (real), Yaqub baxışır 100 (şərti).
   - **Yaqub uduzur:** Anar real bankı alır: 10 + 10 + 100 = **120 xal** balansına. Yaqubun 200 şərti qoyuluşu Anara **borc** kimi yazılır ("Borca oyun — otaq X / raund Y"): Yaqubda "Anara borcum: 200 xal", Anarda "Yaqubdan alacağım: 200 xal". Bu 200 xal Anarın balansına indi yazılmır — Yaqub ödəyəndə (və ya müddət çatanda avtomatik) keçir. Beləliklə eyni məbləğ iki dəfə qazanc yazılmır.
   - **Yaqub udur:** Yaqub yalnız real bankı alır: **120 xal** (Anarın 100 + iki oyun haqqı). Öz 200 şərti qoyuluşu qazanc kimi yaranmır, borc da yaranmır.
2. **Bankın bölünməsi:** şərti qoyuluş real bankın bölündüyü nisbətlə bağlanır — borclunun öz payı ləğv olur, qarşı tərəfə düşən pay borc yazılır (aşağı yuvarlaqlaşdırma borclunun xeyrinə). Məs. real bank 121 (Yaqub 60, Anar 61), şərti 101 → borc 101×61/121 = 50 xal.
3. **Seka:** seka başlamazdan əvvəl şərti qoyuluşlar ikiyə bərabər bölünərək bağlanır (yarısı borc, yarısı ləğv); real bank növbəti əlinə keçir; növbəti ələ gizli borc keçmir. Borc raund bitəndə yazılır.
4. **Ləğv** və ya server restartında bitməmiş raund: real qoyuluşlar mövcud qayda ilə qaytarılır, şərti qoyuluşlar silinir, borc yaranmır. Borc yalnız raundun son paketi bazaya yazılanda, həmin tranzaksiyada yaranır — bağlantı kəsilməsi və restart nəticəni dəyişmir.
5. Yaranan borc adi oyunçu borcudur: qaytarma, avtomatik tutulma, profil və admin bölmələri eyni işləyir. Mövcud borclar silinmir. Hesablar heç vaxt silinmir (yalnız bloklanır), ona görə alacaq itmir.
6. "Kimdən udmuşam / kimə uduzmuşam" statistikası yalnız real xal axınlarını sayır.

## 5d. Sekadan qalan bank (v2.8 qaydası)
Mövcud qaydalarla uyğun olaraq aşağıdakı fərziyyə qəbul edilib:
- Seka (bərabərlik və ya razılaşma) olanda bank **bölünmür və itmir** — tam məbləği ilə seka əlinə ("növbəti raund") keçir. Masada "BANK · sekadan X" yazılır.
- **Əsas iki oyunçu** əlavə ödəmir (onların payı artıq bankdadır).
- Bu raundda iştirak edib pas deyən/uduzan oyunçu **2 × oyun haqqı** (məs. haqq 10 xal → qoşulma 20 xal) qoyub qoşula bilər. Qoşulmayan heç nə ödəmir, amma əvvəl qoyduğu bankda qalır.
- **Raund başlayandan sonra otağa gələn oyunçu** bu sekaya qoşula bilməz (cari bankdan pay almır). O, növbəti yeni raunddan adi oyun haqqı ilə oynayır.
- Bank yalnız **real balansdan** qoyulan xallardan ibarətdir. "Borca oyna" ilə qoyulan şərti xallar seka başlamazdan əvvəl bağlanır (borclunun öz payı ləğv olur, qarşı tərəfin payı borc yazılır) və keçən banka **daxil edilmir** — ikinci dəfə sayılmır.
- Seka əlində yenə bərabərlik → yenə seka (bank yenə tam keçir) və ya bölünmə (tək qalan 1 xal ilk tərəfə düşür, xal itmir). Seka əlində cəkpot → bank və cəkpot haqqı sahibinə.
- Əsas oyunçu qoşulma vaxtı çıxsa — payı bankda qalır, seka qalanlarla oynanılır. Hamı çıxsa və ya raund ləğv olunsa (server yenidən başlaması, otağın bağlanması) — hər kəsə qoyduğu qaytarılır.
- Testlər: `test/v28-engine.test.js` (pul saxlanma balansı: balanslar + bank həmişə sabit).

## 5c. Sekaya qoşulma
- Qoşulmaq üçün **60 saniyə** verilir (təklifə cavab — 20, "eyni xala baxaq" və bərabər xal qərarı — 30, dörd kartdan birini atmaq — 30 saniyə; hamısı ayrı idarə olunur).
- Qalan vaxt və "Sekaya qoşul" / "Qoşulmuram" düymələri aydın görünür.
- Qoşulmaq hüququ olan (balansı çatan, otaqda qalan) oyunçu hələ qərar verməyibsə, əsas oyunçular və botlar sekanı erkən başlada bilməz — server də yoxlayır. Hamı qərar veribsə erkən başlatmaq olar. Vaxt bitəndə seka qoşulanlarla avtomatik davam edir.
- Qoşulmayanlardan xal tutulmur; təkrar sorğu ikinci dəfə xal çıxarmır.

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
  - Hər girişdə 10 000 demo xal verilir; çıxıb yenidən girəndə qalıq yenə 10 000 olur.
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
- **Bank:** masanın ortasında virtual əskinas yığını və dəqiq məbləğ ("Virtual oyun balansı" yazısı ilə). Əskinaslar bu layihə üçün çəkilib, üzərində "VİRTUAL" yazılıb; real manatın surəti deyil.
- **Düymələr:** böyük **Pas** (qırmızı), **Baxış** (göy), **Xod** (sarı, məbləğlə). "Seka təklif et" və "Bankı bölək" yalnız 2 oyunçu qalanda görünür və yalnız icazə olanda aktivdir. Gizli 3 Tuz sahibində Pas kilidlidir.
- **Üst panel:** geri, otağın adı, "N/8 oyunçu · Seka", otaq kodu (kopyalamaq üçün toxunun), "Virtual oyun balansı" və **+** (kredit müraciəti), səs, tam ekran, bildirişlər.
- **Alt panel:** 😊 emoji, mesaj sahəsi, ☰ çat tarixçəsi və oyun jurnalı.
- **Ekranlar:** telefon şaquli, telefon üfüqi (masa solda, düymələr sağda), planşet və kompüter. iPhone-un kəsik və alt zolağı (safe area) nəzərə alınır; klaviatura açılanda mesaj sətri klaviaturanın üstündə qalır.
- **Kartlar:** ənənəvi üslubda, ağ fon, yumru künclər. Küncdə klassik indekslər: **J** (Valet), **Q** (Dama), **K** (Karol), **A** (Tuz). Ürək və kərpic qırmızı, pika və xaç qara. Saray kartları iki başlı və rənglidir; Tuzun ortasında böyük suit var; 6–10 klassik düzülüşlə çəkilib. Daxili kodlar (V/D/K/T) dəyişməyib, bu yalnız görünüşdür.
- **Animasiyalar:** paylama (kartın arxa üzü göyərtədən oyunçuya uçur), açılan kartın çevrilməsi, xodda əskinasın oyunçudan banka, raund sonunda bankdan qalibə uçması. Yalnız serverin təsdiqlədiyi dəyişikliklər üçün işləyir. Ekran yenidən çəkiləndə animasiya baştan başlamır. Sistemdə "hərəkəti azalt" seçilibsə animasiya oynamır.
- **Səslər:** paylama, pul, qələbə və növbə səsi brauzerdə yaradılır (fayl yoxdur). İlk toxunuşdan sonra açılır; 🔊/🔇 düyməsi ilə söndürülür və seçim yadda qalır.
- **Gizlilik:** rəqibin kartı animasiya üçün belə klientə göndərilmir. Paylama yalnız arxa üzlə göstərilir; kartın üzü yalnız server onu sizə açanda görünür.
- Bütün vizual faylların mənbəyi və lisenziyası: `VISUALS.md`.

## 8a. Kartlara küncdən baxmaq
- Öz kartlarınız üzü bağlı gəlir. Kartın **yuxarı küncündən** tutub barmağı (və ya siçanı) diaqonal kartın içinə doğru çəkin — künc qalxır, rəqəm və işarə görünür. Buraxanda kart yenə örtülür.
- 👁 **Göstər** kartları yalnız sizin ekranınızda açır, **Ört** yenidən bağlayır.
- Baxmaq xod deyil, növbəni dəyişmir, rəqiblərə heç nə açmır və serverə göndərilmir.
- 4 kartdan birini atanda: küncdən baxmaq kart seçmir. Atılacaq kartı "At" düyməsi ilə seçib "Seçilmiş kartı at" ilə təsdiqləyin.
- Azaldılmış hərəkət və ya ☰ → Animasiyalar söndürülübsə: kartı basıb saxlayanda açılır, buraxanda bağlanır.
- Brauzer yoxlaması (istəyə görə, Playwright lazımdır): `SEKA_URL=http://localhost:3000 SHOTS=/tmp node tools/ui-peek.cjs`.
- Admin formalarının canlı yenilənmədə qorunması: `SEKA_URL=http://localhost:3000 node tools/ui-admin-morph.cjs` (standart admin/admin123 hesabı ilə işləyən serverdə; 4 test oyunçusu və kredit müraciətləri yaradır — real bazada işə salmayın).

## 9-0. v2.5 masa görünüşü
- Masa istinad şəklinə uyğundur: oyunçu sayına görə sabit yerlər, qalın dəri kənar, mis bəzəklər, ətrafda bəzəklər (fənər, çay, qoz-fındıq — yalnız görünüş).
- Otaq adına toxunun → otaq menyusu (bildirişlər, profil, səs, animasiya, çat, jurnal).
- Oyunçular profilində şəkil yükləyəndə masada öz şəkilləri görünür; yükləməyənlərdə baş hərf, botlarda robot.

## 9-1. v2.4 mobil görünüş
- Avatarlar masanın içində, kənara yaxın; kartlarınız masanın aşağı kənarının üstündə. Növbəsi olanın avatarında vaxt halqası və "N san".
- Masa: keçə toxuması, tikişli dəri kənar, mis bəzək, yumşaq kölgə — hamısı CSS/SVG ilə, xarici şəkil yoxdur.
- Paylama: kartlar göyərtədən sürüşür, öz kartlarınız yerində çevrilir. Paylama və açılma səsləri var; 🔊 ilə söndürülür.
- İdarə tək sıradadır: [− xal +] · Pas · Baxış · Xod et. Alt sətir: 😊 · mesaj · 🎁 · ☰ (bildirişlər, profil, səs, animasiyalar, çat, jurnal).
- Bütün məbləğlər "xal" ilə göstərilir (məs. "10 000 xal").

## 9a-1. "Şir" (tam ekran hədiyyə, v2.8)
- Otaq hədiyyələrinə **Şir** əlavə edilib (ilkin qiymət 500 xal). Göndərmədən əvvəl qiymət, alana keçən pay və sizdə qalacaq balans göstərilir.
- Xal yalnız serverdə uğurlu əməliyyatda bir dəfə çıxılır; eyni sorğu (eyni açar) təkrar gəlsə ikinci dəfə tutulmur və animasiya ikinci dəfə oynamır.
- Animasiya (~3,2 san): istifadəçinin verdiyi şir şəkli əsasında (`public/lion.webp`, 200 KB; zəif cihaz üçün `lion-sm.webp`, 87 KB). Qızılı dairə (portal) açılır → şir dairənin içindən görünüb ekrana tullanır → nərildəyir (yaxınlaşma zərbəsi, yüngül titrəmə, işıq çaxması, sintez olunmuş nərilti səsi) → qızılı halqalar, şüalar və qığılcımlar yayılır → yal küləkdə yellənir (şəklin yal hissəsi ayrıca qatdır, üz sabit qalır) → şir işığa qarışıb çəkilir. Yalnız transform/opacity/clip-path istifadə olunur (GPU), qığılcımlar məhduddur. Şəkil otağa girəndə əvvəlcədən yüklənir; yüklənməsə kodla çəkilmiş SVG şir göstərilir. Portretdə aşağı idarə paneli (növbə vaxtı, düymələr, çat) açıq qalır; animasiya qatı toxunuşları buraxır.
- "Animasiyalar: söndürülüb" → yalnız bildiriş zolağı. "Hərəkəti azalt" sistem ayarı və ya zəif telefon (≤2 nüvə / ≤2 GB) → yüngül variant (az detallı şəkil, yalnız görünüb-itmə). Səsi 🔊 düyməsi ilə söndürmək olar.
- Admin → Masa hədiyyələri: qiymət, aktivlik və **hər hədiyyə üçün ayrıca "alana %"** (boş = ümumi faiz). Tarixçə eyni siyahıdadır. Yalnız virtual xaldır, real pula çevrilmir.

## 9a. Masa hədiyyələri (animasiyalı)
- **Necə göndərilir:** masada oyunçunun şəklinə toxunun → "Hədiyyə göndər". Hər hədiyyənin qiyməti və alana keçəcək xal əvvəlcədən görünür. Hədiyyəni seçəndə təsdiq pəncərəsi açılır: nə qədər çıxılacaq, alan nə qədər alacaq, nə qədəri dövriyyədən çıxacaq və sizdə nə qədər qalacaq.
- **Hədiyyələr (başlanğıc qiymətlər):** 🃏 Kart yağışı — 100 xal, 👑 Masa kralı — 300 xal, 🔥 Odlu Tuz — 1 000 xal. Admin qiyməti dəyişə, hədiyyəni aktiv və ya deaktiv edə bilər.
- **Alana keçən xal:** ilkin olaraq qiymətin 30%-i. Admin faizi 0–100 arasında dəyişə bilər. Nəticə aşağı tam ədədə yuvarlaqlaşdırılır. Qalan hissə heç kimə yazılmır, dövriyyədən çıxır. Məsələn, 1 000 xal çıxılır, alana 300 yazılır, 700 dövriyyədən çıxır.
- **Xal:** yalnız virtual oyun balansı istifadə olunur (bütün balanslar oyun xalı ilə göstərilir). Real pul yoxdur.
- **Qadağalar:** özünə, botlara, masada olmayan oyunçuya, demo və botlu otaqlarda göndərmək olmaz. Balans çatmayanda aydın mesaj çıxır və heç nə dəyişmir.
- **Borclar:** alana gələn xal əvvəlcə onun vaxtı çatmış borclarına tutulur — mövcud avtomatik tutulma qaydası ilə (əvvəl son tarixi köhnə olan, sonra kiçik ID). Bildirişdə hədiyyədən gələn xal, borca tutulan hissə və qalan balans ayrı göstərilir.
- **Təhlükəsizlik:**
  - Qiymət, faiz, balans və icazələr serverdə yoxlanılır.
  - Çıxılma, əlavə, borc tutulması, tarixçə və bildiriş bir tranzaksiyadadır.
  - Təkrar klik, paralel sorğu və bağlantı təkrarı ikiqat xərc yaratmır (idempotency açarı).
  - Balans mənfiyə düşmür.
  - Aktiv raund zamanı balans dəyişikliyi oyunun yaddaşdakı balansına da yazılır (otağın növbəsində).
- **Animasiyalar:**
  - **Kart yağışı:** kartlar göndərəndən alana uçur, ətrafa səpələnib yox olur.
  - **Masa kralı:** qızılı tac alanın avatarına enir, parıldayır, təxminən 3 saniyədən sonra çəkilir.
  - **Odlu Tuz:** masanın ortasında böyük tuz açılır, alov və qığılcımlar görünür (Canvas), sonra alana tərəf kiçilib yox olur.
  - Yuxarıda "Yaqub Anara Odlu Tuz göndərdi" bildirişi çıxır.
- **Animasiya qaydaları:**
  - Effektlər 2–4 saniyə çəkir, klikləri tutmur və oyunu dayandırmır.
  - Yalnız uğurlu əməliyyatdan sonra göstərilir. Eyni hadisə iki dəfə oynamır, yenidən qoşulanda köhnə animasiya təkrarlanmır.
  - Effektlər növbə ilə göstərilir (ən çox 4 gözləyən), köhnəlmiş effekt buraxılır. Bitəndə elementlər, taymerlər və Canvas dövrü təmizlənir.
- **Söndürmə:** ☰ menyusunda **Səs** və **Animasiyalar** ayrı-ayrı söndürülür, seçim yadda qalır. Sistemdə "hərəkəti azalt" seçilibsə yalnız bildiriş göstərilir.
- **Tarixçə:** Profildə "Göndərdiyim hədiyyələr" və "Aldığım hədiyyələr" bölmələri var: qarşı tərəf, hədiyyə, tarix, qiymət, faiz və alınan xal. Admin panelində **Masa hədiyyələri** bölməsində göndərən və ya alan adına görə axtarmaq, ayarları dəyişmək olur. Hər əməliyyatın o anki qiyməti və faizi ayrıca saxlanılır — sonrakı dəyişikliklər köhnə qeydlərə təsir etmir.
- **Statistika:** hədiyyə xalları "kimdən udmuşam / kimə uduzmuşam" statistikasına qarışmır.

## 9c. v2.8 masa: xal, balans, onlayn status, çat, borc, səs
- **Kart xalı:** öz kartlarınızın altındakı xal kartlara baxmamışdan əvvəl "? xal" görünür. Bütün kartlara küncdən baxanda və ya "Göstər" basanda xal açılır (server xalı yalnız bundan sonra göndərir). Raund bitəndə xal mövcud qaydaya görə görünür. Rəqiblərin kartı və xalı yalnız baxışmada / nəticədə açılır.
- **Balans məxfiliyi:** hər kəs yalnız öz dəqiq balansını görür. Başqalarının balansı serverdən brauzerə ümumiyyətlə göndərilmir (CSS ilə gizlətmə deyil). Rəqib üçün yalnız bu raundda banka qoyduğu (🪙) görünür. Admin balansları öz panelində görür.
- **Onlayn status:** avatarın küncündə yaşıl nöqtə — bağlantı var; qırmızı — bağlantı kəsilib və ya masadan çıxıb. Bağlantı bərpa olunanda yenidən yaşıl olur. Botlarda nöqtə yoxdur (BOT nişanı var).
- **Çat tarixçəsi:** 💬 düyməsi çatı açır/bağlayır. Otağa qoşulduğunuz andan sonrakı mesajlar (son 100) otaqda qalır; çat bağlı ikən gələn mesajlar üçün qırmızı say görünür. Çat oyunu dayandırmır, yazı sahəsinin fokusu pozulmur. Tarixçəni yalnız otaq üzvləri görür; sonradan qoşulan köhnə söhbəti görmür. Mesajlar bazada saxlanılmır.
- **Masadan borc:** rəqibin şəklinə toxunun → "🎁 Hədiyyə göndər", "💸 Borc istə", "🤝 Borc təklif et". Məbləğ və qaytarma müddəti seçilir. Qarşı tərəfə masada "🤝 borc təklifi cavabınızı gözləyir" zolağı çıxır — Qəbul/Rədd. Qəbula qədər heç nə dəyişmir; qəbulda hər iki balans serverdə bir tranzaksiyada yoxlanıb yazılır; əməliyyat borc verənin otaq növbəsində (oyun hərəkətləri ilə ardıcıl) icra olunur və gedən raundun balansı da dərhal yenilənir. Təkrar klik/itmiş cavab ikinci borc yaratmır. Masadan və raunddan çıxılmır.
- **Səs:** ☰ menyuda "🔈 Səsi yoxla" qısa test səsi çalır (oyun səsləri söndürülübsə belə — yalnız yoxlama). Səs aç/söndür seçimi yadda qalır. iPhone-da səssiz rejim açarı WebAudio səsini bağlaya bilər.
- **Mikrofonla danışıq əlavə edilməyib.** Səbəb: WebRTC səsli danışığı real telefonlarda və mobil şəbəkələrdə sınamaq imkanım olmadı. Mobil operator şəbəkələrində birbaşa bağlantı çox vaxt alınmır və **TURN serveri** lazımdır. Nümunə xərclər (2026-cı il, saytlarından): Cloudflare Realtime TURN — ayda 1000 GB pulsuz, sonra 0,05 $/GB; Metered — pulsuz plan 0,5 GB, sonra ayda 99 $-dan. Səs təxminən 30–40 kbit/s/axın olduğundan dostlar arasında Cloudflare-in pulsuz həddi adətən kifayət edər, amma hesab, API açarı (server mühit dəyişəni) və real cihaz sınağı tələb olunur. İstəsəniz, ayrıca paketdə əlavə edə bilərəm.

## 9b. iPhone-da yazı və klaviatura
- Ekran artıq hər yenilənmədə bütövlükdə yenidən yaradılmır: kiçik "morph" funksiyası (`public/morph.js`) yalnız dəyişən hissələri yerində yeniləyir. Aktiv input və onun valideynləri DOM-dan çıxarılmır.
- Yazılan mətn, kursor, seçim, fokus və davam edən yazı kompozisiyası (Azərbaycan hərfləri, telefonun söz təklifləri) qorunur. Fon yenilənmələri fokusu özü vermir — klaviatura öz-özünə açılmır. Klaviatura zamanı məcburi `scrollTo` yoxdur.
- Yazı zamanı oyun vəziyyəti və taymerlər yenilənməyə davam edir.

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

## 11a. Render Free haqqında
Render-in pulsuz planında server təxminən 15 dəqiqə heç kim daxil olmayanda "yatır". Növbəti ilk açılış 30–60 saniyə və daha çox gecikə bilər; yatma zamanı yaddaşdakı otaqlar silinir (yarımçıq raundlar açılışda ləğv edilib qoyulanlar qaytarılır). **Bunu kodla aradan qaldırmaq mümkün deyil** — kod "həmişə aktivdir" iddia etmir. Variantlar: ödənişli plan (yatmır) və ya xarici "oyadıcı" (Render-in şərtlərinə baxın). v2.8-də olanlar yalnız təsiri yumşaldır: aydın "yenidən qoşulur" statusu, avtomatik yenidən qoşulma, `/health` yoxlaması.

## 11d. Donma ehtimalları və v2.8 düzəlişləri
Kod və loglar yoxlanılıb; ehtimal olunan səbəblər və görülən iş:
- **PostgreSQL bağlantısı (ən güclü ehtimal):** `pg` pool-da vaxt limiti yox idi — Neon cavab verməsə və ya bağlantı yarımçıq qalsa, sorğu sonsuz gözləyirdi və otağın bütün növbəsi (hərəkətlər, taymerlər, pul) "donurdu". İndi: bağlantı limiti 10 san, sorğu limiti 15 san, boş bağlantı 30 san. Limitdə sorğu xəta verir → otaq "Baza gözlənilir" rejiminə keçir və təkrar cəhd edir (paket ID-si və idempotency açarları sayəsində pul iki dəfə tutulmur).
- **Pool 'error' hadisəsi:** Neon boş bağlantını bağlayanda pool `error` yayırdı, dinləyici olmadığı üçün Node prosesi **tamamilə dayana bilərdi**. İndi dinləyici var (yalnız loga yazır).
- **Taymer növbəsinin şişməsi:** baza ləngiyəndə hər saniyə otaq növbəsinə yeni taymer işi əlavə olunurdu (yaddaş artımı, gecikmə). İndi əvvəlki iş bitməyincə yenisi əlavə edilmir. 10 saniyədən uzun çəkən növbə işi loga yazılır (`növbədəki iş N ms çəkdi`).
- **Hər WebSocket "ping"-i bazaya müraciət edirdi:** indi ping bazasız cavablanır.
- **Sürət limiti cədvəli** heç vaxt təmizlənmirdi (yaddaş artımı) — indi 5 dəqiqədən bir təmizlənir.
- **Ölü bağlantılar:** server ping aralığı 30 → 15 san (kəsilmiş oyunçu ~30 san ərzində qırmızı görünür). Klient 20 saniyədən bir ping göndərir; 45 san cavab gəlməsə bağlantını yenidən qurur; şəbəkə qayıdanda / tətbiq ön plana gələndə dərhal yenidən qoşulur. Bağlantı kəsiləndə masada "📡 yenidən qoşulur…" zolağı görünür.
- **Sağlamlıq yoxlaması:** `GET /health` → baza 3 saniyəyə cavab verirmi, işləmə müddəti, yaddaş, otaq/raund sayı, bazanı gözləyən və uzun məşğul otaqlar. Baza cavab verməsə 503. Şəxsi məlumat, parol, token və mühit dəyişənləri göndərilmir.
- Gözlənilməyən xətalar loga yazılır; `uncaughtException`-da gözləyən paketləri yazmağa cəhd edib çıxır (Render yenidən başladır, yarımçıq raund açılışda ləğv edilib qaytarılır).
- Raund vəziyyəti yalnız yaddaşdadır: server yenidən başlayanda (deploy, yatma, çökmə) gedən raund davam etmir — qoyulanlar qaytarılır. Bu, əvvəlki versiyalardakı kimidir.

## 11b. Telefonla yeniləmə: Codespaces → GitHub → Render
1. ZIP-i telefonda yükləyin və açın (Fayllar tətbiqi ilə).
2. GitHub-da repository-ni açın → **Add file → Upload files** → `seka` qovluğunun **içindəki** bütün fayl və qovluqları seçin → **Commit changes**. (Codespaces istifadə edirsinizsə: repository → **Code → Codespaces → Create codespace**, faylları sol paneldəki fayl ağacına sürükləyin, sonra **Source Control → Commit → Sync/Push**.)
3. Render özü deploy edir. Etməsə: Render → servis → **Manual Deploy → Deploy latest commit**.
4. Logda bu sətri görməlisiniz: `Migration 7 yoxlanıldı/tətbiq edildi` (v2.8: "Şir" hədiyyəsi). Render-də **Settings → Health Check Path** sahəsinə `/health` yazmaq tövsiyə olunur. Yeni mühit dəyişəni, yeni paket və ya Build/Start əmri dəyişikliyi yoxdur.
5. Brauzerdə saytı açın: başlıqda **Dairə** görünməlidir. Admin ilə daxil olub "Admin → Ayarlar"da oyunçuları yaradın.

## 11c. Linkdəki "seka" hissəsini dəyişmək (istəyə görə)
Kod Render ünvanını dəyişmir. `xxx-seka.onrender.com` kimi ünvanı dəyişmək üçün:
1. Render → servis → **Settings → Name**: yeni ad yazın (məs. `daire`). Render alt domeni adla bağlıdırsa, yeni ünvan `daire.onrender.com` (və ya oxşar) olur. Bəzi hallarda alt domen dəyişmir — onda yeni servis yaratmaq lazımdır.
2. **Yeni servis yolu:** Render → **New → Web Service** → eyni GitHub repository → ad `daire` → eyni Build (`npm install`) və Start (`npm start`) əmrləri → **Environment** bölməsinə köhnə servisdəki `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `NODE_ENV` dəyərlərini eyni ilə köçürün. Baza (Neon) eynidir, ona görə hesablar və balanslar olduğu kimi qalır. Yeni ünvan işləyəndən sonra köhnə servisi dayandırın (eyni anda iki server eyni bazada otaq saxlamasın).
3. Öz domeniniz varsa: Render → **Settings → Custom Domains** ilə əlavə edin.
4. Yeni linki WhatsApp qrupuna göndərin. Telefonda "Əsas ekrana əlavə et" ilə yaradılan ikonu yeni ünvandan yenidən əlavə edin.

## 12. Texniki
- `server/game/engine.js`: oyun mühərriki — cəkpotlar və gizli 3 Tuz burada.
- `server/game/cards.js`: xal hesablaması.
- `server/game/bot.js`: bot qərarları.
- `server/finance.js`: bonus, kredit, hədiyyə, borc, avtomatik tutulma, idempotency.
- `server/debts.js`: avtomatik borc tutulması işçisi.
- `server/rooms.js`: otaqlar; botlar, emoji və çat; oyunla sinxron pul növbəsi.
- `server/store.js`, `server/db.js`: baza, migration-lar, tranzaksiyalar.
- `server/app.js`: HTTP API və WebSocket.
- `public/`: frontend modulları (`core`, `room`, `profile`, `admin`, `app`, DOM yeniləməsi `morph`, kartın küncündən baxma `peek`, bəzəklər `decor`, hədiyyə pəncərəsi `gifts`, hədiyyə animasiyaları `giftfx`), kartlar (`cards.js`), virtual əskinaslar (`notes.js`), animasiyalar (`fx.js`), səslər (`sound.js`) və xal (`score.js`).
- Brauzer yoxlamaları (Playwright, istəyə görə): `tools/ui-layout.cjs` (13 ekran ölçüsü × 2–8 oyunçu, üst-üstə düşmə/ekrandan kənar/üfüqi sürüşmə), `tools/ui-v28.cjs` (xal, balans, onlayn status, çat, borc, Şir, yenidən qoşulma — özü test serveri başladır). Lokal test serveri: `tools/devserver.mjs` (yalnız yoxlama üçün, Render-də işə salmayın).
- Testlər `test/` qovluğundadır. Hamısını işə salmaq üçün: `npm test`. PostgreSQL üzərində: `TEST_DATABASE_URL=postgres://... npm test` (`batch`, `finance`, `integration` və `money-integration` faylları).
