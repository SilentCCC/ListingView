import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Express } from 'express';
import { uploadsDir } from './config.js';
import { httpError } from './http.js';

fs.mkdirSync(uploadsDir, { recursive: true });

function getSafeStoredPath(storedName: string): string | null {
  if (!storedName || /[\\/\0]/.test(storedName)) return null;
  const root = path.resolve(uploadsDir);
  const safePath = path.resolve(root, storedName);
  const relative = path.relative(root, safePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return safePath;
}

export function resolveStoredFilePath(storedName: string): string {
  const safePath = getSafeStoredPath(storedName);
  if (!safePath) throw httpError(404, '图片文件不可用');
  return safePath;
}

export function removeStoredFile(storedName: string): void {
  const safePath = getSafeStoredPath(storedName);
  if (!safePath) return;
  try { fs.unlinkSync(safePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function hasSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

export function validateUploadedFile(file: Express.Multer.File): void {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!allowedTypes.has(file.mimetype)) throw httpError(415, '仅支持 JPG、PNG、WEBP 或 GIF 图片');
  if (!file.originalname || file.originalname.length > 255 || /[\\/\0]/.test(file.originalname)) throw httpError(400, '图片文件名无效');
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedExtensions: Record<string, string[]> = {
    'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'], 'image/gif': ['.gif'],
  };
  if (!expectedExtensions[file.mimetype].includes(extension)) throw httpError(415, '图片扩展名与文件类型不匹配');
  if (!hasSignature(file.buffer, file.mimetype)) throw httpError(415, '图片内容校验失败');
}

export function saveUploadedFile(file: Express.Multer.File): { storedName: string; mimeType: string; sizeBytes: number } {
  validateUploadedFile(file);
  const extension = path.extname(file.originalname).toLowerCase();
  const storedName = `${crypto.randomUUID()}${extension}`;
  const destination = path.resolve(uploadsDir, storedName);
  fs.writeFileSync(destination, file.buffer, { flag: 'wx', mode: 0o640 });
  return { storedName, mimeType: file.mimetype, sizeBytes: file.size };
}

export function cloneStoredFile(sourceStoredName: string): { storedName: string; sizeBytes: number } {
  const sourcePath = resolveStoredFilePath(sourceStoredName);
  const stat = fs.statSync(sourcePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw httpError(404, '源图片文件不存在');
  const extension = path.extname(sourceStoredName).toLowerCase() || '.jpg';
  const storedName = `${crypto.randomUUID()}${extension}`;
  const destination = path.resolve(uploadsDir, storedName);
  fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(destination, 0o640); } catch { /* ignore on platforms without chmod */ }
  return { storedName, sizeBytes: stat.size };
}
