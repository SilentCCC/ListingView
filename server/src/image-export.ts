import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import { ZipFile } from 'yazl';
import { httpError } from './http.js';
import { resolveStoredFilePath } from './storage.js';
import type { Platform, Product, ProductImage } from './types.js';

type StoredImage = ProductImage & { storedName: string };
type ExportEntry = { name: string; filePath: string; stat: fs.Stats };
const maxConcurrentExports = 2;
let activeExports = 0;

export function platformImageEntries(product: Product, platform: Platform, safeSku: string): ExportEntry[] {
  const effective = product.effectiveImages[platform];
  // A platform download includes both device layouts, excluding unused fallbacks.
  const selected = [...effective.main, ...effective.detailByDevice.desktop, ...effective.detailByDevice.mobile] as StoredImage[];
  const images = product.images as StoredImage[];
  const commonOwners = new Map(images.filter((image) => image.scope === 'common').map((image) => [image.kind + ':' + image.storedName, image]));
  const seen = new Set<string>();
  const counters = new Map<string, number>();
  return selected.flatMap((image) => {
    const key = image.kind + ':' + image.storedName;
    if (seen.has(key)) return [];
    seen.add(key);
    // Imported common materials retain common ownership, even when referenced by a platform.
    const owner = commonOwners.get(key) || image;
    const kind = image.kind === 'main' ? '主图' : '详情图';
    const scope = owner.scope === 'common' ? '' : owner.scope === 'amazon' ? '-亚马逊' : '-天猫';
    const device = owner.device === 'all' ? '' : owner.device === 'desktop' ? '-电脑' : '-手机';
    const prefix = safeSku + scope + device + '-' + kind;
    const order = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, order);
    const extension = path.posix.extname(image.storedName).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) throw httpError(400, '图片文件格式不可下载');
    const filePath = resolveStoredFilePath(image.storedName);
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw httpError(404, '部分图片文件不存在，请检查素材后重试');
    return [{ name: kind + '/' + prefix + '-' + String(order).padStart(2, '0') + extension, filePath, stat }];
  });
}

export async function streamImageZip(response: Response, entries: ExportEntry[], filename: string): Promise<void> {
  if (!entries.length) throw httpError(400, '当前平台没有可下载的图片');
  if (activeExports >= maxConcurrentExports) {
    response.setHeader('Retry-After', '3');
    throw httpError(429, '正在打包的任务较多，请稍后重试');
  }
  activeExports++;
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  let input: fs.ReadStream | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    input?.destroy();
    output.destroy();
  };
  zip.on('error', (error: Error) => output.destroy(error));
  response.once('close', stop);
  try {
    // STORE mode preserves bytes and avoids spending CPU recompressing image formats.
    zip.addEmptyDirectory('主图/');
    zip.addEmptyDirectory('详情图/');
    for (const entry of entries) {
      zip.addReadStreamLazy(entry.name, { compress: false, size: entry.stat.size, mtime: entry.stat.mtime, mode: 0o100644 }, (callback) => {
        fs.open(entry.filePath, 'r', (openError, fd) => {
          if (openError) { callback(openError, undefined!); return; }
          fs.fstat(fd, (statError, stat) => {
            const changed = statError || !stat.isFile() || stat.ino !== entry.stat.ino || stat.dev !== entry.stat.dev || stat.size !== entry.stat.size || stat.mtimeMs !== entry.stat.mtimeMs;
            if (stopped || changed) {
              fs.close(fd, () => {});
              if (!stopped) callback(statError || new Error('下载期间图片发生变化，请重试'), undefined!);
              return;
            }
            input = fs.createReadStream(entry.filePath, { fd, autoClose: true });
            callback(null, input);
          });
        });
      });
    }
    response.attachment(filename);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Cache-Control', 'no-store');
    // pipeline applies backpressure and destroys the stream when the client disconnects.
    const transfer = pipeline(output, response);
    zip.end();
    await transfer;
  } catch (error) {
    // After headers are sent, a failed transfer must end as a broken download, never as a valid ZIP plus JSON.
    if (!response.destroyed) throw error;
  } finally {
    stop();
    response.off('close', stop);
    activeExports--;
  }
}
