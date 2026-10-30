// Generates test/fixtures/chrome.pdf with headless Chromium (Type0 fonts + TJ kerning, like most
// real-world PDFs). Run once; the output is committed.
const path = require('path');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  await page.setContent(`<html><body style="font-family:'Liberation Serif',serif;font-size:14pt;margin:2cm">
    <h1 style="font-family:'Liberation Sans',sans-serif">Fatura Bilgileri</h1>
    <p>Müşteri adı: Ahmet Yılmaz</p>
    <p>Toplam tutar: 1.250,00 TL</p>
    <p><b>Kalın satır:</b> değiştirilmeyecek metin.</p>
    <p style="color:#c00000">Kırmızı uyarı satırı</p>
  </body></html>`);
  await page.pdf({ path: path.join(__dirname, 'fixtures', 'chrome.pdf'), format: 'A4' });
  await browser.close();
  console.log('chrome.pdf yazıldı');
})();
