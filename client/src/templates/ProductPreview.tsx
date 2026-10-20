import { useMemo } from 'react';
import type { Device, Platform, Product, ProductImage } from '../types';
import { AmazonTemplate } from './AmazonTemplate';
import { TmallTemplate } from './TmallTemplate';
import './amazon.css';
import './tmall.css';

export function ProductPreview({ product, products, platform, device, onPreview }: { product: Product; products: Product[]; platform: Platform; device: Device; onPreview: (image: ProductImage) => void }) {
  const recommendations = useMemo(() => {
    const candidates = products.filter((item) => item.id !== product.id && (item.effectiveImages.amazon.main.length > 0 || item.effectiveImages.tmall.main.length > 0));
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }
    return candidates.slice(0, 6);
  }, [product.id, products]);

  return <div className={`preview-shell preview-shell--${device}`}>
    {platform === 'amazon' ? <AmazonTemplate product={product} recommendations={recommendations} device={device} onPreview={onPreview} /> : <TmallTemplate product={product} device={device} onPreview={onPreview} />}
  </div>;
}
