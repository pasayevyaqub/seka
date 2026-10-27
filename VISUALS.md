# Vizual və səs materiallarının mənbəyi

Bu layihədəki bütün kart, masa, əskinas və səs materialları **layihə üçün sıfırdan yazılmış koddur** (SVG/CSS/WebAudio). Heç bir xarici sayt, CDN, şrift faylı və ya şəkil faylı yüklənmir.

| Material | Fayl | Mənbə | Lisenziya |
|---|---|---|---|
| Kartların üzü (6–10, J, Q, K, A), saray fiqurları | `public/cards.js` | Orijinal SVG, bu layihə üçün çəkilib. Klassik kart üslubu (iki başlı fiqurlar, klassik pip düzülüşü) ümumi ənənədir; konkret nəşrin surəti deyil. | Layihənin öz kodu — layihə ilə eyni şərtlərlə |
| Suit simvolları (♥ ♦ ♠ ♣) | `public/index.html` (`<symbol>`) | Orijinal SVG yolları | Layihənin öz kodu |
| Kartın arxa üzü (qızılı haşiyə, yaşıl sahə, səkkizguşəli ulduz) | `public/cards.js`, `public/index.html` | Orijinal SVG | Layihənin öz kodu |
| Virtual xal əskinasları | `public/notes.js` | Orijinal SVG: üzərində "XAL" və səkkizguşəli ulduz; real pulun təsviri, imzası, seriyası və qoruyucu elementləri yoxdur. | Layihənin öz kodu |
| Masa (keçə toxuması, dəri, tikiş, mis bəzək, taxta fon) | `public/style.css` | CSS qradiyentləri və brauzerdə işləyən SVG `feTurbulence` filtrləri (data URI) — şəkil faylı yoxdur | Layihənin öz kodu |
| Səslər (paylama, pul, qələbə, növbə) | `public/sound.js` | Brauzerdə WebAudio ilə sintez olunur, səs faylı yoxdur | Layihənin öz kodu |
| Hədiyyə animasiyaları: qızılı tac, alov, qığılcımlar, uçan kartlar | `public/giftfx.js`, `public/style.css` | Orijinal SVG (tac, alov), CSS animasiyaları və Canvas qığılcımları; kartlar `cards.js`-dən | Layihənin öz kodu |
| Hədiyyə səsləri | `public/sound.js` | WebAudio ilə sintez | Layihənin öz kodu |
| Bot avatarı (robot) | `public/core.js` | Orijinal SVG | Layihənin öz kodu |
| Masa ətrafı bəzəklər (fənər, çay stəkanı, qoz-fındıq, qutu, yarpaqlar), keçədəki dairəvi naxış | `public/decor.js` | Orijinal SVG | Layihənin öz kodu |
| Üst panel ikonları (geri, səs, tam ekran, sikkələr, oyunçular) | `public/room.js`, `public/style.css` | Orijinal xətti SVG | Layihənin öz kodu |
| Kartın küncünü qaldırma effekti (qat, kağız, işıq, kölgə) | `public/peek.js`, `public/style.css` | CSS clip-path + qradiyentlər, hesablanmış həndəsə | Layihənin öz kodu |
| Emojilər | sistem şrifti | İstifadəçinin cihazının emoji şrifti | Cihaz istehsalçısının |

## Hazır lisenziyalı kart dəsti haqqında
Hazır açıq lisenziyalı SVG dəsti (məsələn, LGPL-2.1 lisenziyalı "SVG-cards" və ya ictimai mülkiyyətdə olan kart dəstləri) bu iş mühitindən **yüklənə bilmədi** — xarici saytlara (GitHub, Wikimedia, CDN) çıxış bağlı idi. Ona görə kartlar orijinal SVG kimi çəkildi və heç bir xarici dəstdən kopyalanmadı.

İstəsəniz sonradan hazır dəstlə əvəz etmək olar: SVG fayllarını `public/` daxilinə qoyub `cardSVG()` funksiyasında `<img>` və ya `<use>` ilə göstərmək kifayətdir. Bu halda dəstin lisenziya mətnini də (məs. LGPL üçün `COPYING`) layihəyə əlavə edin və bu cədvəli yeniləyin.
