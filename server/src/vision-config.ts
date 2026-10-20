import fs from 'node:fs';
import path from 'node:path';
import { dataDir, visionApiBaseUrl as environmentBaseUrl, visionApiKey as environmentApiKey, visionModel as environmentModel } from './config.js';
import { httpError } from './http.js';

export interface VisionConfigInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface VisionConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface VisionStatus {
  configured: boolean;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  source: 'saved' | 'environment' | 'none';
}

const configPath = path.join(dataDir, 'vision-config.json');
let savedConfig: VisionConfig | null = readSavedConfig();

function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function readSavedConfig(): VisionConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<VisionConfig>;
    if (typeof parsed.baseUrl !== 'string' || !validBaseUrl(parsed.baseUrl)
      || typeof parsed.model !== 'string' || !parsed.model.trim()
      || (parsed.apiKey !== undefined && typeof parsed.apiKey !== 'string')) return null;
    return { baseUrl: parsed.baseUrl, model: parsed.model, apiKey: parsed.apiKey || '' };
  } catch { return null; }
}

export function getVisionConfig(): VisionConfig {
  return {
    baseUrl: savedConfig?.baseUrl ?? environmentBaseUrl,
    model: savedConfig?.model ?? environmentModel,
    apiKey: savedConfig?.apiKey || environmentApiKey,
  };
}

export function getVisionStatus(): VisionStatus {
  const config = getVisionConfig();
  return {
    configured: validBaseUrl(config.baseUrl) && Boolean(config.model.trim()),
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    source: savedConfig ? 'saved' : (environmentBaseUrl || environmentModel || environmentApiKey) ? 'environment' : 'none',
  };
}

export function saveVisionConfig(input: unknown): VisionStatus {
  const candidate = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const baseUrl = typeof candidate.baseUrl === 'string' ? candidate.baseUrl.trim() : '';
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
  const requestedApiKey = typeof candidate.apiKey === 'string' ? candidate.apiKey.trim() : '';

  if (!baseUrl || baseUrl.length > 2048 || !validBaseUrl(baseUrl)) {
    throw httpError(400, 'API URL 必须是有效的 HTTP 或 HTTPS 地址，且不能包含账号、查询参数或片段');
  }
  if (!model || model.length > 200) throw httpError(400, '请填写模型名称（不超过 200 个字符）');
  if (typeof candidate.apiKey !== 'undefined' && typeof candidate.apiKey !== 'string') throw httpError(400, 'API Key 格式无效');
  if (requestedApiKey.length > 4096) throw httpError(400, 'API Key 长度不能超过 4096 个字符');

  // Blank key means “keep the existing saved key”; it never clears a deployment env key.
  const apiKey = requestedApiKey || savedConfig?.apiKey || '';
  const next: VisionConfig = { baseUrl, model, apiKey };
  fs.mkdirSync(dataDir, { recursive: true });
  const temporaryPath = path.join(dataDir, `vision-config.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temporaryPath, 0o600); } catch { /* Windows ACLs are managed by the parent data directory. */ }
    fs.rmSync(configPath, { force: true });
    fs.renameSync(temporaryPath, configPath);
    try { fs.chmodSync(configPath, 0o600); } catch { /* Best-effort on filesystems without POSIX modes. */ }
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* ignore cleanup errors */ }
    throw error;
  }
  savedConfig = next;
  return getVisionStatus();
}

export function clearSavedVisionConfig(): VisionStatus {
  try { fs.rmSync(configPath, { force: true }); }
  catch { throw httpError(500, '无法删除已保存的识图配置'); }
  savedConfig = null;
  return getVisionStatus();
}
