import { useMemo } from 'react';
import type { Device, PreviewPlatform, Product, ProductImage } from '../types';
import { AmazonTemplate } from './AmazonTemplate';
import { TmallTemplate } from './TmallTemplate';
import { TemuTemplate } from './TemuTemplate';
import { AliExpressPlaceholder } from './AliExpressPlaceholder';
import './amazon.css';
import './tmall.css';

export function ProductPreview({ product, products, platform, device, onPreview, onSelectProduct }: { product: Product; products: Product[]; platform: PreviewPlatform; device: Device; onPreview: (image: ProductImage) => void; onSelectProduct?: (product: Product) => void }) {
  const recommendations = useMemo(() => {
    const candidates = products.filter((item) => item.id !== product.id && (item.effectiveImages.amazon.main.length > 0 || item.effectiveImages.tmall.main.length > 0 || item.images.some((image) => image.kind === 'main')));
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }
    return candidates.slice(0, 6);
  }, [product.id, products]);

  return <div className={`preview-shell preview-shell--${device} preview-shell--${platform}`}>
    {platform === 'amazon' ? <AmazonTemplate product={product} recommendations={recommendations} device={device} onPreview={onPreview} onSelectProduct={onSelectProduct} /> : platform === 'tmall' ? <TmallTemplate product={product} device={device} onPreview={onPreview} /> : platform === 'temu' ? <TemuTemplate product={product} device={device} onPreview={onPreview} /> : <AliExpressPlaceholder product={product} device={device} onPreview={onPreview} />}
  </div>;
}
