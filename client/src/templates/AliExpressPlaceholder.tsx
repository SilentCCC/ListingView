import { Globe2, ImagePlus } from 'lucide-react';
import type { Device, Product, ProductImage } from '../types';
import { imageUrl } from '../api';

export function AliExpressPlaceholder({ product, device, onPreview }: { product: Product; device: Device; onPreview: (image: ProductImage) => void }) {
  const commonImages = product.images
    .filter((image) => image.scope === 'common' && image.device === 'all' && (image.kind === 'main' || image.kind === 'detail'))
    .sort((a, b) => a.kind === b.kind ? a.sortOrder - b.sortOrder : a.kind === 'main' ? -1 : 1);

  return <section className={`aliexpress-placeholder aliexpress-placeholder--${device}`}>
    <div className="aliexpress-placeholder__brand"><Globe2 size={18} /><span>AliExpress</span></div>
    {commonImages.length > 0 ? <div className="aliexpress-placeholder__assets">
      {commonImages.map((image) => <button type="button" key={image.id} onClick={() => onPreview(image)} aria-label={`预览${image.kind === 'main' ? '通用主图' : '通用详情图'}`}>
        <img src={imageUrl(image)} alt={product.name} />
      </button>)}
    </div> : <div className="aliexpress-placeholder__content">
      <div className="aliexpress-placeholder__icon"><ImagePlus size={23} /></div>
      <h3>AliExpress 页面参考待补充</h3>
      <p>收到参考图后再按对应平台结构制作预览。</p>
    </div>}
  </section>;
}
