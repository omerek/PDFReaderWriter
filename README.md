# Katip PDF

Windows 10 ve 11 (32 bit x86 ve 64 bit x64) ve Android (7.0 ve üzeri) için PDF okuyucu ve düzenleyici.

## İndirme

Hazır kurulum dosyaları her `main` güncellemesinde GitHub Actions ile derlenir ve
[Releases](../../releases) sayfasına yüklenir:

| Dosya | Ne için |
| --- | --- |
| `KatipPDF-Kurulum-<sürüm>-x64.exe` | 64 bit Windows 10/11 kurulumu (çoğu bilgisayar) |
| `KatipPDF-Kurulum-<sürüm>-ia32.exe` | 32 bit (x86) Windows 10 kurulumu |
| `KatipPDF-Tasinabilir-<sürüm>-x64.exe` / `-ia32.exe` | Kurulum gerektirmeyen taşınabilir sürüm |
| `KatipPDF-Android-<sürüm>.apk` | Android telefon ve tabletler (Play Store gerekmez) |

Kurulum, PDF dosyalarını Katip PDF ile ilişkilendirir; Windows'ta varsayılan PDF uygulaması
olarak seçmek için **Ayarlar → Uygulamalar → Varsayılan uygulamalar → .pdf** yolunu kullanın.

> Kurulum dosyası kod imzalı olmadığı için Windows SmartScreen ilk açılışta uyarı gösterebilir:
> **Ek bilgi → Yine de çalıştır** ile devam edebilirsiniz.

### Android'e kurulum

1. Telefonda [Releases](../../releases) sayfasını açıp `KatipPDF-Android-<sürüm>.apk` dosyasını indirin.
2. İndirilen dosyaya dokunun. Android ilk seferde tarayıcıya veya dosya yöneticisine
   **Bilinmeyen uygulamaları yükleme** izni vermenizi ister; izni verip **Yükle**'ye dokunun.
3. Yeni sürümleri aynı şekilde indirip kurmanız yeterlidir; belgeleriniz ve ayarlarınız korunur.

Android sürümü masaüstüyle aynı özelliklere sahiptir; dokunmatik ekrana göre uyarlanmıştır:
- Sağ tık yerine **uzun basma** menüsü (sayfa, küçük resim, Sayfaları Düzenle ekranı)
- Metne uzun basıp seçince alttaki çubukta **Kopyala, Vurgula, Altını çiz, Üstünü çiz, Diğer…**
- **İki parmakla yakınlaştırma**, çift dokunarak yakınlaştırma / genişliğe sığdırma
- Masaüstü menü çubuğunun yerine sağ üstteki **⋮** menüsü
- Dosyalar Android dosya seçicisiyle açılır ve kaydedilir (telefon, SD kart, Google Drive vb.);
  başka uygulamalardan "Birlikte aç" veya "Paylaş" ile PDF açılabilir
- **Paylaş** düğmesi, Android yazdırma hizmetiyle yazdırma (PDF olarak kaydetme dahil)
- Sayfaları Düzenle'de dokunarak çoklu seçim ve menüden **Taşı… / Başa taşı / Sona taşı**
- Geri tuşu açık menüyü, pencereyi, aracı veya belgeyi kapatır

## Özellikler

**Okuma**
- PDF açma (menü, sürükle-bırak, çift tıklama / "Birlikte aç", son kullanılan dosyalar)
- Parola korumalı PDF'ler
- Yakınlaştırma (Ctrl+tekerlek, sayfaya / genişliğe sığdır, gerçek boyut), görünümü döndürme
- Tek sayfa, sürekli, iki sayfa, kapak ayrı iki sayfa ve yatay kaydırma düzenleri
- Sayfa küçük resimleri, yer imleri (içindekiler), açıklama listesi, ek dosyalar
- Metin arama (büyük/küçük harf, tam sözcük, tümünü vurgula), metin seçip kopyalama
- Tam ekran okuma modu, koyu tema, gece okuma modu (renkleri ters çevir)
- Bağlantılar, belge özellikleri (başlık, yazar, konu, anahtar sözcük düzenleme)

**Düzenleme ve açıklama**
- **Orijinal metni düzenleme**: Düzenle aracıyla (E) sayfadaki mevcut yazıya tıklayıp
  değiştirin. Eski harfler PDF'ten gerçekten silinir, yeni metin benzer yazı tipi, boyut ve
  renkle yazılır (Arial, Times ve Courier ile ölçü uyumlu Liberation yazı tipleri, Türkçe karakterli)
- Metin vurgulama (5 renk) ve serbest vurgulama
- Metin kutusu ekleme (Türkçe karakterler gömülü yazı tipiyle kaydedilir)
- Serbest çizim (renk, kalınlık, opaklık)
- Yapışkan not
- Resim ekleme (PNG, JPG, GIF, BMP, WEBP, SVG); taşıma, boyutlandırma, silme
- İmza: fareyle çizme, yazarak oluşturma veya resimden (beyaz arka plan otomatik temizlenir);
  imzalar sonraki kullanımlar için saklanır
- Form doldurma (metin, onay kutusu, açılır liste vb.) ve formu düzleştirme
- Geri al / yinele

**Sağ tık menüleri**
- Seçili metin: Kopyala, Vurgula, Altını çiz, Üstünü çiz, Not ekle, Metni düzenle, Bul, Tümünü seç
- Sayfa: Buraya not ekle, metin kutusu / resim / imza ekle, araçlar, yakınlaştırma,
  sayfa gezinme, sayfayı döndürme / silme, yazdır, belge özellikleri
