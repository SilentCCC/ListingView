import { Router } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { db } from './db.js';
import { asyncRoute, httpError } from './http.js';
import { ensureStoredFileDirectory, pruneStoredFileDirectories, removeStoredFile, resolveStoredFilePath, saveUploadedFile, validateUploadedFile } from './storage.js';
import { getVisionSettingsStatus, recognizeProductImages } from './vision.js';
import { clearSavedVisionConfig, saveVisionConfig } from './vision-config.js';
import { getSiteSettings, saveSiteSettings } from './site-settings.js';
import { applyIncomingSyncCommit, diffSyncManifest, getSyncStatus, pushSyncToRemote, saveSyncConfig, writeIncomingSyncFile } from './sync.js';
import type { CustomSpecItem, Device, ImageDevice, ImageKind, ImageScope, Platform, Product, ProductCategory, ProductImage, ProductSpecs } from './types.js';
import { maxFileSizeBytes } from './config.js';
import multer from 'multer';
import { platformImageEntries, streamImageZip } from './image-export.js';
import { getAuthStatus, loginAdmin, requireAdmin } from './auth.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSizeBytes, files: 30 },
  fileFilter: (_request, file, callback) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!allowed.has(file.mimetype)) callback(httpError(415, '仅支持 JPG、PNG、WEBP 或 GIF 图片')); else callback(null, true);
  },
});

const productSelect = `
  SELECT
    p.id, p.name, p.sku, p.category, p.specs_json AS specsJson, p.generic_title AS genericTitle, p.generic_price AS genericPrice,
    p.created_at AS createdAt, p.updated_at AS updatedAt,
    ac.title AS amazonTitle, ac.price AS amazonPrice,
    tc.title AS tmallTitle, tc.price AS tmallPrice
  FROM products p
  LEFT JOIN platform_content ac ON ac.product_id = p.id AND ac.platform = 'amazon'
  LEFT JOIN platform_content tc ON tc.product_id = p.id AND tc.platform = 'tmall'
`;

const BAG_SPEC_KEYS = ['mainFabric', 'lining', 'outerSize', 'innerSize', 'color', 'weight', 'capacity', 'other'] as const;
const TRIPOD_SPEC_KEYS = ['material', 'loadCapacity', 'maxWorkingHeight', 'minWorkingHeight', 'foldedLength', 'weight', 'sections', 'other'] as const;

function parseCategory(value: unknown): ProductCategory {
  if (value === 'tripod' || value === 'other' || value === 'bag') return value;
  return 'bag';
}

function sanitizeSpecsObject(raw: unknown, category: ProductCategory): ProductSpecs {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const result: ProductSpecs = {};
  if (category === 'bag' && source.bag && typeof source.bag === 'object') {
    const bagRecord: Record<string, string> = {};
    for (const key of BAG_SPEC_KEYS) {
      const val = String((source.bag as Record<string, unknown>)[key] ?? '').trim();
      if (val) bagRecord[key] = val.slice(0, 200);
    }
    if (Object.keys(bagRecord).length) result.bag = bagRecord;
  } else if (category === 'tripod' && source.tripod && typeof source.tripod === 'object') {
    const tripodRecord: Record<string, string> = {};
    for (const key of TRIPOD_SPEC_KEYS) {
      const val = String((source.tripod as Record<string, unknown>)[key] ?? '').trim();
      if (val) tripodRecord[key] = val.slice(0, 200);
    }
    if (Object.keys(tripodRecord).length) result.tripod = tripodRecord;
  } else if (category === 'other' && Array.isArray(source.other)) {
    const otherList: CustomSpecItem[] = [];
    for (const item of source.other.slice(0, 50)) {
      if (!item || typeof item !== 'object') continue;
      const label = String((item as Record<string, unknown>).label ?? '').trim().slice(0, 100);
      const value = String((item as Record<string, unknown>).value ?? '').trim().slice(0, 200);
      if (label || value) otherList.push({ label, value });
    }
    if (otherList.length) result.other = otherList;
  }
  return result;
}

function parseSpecsJson(raw: unknown, category: ProductCategory): ProductSpecs {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return sanitizeSpecsObject(JSON.parse(raw), category);
  } catch {
    return {};
  }
}

