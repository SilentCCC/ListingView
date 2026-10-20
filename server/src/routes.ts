import { Router } from 'express';
import fs from 'node:fs';
import { db } from './db.js';
import { asyncRoute, httpError } from './http.js';
import { cloneStoredFile, removeStoredFile, resolveStoredFilePath, saveUploadedFile } from './storage.js';
import { getVisionSettingsStatus, recognizeProductImages } from './vision.js';
import { clearSavedVisionConfig, saveVisionConfig } from './vision-config.js';
import type { Device, ImageDevice, ImageKind, ImageScope, Platform, Product, ProductImage } from './types.js';
import { maxFileSizeBytes } from './config.js';
import multer from 'multer';

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
    p.id, p.name, p.sku, p.generic_title AS genericTitle, p.generic_price AS genericPrice,
    p.created_at AS createdAt, p.updated_at AS updatedAt,
    ac.title AS amazonTitle, ac.price AS amazonPrice,
    tc.title AS tmallTitle, tc.price AS tmallPrice
  FROM products p
  LEFT JOIN platform_content ac ON ac.product_id = p.id AND ac.platform = 'amazon'
  LEFT JOIN platform_content tc ON tc.product_id = p.id AND tc.platform = 'tmall'
`;

function normalizeProduct(row: any): Product {
  const images = db.prepare(`
    SELECT id, product_id AS productId, scope, kind, device, original_name AS originalName,
      mime_type AS mimeType, size_bytes AS sizeBytes, sort_order AS sortOrder,
      row_order AS rowOrder, col_order AS colOrder,
      created_at AS createdAt, stored_name AS storedName
    FROM images WHERE product_id = ? ORDER BY scope, kind, device, sort_order, row_order, col_order, id
  `).all(row.id) as Array<ProductImage & { storedName: string }>;
  const normalizedImages = images.map((image) => ({ ...image, url: `/uploads/${encodeURIComponent(image.storedName)}` }));
  const effectiveImages = {
    amazon: buildEffectiveImages(normalizedImages, 'amazon'),
    tmall: buildEffectiveImages(normalizedImages, 'tmall'),
  };
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
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
  const scoped = (kind: ImageKind) => {
    const platformItems = images.filter((image) => image.scope === platform && image.kind === kind && image.device === 'all');
    const commonItems = images.filter((image) => image.scope === 'common' && image.kind === kind && image.device === 'all');
    return platformItems.length ? platformItems : commonItems;
  };
  const detail = scoped('detail');
  const amazonDetailsFor = (device: Device) => {
    if (platform !== 'amazon') return detail;
    const deviceItems = images.filter((image) => image.scope === 'amazon' && image.kind === 'detail' && image.device === device);
    return deviceItems.length ? deviceItems : detail;
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

router.get('/vision/status', (_request, response) => {
  response.json(getVisionSettingsStatus());
});

router.put('/vision/config', (request, response) => {
  response.json(saveVisionConfig(request.body));
});

router.delete('/vision/config', (_request, response) => {
  response.json(clearSavedVisionConfig());
});

router.post('/products/:id/recognize', asyncRoute(async (request, response) => {
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

router.post('/products', (request, response) => {
  const name = validateText(request.body?.name, '商品名称');
  const sku = validateText(request.body?.sku, '商品编号');
  const genericTitle = validateText(request.body?.genericTitle, '通用标题', false);
  const genericPrice = parseOptionalPrice(request.body?.genericPrice);
  const platforms = request.body?.platforms || {};
  const insert = db.prepare(`INSERT INTO products (name, sku, generic_title, generic_price) VALUES (?, ?, ?, ?)`);
  const insertPlatform = db.prepare(`INSERT INTO platform_content (product_id, platform, title, price) VALUES (?, ?, ?, ?)`);
  try {
    const created = db.transaction(() => {
      const result = insert.run(name, sku, genericTitle, genericPrice);
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

router.put('/products/:id', (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const name = validateText(request.body?.name, '商品名称');
  const sku = validateText(request.body?.sku, '商品编号');
  const genericTitle = validateText(request.body?.genericTitle, '通用标题', false);
  const genericPrice = parseOptionalPrice(request.body?.genericPrice);
  const platforms = request.body?.platforms || {};
  try {
    db.transaction(() => {
      db.prepare(`UPDATE products SET name = ?, sku = ?, generic_title = ?, generic_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(name, sku, genericTitle, genericPrice, id);
      const updatePlatform = db.prepare(`UPDATE platform_content SET title = ?, price = ? WHERE product_id = ? AND platform = ?`);
      for (const platform of ['amazon', 'tmall'] as const) {
        const content = platforms[platform] || {};
        updatePlatform.run(validateText(content.title, `${platform} 标题`, false), parseOptionalPrice(content.price), id, platform);
      }
    })();
    db.persist();
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: products.sku')) throw httpError(409, '商品编号已经存在');
    throw error;
  }
  response.json({ product: normalizeProduct(requireProduct(id)) });
});