- Küçük resimler ve Sayfaları Düzenle ekranı: döndür, çoğalt, boş sayfa / dosyadan sayfa ekle,
  ayıkla, sil
- Metin kutuları: Kes, Kopyala, Yapıştır, Tümünü seç

**Sayfa işlemleri** (Sayfaları Düzenle ekranı)
- Sürükle-bırak ile sıralama, döndürme, silme, çoğaltma
- Boş sayfa ekleme, başka bir PDF'den sayfa ekleme
- Sayfaları ayıklama, belgeyi bölme (her N sayfada bir veya aralıklara göre)
- Birden çok PDF'i birleştirme, resimlerden PDF oluşturma
- Sayfaları PNG/JPG olarak dışa aktarma

**Diğer**
- Yazdırma (Windows yazdırma penceresi; yazıcı, sayfa aralığı, kopya sayısı)
- Kaydet / Farklı kaydet, kaydedilmemiş değişiklik uyarısı
- Klavye kısayolları (F1 ile listelenir)

## Kaynaktan derleme

Gerekenler: [Node.js 22](https://nodejs.org) ve Git.

```bash
git clone https://github.com/omerek/PDFReaderWriter.git
cd PDFReaderWriter
npm ci
npm start            # uygulamayı geliştirme modunda çalıştırır
npm test             # birim + uçtan uca arayüz testleri
npm run dist         # dist/ klasörüne x64 ve x86 kurulum + taşınabilir sürüm üretir
```

Windows kurulum dosyaları en sorunsuz Windows üzerinde derlenir (GitHub Actions da
`windows-latest` kullanır). Linux/macOS'ta derlemek için Wine gerekir.

Android sürümü ([Capacitor](https://capacitorjs.com) ile) için ayrıca JDK 21 ve Android SDK gerekir:

```bash
npm run build:android-web      # android-web/ klasörüne web paketini hazırlar
npm run test:android-web       # telefon emülasyonlu Chromium'da arayüz testi
npx cap sync android           # web paketini Android projesine kopyalar
cd android && ./gradlew assembleRelease
```

APK'nın güncellemelerde kurulabilmesi için her sürüm aynı anahtarla imzalanmalıdır. CI, imza
anahtarını `KATIP_KEYSTORE_B64` (base64 .jks) ve `KATIP_KEYSTORE_PASSWORD` depo sırlarından alır
(takma ad `katip`); bu sırlar tanımlı değilse ilk derlemede bir anahtar üretip GitHub Actions
önbelleğinde saklar.

Test PDF'lerini yeniden üretmek için: `pip install reportlab && npm run fixtures`.

## Mimari

| Katman | Teknoloji | Lisans |
| --- | --- | --- |
| Masaüstü kabuğu | Electron 43 (Windows x86/x64 destekleyen son ana sürüm) | MIT |
| Android kabuğu | Capacitor 8 (Android System WebView) | MIT |
| Görüntüleme, arama, açıklama düzenleyicileri, form doldurma | PDF.js 6 | Apache 2.0 |
| Sayfa işlemleri, birleştirme, bölme, notlar, Türkçe görünüm düzeltmesi | pdf-lib + fontkit | MIT |
| Unicode yazı tipi | DejaVu Sans | Bitstream Vera (serbest) |
| Metin düzenleme yazı tipleri | Liberation Sans / Serif / Mono | SIL OFL 1.1 |
| Kurulum | electron-builder (NSIS) | MIT |

```
src/main/       Ana süreç: pencere, menü, dosya erişimi, pdf-lib işlemleri (pdfops.js),
                orijinal metin düzenleme (textedit.js)
src/preload/    Güvenli köprü (contextIsolation + sandbox)
src/renderer/   Arayüz: app.js (görüntüleyici, araçlar, kaydetme), sidebar.js,
                organizer.js (sayfa düzenleme), textedit-ui.js, contextmenu.js,
                signature.js, dialogs.js
src/mobile/     Android: android.js (window.katip'in Capacitor ile karşılığı), mobile-ui.js
                (dokunmatik menüler, yakınlaştırma, geri tuşu), pdfops-worker.js (pdfops.js'i
                web worker içinde çalıştırır), mobile.css
android/        Capacitor Android projesi; KatipFilesPlugin.java dosya seçici, kaydetme,
                paylaşma ve yazdırma
test/           unit.cjs (pdf-lib işlemleri), e2e.cjs (gerçek uygulama üzerinde arayüz testi),
                android-web.cjs (Android arayüzü, telefon emülasyonu)
```

Açıklamalar PDF içine standart PDF açıklamaları (Highlight, Ink, FreeText, Stamp, Text)
olarak yazılır; Adobe Acrobat, tarayıcılar ve diğer okuyucularda da görünür ve düzenlenebilir.

## Bilinen sınırlamalar

- Orijinal metin düzenleme satır satır çalışır; düzenlenen satır Liberation yazı tipiyle yeniden
  yazılır, bu yüzden özel yazı tiplerinde küçük görünüm farkı olabilir. Taranmış (resim) sayfalarda
  metin olmadığından düzenleme yapılamaz.
- Şifreli PDF'lerde açıklama ve form doldurma çalışır; sayfa işlemleri (döndürme, silme vb.)
  için önce şifresiz bir kopya kaydedilmelidir.
- Dijital (sertifikalı) imza desteklenmez; imza aracı görsel imza ekler.
- Electron 43, 32 bit Windows'u destekleyen son sürümdür; ileride yalnızca x64 sürümü güncellenebilir.

## Lisans

MIT. Üçüncü taraf lisansları `THIRD_PARTY_NOTICES.txt` dosyasındadır.
