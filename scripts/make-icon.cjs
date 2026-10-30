// Renders build/icon.svg to PNG sizes and packs them into build/icon.ico (run once; output is committed).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const sizes = [16, 24, 32, 48, 64, 128, 256];
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  const pngs = [];
  for (const s of sizes) {
    await page.setViewportSize({ width: s, height: s });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    pngs.push(await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }));
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), pngs[pngs.length - 1]);
  // ICO container with embedded PNG images.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const s = sizes[i];
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16);
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1);
    dir.writeUInt16LE(1, i * 16 + 4);
    dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(png.length, i * 16 + 8);
    dir.writeUInt32LE(offset, i * 16 + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), Buffer.concat([header, dir, ...pngs]));
  console.log('icon.png + icon.ico yazıldı');
})();
