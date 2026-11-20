# Katip PDF (PDFReaderWriter)

Adobe Acrobat Reader yerine kullanılmak üzere yazılmış PDF okuyucu ve düzenleyici. Windows 10/11
(32 bit ia32 + 64 bit x64) ve Android (7.0+) sürümü var. Adobe adı/görseli kullanılmadı; özgün ad
"Katip PDF" ve özgün logo.

## Kod nerede

- Klasör: `E:\Yazılımlar\PDFReaderWriter`
- Repo: github.com/omerek/PDFReaderWriter (public; Actions kotası dolunca 2026-10-30'da public yapıldı)
- Yapı: `src/main` (Electron ana süreç; `pdfops.js` pdf-lib sayfa işlemleri, `textedit.js` orijinal
  metin düzenleme), `src/preload`, `src/renderer` (arayüz; `js/contextmenu.js` sağ tık),
  `src/mobile` (Android köprüsü), `android/` (Capacitor projesi), `scripts/`, `test/`.
- Özellik listesi ve kurulum anlatımı README.md'de.

## Teknoloji

- Electron 43.8.4 — 32 bit (win32-ia32) destekleyen son ana sürüm; 44+ ia32'yi bıraktı, yükseltme.
- pdfjs-dist 6.4.299 (PDFViewer + yerleşik açıklama editörleri), pdf-lib 1.17.1 + @pdf-lib/fontkit
  (ana süreçte sayfa işlemleri), electron-builder 26 (NSIS kurulum + taşınabilir exe).
- Android: Capacitor 8; renderer masaüstüyle ortak, sadece `window.katip` köprüsünü kullanıyor.
  `src/mobile/` window.katip'i uyguluyor (yollar `katip-doc:<enc uri>/<ad>`), pdfops web worker'da
  çalışıyor (esbuild, fs/path shim'leri).

## Komutlar

- Çalıştır: `npm start`
- Test: `npm run test:unit`, `npm run test:e2e` (Playwright `_electron`; Linux'ta `xvfb-run` altında)
- Android web testi: `npm run build:android-web && node test/android-web.cjs`
- Windows kurulumları: `npm run dist` (ya da `dist:x64`, `dist:ia32`)
- Android senkron: `npm run android:sync`
- CI: `.github/workflows/build.yml`, `windows-latest` üzerinde test + derleme; `main`'e her push'ta
  Release yayınlıyor (kurulum x64/ia32, taşınabilir x64/ia32, Android APK). Android işi ayrı job.
- Eski claude.ai ortamı Linux'tu: NSIS (wine gerekir) ve APK (dl.google.com engelli) orada
  derlenemiyordu, hepsi CI'da derlendi. Ömer'in PC'si Windows, yerelde `npm run dist` denenebilir.

## Teknik tuzaklar (önemli)

- Türkçe karakterler (ş ğ ı İ) WinAnsi'de yok: pdf.js FreeText/form görünümleri bunları düşürüyor.
  Bu yüzden her kayıtta `fixAppearances` işlemi görünümleri gömülü DejaVu Sans ile yeniden üretiyor.
- pdf.js 6'da PDFDocumentProxy'de `destroy()` yok; `doc.loadingTask.destroy()` kullan.
- Windows'ta pdf.js fabrika URL'leri (standardFontDataUrl vb.) `/` ile ve sonda `/` ile yazılmalı.
- pdf.js çizim katmanı SVG'lerini presentation attribute ile renklendiriyor; genel bir
  `svg { fill/stroke }` CSS kuralı vurgu ve çizim renklerini bozuyor (v1.2.1 hatası). Simge kuralı
  `:where(svg:not(#viewerContainer svg))` ile sınırlandırıldı; e2e testi hesaplanan rengi kontrol ediyor.
- Orijinal metin düzenleme: `textedit.js` içerik akışını yorumlayıp eski glifleri siliyor, yeni metni
  paketlenmiş Liberation yazı tipleriyle (Arial/Times/Courier ölçü uyumlu) yazıyor. Taranmış (resim)
  PDF'lerde çalışmaz.
- Dönüştürme (sadece Windows, `src/main/convert.js` + `src/renderer/js/convert.js`): PDF→Word'de metin
  renderer'da pdf.js ile çıkarılır, ana süreç satır/paragraf gruplayıp .docx'i kendi zip yazıcısıyla
  üretir. Word→PDF: mammoth ile HTML, gizli pencerede `printToPDF`. Android köprüsünde bu çağrılar yok.
- 3B PDF: pdf.js 3B göstermez. `find3D` /3D açıklamalarındaki U3D/PRC akışını bulur; uyarı şeridi ve
  dışa aktarma var, gerçek 3B görüntüleyici yok (JS'te hazır U3D/PRC çözücü yok).
- `addMarkup` işlemi Underline/StrikeOut/Highlight açıklamalarını ekliyor.
- Android imzalama: CI, `KATIP_KEYSTORE_B64` / `KATIP_KEYSTORE_PASSWORD` sırları varsa onlarla,
  yoksa Actions önbelleğindeki `katip-android-signing-v1` anahtarıyla imzalıyor. Önbellek 7 gün
  kullanılmazsa silinir → yeni APK eskinin üstüne kurulamaz, kaldırıp kurmak gerekir. Kalıcı çözüm
  (anahtarı GitHub Secrets'a eklemek) Ömer'e önerildi, yapılmadı. Keystore'u repoya commit etme.
- Eski ortamda `gh pr` GraphQL komutları engelliydi, REST (`gh api`) kullanılıyordu; yerelde sorun olmayabilir.

## Çalışma tarzı

- Ömer: "bana bir şey sorma, nasıl yapılması gerekiyorsa yap", "PR'ı kendin birleştir, tüm yetki sende".
  Kararları kendin ver; CI yeşil olunca kendi PR'ını merge et. Sonunda indirme linklerini ver.
- Kurulum dosyaları kod imzalı değil; SmartScreen uyarısı normal (Ek bilgi → Yine de çalıştır).
- Sertifikalı dijital imza yok; görsel imza var.

## Sürümler

- v1.0.0 (2026-10-30, PR #1): okuma, arama, vurgulama, çizim, metin kutusu, not, imza, form doldurma,
  sayfa işlemleri (döndür, sil, sırala, birleştir, böl), yazdır/kaydet.
- v1.1.0 (2026-10-30, PR #2): orijinal metni düzenleme (araç çubuğu ya da `E`), Acrobat benzeri sağ tık
  menüleri (seçili metin, sayfa, küçük resim, kutular).
- v1.2.0 (2026-10-30, PR #3): Android sürümü (uzun basma menüsü, seçim çubuğu, iki parmak yakınlaştırma,
  ⋮ menüsü, geri tuşu, dosya seçici, paylaş/yazdır).
- v1.2.1 (2026-11-04, PR #4): vurgulama renklerinin beyaz kalması ve çizim renginin griye dönmesi düzeltildi.
- v1.3.0 (2026-11-20): PDF→Word, Word→PDF (.docx açınca otomatik), 3B PDF algılama ve modeli dışa aktarma.

## Nerede kaldık (son yazışma: 2026-11-04 07:02)

- v1.2.1 yayında, Releases'te tüm exe'ler ve APK var. Açık PR yok, `main` temiz (son commit 321e2a7).
- Ömer vurgu rengi hatasını bildirmişti, düzeltildi; düzeltmeyi kendisi denediğine dair geri bildirim yok.
- Android sürümü gerçek telefonda hiç denenmedi (sadece tarayıcı emülasyonu, 13/13 test).
- Açık konu: Android imza anahtarını kalıcı hale getirmek (GitHub Secrets). Bekleyen başka istek yok.

## Kaynak

Eski proje yedeği: `E:\Claude\Hesap-Yedegi\sohbetler\okunur\projeler\PDF okuyucu ve düzenleyici\`
(`mesajlar.md` tüm yazışma, `hafiza\katip-pdf-project.md` hafıza notu). Ayrıntı gerekirse oradan oku.
