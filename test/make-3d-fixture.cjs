// Creates test/fixtures/model3d.pdf: one page with a 3D annotation holding a (fake) U3D stream
// and a poster appearance, like the 3D PDFs CAD programs export.
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, StandardFonts, rgb } = require('pdf-lib');

(async () => {
  const d = await PDFDocument.create();
  const page = d.addPage([595, 842]);
  const font = await d.embedFont(StandardFonts.Helvetica);
  page.drawText('3B model iceren test belgesi', { x: 72, y: 780, size: 16, font });
  page.drawRectangle({ x: 72, y: 400, width: 450, height: 340, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1 });
  const model = Buffer.concat([Buffer.from('U3D\0', 'latin1'), Buffer.alloc(64, 7)]);
  const stream = d.context.flateStream(model, { Type: '3D', Subtype: 'U3D' });
  const annot = d.context.obj({ Type: 'Annot', Subtype: '3D', Rect: [72, 400, 522, 740], Contents: '3D model' });
  annot.set(PDFName.of('3DD'), d.context.register(stream));
  page.node.set(PDFName.of('Annots'), d.context.obj([d.context.register(annot)]));
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'model3d.pdf'), await d.save());
  console.log('model3d.pdf yazıldı');
})();