function normalizeProduct(row: any): Product {
  const images = db.prepare(`
    SELECT id, product_id AS productId, scope, kind, device, original_name AS originalName,
      mime_type AS mimeType, size_bytes AS sizeBytes, sort_order AS sortOrder,
      row_order AS rowOrder, col_order AS colOrder,
      created_at AS createdAt, stored_name AS storedName
    FROM images WHERE product_id = ? ORDER BY scope, kind, device, sort_order, row_order, col_order, id
  `).all(row.id) as Array<ProductImage & { storedName: string }>;
  // One cache identity per physical file, including all shared platform references.
  // Reordered filenames can hold different images after saving; versioned URLs
  // prevent production browser caches from displaying the previous file.
  const fileVersions = new Map<string, number>();
  for (const image of images) fileVersions.set(image.storedName, Math.min(fileVersions.get(image.storedName) ?? image.id, image.id));
  const normalizedImages = images.map((image) => ({ ...image, url: `/uploads/${image.storedName.split('/').map(encodeURIComponent).join('/')}?v=${fileVersions.get(image.storedName)}` }));
  const effectiveImages = {
    amazon: buildEffectiveImages(normalizedImages, 'amazon'),
    tmall: buildEffectiveImages(normalizedImages, 'tmall'),
  };
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: parseCategory(row.category),
    specs: parseSpecsJson(row.specsJson, parseCategory(row.category)),
    genericTitle: row.genericTitle,
    genericPrice: row.genericPrice == null ? null : Number(row.genericPrice),
    platforms: {
      amazon: { title: row.amazonTitle || '', price: row.amazonPrice == null ? null : Number(row.amazonPrice) },
      tmall: { title: row.tmallTitle || '', price: row.tmallPrice == null ? null : Number(row.tmallPrice) },
    },
    images: normalizedImages,
    effectiveImages,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildEffectiveImages(images: ProductImage[], platform: Platform) {
  const scoped = (kind: ImageKind) => images.filter((image) => image.scope === platform && image.kind === kind && image.device === 'all');
  const detail = scoped('detail');
  const amazonDetailsFor = (device: Device) => {
    if (platform !== 'amazon') return detail;
    return images.filter((image) => image.scope === 'amazon' && image.kind === 'detail' && image.device === device);
  };
  return { main: scoped('main'), detail, detailByDevice: { desktop: amazonDetailsFor('desktop'), mobile: amazonDetailsFor('mobile') } };
}

function getProductRow(id: number) {
  return db.prepare(`${productSelect} WHERE p.id = ?`).get(id);
}

function requireProduct(id: number) {
  const row = getProductRow(id);
  if (!row) throw httpError(404, '商品不存在');
  return row;
}

function parseOptionalPrice(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) throw httpError(400, '价格必须是大于等于 0 的数字');
  return Math.round(price * 100) / 100;
}

function validateText(value: unknown, label: string, required = true): string {
  const text = String(value ?? '').trim();
  if (required && !text) throw httpError(400, `${label}不能为空`);
  if (text.length > 500) throw httpError(400, `${label}长度不能超过 500 个字符`);
  return text;
}

function parseId(value: string | string[]): number {
  const id = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, '无效的商品编号');
  return id;
}

type ImageFileRow = {
  id: number;
  scope: ImageScope;
  kind: ImageKind;
  device: ImageDevice;
  storedName: string;
  originalName: string;
  sortOrder: number;
  rowOrder: number;
  colOrder: number;
};

type ImageRenamePlan = {
  oldName: string;
  newName: string;
};

function contentHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function imageOrder(a: ImageFileRow, b: ImageFileRow): number {
  return a.sortOrder - b.sortOrder || a.rowOrder - b.rowOrder || a.colOrder - b.colOrder || a.id - b.id;
}

