import type { Platform, Product } from '../types';
import { Download, LoaderCircle, Monitor, Smartphone } from 'lucide-react';

export function PreviewControls({ platform, device, onPlatform, onDevice, onDownload, downloading, downloadDisabled }: {
  platform: Platform;
  device: 'desktop' | 'mobile';
  onDownload?: (platform: Platform) => void;
  downloading?: Platform | null;
  downloadDisabled?: boolean;
  onPlatform: (value: Platform) => void;
  onDevice: (platform: Platform, device: 'desktop' | 'mobile') => void;
}) {
  return <div className="preview-control-groups">
    {(['amazon', 'tmall'] as Platform[]).map((item) => <div className={`preview-control-group ${platform === item ? 'is-active' : ''}`} key={item}>
      <button className={`platform-button platform-button--${item}`} onClick={() => onPlatform(item)}><span>{item === 'amazon' ? '亚马逊' : '天猫'}</span><small>{item === 'amazon' ? 'Amazon' : 'TMALL'}</small></button>
      <div className={`device-buttons ${onDownload ? 'device-buttons--download' : ''}`}><button className={platform === item && device === 'desktop' ? 'selected' : ''} onClick={() => onDevice(item, 'desktop')}><Monitor size={14} />电脑</button><button className={platform === item && device === 'mobile' ? 'selected' : ''} onClick={() => onDevice(item, 'mobile')}><Smartphone size={14} />手机</button>{onDownload && <button type="button" className="platform-download" disabled={downloadDisabled || !!downloading} aria-label={`下载${item === 'amazon' ? '亚马逊' : '天猫'}图片 ZIP`} title="下载该平台使用的原图（含电脑及手机详情图）" onClick={() => onDownload(item)}>{downloading === item ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{downloading === item ? '打包中' : '下载'}</button>}</div>
    </div>)}
  </div>;
}

export function initialDraft(product?: Product | null) {
  return {
    name: product?.name || '',
    sku: product?.sku || '',
    genericTitle: product?.genericTitle || '',
    genericPrice: product?.genericPrice == null ? '' : String(product.genericPrice),
    platforms: {
      amazon: { title: product?.platforms.amazon.title || '', price: product?.platforms.amazon.price == null ? '' : String(product.platforms.amazon.price) },
      tmall: { title: product?.platforms.tmall.title || '', price: product?.platforms.tmall.price == null ? '' : String(product.platforms.tmall.price) },
    },
  };
}
