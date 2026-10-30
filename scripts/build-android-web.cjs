'use strict';

// Assembles the web part of the Android app into android-web/ (Capacitor's webDir).
// The renderer is copied unchanged; Android-only pieces are added next to it:
//   src/mobile/android.js        window.katip implemented with Capacitor (bundled)
//   src/mobile/pdfops-worker.js  src/main/pdfops.js running in a web worker (bundled)
//   src/mobile/mobile.css        touch layout
// The folder layout mirrors the repository so relative URLs in the renderer keep working.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'android-web');
const PDFJS = path.join('node_modules', 'pdfjs-dist');

const COPY = [
  'src/renderer',
  'src/assets',
  'src/mobile/mobile.css',
  'THIRD_PARTY_NOTICES.txt',
  `${PDFJS}/LICENSE`,
  `${PDFJS}/build/pdf.mjs`,
  `${PDFJS}/build/pdf.worker.mjs`,
  `${PDFJS}/build/pdf.sandbox.mjs`,
  `${PDFJS}/web/pdf_viewer.mjs`,
  `${PDFJS}/web/pdf_viewer.css`,
  `${PDFJS}/web/images`,
  `${PDFJS}/cmaps`,
  `${PDFJS}/standard_fonts`,
  `${PDFJS}/wasm`,
  `${PDFJS}/iccs`,
];

function copy(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith('.map') });
}

function patchIndex() {
  const file = path.join(OUT, 'src', 'renderer', 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const replace = (from, to) => {
    if (!html.includes(from)) throw new Error(`index.html: "${from}" bulunamadı`);
    html = html.replace(from, to);
  };
  replace('<html lang="tr">', '<html lang="tr" class="mobile">');
  replace('<meta charset="utf-8">',
    '<meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">');
  // Older Android WebViews receive Capacitor's bridge as an inline script.
  replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
  replace('<link rel="stylesheet" href="styles.css">',
    '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="../mobile/mobile.css">');
  replace('<script type="module" src="js/app.js"></script>',
    '<script src="../mobile/android.js"></script>\n  <script type="module" src="js/app.js"></script>');
  fs.writeFileSync(file, html);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  COPY.forEach(copy);
  patchIndex();
  // Capacitor needs an index.html at the web root; the app itself starts at server.appStartPath.
  fs.writeFileSync(path.join(OUT, 'index.html'),
    '<!doctype html><meta charset="utf-8"><script>location.replace("src/renderer/index.html")</script>\n');

  const common = { bundle: true, platform: 'browser', target: ['chrome100'], legalComments: 'none', logLevel: 'warning' };
  await esbuild.build({
    ...common,
    entryPoints: [path.join(ROOT, 'src/mobile/android.js')],
    outfile: path.join(OUT, 'src/mobile/android.js'),
    format: 'iife',
  });
  await esbuild.build({
    ...common,
    entryPoints: [path.join(ROOT, 'src/mobile/pdfops-worker.js')],
    outfile: path.join(OUT, 'src/mobile/pdfops-worker.js'),
    format: 'iife',
    minify: true,
    // pdfops.js resolves its fonts relative to __dirname (src/main) with fs/path.
    define: { __dirname: '"/src/main"' },
    alias: {
      fs: path.join(ROOT, 'src/mobile/shims/fs.js'),
      path: path.join(ROOT, 'src/mobile/shims/path.js'),
    },
  });
  console.log(`Android web paketi hazır: ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
