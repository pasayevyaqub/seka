# Seka — dostlar üçün onlayn kart oyunu

Real-time multiplayer Seka oyunu. Azərbaycan dilindədir, mobil uyğundur, otaqlar kodla açılır, yeni qeydiyyatları admin təsdiqləyir.

## 1. Öz kompüterinizdə işə salmaq

1. **Node.js** quraşdırın: https://nodejs.org. LTS versiyası lazımdır, minimum 22.13.
2. Zip faylını açın, terminalda (Windows-da "Command Prompt") həmin qovluğa keçin:
   ```
   cd seka
   npm install
   npm start
   ```
3. Brauzerdə **http://localhost:3000** ünvanını açın.
4. Admin hesabı ilə daxil olun:
   - istifadəçi adı: `admin`
   - şifrə: `admin123`

   ⚠️ Daxil olandan sonra dərhal "Şifrə" düyməsi ilə şifrəni dəyişin.

Məlumatlar `data/seka.db` faylında saxlanılır. Bu faylı silsəniz hər şey sıfırlanır.

### Dostlar necə qoşulur?
- **Eyni Wi-Fi-dadırlarsa:** telefonda `http://KOMPÜTERİN-IP-si:3000` ünvanını açırlar, məsələn `http://192.168.1.25:3000`. IP-ni Windows-da `ipconfig`, Mac-da `ipconfig getifaddr en0` əmri ilə tapa bilərsiniz.
- **İnternetdən:** pulsuz Cloudflare Tunnel istifadə edin:
  ```
  npx cloudflared tunnel --url http://localhost:3000
  ```
  Ekranda çıxan `https://....trycloudflare.com` linkini dostlarınıza göndərin. Bu üsulda kompüter açıq qalmalıdır.

## 2. İnternetdə pulsuz yerləşdirmək (Render + Neon)

1. **GitHub**-da hesab açın, yeni repository yaradın və bu qovluğun fayllarını yükləyin ("Add file → Upload files").
2. **Neon** (https://neon.com) — pulsuz PostgreSQL bazası. Layihə yaradın və "Connection string"-i kopyalayın. O, `postgresql://...` ilə başlayır.
3. **Render** (https://render.com) — "New → Web Service" seçin, GitHub repository-ni seçin:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance type: **Free**
   - Environment Variables:
     - `DATABASE_URL` = Neon-dan kopyaladığınız link
     - `ADMIN_USERNAME` = admin adınız
     - `ADMIN_PASSWORD` = güclü şifrə
     - `NODE_ENV` = `production`
4. "Deploy" düyməsini basın. Bir neçə dəqiqə sonra `https://seka-xxxx.onrender.com` linki hazır olacaq.

> Render-in pulsuz serveri 15 dəqiqə heç kim girməyəndə yuxuya gedir və ilk açılış ~1 dəqiqə çəkir. Oyun gedərkən serverə bağlantı açıq olduğu üçün yatmır.
> Admin hesabı yalnız bazada heç bir admin olmayanda yaradılır.

## Admin paneli
- Yeni qeydiyyatlar **"Təsdiq gözləyir"** statusunda qalır. Admin təsdiq etməsə həmin istifadəçi daxil ola bilməz.
- **± Balans:** virtual pul əlavə etmək və ya çıxmaq. Çıxmaq üçün mənfi rəqəm yazın.
- Admin həmçinin istifadəçinin adını dəyişə, şifrəsini sıfırlaya, onu bloklaya və ona rol verə bilər. Moderator da istifadəçiləri təsdiq edə və balans dəyişə bilər.
- Bütün əməliyyatlar (oyun və admin) "Əməliyyatlar" bölməsində görünür.

## Oyun qaydaları (qısa)
- 36 kart: 6–10, Valet (V), Dama (D), Karol (K), Tuz (T). Xallar: 6–9 üzərindəki rəqəm qədər, 10/V/D/K 10, Tuz 11.
- Yalnız eyni suitdəki kartların xalı toplanır. Eyni dəyərli 3 kart (7-7-7 = 21) cəmlə hesablanır.
- **Cəkpot:** 3 dənə 6 və ya 3 dənə Tuz. Raund dərhal bitir, cəkpot sahibi bankı götürür və digər oyunçuların hər biri ona cəkpot məbləğini ödəyir.
- Raund belə gedir:
  1. Hər oyunçu oyun haqqı qoyur, kartlar paylanır və növbə saat istiqamətində gedir.
  2. Hər oyunçu ya **Xod** edir ("oyunum var"), ya **Oyunum yoxdur** deyir (cari xod qədər pul qoyur), ya da **Pas** deyir.
  3. Hamı ilk xodunu edəndən sonra oyunçu cari xod qədər pul qoyub sağındakı oyunçu ilə **baxışa** bilər. Xalı az olan çıxır, bərabər xalda çağıran çıxır.
  4. Baxışmada "eyni xala baxaq" təklif etmək olar. Rəqib qəbul etsə və xallar bərabər çıxsa, çağıran şərik olur: rəqib qalib gəlsə bank bölünür.
  5. "Oyunum yoxdur" deyən oyunçunun sağındakı da "oyunum yoxdur" deyibsə, ikisi məcburi baxışır.
- Sonda 2 nəfərin xalı bərabər olarsa, ikisi də "Seka" seçsə **Seka** oynanılır, əks halda bank bölünür.
  - Seka raundunda hər kəsə 4 kart paylanır və ən yaxşı 3 kart sayılır.
  - Əvvəlki raundda iştirak edənlər oyun haqqının 2 qatını ödəyib sekaya qoşula bilər.
- **Vaxt:** növbə vaxtı bitəndə qalan oyunçuların yarısı "pas" səsi versə, oyunçu avtomatik pas edilir.
- Balans mənfiyə düşə bilər. Otaq ayarlarında mənfi balans limiti qoymaq mümkündür (0 = limitsiz).

## Texniki
- Server: Node.js (`server/`), real-time bağlantı WebSocket ilə (`ws`).
- Baza: lokalda Node.js-in daxili SQLite-ı, onlayn PostgreSQL (`pg`).
- Oyun mühərriki: `server/game/engine.js`. Bütün məntiq serverdə işləyir, oyunçular bir-birinin kartlarını görə bilmir.
- Frontend: `public/`. Kartlar SVG ilə çəkilib, build addımı yoxdur.
- Testlər: `npm test`
