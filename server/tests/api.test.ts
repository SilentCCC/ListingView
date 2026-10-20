import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import initSqlJs from 'sql.js';

const serverRoot = path.resolve(process.cwd());
const dataDir = path.join(os.tmpdir(), `listing-view-test-${Date.now()}`);
const port = 4317;
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
const SQL = await initSqlJs({ locateFile: (file) => path.join(serverRoot, 'node_modules', 'sql.js', 'dist', file) });
const legacyDatabase = new SQL.Database();
legacyDatabase.run(`
  CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE, generic_title TEXT NOT NULL DEFAULT '', generic_price REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE platform_content (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, platform TEXT NOT NULL CHECK (platform IN ('amazon', 'tmall')), title TEXT NOT NULL DEFAULT '', price REAL, UNIQUE(product_id, platform));
  CREATE TABLE images (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, scope TEXT NOT NULL CHECK (scope IN ('common', 'amazon', 'tmall')), kind TEXT NOT NULL CHECK (kind IN ('main', 'detail')), original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX idx_images_product_scope_kind_order ON images(product_id, scope, kind, sort_order);
  INSERT INTO products (id, name, sku, generic_title, generic_price) VALUES (1, 'Legacy Product', 'LEGACY-001', 'Legacy title', 20);
  INSERT INTO platform_content (product_id, platform, title, price) VALUES (1, 'amazon', '', NULL);
  INSERT INTO platform_content (product_id, platform, title, price) VALUES (1, 'tmall', '', NULL);
  INSERT INTO images (id, product_id, scope, kind, original_name, stored_name, mime_type, size_bytes, sort_order) VALUES (1, 1, 'amazon', 'detail', 'legacy.png', 'legacy.png', 'image/png', 68, 0);
`);
fs.writeFileSync(path.join(dataDir, 'listing-view.sqlite'), Buffer.from(legacyDatabase.export()));
legacyDatabase.close();
const legacyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(path.join(dataDir, 'uploads', 'legacy.png'), legacyPng);
let visionProviderMode: 'success' | 'malformed' = 'success';
let visionCalls = 0;
let visionReceivedImage = false;
let visionReceivedAuthorization = false;
let visionReceivedModel = '';
const visionProvider = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    visionCalls += 1;
    visionReceivedAuthorization = request.headers.authorization === 'Bearer saved-vision-key';
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    visionReceivedModel = payload.model;
    const content = payload.messages?.[1]?.content;
    visionReceivedImage = Array.isArray(content) && content.some((part: any) => part.type === 'image_url' && String(part.image_url?.url).startsWith('data:image/png;base64,'));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: visionProviderMode === 'success'
      ? JSON.stringify({ name: '识别商品名称', genericTitle: '识别通用标题', amazonTitle: 'Amazon title suggestion', tmallTitle: '天猫标题建议' })
      : 'not a valid structured result' } }] }));
  });
});
await new Promise<void>((resolve, reject) => {
  visionProvider.once('error', reject);
  visionProvider.listen(0, '127.0.0.1', resolve);
});
const providerAddress = visionProvider.address();
if (!providerAddress || typeof providerAddress === 'string') throw new Error('vision test provider failed to bind');
const visionBaseUrl = `http://127.0.0.1:${providerAddress.port}/v1`;
let child: ReturnType<typeof spawn> | null = null;
const base = `http://127.0.0.1:${port}`;
function startApp(withVision = false) {
  child = spawn(process.execPath, [path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: dataDir,
      CLIENT_DIST_DIR: path.join(serverRoot, '..', 'client', 'dist'), CORS_ORIGIN: '*',
      VISION_API_BASE_URL: withVision ? visionBaseUrl : '',
      VISION_API_KEY: withVision ? 'test-vision-key' : '',
      VISION_MODEL: withVision ? 'test-vision-model' : '',
    },
    stdio: 'pipe',
  });
}
async function stopApp() {
  const current = child;
  child = null;
  if (!current || current.exitCode !== null || current.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    current.once('exit', () => { clearTimeout(timer); resolve(); });
    current.kill();
  });
}
async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

