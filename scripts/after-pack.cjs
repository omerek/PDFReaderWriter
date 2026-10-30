// electron-builder afterPack hook: writes the icon and version information into
// "Katip PDF.exe" with resedit (pure JavaScript, so it also works when building on Linux
// without Wine).
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { load } = require('resedit/cjs');
  const ResEdit = await load();
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, groupId, lang, iconFile.icons.map((i) => i.data),
  );

  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [ma, mi, pa] = version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(ma, mi, pa, 0, 1033);
  vi.setProductVersion(ma, mi, pa, 0, 1033);
  const langs = vi.getAllLanguagesForStringValues();
  const targets = langs.length ? langs : [{ lang: 1033, codepage: 1200 }];
  for (const l of targets) {
    vi.setStringValues(l, {
      FileDescription: 'Katip PDF',
      ProductName: 'Katip PDF',
      CompanyName: 'Katip PDF',
      LegalCopyright: 'Copyright © 2026 Ömer',
      OriginalFilename: `${productFilename}.exe`,
      InternalName: 'Katip PDF',
      FileVersion: version,
      ProductVersion: version,
    });
  }
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • afterPack: simge ve sürüm bilgisi yazıldı -> ${exePath}`);
};
