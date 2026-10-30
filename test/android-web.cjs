// End-to-end test of the Android web bundle (android-web/) in Chromium with phone emulation.
// The native file plugin is replaced by its browser stand-in (src/mobile/files-web.js).
// Usage: npm run build:android-web && node test/android-web.cjs
// Browser: $CHROME_PATH, or /opt/pw-browsers/chromium, or Google Chrome.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright-core');
const { PDFDocument } = require('pdf-lib');

const root = path.join(__dirname, '..', 'android-web');
const fixtures = path.join(__dirname, 'fixtures');
const shots = process.env.KATIP_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'katip-android-'));
fs.mkdirSync(shots, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ttf': 'font/ttf', '.txt': 'text/plain', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function browserPath() {
  const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    if (fs.statSync(c).isFile()) return c;
    // Playwright's browser folder
    const exe = path.join(c, 'chrome-linux64', 'chrome');
    if (fs.existsSync(exe)) return exe;
    const sub = fs.readdirSync(c).map((d) => path.join(c, d, 'chrome-linux64', 'chrome')).find((p) => fs.existsSync(p));
    if (sub) return sub;
  }
  return undefined;
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['OK  ', name]); console.log('OK   ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n     ', e.stack || e); }
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: browserPath(), args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  const K = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: path.join(shots, `android-${name}.png`) });

  // Feeds a fixture to the next "open file" request.
  const pickNext = (name) => K(({ name: n, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.__katipWebFiles.openDocuments = async () => ({ files: [window.__katipWebFiles.add(n, bytes)] });
  }, { name, b64: fs.readFileSync(path.join(fixtures, name)).toString('base64') });

  const sheetItems = () => page.$$eval('.msheet-item', (els) => els.map((e) => e.textContent));
  const tapSheet = async (label) => {
    await page.locator('.msheet-item', { hasText: label }).first().click();
    await page.waitForSelector('.msheet-backdrop', { state: 'detached' });
  };

  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.__katipMobile && window.katip?.isMobile, null, { timeout: 20000 });

  await step('Mobil başlangıç ekranı ve ⋮ menü düğmesi', async () => {
    await page.waitForSelector('#welcome .btn.primary');
    assert.ok(await page.isVisible('#mobileMenuBtn'));
    assert.ok(await K(() => document.documentElement.classList.contains('mobile')));
    await shot('01-welcome');
  });

  await step('Dosya seçici ile PDF açılır (genişliğe sığdırılmış)', async () => {
    await pickNext('ornek.pdf');
    await page.tap('#welcome .btn.primary');
    await page.waitForFunction(() => window.__katip.state.pdfDoc && document.querySelector('.page canvas'), null, { timeout: 20000 });
    assert.strictEqual((await page.textContent('#pageCount')).trim(), '/ 5');
    assert.strictEqual(await K(() => window.__katip.pdfViewer.currentScaleValue), 'page-width');
    assert.ok(await K(() => document.getElementById('sidebar').classList.contains('hidden')), 'kenar çubuğu kapalı başlamalı');
    await shot('02-open');
  });

  await step('⋮ menüsünden sayfa döndürme (pdf-lib web worker içinde)', async () => {
    await page.tap('#mobileMenuBtn');
    await page.waitForSelector('.msheet-backdrop.open');
    const items = await sheetItems();
    assert.ok(items.includes('Farklı kaydet…') && items.includes('Sayfaları düzenle'), items.join('|'));
    await shot('03-menu');
    await tapSheet('Geçerli sayfayı sağa döndür');
    await page.waitForFunction(() => window.__katip.state.undo.length === 1, null, { timeout: 15000 });
    const bytes = await K(async () => Array.from(await window.__katip.getCurrentBytes()));
    const doc = await PDFDocument.load(Uint8Array.from(bytes));
    assert.strictEqual(doc.getPage(0).getRotation().angle, 90);
  });

  await step('Orijinal metin düzenleme (fontlar worker içinde yüklenir)', async () => {
    const ok = await K(async () => {
      const { pdfDoc } = window.__katip.state;
      const p = await pdfDoc.getPage(1);
      const tc = await p.getTextContent();
      const it = tc.items.find((i) => i.str.trim().length > 3);
      const bytes = await window.__katip.getCurrentBytes();
      const out = await window.katip.pdfOp('editText', {
        bytes, page: 0, item: { transform: it.transform, width: it.width, height: it.height }, text: 'Şişli İçerik ğü', font: { family: 'sans' },
      });
      return out instanceof Uint8Array && out.length > 1000;
    });
    assert.ok(ok);
  });

  await step('Uzun basma menüsü (boş sayfa alanı)', async () => {
    const box = await page.locator('.page').first().boundingBox();
    await K(({ x, y }) => {
      const t = document.elementFromPoint(x, y);
      t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: box.x + box.width / 2, y: box.y + 20 });
    await page.waitForSelector('.msheet-backdrop.open');
    const items = await sheetItems();
    assert.ok(items.includes('Metin kutusu ekle') && items.includes('Sayfayı sola döndür'), items.join('|'));
    await shot('04-longpress');
    await page.tap('.msheet-backdrop', { position: { x: 20, y: 20 } });
    await page.waitForSelector('.msheet-backdrop', { state: 'detached' });
  });

  await step('Metin seçimi çubuğu ile vurgulama', async () => {
    await K(() => {
      const span = [...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find((s) => s.textContent.trim().length > 4);
      const r = document.createRange();
      r.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.waitForSelector('#selBar:not([hidden])');
    await shot('05-selection');
    const before = await K(() => window.__katip.state.undo.length);
    await page.locator('#selBar .btn', { hasText: 'Vurgula' }).click();
    await page.waitForFunction((n) => window.__katip.state.undo.length === n + 1, before, { timeout: 15000 });
  });

  await step('İki parmakla yakınlaştırma', async () => {
    const before = await K(() => window.__katip.pdfViewer.currentScale);
    const cdp = await context.newCDPSession(page);
    const pt = (x, y, id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(150, 400, 0), pt(250, 400, 1)] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(150 - i * 15, 400, 0), pt(250 + i * 15, 400, 1)] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await K(() => window.__katip.pdfViewer.currentScale);
    assert.ok(after > before * 1.5, `${before} -> ${after}`);
  });

  await step('Kaydet: aynı dosyanın üzerine yazılır', async () => {
    await K(() => window.__katip.commands.save());
    const written = await K(() => [...window.__katipWebFiles.written.keys()]);
    assert.strictEqual(written.length, 1, written.join('|'));
    assert.ok(!(await K(() => window.__katip.state.dirty)));
  });

  await step('Salt okunur dosya: kopya olarak kaydetmeye geçilir', async () => {
    await K(() => {
      const wf = window.__katipWebFiles;
      const orig = wf.commit.bind(wf);
      wf.commit = async (args) => {
        wf.commit = orig;
        throw Object.assign(new Error('read only'), { code: 'READ_ONLY' });
      };
      window.__katip.state.dirty = true;
    });
    await K(() => window.__katip.commands.save());
    const fp = await K(() => window.__katip.state.filePath);
    const written = await K(() => [...window.__katipWebFiles.written.keys()]);
    assert.strictEqual(written.length, 2, written.join('|'));
    assert.ok(fp.includes(encodeURIComponent(written[1])), fp);
  });

  await step('Paylaş ve yazdır geçerli PDF\'i yerel tarafa gönderir', async () => {
    await K(() => { window.open = () => null; });
    await K(() => window.__katip.commands.share());
    await K(() => window.__katip.commands.print());
    const keys = await K(() => [...window.__katipWebFiles.written.keys()]);
    assert.ok(keys.includes('share/ornek.pdf') && keys.includes('print/ornek.pdf'), keys.join('|'));
    const b = await K(() => Array.from(window.__katipWebFiles.written.get('print/ornek.pdf').slice(0, 5)));
    assert.strictEqual(String.fromCharCode(...b), '%PDF-');
  });

  await step('Sayfa düzenleyici: dokunarak çoklu seçim ve menüden taşıma', async () => {
    await K(() => window.__katip.commands.organize());
    await page.waitForSelector('.org-page');
    await page.tap('.org-page[data-index="2"]');
    assert.strictEqual(await page.$$eval('.org-page.selected', (e) => e.length), 2);
    await K(() => {
      const n = document.querySelector('.org-page[data-index="2"]');
      const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + 10 }));
    });
    await page.waitForSelector('.msheet-backdrop.open');
    await shot('06-organizer');
    const n0 = await K(() => window.__katip.state.undo.length);
    await tapSheet('Sona taşı');
    await page.waitForFunction((n) => window.__katip.state.undo.length === n + 1, n0, { timeout: 15000 });
    const texts = await K(async () => {
      const d = window.__katip.state.pdfDoc;
      const out = [];
      for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((t) => t.str).join(' ').slice(0, 30));
      return out;
    });
    assert.strictEqual(texts.length, 5);
  });

  await step('Geri tuşu: düzenleyici, sonra belge kapanır', async () => {
    await K(() => window.katip.emit('mobile:back'));
    assert.ok(await page.isHidden('#organizer'));
    await K(() => { window.__katip.state.dirty = false; });
    await K(() => window.katip.emit('mobile:back'));
    await page.waitForFunction(() => !window.__katip.state.pdfDoc);
    await shot('07-closed');
  });

  await step('Sayfada beklenmeyen JavaScript hatası yok', async () => {
    assert.deepStrictEqual(errors, []);
  });

  await browser.close();
  server.close();
  const failed = results.filter(([s]) => s === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} adım başarılı. Ekran görüntüleri: ${shots}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
