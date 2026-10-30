// End-to-end UI test: launches the real Electron app and exercises the main features.
// Usage (Linux CI): xvfb-run -a node test/e2e.cjs   |   Windows: node test/e2e.cjs
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { _electron: electron } = require('playwright-core');
const { PDFDocument } = require('pdf-lib');

const root = path.join(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'katip-e2e-'));
const shots = process.env.KATIP_SHOTS || tmp;
const copy = (name) => { const p = path.join(tmp, name); fs.copyFileSync(path.join(fixtures, name), p); return p; };

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['OK  ', name]); console.log('OK   ', name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL ', name, '\n     ', e.stack || e); }
}

async function launch(file) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', '--disable-gpu', root, ...(file ? [file] : [])],
    env: { ...process.env, KATIP_USER_DATA: path.join(tmp, 'userdata') },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  win.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  if (file) await win.waitForFunction(() => window.__katip?.state.pdfDoc && document.querySelector('.page canvas'), null, { timeout: 20000 });
  return { app, win };
}

// Closes the app without the "save changes?" prompt.
async function quit(app, win) {
  await win.evaluate(() => { window.__katip.state.dirty = false; }).catch(() => {});
  await app.close();
}

const annotSubtypes = async (file) => {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map((p) => {
    const annots = p.node.Annots();
    if (!annots) return [];
    return annots.asArray().map((ref) => String(p.doc.context.lookup(ref).get(require('pdf-lib').PDFName.of('Subtype'))));
  });
};

