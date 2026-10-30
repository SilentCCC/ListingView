import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir, uploadsDir } from './config.js';
import { db, replaceDatabaseBytes } from './db.js';
import { httpError } from './http.js';
import { getSiteSettings, saveSiteSettings, type SiteSettings } from './site-settings.js';
import { ensureStoredFileDirectory, pruneStoredFileDirectories, resolveStoredFilePath } from './storage.js';

export interface SyncFileEntry {
  storedName: string;
  sizeBytes: number;
  sha256: string;
}

export interface SyncConfig {
  remoteUrl: string;
  lastSyncedAt: string | null;
}

export interface SyncStatus {
  remoteUrl: string;
  lastSyncedAt: string | null;
  localProductCount: number;
  localImageFileCount: number;
}

export interface SyncPushResult {
  remoteUrl: string;
  syncedAt: string;
  productCount: number;
  totalImageFiles: number;
  uploadedImageFiles: number;
  removedRemoteFiles: number;
}

const DEFAULT_REMOTE_URL = '';
const syncConfigPath = path.join(dataDir, 'sync-config.json');

function normalizeRemoteUrl(input: unknown): string {
  const raw = String(input ?? '').trim().replace(/\/+$/, '');
  if (!raw) throw httpError(400, '请填写目标云服务器地址');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw httpError(400, '目标服务器地址格式无效，请以 http:// 或 https:// 开头');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError(400, '目标服务器地址必须使用 http:// 或 https:// 协议');
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

export function readSyncConfig(): SyncConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(syncConfigPath, 'utf8')) as Partial<SyncConfig>;
    return {
      remoteUrl: typeof parsed.remoteUrl === 'string' && parsed.remoteUrl.trim() ? parsed.remoteUrl.trim() : DEFAULT_REMOTE_URL,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
    };
  } catch {
    return { remoteUrl: DEFAULT_REMOTE_URL, lastSyncedAt: null };
  }
}

