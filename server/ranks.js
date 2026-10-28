// Oyunçu dərəcələri — oyun xalı BALANSINDAN ASILI DEYİL, yalnız tamamlanmış real raundların nəticələrinə əsaslanır.
// Admin balansları sıfırlasa da dərəcə dəyişmir.
//
// Hesablanan qələbə ("sayılan qələbə") qaydaları — süni oyunlarla dərəcə yığmağı çətinləşdirmək üçün:
//  * yalnız tamamlanmış (ləğv edilməmiş), botsuz/demo olmayan raundlar;
//  * raundda ən azı 2 insan oyunçu olmalı və kimsə oyun haqqından əlavə xod/baxış etmiş olmalıdır
//    (hamı dərhal pas desə raund sayılmır);
//  * eyni oyunçu tərkibi ilə 24 saatda ən çox 10 raund sayılır (qalanları statistikaya düşür, dərəcəyə yox);
//  * qələbə = bankdan qoyduğundan çox alıb (xalis +); bölünmə = bankı başqası ilə bölüb; məğlubiyyət = xalis −.
export const RANKS = [
  { name: 'Yeni oyunçu', wins: 0 },
  { name: 'Həvəskar', wins: 5 },
  { name: 'Təcrübəli', wins: 20 },
  { name: 'Peşəkar', wins: 50 },
  { name: 'Ekspert', wins: 100 },
  { name: 'Usta', wins: 200 },
  { name: 'Çempion', wins: 400 },
  { name: 'Əfsanə', wins: 700 },
];
export const DAILY_GROUP_CAP = 10;

export function rankFor(countedWins) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (countedWins >= RANKS[k].wins) i = k;
  const next = RANKS[i + 1] || null;
  return { level: i + 1, name: RANKS[i].name, next: next ? { name: next.name, wins: next.wins, left: next.wins - countedWins } : null };
}