(async () => {
  const doc1 = copy('ornek.pdf');
  let { app, win } = await launch(doc1);
  const K = (fn, arg) => win.evaluate(fn, arg);

  await step('Belge açılır ve sayfa sayısı gösterilir', async () => {
    assert.strictEqual((await win.textContent('#pageCount')).trim(), '/ 5');
  });

  await step('Arama sonuç sayısını bulur', async () => {
    await win.keyboard.press('Control+F');
    await K(() => window.__katip.commands.find());
    await win.fill('#findInput', 'kalem');
    await win.waitForFunction(() => /\d+ \/ \d+/.test(document.querySelector('#findResult').textContent), null, { timeout: 15000 });
    const txt = await win.textContent('#findResult');
    assert.match(txt, /^1 \/ 25$/, txt);
    await win.keyboard.press('Escape');
  });

  await step('Yer imleri listelenir', async () => {
    await win.click('.sb-tab[data-panel="outline"]');
    await win.waitForSelector('#outline .tree-link');
    const items = await win.$$eval('#outline .tree-link', (n) => n.map((x) => x.textContent));
    assert.ok(items.includes('Bölüm 3') && items.includes('Alt başlık 2.1'), items.join(','));
    await win.click('#outline .tree-link >> text=Bölüm 4');
    await win.waitForFunction(() => window.__katip.pdfViewer.currentPageNumber === 4);
    await win.click('.sb-tab[data-panel="thumbs"]');
  });

  await step('Yakınlaştırma ve sayfaya git', async () => {
    await K(() => window.__katip.commands.fitWidth());
    await K(() => window.__katip.commands.zoomIn());
    const scale = await K(() => window.__katip.pdfViewer.currentScale);
    assert.ok(scale > 1, String(scale));
    await K(() => window.__katip.commands.fitPage());
    await win.fill('#pageInput', '2');
    await win.press('#pageInput', 'Enter');
    await win.waitForFunction(() => window.__katip.pdfViewer.currentPageNumber === 2);
  });

  await step('Serbest çizim (mürekkep) eklenir', async () => {
    await K(() => window.__katip.setTool('draw'));
    await win.waitForSelector('.page[data-page-number="2"] .annotationEditorLayer');
    await win.waitForTimeout(300);
    const box = await win.locator('.page[data-page-number="2"]').boundingBox();
    const sx = box.x + box.width * 0.3; const sy = box.y + Math.min(box.height * 0.3, 500);
    await win.mouse.move(sx, sy); await win.mouse.down();
    for (let i = 1; i <= 10; i++) await win.mouse.move(sx + i * 15, sy + (i % 2) * 20);
    await win.mouse.up();
    await win.waitForTimeout(300);
    await K(() => window.__katip.setTool('select'));
    await win.waitForTimeout(300);
    assert.ok(await K(() => window.__katip.state.pdfDoc.annotationStorage.size) >= 1);
  });

  await step('Metin seçip vurgulama', async () => {
    await K(() => window.__katip.setTool('highlight'));
    await win.waitForTimeout(300);
    const span = win.locator('.page[data-page-number="2"] .textLayer span').nth(3);
    const b = await span.boundingBox();
    await win.mouse.move(b.x + 2, b.y + b.height / 2);
    await win.mouse.down();
    await win.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(500);
    await K(() => window.__katip.setTool('select'));
    assert.ok(await K(() => window.__katip.state.pdfDoc.annotationStorage.size) >= 2);
  });

  await step('Türkçe metin kutusu eklenir', async () => {
    await K(() => window.__katip.setTool('text'));
    await win.waitForTimeout(300);
    const box = await win.locator('.page[data-page-number="2"]').boundingBox();
    await win.mouse.click(box.x + 80, box.y + 60);
    await win.waitForSelector('.freeTextEditor .internal');
    await win.keyboard.type('Şişli İğdır çığ ÖÜ');
    await win.mouse.click(box.x + box.width - 30, box.y + box.height - 30);
    await win.waitForTimeout(300);
    await K(() => window.__katip.setTool('select'));
    await win.waitForTimeout(300);
  });

  await step('Resim (imza) eklenir', async () => {
    await K(async () => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 100;
      const g = c.getContext('2d'); g.strokeStyle = '#10204a'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(10, 80); g.bezierCurveTo(80, -20, 150, 160, 290, 20); g.stroke();
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await window.__katip.insertImageFile(new File([blob], 'imza.png', { type: 'image/png' }));
    });
    await win.waitForSelector('.stampEditor canvas', { timeout: 10000 });
    await win.waitForTimeout(500);
    await K(() => window.__katip.setTool('select'));
  });

  const saved1 = path.join(tmp, 'kaydedilen.pdf');
  await step('Farklı kaydet: açıklamalar PDF içine yazılır', async () => {
    await K(async (p) => { window.__katip.state.filePath = p; await window.__katip.commands.save(); }, saved1);
    await win.waitForFunction(() => !window.__katip.state.dirty);
    const subtypes = (await annotSubtypes(saved1))[1];
    for (const t of ['/Ink', '/Highlight', '/FreeText', '/Stamp']) assert.ok(subtypes.includes(t), `${t} yok: ${subtypes}`);
    // Turkish free text must carry its own appearance stream with an embedded font.
    const d = await PDFDocument.load(fs.readFileSync(saved1));
    const { PDFName } = require('pdf-lib');
    const ft = d.getPage(1).node.Annots().asArray().map((r) => d.context.lookup(r))
      .find((a) => String(a.get(PDFName.of('Subtype'))) === '/FreeText');
    assert.ok(ft.get(PDFName.of('AP')), 'FreeText görünümü yok');
    await win.screenshot({ path: path.join(shots, 'e2e-annotations.png') });
  });

  await step('Yapışkan not eklenir', async () => {
    await K(() => window.__katip.applyOp('Not ekleme', 'addNote', { page: 0, x: 400, y: 800, text: 'Gözden geçir: ışık', author: 'Test' }));
    const subtypes = await annotSubtypes(saved1); // unchanged file on disk
    assert.ok(!subtypes[0].includes('/Text'));
    await K(async () => { await window.__katip.commands.save(); });
    assert.ok((await annotSubtypes(saved1))[0].includes('/Text'));
  });

  await step('Sayfa işlemleri: döndür, sil, boş sayfa, sırala, geri al', async () => {
    const pages = () => K(() => window.__katip.state.pdfDoc.numPages);
    await K(() => window.__katip.applyOp('Döndür', 'rotate', { pages: [0], delta: 90 }));
    const rot = await K(async () => (await window.__katip.state.pdfDoc.getPage(1)).rotate);
    assert.strictEqual(rot, 90);
    await K(() => window.__katip.applyOp('Sil', 'remove', { pages: [4] }));
    assert.strictEqual(await pages(), 4);
    await K(() => window.__katip.applyOp('Boş', 'insertBlank', { at: 1 }));
    assert.strictEqual(await pages(), 5);
    await K(() => window.__katip.applyOp('Sıra', 'reorder', { order: [4, 3, 2, 1, 0] }));
    const firstText = await K(async () => (await (await window.__katip.state.pdfDoc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' '));
    assert.match(firstText, /Bölüm 4/);
    await K(() => window.__katip.commands.undo());
    await K(() => window.__katip.commands.undo());
    assert.strictEqual(await pages(), 4);
    await K(() => window.__katip.commands.redo());
    assert.strictEqual(await pages(), 5);
  });

  await step('Sayfa düzenleme ekranı açılır', async () => {
    await K(() => window.__katip.commands.organize());
    await win.waitForSelector('.org-page canvas');
    assert.strictEqual(await win.locator('.org-page').count(), 5);
    await win.screenshot({ path: path.join(shots, 'e2e-organizer.png') });
    await win.click('[data-org="close"]');
  });

  await step('Yazdırma hazırlığı sayfaları işler', async () => {
    const n = await K(async () => {
      const c = await window.__katip.renderPageToCanvas(0, { scale: 1, print: true });
      return c.width;
    });
    assert.ok(n > 100);
  });
  await quit(app, win);

  // ---- forms
  ({ app, win } = await launch(copy('form.pdf')));
  await step('Form doldurulur ve kaydedilir', async () => {
    await win.waitForSelector('.annotationLayer input[type=text]');
    const input = win.locator('.annotationLayer input[type=text]').first();
    await input.fill('Ayşe Yılmaz');
    await win.locator('.annotationLayer input[type=checkbox]').first().check();
    await win.locator('.annotationLayer select').first().selectOption('İzmir');
    await win.waitForTimeout(200);
    const out = path.join(tmp, 'form-dolu.pdf');
    await K(async (p) => { window.__katip.state.filePath = p; await window.__katip.commands.save(); }, out);
    const form = (await PDFDocument.load(fs.readFileSync(out))).getForm();
    assert.strictEqual(form.getTextField('adsoyad').getText(), 'Ayşe Yılmaz');
    assert.strictEqual(form.getCheckBox('onay').isChecked(), true);
    assert.deepStrictEqual(form.getDropdown('sehir').getSelected(), ['İzmir']);
    await win.screenshot({ path: path.join(shots, 'e2e-form.png') });
  });
  await quit(app, win);

  // ---- welcome screen
  ({ app, win } = await launch(null));
  await step('Karşılama ekranı', async () => {
    await win.waitForSelector('#welcome .btn.primary');
    await win.screenshot({ path: path.join(shots, 'e2e-welcome.png') });
  });
  await quit(app, win);

  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} adım başarılı. Ekran görüntüleri: ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