export function saveSyncConfig(partial: Partial<SyncConfig>): SyncConfig {
  const current = readSyncConfig();
  const next: SyncConfig = {
    remoteUrl: partial.remoteUrl !== undefined ? normalizeRemoteUrl(partial.remoteUrl) : current.remoteUrl,
    lastSyncedAt: partial.lastSyncedAt !== undefined ? partial.lastSyncedAt : current.lastSyncedAt,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const tempPath = path.join(dataDir, `sync-config.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.rmSync(syncConfigPath, { force: true });
    fs.renameSync(tempPath, syncConfigPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
  return next;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function scanUploadsManifest(): SyncFileEntry[] {
  const entries: SyncFileEntry[] = [];
  const root = path.resolve(uploadsDir);
  if (!fs.existsSync(root)) return entries;

  const walk = (dir: string) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isSymbolicLink()) continue;
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
      } else if (item.isFile()) {
        const rel = path.relative(root, fullPath).split(path.sep).join('/');
        const stat = fs.statSync(fullPath);
        entries.push({
          storedName: rel,
          sizeBytes: stat.size,
          sha256: sha256File(fullPath),
        });
      }
    }
  };
  walk(root);
  entries.sort((a, b) => a.storedName.localeCompare(b.storedName));
  return entries;
}

export function getSyncStatus(): SyncStatus {
  const config = readSyncConfig();
  const productCountRow = db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count?: number } | undefined;
  const manifest = scanUploadsManifest();
  return {
    remoteUrl: config.remoteUrl,
    lastSyncedAt: config.lastSyncedAt,
    localProductCount: Number(productCountRow?.count || 0),
    localImageFileCount: manifest.length,
  };
}

export function diffSyncManifest(incomingFiles: SyncFileEntry[]): { missingFiles: string[] } {
  const localMap = new Map<string, SyncFileEntry>();
  for (const item of scanUploadsManifest()) {
    localMap.set(item.storedName, item);
  }
  const missingFiles: string[] = [];
  for (const item of incomingFiles) {
    if (!item || typeof item.storedName !== 'string' || typeof item.sha256 !== 'string') continue;
    resolveStoredFilePath(item.storedName);
    const existing = localMap.get(item.storedName);
    if (!existing || existing.sizeBytes !== item.sizeBytes || existing.sha256 !== item.sha256) {
      missingFiles.push(item.storedName);
    }
  }
  return { missingFiles };
}

export function writeIncomingSyncFile(storedName: string, buffer: Buffer, expectedSha256?: string): void {
  if (!storedName || typeof storedName !== 'string') {
    throw httpError(400, '缺少图片存储路径');
  }
  const destination = resolveStoredFilePath(storedName);
  if (expectedSha256) {
    const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw httpError(400, `图片校验失败：${storedName}`);
    }
  }
  ensureStoredFileDirectory(storedName);
  const tempPath = `${destination}.${crypto.randomUUID()}.sync.tmp`;
  try {
    fs.writeFileSync(tempPath, buffer, { flag: 'wx', mode: 0o640 });
    fs.rmSync(destination, { force: true });
    fs.renameSync(tempPath, destination);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export async function applyIncomingSyncCommit(payload: {
  databaseBase64: string;
  siteSettings?: SiteSettings;
  expectedFiles?: string[];
}): Promise<{ removedFiles: number; productCount: number }> {
  if (!payload.databaseBase64 || typeof payload.databaseBase64 !== 'string') {
    throw httpError(400, '缺少同步数据库内容');
  }
  const dbBytes = new Uint8Array(Buffer.from(payload.databaseBase64, 'base64'));
  await replaceDatabaseBytes(dbBytes);

  if (payload.siteSettings && typeof payload.siteSettings.showPreviewDownload === 'boolean') {
    saveSiteSettings({ showPreviewDownload: payload.siteSettings.showPreviewDownload });
  }

  let removedFiles = 0;
  if (Array.isArray(payload.expectedFiles)) {
    const expectedSet = new Set(payload.expectedFiles);
    for (const localFile of scanUploadsManifest()) {
      if (!expectedSet.has(localFile.storedName)) {
        const fullPath = resolveStoredFilePath(localFile.storedName);
        try {
          fs.unlinkSync(fullPath);
          pruneStoredFileDirectories(localFile.storedName);
          removedFiles += 1;
        } catch {
          // ignore if already removed
        }
      }
    }
  }

  const productCountRow = db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count?: number } | undefined;
  return {
    removedFiles,
    productCount: Number(productCountRow?.count || 0),
  };
}

async function parseRemoteJson(response: Response, fallbackMessage: string): Promise<any> {
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw httpError(response.status === 401 ? 400 : 502, body?.error || `${fallbackMessage} (HTTP ${response.status})`);
  }
  return body;
}

export async function pushSyncToRemote(input: { remoteUrl: string; password?: string }): Promise<SyncPushResult> {
  const remoteUrl = normalizeRemoteUrl(input.remoteUrl);
  const password = String(input.password ?? '');

  // 1. Authenticate against remote server
  let loginRes: Response;
  try {
    loginRes = await fetch(`${remoteUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch (error: any) {
    throw httpError(502, `无法连接到目标云服务器 (${remoteUrl})：${error?.message || '网络不可达'}`);
  }
  const loginBody = await parseRemoteJson(loginRes, '目标服务器管理员密码验证失败');
  const remoteToken = loginBody?.token ? String(loginBody.token) : '';
  const authHeaders: Record<string, string> = remoteToken ? { Authorization: `Bearer ${remoteToken}` } : {};

  // 2. Compare manifest
  const manifest = scanUploadsManifest();
  const diffRes = await fetch(`${remoteUrl}/api/sync/receive/diff`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: manifest }),
  });
  if (diffRes.status === 404) {
    throw httpError(502, '目标云服务器尚未更新支持同步功能的版本，请先更新云服务器代码');
  }
  const diffBody = await parseRemoteJson(diffRes, '比对云服务器图片清单失败') as { missingFiles?: string[] };
  const missingFiles = Array.isArray(diffBody?.missingFiles) ? diffBody.missingFiles : [];

  // 3. Upload missing or changed image files
  const manifestMap = new Map(manifest.map((item) => [item.storedName, item]));
  for (const storedName of missingFiles) {
    const fileEntry = manifestMap.get(storedName);
    if (!fileEntry) continue;
    const localFilePath = resolveStoredFilePath(storedName);
    const fileBuffer = fs.readFileSync(localFilePath);
    const form = new FormData();
    form.append('storedName', storedName);
    form.append('sha256', fileEntry.sha256);
    form.append('file', new Blob([fileBuffer]), path.posix.basename(storedName));
    const uploadRes = await fetch(`${remoteUrl}/api/sync/receive/file`, {
      method: 'POST',
      headers: authHeaders,
      body: form,
    });
    await parseRemoteJson(uploadRes, `上传图片失败 (${storedName})`);
  }

  // 4. Commit database and site settings
  db.persist();
  const databaseBase64 = Buffer.from(db.exportBytes()).toString('base64');
  const commitRes = await fetch(`${remoteUrl}/api/sync/receive/commit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      databaseBase64,
      siteSettings: getSiteSettings(),
      expectedFiles: manifest.map((item) => item.storedName),
    }),
  });
  const commitBody = await parseRemoteJson(commitRes, '同步商品数据库到云服务器失败') as { removedFiles?: number; productCount?: number };

  const syncedAt = new Date().toISOString();
  saveSyncConfig({ remoteUrl, lastSyncedAt: syncedAt });

  return {
    remoteUrl,
    syncedAt,
    productCount: Number(commitBody?.productCount ?? 0),
    totalImageFiles: manifest.length,
    uploadedImageFiles: missingFiles.length,
    removedRemoteFiles: Number(commitBody?.removedFiles ?? 0),
  };
}