function safeFilePart(value: string): string {
  let cleaned = value.normalize('NFC')
    .replace(/[\\/:*?"<>|\0-\x1f]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw httpError(400, '商品编号不能用于生成图片目录');
  // Avoid dot-directories, which the static image server deliberately hides.
  if (cleaned.startsWith('.')) cleaned = `_${cleaned}`;
  // Windows device names are reserved even when followed by an extension.
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`;
  if (Buffer.byteLength(cleaned, 'utf8') > 160) throw httpError(400, '商品编号过长，不能用于生成图片目录');
  return cleaned;
}

function productImageDirectory(productId: number, sku: string, kind: ImageKind): string {
  const folder = safeFilePart(sku);
  const products = db.prepare('SELECT id, sku FROM products WHERE id <> ?').all(productId) as Array<{ id: number; sku: string }>;
  for (const product of products) {
    let otherFolder: string;
    try { otherFolder = safeFilePart(product.sku); } catch { continue; }
    if (otherFolder.toLowerCase() === folder.toLowerCase()) {
      throw httpError(409, '商品编号生成的图片目录与其他商品重复，请使用不同编号（不区分大小写）');
    }
  }
  return path.posix.join(folder, kind === 'main' ? '主图' : '详情图');
}

function imageCategory(image: ImageFileRow): string {
  if (image.scope === 'common') return image.kind === 'main' ? '主图' : '详情图';
  const platform = image.scope === 'amazon' ? '亚马逊' : '天猫';
  if (image.kind === 'detail' && image.device !== 'all') return `${platform}-${image.device === 'desktop' ? '电脑' : '手机'}-详情图`;
  return `${platform}-${image.kind === 'main' ? '主图' : '详情图'}`;
}

function buildImageRenamePlan(productId: number, sku: string): ImageRenamePlan[] {
  const images = db.prepare(`
    SELECT id, scope, kind, device, stored_name AS storedName, original_name AS originalName,
      sort_order AS sortOrder, row_order AS rowOrder, col_order AS colOrder
    FROM images WHERE product_id = ?
    ORDER BY sort_order, row_order, col_order, id
  `).all(productId) as ImageFileRow[];
  // Only merge byte-identical files within the same product and image kind.
  // Keep every usage record, so each platform retains its own order and layout.
  const hashByFile = new Map<string, string>();
  const groups = new Map<string, ImageFileRow[]>();
  for (const image of images) {
    let hash = hashByFile.get(image.storedName);
    if (!hash) {
      const source = resolveStoredFilePath(image.storedName);
      if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) throw httpError(404, `图片文件不存在：${image.storedName}`);
      hash = contentHash(fs.readFileSync(source));
      hashByFile.set(image.storedName, hash);
    }
    const key = `${image.kind}:${hash}`;
    groups.set(key, [...(groups.get(key) || []), image]);
  }

  const categoryGroups = new Map<string, Array<{ storedNames: string[]; first: ImageFileRow }>>();
  for (const group of groups.values()) {
    const representative = [...group].sort((a, b) => {
      const scopeWeight = (item: ImageFileRow) => item.scope === 'common' ? 0 : 1;
      return scopeWeight(a) - scopeWeight(b) || imageOrder(a, b);
    })[0];
    const category = imageCategory(representative);
    const list = categoryGroups.get(category) || [];
    const storedNames = [...new Set([representative.storedName, ...group.map((image) => image.storedName)])];
    list.push({ storedNames, first: representative });
    categoryGroups.set(category, list);
  }

  const productPart = safeFilePart(sku);
  const plan: ImageRenamePlan[] = [];
  for (const [category, categoryItems] of categoryGroups) {
    categoryItems.sort((a, b) => imageOrder(a.first, b.first));
    categoryItems.forEach((item, index) => {
      const extension = path.extname(item.first.storedName).toLowerCase() || path.extname(item.first.originalName).toLowerCase() || '.jpg';
      const directory = productImageDirectory(productId, sku, item.first.kind);
      const newName = path.posix.join(directory, `${productPart}-${category}-${String(index + 1).padStart(2, '0')}${extension}`);
      // Include the canonical source when merging, even if it already has its final name.
      if (item.storedNames.length > 1 || item.storedNames[0] !== newName) {
        for (const oldName of item.storedNames) plan.push({ oldName, newName });
      }
    });
  }
  return plan;
}

function renameProductImages(productId: number, sku: string, updateProduct: () => void, restoreProduct: () => void): void {
  const plan = buildImageRenamePlan(productId, sku);
  const originalReferences = db.prepare('SELECT id, stored_name AS storedName FROM images WHERE product_id = ?').all(productId) as Array<{ id: number; storedName: string }>;

  const currentNames = new Set((db.prepare('SELECT DISTINCT stored_name AS storedName FROM images WHERE product_id = ?').all(productId) as Array<{ storedName: string }>).map((row) => row.storedName));
  const externalNames = new Set((db.prepare('SELECT DISTINCT stored_name AS storedName FROM images WHERE product_id <> ?').all(productId) as Array<{ storedName: string }>).map((row) => row.storedName.toLowerCase()));
  const targetNames = new Set<string>();
  for (const item of plan) {
    const key = item.newName.toLowerCase();
    // Repeated exact targets represent identical files that are being merged.
    if (targetNames.has(key)) {
      if (plan.some((other) => other.newName.toLowerCase() === key && other.newName !== item.newName)) throw httpError(409, '图片命名冲突，请检查商品编号');
      continue;
    }
    if (externalNames.has(key)) throw httpError(409, `图片文件名已存在：${item.newName}`);
    const destination = resolveStoredFilePath(item.newName);
    if (!currentNames.has(item.newName) && fs.existsSync(destination)) {
      // Windows resolves case-only changes to the same file. On Linux, a separate
      // file with different casing must still never be overwritten.
      const existing = fs.statSync(destination);
      const sourceName = [...currentNames].find((name) => name.toLowerCase() === key);
      const source = sourceName ? fs.statSync(resolveStoredFilePath(sourceName), { throwIfNoEntry: false }) : undefined;
      if (!source || source.dev !== existing.dev || source.ino !== existing.ino) throw httpError(409, `图片文件名已存在：${item.newName}`);
    }
    targetNames.add(key);
  }

  const moves: Array<{ oldName: string; newName: string; tempName: string; finalized: boolean }> = [];
  let referencesUpdated = false;
  try {
    for (const item of plan) {
      const sourcePath = resolveStoredFilePath(item.oldName);
      if (!fs.statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) throw httpError(404, `图片文件不存在：${item.oldName}`);
      const tempName = `.__listingview_rename_${crypto.randomUUID()}${path.extname(item.oldName).toLowerCase() || '.tmp'}`;
      fs.renameSync(sourcePath, resolveStoredFilePath(tempName));
      moves.push({ ...item, tempName, finalized: false });
    }
    for (const move of moves) pruneStoredFileDirectories(move.oldName);
    const finalizedNames = new Set<string>();
    for (const move of moves) {
      if (finalizedNames.has(move.newName)) continue;
      ensureStoredFileDirectory(move.newName);
      fs.renameSync(resolveStoredFilePath(move.tempName), resolveStoredFilePath(move.newName));
      move.finalized = true;
      finalizedNames.add(move.newName);
    }
    db.transaction(() => {
      // Two passes also protect database references when filenames swap after sorting.
      for (const move of moves) db.prepare('UPDATE images SET stored_name = ? WHERE product_id = ? AND stored_name = ?').run(move.tempName, productId, move.oldName);
      for (const move of moves) db.prepare('UPDATE images SET stored_name = ? WHERE product_id = ? AND stored_name = ?').run(move.newName, productId, move.tempName);
      updateProduct();
    })();
    referencesUpdated = true;
    db.persist();
    for (const move of moves) pruneStoredFileDirectories(move.oldName);
  } catch (error) {
    if (referencesUpdated) {
      db.transaction(() => {
        for (const image of originalReferences) db.prepare('UPDATE images SET stored_name = ? WHERE id = ? AND product_id = ?').run(image.storedName, image.id, productId);
        restoreProduct();
      })();
    }
    // Stage finalized targets again before restoration, including filename swaps.
    for (const move of moves.filter((item) => item.finalized)) {
      try { fs.renameSync(resolveStoredFilePath(move.newName), resolveStoredFilePath(move.tempName)); }
      catch (restoreError) { console.error('图片文件回滚失败', restoreError); }
    }
    for (const move of [...moves].reverse()) {
      try {
        const currentPath = resolveStoredFilePath(move.tempName);
        ensureStoredFileDirectory(move.oldName);
        if (fs.statSync(currentPath, { throwIfNoEntry: false })?.isFile()) fs.renameSync(currentPath, resolveStoredFilePath(move.oldName));
        pruneStoredFileDirectories(move.newName);
      } catch (restoreError) { console.error('图片文件回滚失败', restoreError); }
    }
    throw error;
  }
  // Duplicate originals remain staged until the new references are safely persisted.
  // Cleanup errors must not roll back an already committed save.
  for (const move of moves.filter((item) => !item.finalized)) {
    try { removeStoredFile(move.tempName); }
    catch (error) { console.error('重复图片临时文件清理失败', error); }
  }
}

function removeStoredFileIfUnreferenced(storedName: string): void {
  const reference = db.prepare('SELECT id FROM images WHERE stored_name = ? LIMIT 1').get(storedName);
  if (!reference) removeStoredFile(storedName);
}

router.get('/auth/status', (request, response) => {
  response.json(getAuthStatus(request));
});

router.post('/auth/login', (request, response) => {
  response.json(loginAdmin(request, request.body?.password));
});

router.post('/auth/logout', (request, response) => {
  const current = getAuthStatus(request);
  response.json({ status: { authenticated: !current.passwordRequired, passwordRequired: current.passwordRequired } });
});

router.get('/settings', (_request, response) => {
  response.json(getSiteSettings());
});

router.put('/settings', requireAdmin, (request, response) => {
  response.json(saveSiteSettings(request.body));
});

router.get('/sync/status', requireAdmin, (_request, response) => {
  response.json(getSyncStatus());
});

router.put('/sync/config', requireAdmin, (request, response) => {
  saveSyncConfig({ remoteUrl: request.body?.remoteUrl });
  response.json(getSyncStatus());
});

router.post('/sync/push', requireAdmin, asyncRoute(async (request, response) => {
  const result = await pushSyncToRemote({
    remoteUrl: request.body?.remoteUrl,
    password: request.body?.password,
  });
  response.json({ result, status: getSyncStatus() });
}));

router.post('/sync/receive/diff', requireAdmin, (request, response) => {
  const files = Array.isArray(request.body?.files) ? request.body.files : [];
  response.json(diffSyncManifest(files));
});

router.post('/sync/receive/file', requireAdmin, upload.single('file'), (request, response) => {
  const file = request.file;
  if (!file) throw httpError(400, '缺少上传的图片文件');
  const storedName = String(request.body?.storedName || '').trim();
  const sha256 = String(request.body?.sha256 || '').trim() || undefined;
  writeIncomingSyncFile(storedName, file.buffer, sha256);
  response.json({ ok: true });
});

router.post('/sync/receive/commit', requireAdmin, asyncRoute(async (request, response) => {
  const result = await applyIncomingSyncCommit({
    databaseBase64: request.body?.databaseBase64,
    siteSettings: request.body?.siteSettings,
    expectedFiles: request.body?.expectedFiles,
  });
  response.json(result);
}));

router.get('/vision/status', requireAdmin, (_request, response) => {
  response.json(getVisionSettingsStatus());
});

router.put('/vision/config', requireAdmin, (request, response) => {
  response.json(saveVisionConfig(request.body));
});

router.delete('/vision/config', requireAdmin, (_request, response) => {
  response.json(clearSavedVisionConfig());
});

router.post('/products/:id/recognize', requireAdmin, asyncRoute(async (request, response) => {
  const productId = parseId(request.params.id);
  requireProduct(productId);
  const imageIds: unknown = request.body?.imageIds;
  if (!Array.isArray(imageIds) || imageIds.length < 1 || imageIds.length > 3 || imageIds.some((id) => !Number.isInteger(id) || id <= 0) || new Set(imageIds).size !== imageIds.length) {
    throw httpError(400, '请选择 1 至 3 张已上传图片');
  }

  const placeholders = imageIds.map(() => '?').join(', ');
  const images = db.prepare(`SELECT id, product_id AS productId, stored_name AS storedName, mime_type AS mimeType, size_bytes AS sizeBytes FROM images WHERE product_id = ? AND id IN (${placeholders})`).all(productId, ...imageIds) as Array<{ id: number; productId: number; storedName: string; mimeType: string; sizeBytes: number }>;
  if (images.length !== imageIds.length || images.some((image) => image.productId !== productId)) throw httpError(404, '所选图片不存在或不属于当前商品');

  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  let totalBytes = 0;
  const recognitionImages = imageIds.map((imageId) => {
    const image = images.find((item) => item.id === imageId)!;
    if (!allowedTypes.has(image.mimeType)) throw httpError(415, '识图仅支持 JPG、PNG、WEBP 图片，请移除 GIF 图片后重试');
    const filePath = resolveStoredFilePath(image.storedName);
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > maxFileSizeBytes) throw httpError(400, '图片文件不存在或超出识图大小限制');
    totalBytes += stat.size;
    if (totalBytes > 20 * 1024 * 1024) throw httpError(413, '所选图片总大小不能超过 20 MB');
    return { mimeType: image.mimeType, buffer: fs.readFileSync(filePath) };
  });

  const result = await recognizeProductImages(recognitionImages);
  response.json({ result });
}));

router.get('/products', (request, response) => {
  const search = String(request.query.search || '').trim();
  const rows = search
    ? db.prepare(`${productSelect} WHERE p.name LIKE @search OR p.sku LIKE @search OR p.generic_title LIKE @search ORDER BY p.updated_at DESC, p.id DESC`).all({ search: `%${search}%` })
    : db.prepare(`${productSelect} ORDER BY p.updated_at DESC, p.id DESC`).all();
  response.json({ products: rows.map(normalizeProduct) });
});

router.get('/products/:id', (request, response) => {
  response.json({ product: normalizeProduct(requireProduct(parseId(request.params.id))) });
});

router.get('/products/:id/export', asyncRoute(async (request, response) => {
  if (!getSiteSettings().showPreviewDownload) throw httpError(403, '预览图片下载功能已关闭');
  const platform = request.query.platform;
  if (platform !== 'amazon' && platform !== 'tmall') throw httpError(400, '请选择亚马逊或天猫平台');
  const product = normalizeProduct(requireProduct(parseId(request.params.id)));
  const sku = safeFilePart(product.sku);
  const entries = platformImageEntries(product, platform, sku);
  await streamImageZip(response, entries, sku + '-' + (platform === 'amazon' ? '亚马逊' : '天猫') + '.zip');
}));

router.post('/products', requireAdmin, (request, response) => {
  const name = validateText(request.body?.name, '商品名称');
  const sku = validateText(request.body?.sku, '商品编号');
  productImageDirectory(0, sku, 'main');
  const category = parseCategory(request.body?.category);
  const specsJson = JSON.stringify(sanitizeSpecsObject(request.body?.specs, category));
  const genericTitle = validateText(request.body?.genericTitle, '通用标题', false);
  const genericPrice = parseOptionalPrice(request.body?.genericPrice);
  const platforms = request.body?.platforms || {};
  const insert = db.prepare(`INSERT INTO products (name, sku, category, specs_json, generic_title, generic_price) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertPlatform = db.prepare(`INSERT INTO platform_content (product_id, platform, title, price) VALUES (?, ?, ?, ?)`);
  try {
    const created = db.transaction(() => {
      const result = insert.run(name, sku, category, specsJson, genericTitle, genericPrice);
      for (const platform of ['amazon', 'tmall'] as const) {
        const content = platforms[platform] || {};
        insertPlatform.run(result.lastInsertRowid, platform, validateText(content.title, `${platform} 标题`, false), parseOptionalPrice(content.price));
      }
      return Number(result.lastInsertRowid);
    })();
    db.persist();
    response.status(201).json({ product: normalizeProduct(requireProduct(created)) });
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: products.sku')) throw httpError(409, '商品编号已经存在');
    throw error;
  }
});

router.put('/products/:id', requireAdmin, (request, response) => {
  const id = parseId(request.params.id);
  const previous = requireProduct(id);
  const name = validateText(request.body?.name, '商品名称');
  const sku = validateText(request.body?.sku, '商品编号');
  productImageDirectory(id, sku, 'main');
  const category = request.body?.category !== undefined ? parseCategory(request.body?.category) : parseCategory(previous.category);
  const specsJson = request.body?.specs !== undefined ? JSON.stringify(sanitizeSpecsObject(request.body?.specs, category)) : JSON.stringify(parseSpecsJson(previous.specsJson, category));
  const genericTitle = validateText(request.body?.genericTitle, '通用标题', false);
  const genericPrice = parseOptionalPrice(request.body?.genericPrice);
  const platforms = request.body?.platforms || {};
  const platformValues = Object.fromEntries((['amazon', 'tmall'] as const).map((platform) => {
    const content = platforms[platform] || {};
    return [platform, {
      title: validateText(content.title, `${platform} 标题`, false),
      price: parseOptionalPrice(content.price),
    }];
  })) as Record<Platform, { title: string; price: number | null }>;
  const duplicateSku = db.prepare('SELECT id FROM products WHERE sku = ? AND id <> ?').get(sku, id) as { id?: number } | undefined;
  if (duplicateSku) throw httpError(409, '商品编号已经存在');
  const update = (values: { name: string; sku: string; category: string; specsJson: string; genericTitle: string; genericPrice: number | null }, content: Record<Platform, { title: string; price: number | null }>, updatedAt?: string) => {
    db.prepare(`UPDATE products SET name = ?, sku = ?, category = ?, specs_json = ?, generic_title = ?, generic_price = ?, updated_at = COALESCE(?, CURRENT_TIMESTAMP) WHERE id = ?`).run(values.name, values.sku, values.category, values.specsJson, values.genericTitle, values.genericPrice, updatedAt ?? null, id);
    for (const platform of ['amazon', 'tmall'] as const) {
      db.prepare('UPDATE platform_content SET title = ?, price = ? WHERE product_id = ? AND platform = ?').run(content[platform].title, content[platform].price, id, platform);
    }
  };
  renameProductImages(id, sku,
    () => update({ name, sku, category, specsJson, genericTitle, genericPrice }, platformValues),
    () => update({
      name: previous.name,
      sku: previous.sku,
      category: parseCategory(previous.category),
      specsJson: String(previous.specsJson || '{}'),
      genericTitle: previous.genericTitle,
      genericPrice: previous.genericPrice,
    }, {
      amazon: { title: previous.amazonTitle, price: previous.amazonPrice },
      tmall: { title: previous.tmallTitle, price: previous.tmallPrice },
    }, previous.updatedAt),
  );
  response.json({ product: normalizeProduct(requireProduct(id)) });
});

router.delete('/products/:id', requireAdmin, (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const storedNames = db.prepare('SELECT DISTINCT stored_name AS storedName FROM images WHERE product_id = ?').all(id) as Array<{ storedName: string }>;
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  db.persist();
  for (const image of storedNames) removeStoredFileIfUnreferenced(image.storedName);
  response.status(204).send();
});

function normalizeGroupRows(productId: number, scope: ImageScope, kind: ImageKind, device: ImageDevice) {
  const items = db.prepare('SELECT id, row_order AS rowOrder, col_order AS colOrder, sort_order AS sortOrder FROM images WHERE product_id = ? AND scope = ? AND kind = ? AND device = ? ORDER BY row_order, col_order, sort_order, id').all(productId, scope, kind, device) as Array<{ id: number; rowOrder: number; colOrder: number; sortOrder: number }>;
  const grouped = new Map<number, number[]>();
  for (const item of items) {
    const rowList = grouped.get(item.rowOrder) || [];
    rowList.push(item.id);
    grouped.set(item.rowOrder, rowList);
  }
  const update = db.prepare('UPDATE images SET sort_order = ?, row_order = ?, col_order = ? WHERE id = ?');
  let sortIndex = 0;
  let rowIndex = 0;
  for (const rowItems of grouped.values()) {
    for (let index = 0; index < rowItems.length; index += 3) {
      const chunk = rowItems.slice(index, index + 3);
      chunk.forEach((imageId, colIndex) => {
        update.run(sortIndex++, rowIndex, colIndex, imageId);
      });
      rowIndex += 1;
    }
  }
}

router.post('/products/:id/images', requireAdmin, upload.array('files', 30), (request, response) => {
  const id = parseId(request.params.id);
  const product = requireProduct(id);
  const files = (request.files || []) as Express.Multer.File[];
  if (!files.length) throw httpError(400, '请选择至少一张图片');
  const scope = String(request.body?.scope || 'common') as ImageScope;
  const kind = String(request.body?.kind || 'main') as ImageKind;
  const device = String(request.body?.device || 'all') as ImageDevice;
  if (!['common', 'amazon', 'tmall'].includes(scope) || !['main', 'detail'].includes(kind)) throw httpError(400, '图片范围或类型无效');
  if (!['all', 'desktop', 'mobile'].includes(device) || (device !== 'all' && (scope !== 'amazon' || kind !== 'detail')) || (scope === 'amazon' && kind === 'detail' && device === 'all')) throw httpError(400, '亚马逊详情图请选择电脑版或手机版');
  const maxStats = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder, COALESCE(MAX(row_order), -1) AS maxRow FROM images WHERE product_id = ? AND scope = ? AND kind = ? AND device = ?').get(id, scope, kind, device) as { maxOrder: number; maxRow: number };
  const insert = db.prepare(`INSERT INTO images (product_id, scope, kind, device, original_name, stored_name, mime_type, size_bytes, sort_order, row_order, col_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const directory = productImageDirectory(id, product.sku, kind);
  const saved: Array<{ storedName: string; originalName: string }> = [];
  const insertedIds: number[] = [];
  let committed = false;
  const candidates = db.prepare('SELECT DISTINCT stored_name AS storedName, mime_type AS mimeType, size_bytes AS sizeBytes FROM images WHERE product_id = ? AND kind = ?').all(id, kind) as Array<{ storedName: string; mimeType: string; sizeBytes: number }>;
  const hashes = new Map<string, string>();
  try {
    db.transaction(() => {
      files.forEach((file, index) => {
        validateUploadedFile(file);
        const hash = contentHash(file.buffer);
        const matching = candidates.find((candidate) => {
          if (candidate.mimeType !== file.mimetype || candidate.sizeBytes !== file.size) return false;
          let storedHash = hashes.get(candidate.storedName);
          if (!storedHash) {
            const source = resolveStoredFilePath(candidate.storedName);
            if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) return false;
            storedHash = contentHash(fs.readFileSync(source));
            hashes.set(candidate.storedName, storedHash);
          }
          return storedHash === hash;
        });
        const savedFile = matching || saveUploadedFile(file, directory);
        if (!matching) {
          saved.push({ storedName: savedFile.storedName, originalName: file.originalname });
          candidates.push(savedFile);
          hashes.set(savedFile.storedName, hash);
        }
        const result = insert.run(id, scope, kind, device, file.originalname, savedFile.storedName, savedFile.mimeType, savedFile.sizeBytes, maxStats.maxOrder + index + 1, maxStats.maxRow + index + 1, 0);
        insertedIds.push(Number(result.lastInsertRowid));
      });
    })();
    committed = true;
    db.persist();
  } catch (error) {
    if (committed) db.transaction(() => {
      for (const imageId of insertedIds) db.prepare('DELETE FROM images WHERE id = ? AND product_id = ?').run(imageId, id);
    })();
    for (const file of saved) removeStoredFile(file.storedName);
    throw error;
  }
  response.status(201).json({ product: normalizeProduct(requireProduct(id)) });
});

router.post('/products/:id/images/import', requireAdmin, (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const scope = String(request.body?.scope || '') as ImageScope;
  const kind = String(request.body?.kind || '') as ImageKind;
  const device = String(request.body?.device || 'all') as ImageDevice;
  if (!['amazon', 'tmall'].includes(scope) || !['main', 'detail'].includes(kind) || !['all', 'desktop', 'mobile'].includes(device)) {
    throw httpError(400, '仅支持将通用素材导入到平台专属图片栏目');
  }
  if ((device !== 'all' && (scope !== 'amazon' || kind !== 'detail')) || (scope === 'amazon' && kind === 'detail' && device === 'all')) {
    throw httpError(400, '亚马逊详情图请选择电脑版或手机版');
  }
  const sourceImages = db.prepare(`
    SELECT original_name AS originalName, stored_name AS storedName, mime_type AS mimeType, size_bytes AS sizeBytes
    FROM images AS common_images
    WHERE product_id = ? AND scope = 'common' AND kind = ? AND device = 'all'
      AND NOT EXISTS (
        SELECT 1 FROM images AS target_images
        WHERE target_images.product_id = common_images.product_id
          AND target_images.scope = ? AND target_images.kind = ? AND target_images.device = ?
          AND target_images.stored_name = common_images.stored_name
      )
    ORDER BY sort_order, id
  `).all(id, kind, scope, kind, device) as Array<{ originalName: string; storedName: string; mimeType: string; sizeBytes: number }>;
  if (!sourceImages.length) {
    throw httpError(400, `上方通用${kind === 'main' ? '主图' : '详情图'}暂无新的可导入图片`);
  }
  const maxStats = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder, COALESCE(MAX(row_order), -1) AS maxRow FROM images WHERE product_id = ? AND scope = ? AND kind = ? AND device = ?').get(id, scope, kind, device) as { maxOrder: number; maxRow: number };
  const insert = db.prepare(`INSERT INTO images (product_id, scope, kind, device, original_name, stored_name, mime_type, size_bytes, sort_order, row_order, col_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    sourceImages.forEach((source, index) => {
      const rowOrder = maxStats.maxRow + index + 1;
      const colOrder = 0;
      // Importing creates another usage record, not another physical file.
      insert.run(id, scope, kind, device, source.originalName, source.storedName, source.mimeType, source.sizeBytes, maxStats.maxOrder + index + 1, rowOrder, colOrder);
    });
  })();
  db.persist();
  response.status(201).json({ product: normalizeProduct(requireProduct(id)) });
});

router.delete('/images/:id', requireAdmin, (request, response) => {
  const imageId = parseId(request.params.id);
  const image = db.prepare('SELECT stored_name AS storedName, product_id AS productId, scope, kind, device FROM images WHERE id = ?').get(imageId) as { storedName: string; productId: number; scope: ImageScope; kind: ImageKind; device: ImageDevice } | undefined;
  if (!image) throw httpError(404, '图片不存在');
  db.transaction(() => {
    db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
    normalizeGroupRows(image.productId, image.scope, image.kind, image.device);
  })();
  db.persist();
  removeStoredFileIfUnreferenced(image.storedName);
  response.json({ product: normalizeProduct(requireProduct(image.productId)) });
});

router.put('/products/:id/images/order', requireAdmin, (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const scope = String(request.body?.scope || 'common') as ImageScope;
  const kind = String(request.body?.kind || 'main') as ImageKind;
  const device = String(request.body?.device || 'all') as ImageDevice;
  if (!['common', 'amazon', 'tmall'].includes(scope) || !['main', 'detail'].includes(kind) || !['all', 'desktop', 'mobile'].includes(device)) throw httpError(400, '图片范围或类型无效');
  if ((device !== 'all' && (scope !== 'amazon' || kind !== 'detail')) || (scope === 'amazon' && kind === 'detail' && device === 'all')) throw httpError(400, '亚马逊详情图请选择电脑版或手机版');

  const rawRows = request.body?.rows;
  let normalizedRows: number[][];
  if (Array.isArray(rawRows)) {
    const nonEmptyRows = rawRows.filter((row: unknown) => Array.isArray(row) && row.length > 0);
    if (nonEmptyRows.some((row: unknown[]) => row.length > 3 || row.some((value) => !Number.isInteger(value)))) {
      throw httpError(400, '宫格每行最多放置 3 张图片，且图片 ID 必须有效');
    }
    normalizedRows = nonEmptyRows as number[][];
  } else {
    const imageIds = request.body?.imageIds;
    if (!Array.isArray(imageIds) || imageIds.some((value) => !Number.isInteger(value))) throw httpError(400, '图片排序数据无效');
    normalizedRows = imageIds.map((imageId: number) => [imageId]);
  }

  const flatIds = normalizedRows.flat();
  if (new Set(flatIds).size !== flatIds.length) throw httpError(400, '图片排序数据无效');
  const matching = db.prepare('SELECT id FROM images WHERE product_id = ? AND scope = ? AND kind = ? AND device = ?').all(id, scope, kind, device) as Array<{ id: number }>;
  if (matching.length !== flatIds.length || matching.some(({ id: imageId }) => !flatIds.includes(imageId))) throw httpError(400, '排序图片与当前素材组不匹配');

  const update = db.prepare('UPDATE images SET sort_order = ?, row_order = ?, col_order = ? WHERE id = ? AND product_id = ? AND scope = ? AND kind = ? AND device = ?');
  db.transaction(() => {
    let sortIndex = 0;
    normalizedRows.forEach((rowIds, rowIndex) => {
      rowIds.forEach((imageId, colIndex) => {
        update.run(sortIndex++, rowIndex, colIndex, imageId, id, scope, kind, device);
      });
    });
  })();
  db.persist();
  response.json({ product: normalizeProduct(requireProduct(id)) });
});

export default router;





