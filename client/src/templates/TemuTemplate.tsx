import { useState } from 'react';
import { ChevronLeft, ChevronRight, Globe2, Info, Search, ShoppingCart, Truck, UserRound } from 'lucide-react';
import type { Device, Product, ProductImage } from '../types';
import { imageUrl } from '../api';
import { getDisplaySpecs } from '../components/PreviewControls';
import './temu.css';

export function TemuTemplate({ product, device, onPreview }: { product: Product; device: Device; onPreview: (image: ProductImage) => void }) {
  const commonImages = product.images
    .filter((image) => image.scope === 'common' && image.kind === 'main' && image.device === 'all')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const images = commonImages.length ? commonImages : product.effectiveImages.tmall.main.length
    ? product.effectiveImages.tmall.main
    : product.effectiveImages.amazon.main;
  const commonDetails = product.images
    .filter((image) => image.scope === 'common' && image.kind === 'detail' && image.device === 'all')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = images[Math.min(activeIndex, Math.max(0, images.length - 1))];
  const title = product.platforms.tmall.title || product.platforms.amazon.title || product.genericTitle || product.name;
  const price = product.platforms.tmall.price ?? product.platforms.amazon.price ?? product.genericPrice;
  const specs = getDisplaySpecs(product).slice(0, 4);
  const changeImage = (step: number) => setActiveIndex((index) => (index + step + images.length) % images.length);

  return <div className={`temu-page temu-page--${device}`}>
    <div className="temu-promo"><span>今日上新</span><span>热门精选</span><span><Globe2 size={14} /> 探索全球好物</span><span className="temu-promo__join">TEMU</span></div>
    <header className="temu-header">
      <div className="temu-logo"><b>T</b><span>TEMU</span></div>
      <nav className="temu-nav"><span>畅销商品</span><span>新品</span><span>分类</span></nav>
      <label className="temu-search"><span>搜索商品</span><button type="button" aria-label="搜索"><Search size={17} /></button></label>
      <div className="temu-header__account"><UserRound size={17} /><span>账户</span></div>
      <ShoppingCart size={19} />
    </header>
    <div className="temu-breadcrumb">首页 <span>›</span> 商品 <span>›</span> {product.name}</div>
    <main className="temu-product">
      <section className="temu-gallery" aria-label="商品图片">
        <div className="temu-gallery__main">
          <div className="temu-thumbnails">
            {images.length ? images.slice(0, 8).map((image, index) => <button type="button" key={image.id} className={index === activeIndex ? 'is-active' : ''} onClick={() => setActiveIndex(index)} aria-label={`查看第 ${index + 1} 张商品图`}><img src={imageUrl(image)} alt="" /></button>) : <span>主图</span>}
          </div>
          <div className="temu-stage">
            {activeImage ? <>
              <img src={imageUrl(activeImage)} alt={product.name} onClick={() => onPreview(activeImage)} />
              {images.length > 1 && <><button type="button" className="temu-stage__arrow temu-stage__arrow--left" onClick={() => changeImage(-1)} aria-label="上一张"><ChevronLeft size={20} /></button><button type="button" className="temu-stage__arrow temu-stage__arrow--right" onClick={() => changeImage(1)} aria-label="下一张"><ChevronRight size={20} /></button></>}
            </> : <div className="temu-stage__empty">上传商品主图后显示预览</div>}
          </div>
        </div>
        {commonDetails.length > 0 && <section className="temu-common-details" aria-label="商品详情图片">
          {commonDetails.map((image) => <img key={image.id} src={imageUrl(image)} alt={product.name} onClick={() => onPreview(image)} />)}
        </section>}
      </section>
      <section className="temu-info">
        <div className="temu-delivery"><Truck size={14} /> 配送信息 <span>以实际设置为准</span></div>
        <h1>{title}</h1>
        <div className="temu-sku">商品型号：{product.sku || '—'}</div>
        <div className="temu-price"><span>预估</span><strong>{price == null ? '价格待填写' : <><small>¥</small>{Number(price).toFixed(2)}</>}</strong></div>
        <div className="temu-benefits"><span><Info size={14} /> 服务政策待填写</span><span><Info size={14} /> 详情以实际设置为准</span></div>
        <div className="temu-variant"><span>规格</span><strong>{specs.find((spec) => /颜色|color/i.test(spec.label))?.value || '默认规格'}</strong></div>
        <div className="temu-actions"><button type="button">加入购物车</button><button type="button">立即购买</button></div>
        <div className="temu-service"><Info size={16} /><span>服务说明待填写</span><ChevronRight size={15} /></div>
        <div className="temu-specs">{specs.map((spec) => <div key={spec.label}><span>{spec.label}</span><b>{spec.value}</b></div>)}</div>
      </section>
    </main>
  </div>;
}
