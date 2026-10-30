// Browser stand-in for the native KatipFiles plugin, so the Android web bundle can run (and be
// tested) in an ordinary browser. Picked files live in memory; saved files are downloaded.

export class KatipFilesWeb {
  constructor() {
    this.files = new Map(); // uri -> Uint8Array
    this.staged = new Map(); // id -> Uint8Array[]
    this.written = new Map(); // uri or "dir/name" -> Uint8Array (inspected by tests)
    this.seq = 0;
  }

  // Lets tests (or a page) register a file and get its uri.
  add(name, bytes) {
    const uri = `mem://${++this.seq}/${encodeURIComponent(name)}`;
    this.files.set(uri, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    return { uri, name };
  }

  async bytesOf(uri) {
    const b = this.files.get(uri);
    if (!b) throw new Error('Dosya bulunamadı');
    return b.slice();
  }

  async openDocuments({ multi, mimeTypes }) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!multi;
    if (mimeTypes?.length && !mimeTypes.includes('*/*')) input.accept = mimeTypes.join(',');
    const picked = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve([...input.files]), { once: true });
      input.addEventListener('cancel', () => resolve([]), { once: true });
      input.click();
    });
    const files = [];
    for (const f of picked) files.push(this.add(f.name, new Uint8Array(await f.arrayBuffer())));
    return { files };
  }

  async getPendingIntent() {
    return {};
  }

  async createDocument({ name }) {
    const uri = `mem://${++this.seq}/${encodeURIComponent(name)}`;
    return { uri, name };
  }

  async chooseDirectory() {
    return { uri: 'mem://dir' };
  }

  async readFile({ uri }) {
    const b = await this.bytesOf(uri);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return { data: btoa(s) };
  }

  async stageChunk({ id, data, append }) {
    const s = atob(data);
    const chunk = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) chunk[i] = s.charCodeAt(i);
    if (!append) this.staged.set(id, []);
    this.staged.get(id).push(chunk);
  }

  take(id) {
    const parts = this.staged.get(id) || [];
    this.staged.delete(id);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  download(bytes, name, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async commit({ id, uri }) {
    const bytes = this.take(id);
    this.files.set(uri, bytes);
    this.written.set(uri, bytes);
    this.download(bytes, decodeURIComponent(uri.split('/').pop()));
  }

  async commitToDirectory({ id, name, mime }) {
    const bytes = this.take(id);
    this.written.set(`dir/${name}`, bytes);
    this.download(bytes, name, mime);
  }

  async share({ id, name, mime }) {
    const bytes = this.take(id);
    this.written.set(`share/${name}`, bytes);
    const file = new File([bytes], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] }).catch(() => {});
    else this.download(bytes, name, mime);
  }

  async print({ id, name }) {
    const bytes = this.take(id);
    this.written.set(`print/${name}`, bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    window.open(url, '_blank');
  }

  async setBackground() {}

  async addListener() {
    return { remove: async () => {} };
  }
}
