import { useState } from 'react';
import { Maximize2, Search, ShoppingCart } from 'lucide-react';
import type { Device, Product, ProductImage } from '../types';
import { formatPrice, imageUrl } from '../api';
import { DetailLayoutOverviewModal } from '../components/ImageManager';

export function TmallTemplate({ product, device, onPreview }: { product: Product; device: Device; onPreview: (image: ProductImage) => void }) {
  const [activeImage, setActiveImage] = useState(0);
  const [detailOverviewOpen, setDetailOverviewOpen] = useState(false);
  const images = product.effectiveImages.tmall.main;
  const details = product.effectiveImages.tmall.detail;
  const detailRows = details.map((image) => [image]);
  const title = product.platforms.tmall.title || product.genericTitle || product.name;
  const price = product.platforms.tmall.price ?? product.genericPrice;
  const selected = images[Math.min(activeImage, Math.max(images.length - 1, 0))];
  return <div className={`market-frame tmall-frame ${device}`}>
    <div className="tmall-top-strip"><div><span>天猫预览</span><span>首页</span><span>品牌精选</span><span>商家服务</span></div><div><span>我的订单</span><span>购物车</span><span>帮助中心</span></div></div>
    <header className="tmall-header"><div className="tmall-brand"><span className="tmall-cat">天猫</span><div><strong>商品详情</strong><small>LISTING PREVIEW</small></div></div><div className="tmall-search"><input placeholder="搜索商品名称" /><button><Search size={18} /></button><div>本页面为商品展示预览</div></div></header>
    <div className="tmall-promo-line"><span>商品展示</span><span>商品信息 · 规格选择 · 详情介绍</span></div>
    <main className="tmall-product">
      <div className="tmall-gallery"><div className="tmall-main-image">{selected ? <button type="button" className="tmall-image-preview" onClick={() => onPreview(selected)} aria-label="放大查看商品主图"><img src={imageUrl(selected)} alt={product.name} /></button> : <div className="preview-placeholder tmall-placeholder"><span>商品主图预览</span><small>请在左侧上传主图</small></div>}</div><div className="tmall-thumbnails">{images.length ? images.map((image, index) => <button type="button" key={image.id} className={index === activeImage ? 'active' : ''} onClick={() => setActiveImage(index)} aria-label={`查看第 ${index + 1} 张商品图片`} aria-pressed={index === activeImage}><img src={imageUrl(image)} alt="商品缩略图" /></button>) : <span>上传主图后显示缩略图</span>}</div><div className="tmall-share">商品编号：{product.sku}</div></div>
      <section className="tmall-info"><h1>{title}</h1><p className="tmall-subtitle">{product.name} · 详情预览</p><div className="tmall-price-panel"><div><span>价格</span><strong>{formatPrice(price)}</strong></div><div><span>促销</span><b>未设置</b></div></div><div className="tmall-spec"><span>规格</span><button className="selected-spec">默认规格</button></div><div className="tmall-spec"><span>数量</span><div className="quantity-demo"><button>−</button><b>1</b><button>＋</button></div></div><div className="tmall-actions"><button className="tmall-buy">立即购买 · 预览</button><button className="tmall-cart"><ShoppingCart size={16} /> 加入购物车</button></div><p className="tmall-disclaimer">仅模拟页面样式，不提供真实购买功能或销量数据</p><div className="tmall-service"><span>服务</span><b>商品信息以商家实际发布为准</b></div></section>
    </main>
    <div className="tmall-detail-tabs">
      <div className="tmall-detail-tabs__links"><strong>商品详情</strong><span>规格参数</span><span>售后服务</span></div>
      <button type="button" className="detail-overview-trigger detail-overview-trigger--tmall" onClick={() => setDetailOverviewOpen(true)} disabled={!details.length}>
        <Maximize2 size={13} /> 整体预览
      </button>
    </div>
    {details.length > 0 ? <section className="tmall-detail-images">{details.map((image, index) => <button type="button" key={image.id} onClick={() => onPreview(image)} aria-label={`放大查看第 ${index + 1} 张详情图`}><img src={imageUrl(image)} alt={`${product.name}详情图 ${index + 1}`} loading="lazy" /></button>)}</section> : <div className="tmall-detail-empty">上传详情图后将在此处纵向展示</div>}
    <DetailLayoutOverviewModal
      open={detailOverviewOpen}
      rows={detailRows}
      title={`${product.name} · 天猫详情图整体预览`}
      onClose={() => setDetailOverviewOpen(false)}
    />
  </div>;
}
