import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';
import { httpError } from './http.js';

export interface SiteSettings {
  showPreviewDownload: boolean;
}

const settingsPath = path.join(dataDir, 'site-settings.json');
let savedSettings: SiteSettings = readSavedSettings();

function readSavedSettings(): SiteSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<SiteSettings>;
    return {
      showPreviewDownload: typeof parsed.showPreviewDownload === 'boolean' ? parsed.showPreviewDownload : true,
    };
  } catch {
    return { showPreviewDownload: true };
  }
}

export function getSiteSettings(): SiteSettings {
  return { ...savedSettings };
}

export function saveSiteSettings(input: unknown): SiteSettings {
  const candidate = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (typeof candidate.showPreviewDownload !== 'boolean') {
    throw httpError(400, '请提供有效的预览图片下载开关状态');
  }
  const next: SiteSettings = {
    showPreviewDownload: candidate.showPreviewDownload,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const temporaryPath = path.join(dataDir, `site-settings.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temporaryPath, 0o600); } catch { /* Windows ACLs are managed by the parent data directory. */ }
    fs.rmSync(settingsPath, { force: true });
    fs.renameSync(temporaryPath, settingsPath);
    try { fs.chmodSync(settingsPath, 0o600); } catch { /* Best-effort on filesystems without POSIX modes. */ }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* ignore cleanup errors */ }
    throw error;
  }
  savedSettings = next;
  return getSiteSettings();
}
