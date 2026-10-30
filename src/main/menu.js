'use strict';

const { Menu, app, shell } = require('electron');
const path = require('path');

// Every menu item sends a command string to the focused renderer ("cmd", name).
function buildMenu({ recent, send, newWindow, openRecent, clearRecent }) {
  const cmd = (name, label, accelerator, extra = {}) => ({
    label,
    accelerator,
    click: () => send('cmd', name),
    ...extra,
  });

  const recentItems = recent.length
    ? [
        ...recent.map((p) => ({ label: path.basename(p), sublabel: p, click: () => openRecent(p) })),
        { type: 'separator' },
        { label: 'Listeyi Temizle', click: clearRecent },
      ]
    : [{ label: '(boş)', enabled: false }];

  const template = [
    {
      label: '&Dosya',
      submenu: [
        cmd('open', 'Aç...', 'CmdOrCtrl+O'),
        { label: 'Son Kullanılanlar', submenu: recentItems },
        { label: 'Yeni Pencere', accelerator: 'CmdOrCtrl+N', click: newWindow },
        { type: 'separator' },
        cmd('save', 'Kaydet', 'CmdOrCtrl+S'),
        cmd('saveAs', 'Farklı Kaydet...', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('merge', 'Dosyaları Birleştir...'),
        cmd('split', 'Belgeyi Böl...'),
        cmd('exportImages', 'Sayfaları Resim Olarak Dışa Aktar...'),
        { type: 'separator' },
        cmd('properties', 'Belge Özellikleri...', 'CmdOrCtrl+D'),
        cmd('print', 'Yazdır...', 'CmdOrCtrl+P'),
        { type: 'separator' },
        cmd('close', 'Belgeyi Kapat', 'CmdOrCtrl+W'),
        { label: 'Çıkış', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Dü&zen',
      submenu: [
        cmd('undo', 'Geri Al', 'CmdOrCtrl+Z'),
        cmd('redo', 'Yinele', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        { label: 'Kes', role: 'cut' },
        { label: 'Kopyala', role: 'copy' },
        { label: 'Yapıştır', role: 'paste' },
        { label: 'Tümünü Seç', role: 'selectAll' },
        { type: 'separator' },
        cmd('find', 'Bul...', 'CmdOrCtrl+F'),
        cmd('findNext', 'Sonrakini Bul', 'F3'),
        cmd('findPrev', 'Öncekini Bul', 'Shift+F3'),
        { type: 'separator' },
        cmd('preferences', 'Tercihler...', 'CmdOrCtrl+K'),
      ],
    },
    {
      label: '&Görünüm',
      submenu: [
        cmd('zoomIn', 'Yakınlaştır', 'CmdOrCtrl+='),
        cmd('zoomIn', 'Yakınlaştır', 'CmdOrCtrl+Plus', { visible: false }),
        cmd('zoomOut', 'Uzaklaştır', 'CmdOrCtrl+-'),
        cmd('actualSize', 'Gerçek Boyut', 'CmdOrCtrl+1'),
        cmd('fitPage', 'Sayfaya Sığdır', 'CmdOrCtrl+0'),
        cmd('fitWidth', 'Genişliğe Sığdır', 'CmdOrCtrl+2'),
        { type: 'separator' },
        cmd('rotateViewCw', 'Görünümü Saat Yönünde Döndür', 'CmdOrCtrl+Shift+='),
        cmd('rotateViewCcw', 'Görünümü Saat Yönü Tersine Döndür', 'CmdOrCtrl+Shift+-'),
        { type: 'separator' },
        {
          label: 'Sayfa Düzeni',
          submenu: [
            cmd('layoutSingle', 'Tek Sayfa'),
            cmd('layoutContinuous', 'Sürekli Kaydırma'),
            cmd('layoutTwo', 'İki Sayfa'),
            cmd('layoutTwoCover', 'İki Sayfa (Kapak Ayrı)'),
            cmd('layoutHorizontal', 'Yatay Kaydırma'),
          ],
        },
        { type: 'separator' },
        cmd('toggleSidebar', 'Kenar Çubuğu', 'F4'),
        cmd('presentation', 'Tam Ekran Okuma Modu', 'CmdOrCtrl+L'),
        cmd('toggleTheme', 'Koyu/Açık Tema'),
        cmd('nightMode', 'Gece Okuma Modu (Renkleri Ters Çevir)'),
        { type: 'separator' },
        cmd('firstPage', 'İlk Sayfa', 'Home', { registerAccelerator: false }),
        cmd('lastPage', 'Son Sayfa', 'End', { registerAccelerator: false }),
        cmd('gotoPage', 'Sayfaya Git...', 'CmdOrCtrl+G'),
        { type: 'separator' },
        { label: 'Geliştirici Araçları', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Araçlar',
      submenu: [
        cmd('toolSelect', 'Metin Seçimi'),
        cmd('toolHand', 'El Aracı'),
        { type: 'separator' },
        cmd('toolHighlight', 'Metni Vurgula'),
        cmd('toolEditText', 'Orijinal Metni Düzenle'),
        cmd('toolText', 'Metin Ekle'),
        cmd('toolDraw', 'Serbest Çizim'),
        cmd('toolNote', 'Yapışkan Not'),
        cmd('toolImage', 'Resim Ekle...'),
        cmd('toolSign', 'İmzala...'),
        { type: 'separator' },
        cmd('organize', 'Sayfaları Düzenle', 'CmdOrCtrl+Shift+O'),
        cmd('rotatePagesCw', 'Geçerli Sayfayı Sağa Döndür'),
        cmd('rotatePagesCcw', 'Geçerli Sayfayı Sola Döndür'),
        cmd('deletePage', 'Geçerli Sayfayı Sil'),
        cmd('insertBlank', 'Boş Sayfa Ekle'),
        cmd('insertFile', 'Dosyadan Sayfa Ekle...'),
        cmd('extractPages', 'Sayfaları Ayıkla...'),
        { type: 'separator' },
        cmd('flattenForm', 'Form Alanlarını Düzleştir'),
      ],
    },
    {
      label: '&Yardım',
      submenu: [
        cmd('shortcuts', 'Klavye Kısayolları', 'F1'),
        cmd('about', `${app.getName()} Hakkında`),
        { label: 'Lisanslar', click: () => shell.openPath(path.join(process.resourcesPath || '', 'THIRD_PARTY_NOTICES.txt')) },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
