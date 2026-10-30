# Generates sample PDFs used by the automated UI tests (requires reportlab).
import os, sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(out, exist_ok=True)
font = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'fonts', 'DejaVuSans.ttf')
pdfmetrics.registerFont(TTFont('DejaVu', font))

# 1) Multi-page document with Turkish text and bookmarks.
c = canvas.Canvas(os.path.join(out, 'ornek.pdf'), pagesize=A4)
c.setTitle('Örnek Belge'); c.setAuthor('Katip Test')
for i in range(1, 6):
    c.setFont('DejaVu', 28)
    c.drawString(72, 760, f'Bölüm {i}: Çalışma Şartları')
    c.setFont('DejaVu', 12)
    y = 720
    for line in range(30):
        c.drawString(72, y, f'Satır {line+1}: Işık, ğüşiöç ĞÜŞİÖÇ — arama testi için anahtar sözcük {"kalem" if line % 7 == 0 else "defter"}.')
        y -= 20
    c.bookmarkPage(f'b{i}')
    c.addOutlineEntry(f'Bölüm {i}', f'b{i}', level=0)
    if i == 2:
        c.addOutlineEntry('Alt başlık 2.1', f'b{i}', level=1)
    c.showPage()
c.save()

# 2) AcroForm document.
c = canvas.Canvas(os.path.join(out, 'form.pdf'), pagesize=A4)
c.setFont('DejaVu', 18); c.drawString(72, 780, 'Başvuru Formu')
f = c.acroForm
c.setFont('DejaVu', 12)
c.drawString(72, 730, 'Ad Soyad:'); f.textfield(name='adsoyad', x=170, y=722, width=300, height=22)
c.drawString(72, 690, 'E-posta:'); f.textfield(name='eposta', x=170, y=682, width=300, height=22)
c.drawString(72, 650, 'Onaylıyorum:'); f.checkbox(name='onay', x=170, y=646, size=18)
c.drawString(72, 610, 'Şehir:'); f.choice(name='sehir', value='Ankara', options=['Ankara', 'İstanbul', 'İzmir'], x=170, y=602, width=200, height=22)
c.showPage(); c.save()

# 3) Small second document for merge/insert tests.
c = canvas.Canvas(os.path.join(out, 'ek.pdf'), pagesize=A4)
for i in range(1, 3):
    c.setFont('DejaVu', 36); c.drawString(72, 700, f'Ek sayfa {i}'); c.showPage()
c.save()
print('ok')
