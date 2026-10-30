import type { CustomSpecItem, DownloadPlatform, Platform, PreviewPlatform, Product, ProductCategory, ProductSpecs } from '../types';
import { Download, LoaderCircle, Monitor, Smartphone } from 'lucide-react';

export const PRODUCT_CATEGORIES: Array<{ key: ProductCategory; label: string }> = [
  { key: 'bag', label: '箱包' },
  { key: 'tripod', label: '脚架' },
  { key: 'other', label: '其他' },
];

export const BAG_SPEC_FIELDS = [
  { key: 'mainFabric', label: '主面料', placeholder: '例如：防泼水牛津布' },
  { key: 'lining', label: '里料', placeholder: '例如：聚酯纤维' },
  { key: 'outerSize', label: '外尺寸', placeholder: '例如：45 × 30 × 18 cm' },
  { key: 'innerSize', label: '内尺寸', placeholder: '例如：42 × 28 × 15 cm' },
  { key: 'color', label: '颜色', placeholder: '例如：曜石黑' },
  { key: 'weight', label: '重量', placeholder: '例如：0.95 kg' },
  { key: 'capacity', label: '容量', placeholder: '例如：20L' },
  { key: 'other', label: '其他', placeholder: '补充其他参数或说明信息' },
] as const;

export const TRIPOD_SPEC_FIELDS = [
  { key: 'material', label: '主要材质', placeholder: '例如：碳纤维 / 铝合金' },
  { key: 'loadCapacity', label: '承重', placeholder: '例如：8 kg' },
  { key: 'maxWorkingHeight', label: '最大工作高度', placeholder: '例如：165 cm' },
  { key: 'minWorkingHeight', label: '最小工作高度', placeholder: '例如：45 cm' },
  { key: 'foldedLength', label: '收纳长度', placeholder: '例如：48 cm' },
  { key: 'weight', label: '重量', placeholder: '例如：1.25 kg' },
  { key: 'sections', label: '节数', placeholder: '例如：4 节' },
  { key: 'other', label: '其他', placeholder: '补充其他参数或说明信息' },
] as const;

export function getDisplaySpecs(product: Pick<Product, 'category' | 'specs'>): CustomSpecItem[] {
  const category = product.category || 'bag';
  const specs = product.specs || {};
  if (category === 'bag') {
    const bag = specs.bag || {};
    return BAG_SPEC_FIELDS
      .map((field) => ({ label: field.label, value: (bag[field.key] || '').trim() }))
      .filter((item) => item.value);
  }
  if (category === 'tripod') {
    const tripod = specs.tripod || {};
    return TRIPOD_SPEC_FIELDS
      .map((field) => ({ label: field.label, value: (tripod[field.key] || '').trim() }))
      .filter((item) => item.value);
  }
  return (specs.other || [])
    .map((item) => ({ label: (item.label || '').trim(), value: (item.value || '').trim() }))
    .filter((item) => item.label && item.value);
}

export function PreviewControls({ platform, device, onPlatform, onDevice, onDownload, downloading, downloadDisabled }: {
  platform: PreviewPlatform;
  device: 'desktop' | 'mobile';
  onDownload?: (platform: DownloadPlatform) => void;
  downloading?: DownloadPlatform | null;
  downloadDisabled?: boolean;
  onPlatform: (value: PreviewPlatform) => void;
  onDevice: (platform: PreviewPlatform, device: 'desktop' | 'mobile') => void;
}) {
  const platforms: Array<{ id: PreviewPlatform; label: string; mark: string }> = [
    { id: 'amazon', label: '亚马逊', mark: 'AMAZON' },
    { id: 'tmall', label: '天猫', mark: 'TMALL' },
    { id: 'temu', label: 'Temu', mark: 'TEMU' },
    { id: 'aliexpress', label: 'AliExpress', mark: 'ALIEXPRESS' },
  ];
  return <div className="preview-control-groups">
    {platforms.map(({ id, label, mark }) => <div className={`preview-control-group ${platform === id ? 'is-active' : ''}`} key={id}>
      <button type="button" className={`platform-button platform-button--${id}`} aria-pressed={platform === id} onClick={() => onPlatform(id)}><span>{label}</span><small>{mark}</small></button>
      <div className={`device-buttons ${onDownload ? 'device-buttons--download' : ''}`}><button type="button" className={platform === id && device === 'desktop' ? 'selected' : ''} onClick={() => onDevice(id, 'desktop')}><Monitor size={14} />电脑</button><button type="button" className={platform === id && device === 'mobile' ? 'selected' : ''} onClick={() => onDevice(id, 'mobile')}><Smartphone size={14} />手机</button>{onDownload && <button type="button" className="platform-download" disabled={downloadDisabled || !!downloading} aria-label={`下载${label}图片 ZIP`} title={id === 'temu' || id === 'aliexpress' ? '下载通用主图和详情图' : '下载该平台使用的原图（含电脑及手机详情图）'} onClick={() => onDownload(id)}>{downloading === id ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{downloading === id ? '打包中' : '下载'}</button>}</div>
    </div>)}
  </div>;
}

export function initialDraft(product?: Product | null) {
  const category = (product?.category || 'bag') as ProductCategory;
  const bag: Record<string, string> = {};
  for (const field of BAG_SPEC_FIELDS) {
    bag[field.key] = category === 'bag' ? (product?.specs?.bag?.[field.key] || '') : '';
  }
  const tripod: Record<string, string> = {};
  for (const field of TRIPOD_SPEC_FIELDS) {
    tripod[field.key] = category === 'tripod' ? (product?.specs?.tripod?.[field.key] || '') : '';
  }
  const other: CustomSpecItem[] = category === 'other' && product?.specs?.other?.length
    ? product.specs.other.map((item) => ({ label: item.label || '', value: item.value || '' }))
    : [{ label: '', value: '' }];
  return {
    name: product?.name || '',
    sku: product?.sku || '',
    category,
    specs: {
      bag,
      tripod,
      other,
    } satisfies Required<ProductSpecs>,
    genericTitle: product?.genericTitle || '',
    genericPrice: product?.genericPrice == null ? '' : String(product.genericPrice),
    platforms: {
      amazon: { title: product?.platforms.amazon.title || '', price: product?.platforms.amazon.price == null ? '' : String(product.platforms.amazon.price) },
      tmall: { title: product?.platforms.tmall.title || '', price: product?.platforms.tmall.price == null ? '' : String(product.platforms.tmall.price) },
    },
  };
}