try {
  startApp();
  await waitForServer();
  const initialVisionStatus = await fetch(`${base}/api/vision/status`).then((response) => response.json()) as { configured: boolean };
  assert(initialVisionStatus.configured === false, 'vision status should hide an unconfigured provider');
  const list = await fetch(`${base}/api/products`).then((response) => response.json()) as { products: any[] };
  assert(list.products.length >= 1, 'legacy product missing');
  const migratedLegacy = list.products.find((product: any) => product.sku === 'LEGACY-001');
  assert(migratedLegacy?.images[0]?.device === 'all', 'legacy image was not migrated as a shared image');
  assert(migratedLegacy?.effectiveImages.amazon.detailByDevice.desktop[0]?.id === 1, 'legacy Amazon detail image stopped working as a desktop fallback');
  const preservedFile = await fetch(`${base}/uploads/legacy.png`);
  assert(preservedFile.ok && Buffer.compare(Buffer.from(await preservedFile.arrayBuffer()), legacyPng) === 0, 'legacy uploaded file was changed or removed');
  const created = await fetch(`${base}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'API Test Product', sku: `API-${Date.now()}`, genericTitle: '测试标题', genericPrice: 88, platforms: { amazon: { title: 'Amazon title', price: 12 }, tmall: { title: '天猫标题', price: 88 } } }) }).then((response) => response.json()) as { product: any };
  assert(created.product.platforms.amazon.title === 'Amazon title', 'create failed');
  const updated = await fetch(`${base}/api/products/${created.product.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'API Test Product Updated', sku: created.product.sku, genericTitle: 'updated', genericPrice: 99, platforms: { amazon: { title: '', price: null }, tmall: { title: '天猫更新', price: 99 } } }) }).then((response) => response.json()) as { product: any };
  assert(updated.product.name.endsWith('Updated'), 'update failed');
  const form = new FormData();
  form.append('scope', 'common'); form.append('kind', 'main');
  form.append('files', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'test.png');
  const uploaded = await fetch(`${base}/api/products/${created.product.id}/images`, { method: 'POST', body: form }).then((response) => response.json()) as { product: any };
  assert(uploaded.product.images.length === 1, 'upload failed');
  const unconfiguredRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds: [uploaded.product.images[0].id] }),
  });
  assert(unconfiguredRecognition.status === 503, 'recognition should explain when the provider is unconfigured');

  const uploadImage = async (scope: 'common' | 'amazon', device: 'all' | 'desktop' | 'mobile', kind = 'detail') => {
    const imageForm = new FormData();
    imageForm.append('scope', scope); imageForm.append('kind', kind); imageForm.append('device', device);
    imageForm.append('files', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), `${scope}-${device}.png`);
    const response = await fetch(`${base}/api/products/${created.product.id}/images`, { method: 'POST', body: imageForm });
    assert(response.ok, `upload failed for ${scope}/${device}`);
    return response.json() as Promise<{ product: any }>;
  };
  await uploadImage('common', 'all');
  const sharedUpload = await uploadImage('amazon', 'all');
  const sharedImage = sharedUpload.product.images.find((image: any) => image.scope === 'amazon' && image.device === 'all');
  assert(sharedUpload.product.effectiveImages.amazon.detailByDevice.mobile[0].id === sharedImage.id, 'shared Amazon detail fallback failed');
  const desktopUpload = await uploadImage('amazon', 'desktop');
  const mobileUpload = await uploadImage('amazon', 'mobile');
  const desktopImage = desktopUpload.product.images.find((image: any) => image.device === 'desktop');
  const mobileImage = mobileUpload.product.images.find((image: any) => image.device === 'mobile');
  assert(desktopImage && mobileImage && desktopImage.id !== mobileImage.id, 'device-specific uploads were not stored separately');
  assert(mobileUpload.product.effectiveImages.amazon.detailByDevice.desktop[0].id === desktopImage.id, 'desktop preview selected the wrong detail images');
  assert(mobileUpload.product.effectiveImages.amazon.detailByDevice.mobile[0].id === mobileImage.id, 'mobile preview selected the wrong detail images');
  assert(mobileUpload.product.effectiveImages.tmall.detail[0].scope === 'common', 'Tmall detail images should ignore Amazon device-specific assets');

  await stopApp();
  startApp(true);
  await waitForServer();
  const configuredVisionStatus = await fetch(`${base}/api/vision/status`).then((response) => response.json()) as { configured: boolean };
  assert(configuredVisionStatus.configured, 'vision status should report configured provider');
  const savedVisionConfigResponse = await fetch(`${base}/api/vision/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: visionBaseUrl, model: 'saved-vision-model', apiKey: 'saved-vision-key' }),
  });
  const savedVisionConfig = await savedVisionConfigResponse.json() as { configured: boolean; baseUrl: string; model: string; apiKeyConfigured: boolean; source: string; apiKey?: string };
  assert(savedVisionConfigResponse.ok && savedVisionConfig.configured && savedVisionConfig.model === 'saved-vision-model' && savedVisionConfig.apiKeyConfigured && savedVisionConfig.source === 'saved' && !('apiKey' in savedVisionConfig), 'vision config was not saved securely');
  const savedVisionConfigUpdate = await fetch(`${base}/api/vision/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: visionBaseUrl, model: 'saved-vision-model', apiKey: '' }),
  }).then((response) => response.json()) as { apiKeyConfigured: boolean };
  assert(savedVisionConfigUpdate.apiKeyConfigured, 'blank API Key should retain the saved key when settings are updated');
  const invalidVisionConfig = await fetch(`${base}/api/vision/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'file:///etc/passwd', model: 'bad-model' }),
  });
  assert(invalidVisionConfig.status === 400, 'vision config accepted a non-HTTP URL');
  const callCountBeforeInvalid = visionCalls;
  const invalidRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds: [1] }),
  });
  assert(invalidRecognition.status === 404 && visionCalls === callCountBeforeInvalid, 'recognition accepted an image not owned by the product');
  const recognition = await fetch(`${base}/api/products/${created.product.id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds: [uploaded.product.images[0].id] }),
  });
  const recognitionBody = await recognition.json() as { result: any };
  assert(recognition.ok && recognitionBody.result.name === '识别商品名称' && recognitionBody.result.amazonTitle === 'Amazon title suggestion', 'image recognition result was not parsed');
  assert(visionReceivedImage && visionReceivedAuthorization, 'image or API key was not forwarded to the server-side vision provider');
  assert(visionProviderMode === 'success', 'vision provider should receive valid image content');
  assert(visionReceivedModel === 'saved-vision-model', 'configured model was not sent to the provider');
  visionProviderMode = 'malformed';
  const malformedRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds: [uploaded.product.images[0].id] }),
  });
  assert(malformedRecognition.status === 502, 'malformed model response was not rejected');
  await stopApp();
  startApp(false);
  await waitForServer();
  const persistedVisionStatus = await fetch(`${base}/api/vision/status`).then((response) => response.json()) as { configured: boolean; model: string; apiKeyConfigured: boolean; source: string; apiKey?: string };
  assert(persistedVisionStatus.configured && persistedVisionStatus.model === 'saved-vision-model' && persistedVisionStatus.apiKeyConfigured && persistedVisionStatus.source === 'saved' && !('apiKey' in persistedVisionStatus), 'saved vision config did not persist securely across restart');
  visionProviderMode = 'success';
  const recognitionAfterRestart = await fetch(`${base}/api/products/${created.product.id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds: [uploaded.product.images[0].id] }),
  });
  assert(recognitionAfterRestart.ok && visionReceivedAuthorization && visionReceivedModel === 'saved-vision-model', 'saved API key or model was not used after restart');
  const unchanged = await fetch(`${base}/api/products/${created.product.id}`).then((response) => response.json()) as { product: any };
  assert(unchanged.product.name === 'API Test Product Updated', 'recognition unexpectedly saved product data');
  const resetVisionConfig = await fetch(`${base}/api/vision/config`, { method: 'DELETE' }).then((response) => response.json()) as { configured: boolean; source: string };
  assert(!resetVisionConfig.configured && resetVisionConfig.source === 'none', 'reset did not clear saved vision configuration');

  const reorder = await fetch(`${base}/api/products/${created.product.id}/images/order`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageIds: [mobileImage.id], scope: 'amazon', kind: 'detail', device: 'mobile' }),
  });
  assert(reorder.ok, 'device-specific sort failed');
  const invalidReorder = await fetch(`${base}/api/products/${created.product.id}/images/order`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageIds: [mobileImage.id], scope: 'amazon', kind: 'detail', device: 'desktop' }),
  });
  assert(invalidReorder.status === 400, 'sort allowed an image from another device group');

  // Test importing common images into platform-specific slots and 2D grid row/column ordering
  const commonDetailUpload = new FormData();
  commonDetailUpload.append('files', new Blob([legacyPng], { type: 'image/png' }), 'common-detail-1.png');
  commonDetailUpload.append('files', new Blob([legacyPng], { type: 'image/png' }), 'common-detail-2.png');
  commonDetailUpload.append('files', new Blob([legacyPng], { type: 'image/png' }), 'common-detail-3.png');
  commonDetailUpload.append('scope', 'common');
  commonDetailUpload.append('kind', 'detail');
  commonDetailUpload.append('device', 'all');
  const commonDetailRes = await fetch(`${base}/api/products/${created.product.id}/images`, { method: 'POST', body: commonDetailUpload });
  assert(commonDetailRes.status === 201, 'common detail upload failed');

  const importedMainRes = await fetch(`${base}/api/products/${created.product.id}/images/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'amazon', kind: 'main', device: 'all' }),
  });
  assert(importedMainRes.status === 201, 'importing common main images to amazon main failed');
  const importedMainBody = await importedMainRes.json() as { product: any };
  const amazonMains = importedMainBody.product.images.filter((img: any) => img.scope === 'amazon' && img.kind === 'main');
  assert(amazonMains.length === 1 && amazonMains[0].url !== uploaded.product.images[0].url, 'imported main image should clone stored file');

  const importedDesktopRes = await fetch(`${base}/api/products/${created.product.id}/images/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'amazon', kind: 'detail', device: 'desktop' }),
  });
  assert(importedDesktopRes.status === 201, 'importing common detail images to amazon desktop detail failed');
  const importedDesktopBody = await importedDesktopRes.json() as { product: any };
  const desktopDetails = importedDesktopBody.product.images.filter((img: any) => img.scope === 'amazon' && img.kind === 'detail' && img.device === 'desktop');
  assert(desktopDetails.length === 5, 'expected 1 existing + 4 imported desktop detail images');
  const detailRowSizes = new Map<number, number>();
  for (const image of desktopDetails) detailRowSizes.set(image.rowOrder, (detailRowSizes.get(image.rowOrder) || 0) + 1);
  assert(detailRowSizes.size === desktopDetails.length && [...detailRowSizes.values()].every((count) => count === 1), 'desktop detail images should be imported one per row in vertical order');

  const gridOrderRes = await fetch(`${base}/api/products/${created.product.id}/images/order`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: 'amazon',
      kind: 'detail',
      device: 'desktop',
      rows: [
        [desktopDetails[1].id, desktopDetails[2].id, desktopDetails[3].id],
        [desktopDetails[0].id, desktopDetails[4].id],
      ],
    }),
  });
  assert(gridOrderRes.ok, '2D grid row/col reorder failed');
  const gridOrderedBody = await gridOrderRes.json() as { product: any };
  const reorderedDesktop = gridOrderedBody.product.effectiveImages.amazon.detailByDevice.desktop;
  assert(
    reorderedDesktop[0].id === desktopDetails[1].id && reorderedDesktop[0].rowOrder === 0 && reorderedDesktop[0].colOrder === 0 &&
    reorderedDesktop[2].id === desktopDetails[3].id && reorderedDesktop[2].rowOrder === 0 && reorderedDesktop[2].colOrder === 2 &&
    reorderedDesktop[3].id === desktopDetails[0].id && reorderedDesktop[3].rowOrder === 1 && reorderedDesktop[3].colOrder === 0 &&
    reorderedDesktop[4].id === desktopDetails[4].id && reorderedDesktop[4].rowOrder === 1 && reorderedDesktop[4].colOrder === 1,
    '2D grid rowOrder and colOrder were not persisted accurately'
  );
  await fetch(`${base}/api/products/${created.product.id}`, { method: 'DELETE' });
  console.log('API integration test passed: legacy database migration, file preservation, CRUD, image fallback, device-specific upload and preview, isolated sorting, vision configuration, image ownership, recognition, malformed provider response and delete');
} finally {
  await stopApp();
  await new Promise<void>((resolve) => visionProvider.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