router.delete('/products/:id', (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const storedNames = db.prepare('SELECT stored_name AS storedName FROM images WHERE product_id = ?').all(id) as Array<{ storedName: string }>;
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  db.persist();
  for (const image of storedNames) removeStoredFile(image.storedName);
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

router.post('/products/:id/images', upload.array('files', 30), (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const files = (request.files || []) as Express.Multer.File[];
  if (!files.length) throw httpError(400, '请选择至少一张图片');
  const scope = String(request.body?.scope || 'common') as ImageScope;
  const kind = String(request.body?.kind || 'main') as ImageKind;
  const device = String(request.body?.device || 'all') as ImageDevice;
  if (!['common', 'amazon', 'tmall'].includes(scope) || !['main', 'detail'].includes(kind)) throw httpError(400, '图片范围或类型无效');
  if (!['all', 'desktop', 'mobile'].includes(device) || (device !== 'all' && (scope !== 'amazon' || kind !== 'detail'))) throw httpError(400, '设备专属图片仅支持亚马逊详情图');
  const maxStats = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder, COALESCE(MAX(row_order), -1) AS maxRow FROM images WHERE product_id = ? AND scope = ? AND kind = ? AND device = ?').get(id, scope, kind, device) as { maxOrder: number; maxRow: number };
  const insert = db.prepare(`INSERT INTO images (product_id, scope, kind, device, original_name, stored_name, mime_type, size_bytes, sort_order, row_order, col_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const saved: Array<{ storedName: string; originalName: string }> = [];
  try {
    db.transaction(() => {
      files.forEach((file, index) => {
        const savedFile = saveUploadedFile(file);
        saved.push({ storedName: savedFile.storedName, originalName: file.originalname });
        insert.run(id, scope, kind, device, file.originalname, savedFile.storedName, savedFile.mimeType, savedFile.sizeBytes, maxStats.maxOrder + index + 1, maxStats.maxRow + index + 1, 0);
      });
    })();
    db.persist();
  } catch (error) {
    for (const file of saved) removeStoredFile(file.storedName);
    throw error;
  }
  response.status(201).json({ product: normalizeProduct(requireProduct(id)) });
});

router.post('/products/:id/images/import', (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const scope = String(request.body?.scope || '') as ImageScope;
  const kind = String(request.body?.kind || '') as ImageKind;
  const device = String(request.body?.device || 'all') as ImageDevice;
  if (!['amazon', 'tmall'].includes(scope) || !['main', 'detail'].includes(kind) || !['all', 'desktop', 'mobile'].includes(device)) {
    throw httpError(400, '仅支持将通用素材导入到平台专属图片栏目');
  }
  if (device !== 'all' && (scope !== 'amazon' || kind !== 'detail')) {
    throw httpError(400, '设备专属图片仅支持亚马逊详情图');
  }
  const sourceImages = db.prepare(`
    SELECT original_name AS originalName, stored_name AS storedName, mime_type AS mimeType, size_bytes AS sizeBytes
    FROM images WHERE product_id = ? AND scope = 'common' AND kind = ? AND device = 'all'
    ORDER BY sort_order, id
  `).all(id, kind) as Array<{ originalName: string; storedName: string; mimeType: string; sizeBytes: number }>;
  if (!sourceImages.length) {
    throw httpError(400, `上方通用${kind === 'main' ? '主图' : '详情图'}暂无可导入的图片`);
  }
  const maxStats = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder, COALESCE(MAX(row_order), -1) AS maxRow FROM images WHERE product_id = ? AND scope = ? AND kind = ? AND device = ?').get(id, scope, kind, device) as { maxOrder: number; maxRow: number };
  const insert = db.prepare(`INSERT INTO images (product_id, scope, kind, device, original_name, stored_name, mime_type, size_bytes, sort_order, row_order, col_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const clonedNames: string[] = [];
  try {
    db.transaction(() => {
      sourceImages.forEach((source, index) => {
        const cloned = cloneStoredFile(source.storedName);
        clonedNames.push(cloned.storedName);
        const rowOrder = maxStats.maxRow + index + 1;
        const colOrder = 0;
        insert.run(id, scope, kind, device, source.originalName, cloned.storedName, source.mimeType, cloned.sizeBytes, maxStats.maxOrder + index + 1, rowOrder, colOrder);
      });
    })();
    db.persist();
  } catch (error) {
    for (const storedName of clonedNames) removeStoredFile(storedName);
    throw error;
  }
  response.status(201).json({ product: normalizeProduct(requireProduct(id)) });
});

router.delete('/images/:id', (request, response) => {
  const imageId = parseId(request.params.id);
  const image = db.prepare('SELECT stored_name AS storedName, product_id AS productId, scope, kind, device FROM images WHERE id = ?').get(imageId) as { storedName: string; productId: number; scope: ImageScope; kind: ImageKind; device: ImageDevice } | undefined;
  if (!image) throw httpError(404, '图片不存在');
  db.transaction(() => {
    db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
    normalizeGroupRows(image.productId, image.scope, image.kind, image.device);
  })();
  db.persist();
  removeStoredFile(image.storedName);
  response.json({ product: normalizeProduct(requireProduct(image.productId)) });
});

router.put('/products/:id/images/order', (request, response) => {
  const id = parseId(request.params.id);
  requireProduct(id);
  const scope = String(request.body?.scope || 'common') as ImageScope;
  const kind = String(request.body?.kind || 'main') as ImageKind;
  const device = String(request.body?.device || 'all') as ImageDevice;
  if (!['common', 'amazon', 'tmall'].includes(scope) || !['main', 'detail'].includes(kind) || !['all', 'desktop', 'mobile'].includes(device)) throw httpError(400, '图片范围或类型无效');
  if (device !== 'all' && (scope !== 'amazon' || kind !== 'detail')) throw httpError(400, '设备专属图片仅支持亚马逊详情图');

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





