import fs from 'node:fs';
import path from 'node:path';
import { fromBuffer } from 'yauzl';

type Image = { id: number; storedName: string; scope: string; device: string; kind: string };
const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };

async function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const files = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        if (files.has(entry.fileName) || entry.fileName.includes('..') || entry.fileName.includes('\\')) {
          zip.close(); reject(new Error('duplicate or unsafe ZIP entry')); return;
        }
        assert(entry.compressionMethod === 0, 'image ZIP must use STORE without recompressing');
        if (entry.fileName.endsWith('/')) {
          files.set(entry.fileName, Buffer.alloc(0)); zip.readEntry(); return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { reject(streamError); return; }
          const chunks: Buffer[] = [];
          stream.on('error', reject);
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

export async function testImageExport(base: string, dataDir: string): Promise<void> {
  const sku = '导出-123';
  const body = { name: 'ZIP export test', sku, platforms: {} };
  const created = await fetch(base + '/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()) as any;
  const id = created.product.id;
  const url = (platform: string) => base + '/api/products/' + id + '/export?platform=' + platform;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const bytes = (label: string) => Buffer.concat([png, Buffer.from(label)]);
  const upload = async (scope: string, kind: string, device: string, buffers: Buffer[]): Promise<any> => {
    const form = new FormData();
    form.append('scope', scope); form.append('kind', kind); form.append('device', device);
    buffers.forEach((buffer, i) => form.append('files', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), '图-' + i + '.png'));
    const response = await fetch(base + '/api/products/' + id + '/images', { method: 'POST', body: form });
    assert(response.ok, 'export fixture upload failed');
    return (await response.json() as any).product;
  };
  const expectZip = async (platform: string, expected: Record<string, Buffer>) => {
    const response = await fetch(url(platform));
    assert(response.ok, 'ZIP export request failed: ' + response.status);
    assert(response.headers.get('content-type') === 'application/zip', 'incorrect ZIP type');
    assert(response.headers.get('cache-control') === 'no-store', 'exports must not be cached');
    const filename = sku + '-' + ({ amazon: '亚马逊', tmall: '天猫', temu: 'Temu', aliexpress: 'AliExpress' } as Record<string, string>)[platform] + '.zip';
    assert(decodeURIComponent(response.headers.get('content-disposition') || '').includes(filename), 'Chinese download filename missing');
    assert(response.headers.get('access-control-expose-headers')?.includes('Content-Disposition'), 'separate frontend cannot read download filename');
    const files = await unzip(Buffer.from(await response.arrayBuffer()));
    assert(files.has('主图/') && files.has('详情图/'), 'ZIP must retain both folders');
    const names = [...files.keys()].filter((name) => !name.endsWith('/'));
    assert(JSON.stringify(names) === JSON.stringify(Object.keys(expected)), 'ZIP entries/order differ: ' + JSON.stringify(names));
    for (const [name, buffer] of Object.entries(expected)) assert(files.get(name)?.equals(buffer), 'original bytes changed: ' + name);
  };

  assert((await fetch(url('amazon'))).status === 400, 'empty product should explain there are no images');
  assert((await fetch(url('invalid'))).status === 400, 'invalid platform must be rejected');
  assert((await fetch(base + '/api/products/999999999/export?platform=amazon')).status === 404, 'unknown product must be rejected');
  await upload('common', 'main', 'all', [bytes('main1'), bytes('main2')]);
  await upload('common', 'detail', 'all', [bytes('detail1'), bytes('detail2')]);
  // Common images are exported for Temu/AliExpress, but not in Amazon/Tmall platform packs unless imported.
  const commonExpected = {
    ['主图/' + sku + '-主图-01.png']: bytes('main1'),
    ['主图/' + sku + '-主图-02.png']: bytes('main2'),
    ['详情图/' + sku + '-详情图-01.png']: bytes('detail1'),
    ['详情图/' + sku + '-详情图-02.png']: bytes('detail2'),
  };
  await expectZip('temu', commonExpected);
  await expectZip('aliexpress', commonExpected);
  assert((await fetch(url('amazon'))).status === 400, 'unimported common images must not be exported for Amazon');
  assert((await fetch(url('tmall'))).status === 400, 'unimported common images must not be exported for Tmall');
  const imported = await fetch(base + '/api/products/' + id + '/images/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'amazon', kind: 'main', device: 'all' }) });
  assert(imported.ok, 'common image import failed');
  await upload('amazon', 'main', 'all', [bytes('amazon-main')]);
  await upload('amazon', 'detail', 'desktop', [bytes('desktop1'), bytes('desktop2')]);
  await expectZip('amazon', {
    ['主图/' + sku + '-主图-01.png']: bytes('main1'),
    ['主图/' + sku + '-主图-02.png']: bytes('main2'),
    ['主图/' + sku + '-亚马逊-主图-01.png']: bytes('amazon-main'),
    ['详情图/' + sku + '-亚马逊-电脑-详情图-01.png']: bytes('desktop1'),
    ['详情图/' + sku + '-亚马逊-电脑-详情图-02.png']: bytes('desktop2'),
  });
  const current = await upload('amazon', 'detail', 'mobile', [bytes('desktop1'), bytes('mobile-only')]);
  const expectedAmazon = {
    ['主图/' + sku + '-主图-01.png']: bytes('main1'),
    ['主图/' + sku + '-主图-02.png']: bytes('main2'),
    ['主图/' + sku + '-亚马逊-主图-01.png']: bytes('amazon-main'),
    ['详情图/' + sku + '-亚马逊-电脑-详情图-01.png']: bytes('desktop1'),
    ['详情图/' + sku + '-亚马逊-电脑-详情图-02.png']: bytes('desktop2'),
    ['详情图/' + sku + '-亚马逊-手机-详情图-01.png']: bytes('mobile-only'),
  };
  const snapshot = JSON.stringify(current);
  await expectZip('amazon', expectedAmazon);
  const after = await fetch(base + '/api/products/' + id).then((r) => r.json()) as any;
  assert(JSON.stringify(after.product) === snapshot, 'export must not save, reorder or rename product data');
  assert((await fetch(url('tmall'))).status === 400, 'Tmall must remain empty before importing or uploading Tmall images');
  await upload('tmall', 'main', 'all', [bytes('tmall-main')]);
  await upload('tmall', 'sku', 'all', [bytes('tmall-sku')]);
  await upload('tmall', 'detail', 'all', [bytes('tmall-detail')]);
  await expectZip('tmall', {
    ['主图/' + sku + '-天猫-主图-01.png']: bytes('tmall-main'),
    ['SKU/' + sku + '-天猫-sku-01.png']: bytes('tmall-sku'),
    ['详情图/' + sku + '-天猫-详情图-01.png']: bytes('tmall-detail'),
  });
  await expectZip('temu', commonExpected);
  await expectZip('aliexpress', commonExpected);
  const missing = current.images.find((image: Image) => image.device === 'desktop') as Image;
  const missingPath = path.join(dataDir, 'uploads', ...missing.storedName.split('/'));
  fs.renameSync(missingPath, missingPath + '.test-hidden');
  try { assert((await fetch(url('amazon'))).status === 404, 'missing files must fail before starting ZIP'); }
  finally { fs.renameSync(missingPath + '.test-hidden', missingPath); }
  // Make the download exceed transport buffers so both streams remain active.
  await upload('tmall', 'main', 'all', [Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024, 1)]), Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024, 2)])]);
  const controllers = [new AbortController(), new AbortController()];
  try {
    for (const controller of controllers) {
      const response = await fetch(url('tmall'), { signal: controller.signal });
      assert(response.ok, 'concurrent download did not start');
    }
    const busy = await fetch(url('tmall'));
    assert(busy.status === 429 && busy.headers.get('retry-after') === '3', 'concurrent ZIP jobs must be bounded');
  } finally { controllers.forEach((controller) => controller.abort()); }
  let recovered = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = await fetch(url('amazon'));
    if (probe.ok) { await probe.arrayBuffer(); recovered = true; break; }
    assert(probe.status === 429, 'unexpected error after cancellation');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(recovered, 'cancelled exports did not release concurrency slots');
  await expectZip('amazon', expectedAmazon);
  const deleted = await fetch(base + '/api/products/' + id, { method: 'DELETE' });
  assert(deleted.ok, 'export fixture cleanup failed');
  console.log('Platform ZIP export tests passed (explicit platform assets, device union, shared files, original bytes, errors, cancellation).');
}
