import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import initSqlJs from 'sql.js';
import { testImageExport } from './image-export.test.ts';

const serverRoot = path.resolve(process.cwd());
const dataDir = path.join(os.tmpdir(), `listing-view-test-${Date.now()}`);
const port = Number(process.env.TEST_PORT || 4317);
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
legacyDatabase.run(`
  INSERT INTO products (id, name, sku) VALUES (2, 'Legacy duplicate images', 'DEDUP-LEGACY');
  INSERT INTO platform_content (product_id, platform) VALUES (2, 'amazon'), (2, 'tmall');
  INSERT INTO images (id, product_id, scope, kind, original_name, stored_name, mime_type, size_bytes, sort_order) VALUES
    (2, 2, 'common', 'main', 'same.png', 'duplicate-common.png', 'image/png', 68, 0),
    (3, 2, 'amazon', 'main', 'different-name.png', 'duplicate-amazon.png', 'image/png', 68, 0),
    (4, 2, 'tmall', 'main', 'third-name.png', 'duplicate-tmall.png', 'image/png', 68, 0),
    (5, 2, 'common', 'detail', 'same.png', 'duplicate-detail.png', 'image/png', 68, 0);
`);
fs.writeFileSync(path.join(dataDir, 'listing-view.sqlite'), Buffer.from(legacyDatabase.export()));
legacyDatabase.close();
const legacyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(path.join(dataDir, 'uploads', 'legacy.png'), legacyPng);
for (const filename of ['duplicate-common.png', 'duplicate-amazon.png', 'duplicate-tmall.png', 'duplicate-detail.png']) fs.writeFileSync(path.join(dataDir, 'uploads', filename), legacyPng);
let visionProviderMode: 'success' | 'malformed' | 'truncated' | 'error-json' | 'missing-choices' | 'http-error' = 'success';
let visionCalls = 0;
let visionSentMaxTokens = false;
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
    visionSentMaxTokens = Object.hasOwn(payload, 'max_tokens');
    const content = payload.messages?.[1]?.content;
    visionReceivedImage = Array.isArray(content) && content.some((part: any) => part.type === 'image_url' && String(part.image_url?.url).startsWith('data:image/png;base64,'));
    const isSpecRecognition = Array.isArray(content) && content.some((part: any) => part.type === 'text' && String(part.text).includes('商品参数'));
    response.writeHead(visionProviderMode === 'http-error' ? 429 : 200, { 'Content-Type': 'application/json' });
    if (visionProviderMode === 'error-json') {
      response.end(JSON.stringify({ error: { message: 'quota exceeded: daily limit reached' } }));
      return;
    }
    if (visionProviderMode === 'missing-choices') {
      response.end(JSON.stringify({ id: 'response-without-choices', provider_message: 'model output omitted' }));
      return;
    }
    if (visionProviderMode === 'http-error') {
      response.end(JSON.stringify({ error: { message: 'upstream overloaded' } }));
      return;
    }
    response.end(JSON.stringify({ choices: [{ finish_reason: visionProviderMode === 'truncated' ? 'length' : 'stop', message: { content: visionProviderMode === 'truncated'
      ? ''
      : visionProviderMode === 'success'
      ? JSON.stringify(isSpecRecognition
        ? { values: { mainFabric: '涤纶', capacity: '20L' }, other: [] }
        : { name: '识别商品名称', genericTitle: '识别通用标题', amazonTitle: 'Amazon title suggestion', tmallTitle: '天猫标题建议' })
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
function startApp(withVision = false, adminPassword = '') {
  child = spawn(process.execPath, [...(process.env.TEST_BUILT_SERVER === '1' ? ['dist/index.js'] : [path.join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'])], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: dataDir,
      CLIENT_DIST_DIR: path.join(serverRoot, '..', 'client', 'dist'), CORS_ORIGIN: '*',
      VISION_API_BASE_URL: withVision ? visionBaseUrl : '',
      VISION_API_KEY: withVision ? 'test-vision-key' : '',
      VISION_MODEL: withVision ? 'test-vision-model' : '',
      ADMIN_PASSWORD: adminPassword,
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
  await testImageExport(base, dataDir);
  if (process.env.TEST_BUILT_SERVER === '1') {
    const html = await fetch(base).then((r) => r.text());
    const script = html.match(/src="([^"]+\.js)"/);
    assert(html.includes('<div id="root">') && script && (await fetch(`${base}${script[1]}`)).ok, 'production frontend and built assets must be served');
  }
  const initialVisionStatus = await fetch(`${base}/api/vision/status`).then((response) => response.json()) as { configured: boolean };
  assert(initialVisionStatus.configured === false, 'vision status should hide an unconfigured provider');
  const list = await fetch(`${base}/api/products`).then((response) => response.json()) as { products: any[] };
  assert(list.products.length >= 1, 'legacy product missing');
  const migratedLegacy = list.products.find((product: any) => product.sku === 'LEGACY-001');
  assert(migratedLegacy?.images[0]?.device === 'desktop', 'legacy Amazon detail image was not migrated to desktop device');
  assert(migratedLegacy?.effectiveImages.amazon.detailByDevice.desktop[0]?.id === 1, 'legacy Amazon detail image stopped working as a desktop image');
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
  assert(uploaded.product.images[0].storedName.startsWith(`${created.product.sku}/主图/`), 'new uploads must use the SKU and kind subdirectories');
  const unconfiguredRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds: [uploaded.product.images[0].id] }),
  });
  assert(unconfiguredRecognition.status === 503, 'recognition should explain when the provider is unconfigured');

  let uploadSequence = 0;
  const uploadImage = async (scope: 'common' | 'amazon' | 'tmall', device: 'all' | 'desktop' | 'mobile', kind = 'detail') => {
    const imageForm = new FormData();
    imageForm.append('scope', scope); imageForm.append('kind', kind); imageForm.append('device', device);
    imageForm.append('files', new Blob([Buffer.concat([legacyPng, Buffer.from(`image-${++uploadSequence}`)])], { type: 'image/png' }), `${scope}-${device}.png`);
    const response = await fetch(`${base}/api/products/${created.product.id}/images`, { method: 'POST', body: imageForm });
    assert(response.ok, `upload failed for ${scope}/${device}`);
    return response.json() as Promise<{ product: any }>;
  };
  const commonOnlyUpload = await uploadImage('common', 'all');
  assert(
    commonOnlyUpload.product.effectiveImages.amazon.main.length === 0 &&
    commonOnlyUpload.product.effectiveImages.amazon.detailByDevice.desktop.length === 0 &&
    commonOnlyUpload.product.effectiveImages.tmall.main.length === 0 &&
    commonOnlyUpload.product.effectiveImages.tmall.detail.length === 0,
    'common images must not appear in effective preview images before being imported'
  );
  const rejectedAmazonAllForm = new FormData();
  rejectedAmazonAllForm.append('scope', 'amazon'); rejectedAmazonAllForm.append('kind', 'detail'); rejectedAmazonAllForm.append('device', 'all');
  rejectedAmazonAllForm.append('files', new Blob([legacyPng], { type: 'image/png' }), 'invalid.png');
  assert((await fetch(`${base}/api/products/${created.product.id}/images`, { method: 'POST', body: rejectedAmazonAllForm })).status === 400, 'amazon detail device=all should be rejected');
  const rejectedAmazonSkuForm = new FormData();
  rejectedAmazonSkuForm.append('scope', 'amazon'); rejectedAmazonSkuForm.append('kind', 'sku'); rejectedAmazonSkuForm.append('device', 'all');
  rejectedAmazonSkuForm.append('files', new Blob([legacyPng], { type: 'image/png' }), 'amazon-sku.png');
  assert((await fetch(`${base}/api/products/${created.product.id}/images`, { method: 'POST', body: rejectedAmazonSkuForm })).status === 400, 'non-tmall sku upload should be rejected');
  await uploadImage('tmall', 'all', 'sku');
  await uploadImage('tmall', 'all');
  const desktopUpload = await uploadImage('amazon', 'desktop');
  const mobileUpload = await uploadImage('amazon', 'mobile');
  const desktopImage = desktopUpload.product.images.find((image: any) => image.device === 'desktop');
  const mobileImage = mobileUpload.product.images.find((image: any) => image.device === 'mobile');
  assert(desktopImage && mobileImage && desktopImage.id !== mobileImage.id, 'device-specific uploads were not stored separately');
  assert(mobileUpload.product.effectiveImages.amazon.detailByDevice.desktop[0].id === desktopImage.id, 'desktop preview selected the wrong detail images');
  assert(mobileUpload.product.effectiveImages.amazon.detailByDevice.mobile[0].id === mobileImage.id, 'mobile preview selected the wrong detail images');
  assert(mobileUpload.product.effectiveImages.tmall.sku.length === 1 && mobileUpload.product.effectiveImages.tmall.sku[0].kind === 'sku', 'Tmall sku images should be included in effectiveImages.tmall.sku');
  assert(mobileUpload.product.effectiveImages.tmall.detail[0].scope === 'tmall', 'Tmall detail images should use Tmall platform assets only');

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
  assert(!visionSentMaxTokens, 'title recognition should not set a max_tokens limit');
  assert(visionProviderMode === 'success', 'vision provider should receive valid image content');
  assert(visionReceivedModel === 'saved-vision-model', 'configured model was not sent to the provider');
  const specRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize-specs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: uploaded.product.images[0].id, category: 'bag' }),
  });
  const specRecognitionBody = await specRecognition.json() as { result: { values: Record<string, string>; other: any[] } };
  assert(specRecognition.ok && specRecognitionBody.result.values.mainFabric === '涤纶' && specRecognitionBody.result.values.capacity === '20L', 'product spec recognition result was not parsed');
  assert(!visionSentMaxTokens, 'parameter recognition should not set a max_tokens limit');
  const invalidSpecRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize-specs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: 1, category: 'bag' }),
  });
  assert(invalidSpecRecognition.status === 404, 'parameter recognition accepted an image not owned by the product');
  visionProviderMode = 'malformed';
  const malformedSpecRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize-specs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: uploaded.product.images[0].id, category: 'bag' }),
  });
  const malformedSpecBody = await malformedSpecRecognition.json() as { error: string; diagnostic?: string; diagnosticTruncated?: boolean };
  assert(malformedSpecRecognition.status === 502 && malformedSpecBody.error === '参数识别结果无法解析，请重试', 'malformed parameter recognition should preserve its user-facing error');
  assert(malformedSpecBody.diagnostic === 'not a valid structured result' && malformedSpecBody.diagnosticTruncated === false, 'malformed parameter recognition should expose the model text for diagnosis');
  visionProviderMode = 'truncated';
  const visionCallsBeforeTruncatedResponse = visionCalls;
  const truncatedSpecRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize-specs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: uploaded.product.images[0].id, category: 'bag' }),
  });
  const truncatedSpecBody = await truncatedSpecRecognition.json() as { diagnostic?: string };
  assert(truncatedSpecRecognition.status === 502 && truncatedSpecBody.diagnostic?.includes('"finish_reason":"length"') && truncatedSpecBody.diagnostic.includes('"content":""'), 'empty output caused by a model output limit should preserve the full provider response');
  assert(visionCalls === visionCallsBeforeTruncatedResponse + 1 && !visionSentMaxTokens, 'truncated parameter recognition should not retry with an application token limit');
  for (const [mode, expected] of [
    ['error-json', 'quota exceeded: daily limit reached'],
    ['missing-choices', 'model output omitted'],
    ['http-error', 'upstream overloaded'],
  ] as const) {
    visionProviderMode = mode;
    const response = await fetch(`${base}/api/products/${created.product.id}/recognize-specs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: uploaded.product.images[0].id, category: 'bag' }),
    });
    const body = await response.json() as { error: string; diagnostic?: string };
    assert(response.status === 502 && body.diagnostic?.includes(expected), `parameter recognition should expose provider details for ${mode}`);
  }
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
  commonDetailUpload.append('files', new Blob([Buffer.concat([legacyPng, Buffer.from('common-detail-1')])], { type: 'image/png' }), 'common-detail-1.png');
  commonDetailUpload.append('files', new Blob([Buffer.concat([legacyPng, Buffer.from('common-detail-2')])], { type: 'image/png' }), 'common-detail-2.png');
  commonDetailUpload.append('files', new Blob([Buffer.concat([legacyPng, Buffer.from('common-detail-3')])], { type: 'image/png' }), 'common-detail-3.png');
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
  assert(amazonMains.length === 1 && amazonMains[0].url === uploaded.product.images[0].url, 'imported main image should reference the common stored file');

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
  const saveProduct = (id: number, sku: string) => fetch(`${base}/api/products/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'API Test Product Updated', sku, genericTitle: 'updated', genericPrice: 99, platforms: { amazon: { title: '', price: null }, tmall: { title: '天猫更新', price: 99 } } }),
  });
  const readProduct = async (id: number) => (await fetch(`${base}/api/products/${id}`).then((r) => r.json()) as { product: any }).product;
  const readBytes = async (image: any) => {
    const response = await fetch(`${base}${image.url}`);
    assert(response.ok, `image is not served: ${image.url}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const beforeSave = await readProduct(created.product.id);
  const originalBytes = new Map<number, Buffer>();
  for (const image of beforeSave.images) originalBytes.set(image.id, await readBytes(image));
  const assertPreserved = async (product: any) => {
    assert(product.images.length === originalBytes.size, 'saving must preserve every image reference');
    for (const image of product.images) {
      assert((await readBytes(image)).equals(originalBytes.get(image.id)!), `image content changed for ID ${image.id}`);
      const original = beforeSave.images.find((item: any) => item.id === image.id);
      assert(image.scope === original.scope && image.device === original.device && image.rowOrder === original.rowOrder && image.colOrder === original.colOrder, 'saving changed platform layout');
    }
  };
  const renamed = await saveProduct(created.product.id, '5188');
  assert(renamed.ok, `saving should rename image files: ${await renamed.text()}`);
  let savedProduct = await readProduct(created.product.id);
  await assertPreserved(savedProduct);
  const skuDirectory = path.join(dataDir, 'uploads', '5188');
  assert(fs.readdirSync(skuDirectory).sort().join(',') === ['SKU', '主图', '详情图'].sort().join(','), 'SKU must contain only image kind directories');
  const mainFiles = fs.readdirSync(path.join(skuDirectory, '主图'));
  const skuFiles = fs.readdirSync(path.join(skuDirectory, 'SKU'));
  const detailFiles = fs.readdirSync(path.join(skuDirectory, '详情图'));
  assert(mainFiles.length === 1 && mainFiles.includes('5188-主图-01.png'), 'imported main must share one physical file');
  assert(skuFiles.length === 1 && skuFiles.includes('5188-天猫-sku-01.png'), 'tmall sku image must be renamed in SKU directory');
  for (const name of ['5188-详情图-01.png', '5188-天猫-详情图-01.png', '5188-亚马逊-电脑-详情图-01.png', '5188-亚马逊-手机-详情图-01.png']) {
    assert(detailFiles.includes(name), `missing classified image: ${name}`);
  }
  assert(mainFiles.length + skuFiles.length + detailFiles.length === new Set(savedProduct.images.map((image: any) => image.storedName)).size, 'imports duplicated physical files');
  assert(!fs.existsSync(path.join(dataDir, 'uploads', created.product.sku)), 'old empty SKU directory was not removed');

  // Swapping sequential filenames must preserve ID -> content and shared references.
  const commonDetails = savedProduct.images.filter((image: any) => image.scope === 'common' && image.kind === 'detail');
  const urlsBeforeSwap = new Map(savedProduct.images.map((image: any) => [image.storedName, image.url]));
  const reverseIds = commonDetails.map((image: any) => image.id).reverse();
  const reverseResponse = await fetch(`${base}/api/products/${created.product.id}/images/order`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'common', kind: 'detail', device: 'all', imageIds: reverseIds }),
  });
  assert(reverseResponse.ok, 'common detail reorder failed');
  assert((await saveProduct(created.product.id, '5188')).ok, 'save after filename swap failed');
  savedProduct = await readProduct(created.product.id);
  for (const image of savedProduct.images) assert((await readBytes(image)).equals(originalBytes.get(image.id)!), 'swapping filenames mixed image contents');
  const firstAfterSwap = savedProduct.images.find((image: any) => image.id === reverseIds[0]);
  assert(firstAfterSwap.storedName === '5188/详情图/5188-详情图-01.png', 'filenames did not follow new order');
  assert(firstAfterSwap.url !== urlsBeforeSwap.get(firstAfterSwap.storedName), 'reused filenames must not reuse the previous image cache identity');
  assert(savedProduct.images.filter((image: any) => image.device === 'desktop').every((image: any) => {
    const original = beforeSave.images.find((item: any) => item.id === image.id);
    return image.rowOrder === original.rowOrder && image.colOrder === original.colOrder;
  }), 'common reorder affected the platform grid');

  // An unknown destination file must survive a rejected save.
  const occupied = path.join(dataDir, 'uploads', 'blocked', '主图', 'blocked-主图-01.png');
  fs.mkdirSync(path.dirname(occupied), { recursive: true });
  fs.writeFileSync(occupied, 'do not overwrite');
  assert((await saveProduct(created.product.id, 'blocked')).status === 409, 'existing target file must reject save');
  assert(fs.readFileSync(occupied, 'utf8') === 'do not overwrite', 'unknown destination file was overwritten');
  assert((await readProduct(created.product.id)).sku === '5188', 'failed save changed SKU');
  fs.unlinkSync(occupied); fs.rmdirSync(path.dirname(occupied)); fs.rmdirSync(path.dirname(path.dirname(occupied)));

  // Force a failure after staging files: the new detail directory is a file.
  const blockedParent = path.join(dataDir, 'uploads', 'rollback');
  fs.mkdirSync(blockedParent);
  fs.writeFileSync(path.join(blockedParent, '详情图'), 'blocked directory');
  assert(!(await saveProduct(created.product.id, 'rollback')).ok, 'invalid destination directory should reject save');
  const rolledBack = await readProduct(created.product.id);
  assert(rolledBack.sku === '5188', 'failed move changed product metadata');
  for (const image of rolledBack.images) assert((await readBytes(image)).equals(originalBytes.get(image.id)!), 'failed move did not restore source files');
  assert(!fs.readdirSync(path.join(dataDir, 'uploads')).some((name) => name.startsWith('.__listingview_rename_')), 'rollback left staged files');
  fs.unlinkSync(path.join(blockedParent, '详情图')); fs.rmdirSync(blockedParent);

  const missingImage = savedProduct.images.find((image: any) => image.device === 'mobile');
  const missingPath = path.join(dataDir, 'uploads', ...missingImage.storedName.split('/'));
  const outsideBackup = path.join(dataDir, 'missing-image-backup.png');
  fs.renameSync(missingPath, outsideBackup);
  assert((await saveProduct(created.product.id, 'missing-source')).status === 404, 'missing source file must reject save');
  fs.renameSync(outsideBackup, missingPath);
  for (const image of (await readProduct(created.product.id)).images) assert((await readBytes(image)).equals(originalBytes.get(image.id)!), 'mid-staging failure lost an original image');
  assert(!fs.existsSync(path.join(dataDir, 'uploads', 'missing-source')), 'failed staging should not create a new SKU directory');

  // Block the final SQLite replacement and verify both files and in-memory data roll back.
  const databasePath = path.join(dataDir, 'listing-view.sqlite');
  const databaseBackup = path.join(dataDir, 'database-backup.sqlite');
  fs.renameSync(databasePath, databaseBackup);
  fs.mkdirSync(databasePath);
  try {
    assert(!(await saveProduct(created.product.id, 'database-failure')).ok, 'failed database persistence must reject save');
    const afterDatabaseFailure = await readProduct(created.product.id);
    assert(afterDatabaseFailure.sku === '5188', 'failed database persistence changed SKU in memory');
    for (const image of afterDatabaseFailure.images) assert((await readBytes(image)).equals(originalBytes.get(image.id)!), 'failed persistence changed image references or content');
    assert(!fs.existsSync(path.join(dataDir, 'uploads', 'database-failure')), 'failed persistence left a moved SKU directory');
  } finally {
    fs.rmdirSync(databasePath); fs.renameSync(databaseBackup, databasePath);
  }

  assert((await saveProduct(created.product.id, 'Sku-Renamed')).ok, 'changing SKU should move all files');
  assert(!fs.existsSync(skuDirectory), 'previous SKU directory should be empty and removed');
  assert((await saveProduct(created.product.id, 'sku-renamed')).ok, 'case-only SKU rename should work on both platforms');
  savedProduct = await readProduct(created.product.id);
  for (const image of savedProduct.images) {
    assert(image.storedName.startsWith('sku-renamed/'), 'SKU directory not updated');
    assert((await readBytes(image)).equals(originalBytes.get(image.id)!), 'SKU rename changed content');
  }
  const createSku = (sku: string) => fetch(`${base}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Path test', sku }) });
  assert((await createSku('SKU-RENAMED')).status === 409, 'case-insensitive directory conflict must be rejected');
  assert((await createSku('..')).status === 400, 'dot directory must be rejected');
  assert((await createSku('a'.repeat(200))).status === 400, 'overlong directory component must be rejected');
  for (const [sku, expected] of [['A/B', 'A-B'], ['CON', '_CON'], ['中文编号', '中文编号'], ['.hidden', '_.hidden']]) {
    const response = await createSku(sku);
    assert(response.ok, `safe SKU normalization failed: ${sku}`);
    const { product } = await response.json() as { product: any };
    const testForm = new FormData(); testForm.append('files', new Blob([legacyPng], { type: 'image/png' }), 'original.png');
    assert((await fetch(`${base}/api/products/${product.id}/images`, { method: 'POST', body: testForm })).ok, 'upload for normalized SKU failed');
    assert((await saveProduct(product.id, sku)).ok, 'normalized SKU save failed');
    const normalized = await readProduct(product.id);
    assert(normalized.images[0].storedName === `${expected}/主图/${expected}-主图-01.png`, 'unsafe or Unicode directory normalization mismatch');
    assert((await readBytes(normalized.images[0])).equals(legacyPng), 'normalized path is unreadable');
    if (sku === 'A/B') assert((await createSku('A-B')).status === 409, 'sanitized directory collision must be rejected');
    await fetch(`${base}/api/products/${product.id}`, { method: 'DELETE' });
    assert(!fs.existsSync(path.join(dataDir, 'uploads', expected)), 'deleting product did not clean empty directories');
  }

  // Separately uploaded identical bytes reuse storage; filenames and positions do not matter.
  const dedupCreate = await createSku('DEDUP-NEW');
  const dedupId = (await dedupCreate.json() as { product: any }).product.id;
  const uploadFor = async (productId: number, scope: string, kind: string, contents: Buffer[], filename = 'same.png') => {
    const imageForm = new FormData(); imageForm.append('scope', scope); imageForm.append('kind', kind);
    for (const bytes of contents) imageForm.append('files', new Blob([bytes], { type: 'image/png' }), filename);
    return fetch(`${base}/api/products/${productId}/images`, { method: 'POST', body: imageForm });
  };
  assert((await uploadFor(dedupId, 'amazon', 'main', [legacyPng])).ok, 'platform-first upload failed');
  assert((await saveProduct(dedupId, 'DEDUP-NEW')).ok, 'platform-first save failed');
  assert((await uploadFor(dedupId, 'common', 'main', [legacyPng], 'renamed-identical.png')).ok, 'common duplicate upload failed');
  let dedupProduct = await readProduct(dedupId);
  assert(dedupProduct.images.length === 2 && new Set(dedupProduct.images.map((image: any) => image.storedName)).size === 1, 're-uploading identical bytes should share one file immediately');
  assert((await saveProduct(dedupId, 'DEDUP-NEW')).ok, 'common naming ownership failed');
  dedupProduct = await readProduct(dedupId);
  assert(dedupProduct.images.every((image: any) => image.storedName === 'DEDUP-NEW/主图/DEDUP-NEW-主图-01.png'), 'common reference should own the rule filename');
  const dedupMainDir = path.join(dataDir, 'uploads', 'DEDUP-NEW', '主图');
  assert(fs.readdirSync(dedupMainDir).length === 1, 'platform duplicate file remained after saving');

  // A batch that reuses a shared file then fails validation must leave it intact.
  const failedBatch = await uploadFor(dedupId, 'tmall', 'main', [legacyPng, Buffer.from('not a png')]);
  assert(failedBatch.status === 415, 'dedup must not bypass validation');
  assert((await readProduct(dedupId)).images.length === 2 && fs.readdirSync(dedupMainDir).length === 1, 'failed upload removed shared storage or retained usage records');
  const differentBytes = Buffer.concat([legacyPng, Buffer.from('different content')]);
  assert((await uploadFor(dedupId, 'amazon', 'main', [differentBytes], 'same.png')).ok, 'different image with same filename should upload');
  assert((await uploadFor(dedupId, 'tmall', 'main', [legacyPng, legacyPng])).ok, 'duplicates within one batch should share storage');
  assert((await saveProduct(dedupId, 'DEDUP-NEW')).ok, 'saving distinct and duplicate materials failed');
  dedupProduct = await readProduct(dedupId);
  assert(dedupProduct.images.length === 5 && fs.readdirSync(dedupMainDir).length === 2, 'usage rows must remain independent while identical bytes share files');
  assert(fs.existsSync(path.join(dedupMainDir, 'DEDUP-NEW-亚马逊-主图-01.png')), 'different platform content must retain its own rule filename');
  const commonDedupImage = dedupProduct.images.find((image: any) => image.scope === 'common');
  const amazonDedupImage = dedupProduct.images.find((image: any) => image.scope === 'amazon' && image.storedName === commonDedupImage.storedName);
  assert((await fetch(`${base}/api/images/${commonDedupImage.id}`, { method: 'DELETE' })).ok, 'deleting shared common usage failed');
  assert((await readBytes(amazonDedupImage)).equals(legacyPng), 'deleting shared common usage removed platform image');
  assert((await saveProduct(dedupId, 'DEDUP-NEW')).ok, 'platform-only reference should remain savable');
  await fetch(`${base}/api/products/${dedupId}`, { method: 'DELETE' });
  assert(!fs.existsSync(path.dirname(dedupMainDir)), 'deleting all usages should clean shared and separate files');

  // Existing duplicates merge on Save; a persistence failure restores each original separately.
  const duplicateLegacyBefore = await readProduct(2);
  const legacyDatabaseBackup = path.join(dataDir, 'dedup-database-backup.sqlite');
  fs.renameSync(databasePath, legacyDatabaseBackup); fs.mkdirSync(databasePath);
  try {
    assert(!(await saveProduct(2, 'DEDUP-LEGACY')).ok, 'merge must reject failed persistence');
    const afterFailedMerge = await readProduct(2);
    assert(afterFailedMerge.images.every((image: any) => image.storedName === duplicateLegacyBefore.images.find((original: any) => original.id === image.id).storedName), 'failed merge lost original references');
    for (const image of afterFailedMerge.images) assert((await readBytes(image)).equals(legacyPng), 'failed merge lost duplicate source files');
    assert(!fs.existsSync(path.join(dataDir, 'uploads', 'DEDUP-LEGACY')), 'failed merge retained target directory');
  } finally { fs.rmdirSync(databasePath); fs.renameSync(legacyDatabaseBackup, databasePath); }
  assert((await saveProduct(2, 'DEDUP-LEGACY')).ok, 'legacy duplicate merge failed');
  let mergedLegacy = await readProduct(2);
  const mergedMains = mergedLegacy.images.filter((image: any) => image.kind === 'main');
  assert(mergedMains.length === 3 && mergedMains.every((image: any) => image.storedName === 'DEDUP-LEGACY/主图/DEDUP-LEGACY-主图-01.png'), 'legacy platform and common duplicates should use the common filename');
  assert(fs.readdirSync(path.join(dataDir, 'uploads', 'DEDUP-LEGACY', '主图')).length === 1, 'legacy duplicate physical files remain');
  assert(mergedLegacy.images.find((image: any) => image.kind === 'detail').storedName === 'DEDUP-LEGACY/详情图/DEDUP-LEGACY-详情图-01.png', 'main and detail classifications must remain separate');
  for (const filename of ['duplicate-common.png', 'duplicate-amazon.png', 'duplicate-tmall.png', 'duplicate-detail.png']) assert(!fs.existsSync(path.join(dataDir, 'uploads', filename)), 'legacy duplicate source was not removed after success');
  assert((await saveProduct(2, 'DEDUP-LEGACY')).ok, 'repeated saves should keep the same shared file');
  await stopApp(); startApp(true); await waitForServer();
  mergedLegacy = await readProduct(2);
  for (const image of mergedLegacy.images) assert((await readBytes(image)).equals(legacyPng), 'merged file did not survive restart');
  await fetch(`${base}/api/products/2`, { method: 'DELETE' });
  assert(!fs.existsSync(path.join(dataDir, 'uploads', 'DEDUP-LEGACY')), 'merged legacy product files were not cleaned');
  assert(!fs.readdirSync(path.join(dataDir, 'uploads')).some((name) => name.startsWith('.__listingview_rename_')), 'dedup left staged duplicate files');

  // Legacy flat files remain readable until saving, then move into the new layout.
  assert((await saveProduct(migratedLegacy.id, migratedLegacy.sku)).ok, 'legacy flat-file migration on save failed');
  const savedLegacy = await readProduct(migratedLegacy.id);
  assert(savedLegacy.images[0].storedName === 'LEGACY-001/详情图/LEGACY-001-亚马逊-电脑-详情图-01.png', 'legacy image was not classified');
  assert((await readBytes(savedLegacy.images[0])).equals(legacyPng) && !fs.existsSync(path.join(dataDir, 'uploads', 'legacy.png')), 'legacy image content not preserved');

  await stopApp(); startApp(true); await waitForServer();
  savedProduct = await readProduct(created.product.id);
  for (const image of savedProduct.images) assert((await readBytes(image)).equals(originalBytes.get(image.id)!), 'nested path did not survive restart');
  const commonMainId = uploaded.product.images.find((image: any) => image.scope === 'common' && image.kind === 'main').id;
  visionProviderMode = 'success';
  const nestedRecognition = await fetch(`${base}/api/products/${created.product.id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds: [commonMainId] }),
  });
  assert(nestedRecognition.ok, 'recognition cannot read the nested image path');
  const commonMain = savedProduct.images.find((image: any) => image.id === commonMainId);
  assert((await fetch(`${base}/api/images/${commonMainId}`, { method: 'DELETE' })).ok, 'deleting common reference failed');
  assert((await readBytes(commonMain)).equals(originalBytes.get(commonMainId)!), 'deleting one shared reference removed the file');
  await fetch(`${base}/api/products/${created.product.id}`, { method: 'DELETE' });
  assert(!fs.existsSync(path.join(dataDir, 'uploads', 'sku-renamed')), 'final reference deletion should remove SKU directory');
  assert(!fs.readdirSync(path.join(dataDir, 'uploads')).some((name) => name.startsWith('.__listingview_rename_')), 'save left staged files');
  // Verify public preview + download vs password-protected editing when ADMIN_PASSWORD is set.
  await stopApp();
  startApp(true, 'secret-admin-pass');
  await waitForServer();
  const visitorAuth = await fetch(`${base}/api/auth/status`).then((r) => r.json()) as { authenticated: boolean; passwordRequired: boolean };
  assert(!visitorAuth.authenticated && visitorAuth.passwordRequired, 'visitor should not be authenticated when ADMIN_PASSWORD is set');
  const visitorList = await fetch(`${base}/api/products`).then((r) => r.json()) as { products: any[] };
  assert(visitorList.products.some((p: any) => p.id === migratedLegacy.id), 'visitor should still be able to view products');
  const visitorDetail = await fetch(`${base}/api/products/${migratedLegacy.id}`);
  assert(visitorDetail.ok, 'visitor should be able to view product detail');
  const visitorExport = await fetch(`${base}/api/products/${migratedLegacy.id}/export?platform=amazon`);
  assert(visitorExport.ok && (await visitorExport.arrayBuffer()).byteLength > 0, 'visitor should be able to download platform images');
  assert((await fetch(`${base}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Blocked', sku: 'BLOCKED-1', platforms: { amazon: {}, tmall: {} } }) })).status === 401, 'visitor create must be rejected with 401');
  assert((await fetch(`${base}/api/products/${migratedLegacy.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Blocked', sku: migratedLegacy.sku, platforms: { amazon: {}, tmall: {} } }) })).status === 401, 'visitor update must be rejected with 401');
  assert((await fetch(`${base}/api/products/${migratedLegacy.id}`, { method: 'DELETE' })).status === 401, 'visitor delete must be rejected with 401');
  assert((await fetch(`${base}/api/vision/status`)).status === 401, 'visitor vision status must be rejected with 401');
  assert((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) })).status === 401, 'wrong admin password must return 401');
  const loginRes = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-admin-pass' }) });
  assert(loginRes.ok, 'correct admin password should succeed');
  const loginBody = await loginRes.json() as { status: { authenticated: boolean; passwordRequired: boolean }; token: string };
  assert(loginBody.status.authenticated && loginBody.token, 'login must return authenticated status and token');
  const authedStatus = await fetch(`${base}/api/auth/status`, { headers: { Authorization: `Bearer ${loginBody.token}` } }).then((r) => r.json()) as { authenticated: boolean };
  assert(authedStatus.authenticated, 'valid token should authenticate status check');
  const authedUpdate = await fetch(`${base}/api/products/${migratedLegacy.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` },
    body: JSON.stringify({
      name: 'Authed Legacy Product',
      sku: migratedLegacy.sku,
      category: 'tripod',
      specs: {
        bag: { mainFabric: '牛津布', capacity: '20L', other: '附带防雨罩' },
        tripod: { material: '碳纤维', loadCapacity: '8 kg', weight: '1.2 kg', sections: '4 节', other: '含云台快装板' },
        other: [{ label: '最大尺寸', value: '45 cm' }, { label: '', value: '   ' }],
      },
      genericTitle: 'Legacy title',
      genericPrice: 20,
      platforms: { amazon: { title: '', price: null }, tmall: { title: '', price: null } },
    }),
  });
  assert(authedUpdate.ok, 'authenticated admin should be able to save product');
  const updatedProductBody = await authedUpdate.json() as { product: any };
  assert(updatedProductBody.product.category === 'tripod', 'product category should persist as tripod');
  assert(updatedProductBody.product.specs?.tripod?.material === '碳纤维' && updatedProductBody.product.specs?.tripod?.loadCapacity === '8 kg' && updatedProductBody.product.specs?.tripod?.other === '含云台快装板', 'tripod preset specs including other should persist');
  assert(updatedProductBody.product.specs?.bag === undefined && updatedProductBody.product.specs?.other === undefined, 'only the selected category specs should be stored on a product');
  const otherCategoryUpdate = await fetch(`${base}/api/products/${migratedLegacy.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` },
    body: JSON.stringify({
      name: 'Authed Legacy Product',
      sku: migratedLegacy.sku,
      category: 'other',
      specs: {
        tripod: { material: '碳纤维' },
        other: [{ label: '最大尺寸', value: '45 cm' }, { label: '', value: '   ' }],
      },
      genericTitle: 'Legacy title',
      genericPrice: 20,
      platforms: { amazon: { title: '', price: null }, tmall: { title: '', price: null } },
    }),
  });
  assert(otherCategoryUpdate.ok, 'switching product category to other should succeed');
  const otherCategoryBody = await otherCategoryUpdate.json() as { product: any };
  assert(otherCategoryBody.product.category === 'other', 'product category should switch to other');
  assert(otherCategoryBody.product.specs?.tripod === undefined && Array.isArray(otherCategoryBody.product.specs?.other) && otherCategoryBody.product.specs.other.length === 1 && otherCategoryBody.product.specs.other[0].label === '最大尺寸', 'switching category to other should clear previous category specs and persist valid custom rows');

  const initialSettings = await fetch(`${base}/api/settings`).then((r) => r.json()) as { showPreviewDownload: boolean };
  assert(initialSettings.showPreviewDownload === true, 'showPreviewDownload should default to true');
  assert((await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showPreviewDownload: false }),
  })).status === 401, 'unauthenticated settings update must be rejected with 401');
  const disableDownloadRes = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` },
    body: JSON.stringify({ showPreviewDownload: false }),
  });
  assert(disableDownloadRes.ok, 'authenticated admin should be able to update settings');
  const updatedSettings = await disableDownloadRes.json() as { showPreviewDownload: boolean };
  assert(updatedSettings.showPreviewDownload === false, 'updated settings should disable preview download');
  assert((await fetch(`${base}/api/products/${migratedLegacy.id}/export?platform=amazon`)).status === 403, 'export must return 403 when preview download is disabled');
  const enableDownloadRes = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` },
    body: JSON.stringify({ showPreviewDownload: true }),
  });
  assert(enableDownloadRes.ok, 're-enabling preview download should succeed');

  // Verify sync status & push endpoints (including one-time password auth)
  assert((await fetch(`${base}/api/sync/status`)).status === 401, 'unauthenticated sync status must be rejected with 401');
  const syncStatusRes = await fetch(`${base}/api/sync/status`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  assert(syncStatusRes.ok, 'authenticated admin should get sync status');
  const syncStatusBody = await syncStatusRes.json() as { remoteUrl: string; localProductCount: number; localImageFileCount: number };
  assert(syncStatusBody.remoteUrl === '' && syncStatusBody.localProductCount >= 1 && syncStatusBody.localImageFileCount >= 1, 'sync status should not expose a default remote url and should return local counts');

  const badSyncPushRes = await fetch(`${base}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` },
    body: JSON.stringify({ remoteUrl: base, password: 'wrong-password' }),
  });
  assert(badSyncPushRes.status === 400, 'sync push with wrong remote password should fail with 400');

  const selfSyncPushRes = await fetch(`${base}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` },
    body: JSON.stringify({ remoteUrl: base, password: 'secret-admin-pass' }),
  });
  assert(selfSyncPushRes.ok, 'sync push with valid one-time remote password should succeed');
  const selfSyncPushBody = await selfSyncPushRes.json() as { result: { productCount: number; uploadedImageFiles: number }; status: { lastSyncedAt: string | null } };
  assert(selfSyncPushBody.result.productCount >= 1 && selfSyncPushBody.result.uploadedImageFiles === 0 && Boolean(selfSyncPushBody.status.lastSyncedAt), 'sync push should report synced products, 0 missing files on identical target, and update lastSyncedAt');

  console.log('API integration test passed: legacy migration, CRUD, platform/device fallback, grid order, vision, SKU/kind directories, rule naming, shared files, content deduplication, legacy duplicate merge and rollback, filename swaps, collision protection, rollback, SKU changes, restart and deletion');

} finally {
  await stopApp();
  await new Promise<void>((resolve) => visionProvider.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
