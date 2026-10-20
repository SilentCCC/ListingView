import { useRef, useState, type TouchEvent } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  MapPin,
  Menu,
  Search,
  Share2,
  ShoppingCart,
} from 'lucide-react';
import type { Device, Product, ProductImage } from '../types';
import { imageUrl } from '../api';
import { DetailLayoutOverviewModal, groupImagesIntoRows } from '../components/ImageManager';

function splitPrice(price: number | null) {
  if (price == null || !Number.isFinite(Number(price))) return null;
  const [whole, fraction = '00'] = Number(price).toFixed(2).split('.');
  return { whole: Number(whole).toLocaleString('en-US'), fraction };
}

function AmazonDetailCarouselRow({ row, rowIndex, productName, onPreview }: { row: ProductImage[]; rowIndex: number; productName: string; onPreview: (image: ProductImage) => void }) {
  const [activeSlide, setActiveSlide] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const didSwipe = useRef(false);
  const currentIndex = Math.min(activeSlide, row.length - 1);
  const currentImage = row[currentIndex] || row[0];

  const handleTouchStart = (event: TouchEvent<HTMLButtonElement>) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    didSwipe.current = false;
  };
  const handleTouchEnd = (event: TouchEvent<HTMLButtonElement>) => {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch || row.length < 2) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    didSwipe.current = true;
    setActiveSlide((index) => Math.max(0, Math.min(row.length - 1, index + (deltaX < 0 ? 1 : -1))));
  };

  if (row.length === 1) {
    return (
      <button type="button" className="amazon-detail-single" onClick={() => onPreview(currentImage)} aria-label={`放大查看第 ${rowIndex + 1} 行详情图`}>
        <img src={imageUrl(currentImage)} alt={`${productName}详情图 第 ${rowIndex + 1} 行`} loading="lazy" />
      </button>
    );
  }

  const offset = `calc(64px - ${currentIndex * 100}% + ${currentIndex * 128}px)`;
  return (
    <div className="amazon-detail-carousel" aria-label={`第 ${rowIndex + 1} 行详情横滑模块`}>
      <div className="amazon-detail-carousel__stage">
        <div className="amazon-detail-carousel__track" style={{ transform: `translateX(${offset})` }}>
          {row.map((image, index) => (
            <button
              type="button"
              className="amazon-detail-carousel__slide"
              key={image.id}
              onClick={() => {
                if (didSwipe.current) {
                  didSwipe.current = false;
                  return;
                }
                onPreview(image);
              }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              aria-label={`放大查看第 ${rowIndex + 1} 行第 ${index + 1} 张详情图`}
              aria-current={index === currentIndex}
            >
              <img src={imageUrl(image)} alt={`${productName}详情图 ${rowIndex + 1}-${index + 1}`} loading="lazy" />
            </button>
          ))}
        </div>
        <button type="button" className="amazon-detail-carousel__nav amazon-detail-carousel__nav--prev" onClick={() => setActiveSlide((index) => Math.max(0, index - 1))} disabled={currentIndex === 0} aria-label="上一张详情图"><ChevronLeft size={20} /></button>
        <button type="button" className="amazon-detail-carousel__nav amazon-detail-carousel__nav--next" onClick={() => setActiveSlide((index) => Math.min(row.length - 1, index + 1))} disabled={currentIndex === row.length - 1} aria-label="下一张详情图"><ChevronRight size={20} /></button>
        <span className="amazon-detail-carousel__badge">{currentIndex + 1} / {row.length}</span>
      </div>
    </div>
  );
}export function AmazonTemplate({ product, recommendations, device, onPreview }: { product: Product; recommendations: Product[]; device: Device; onPreview: (image: ProductImage) => void }) {
  const [activeImage, setActiveImage] = useState(0);
  const [detailOverviewOpen, setDetailOverviewOpen] = useState(false);
  const images = product.effectiveImages.amazon.main;
  const details = product.effectiveImages.amazon.detailByDevice[device];
  const detailRows = groupImagesIntoRows(details, 3);
  const title = product.platforms.amazon.title || product.genericTitle || product.name;
  const price = product.platforms.amazon.price ?? product.genericPrice;
  const selectedImage = images[activeImage] ?? images[0];
  const priceParts = splitPrice(price);
  const totalSlots = 6;
  const recommendationSlots = [
    ...recommendations.slice(0, totalSlots),
    ...Array.from({ length: Math.max(0, totalSlots - recommendations.length) }, () => null),
  ];

  const renderPrice = (value: number | null, className: string) => {
    const parts = splitPrice(value);
    if (!parts) return <span className={`${className} ${className}--unset`}>未设置价格</span>;
    return <span className={className} aria-label={`$${parts.whole}.${parts.fraction}`}>
      <sup className="amazon-currency">$</sup>
      <strong className="amazon-price-whole">{parts.whole}</strong>
      <sup className="amazon-price-fraction">{parts.fraction}</sup>
    </span>;
  };

  return <div className={`market-frame amazon-frame ${device}`}>
    <header className="amazon-topbar">
      <div className="market-logo" aria-label="Amazon">amazon</div>
      <div className="amazon-location"><MapPin size={16} /><div><small>配送至</small><strong>选择配送地址</strong></div></div>
      <div className="amazon-search"><button type="button" className="amazon-search-category">全部 <ChevronDown size={11} /></button><div className="amazon-search-input">搜索 Amazon</div><button type="button" className="amazon-search-submit" aria-label="搜索"><Search size={19} /></button></div>
      <div className="amazon-language"><strong>ZH</strong><ChevronDown size={10} /></div>
      <div className="amazon-account"><small>您好，登录</small><strong>账户及列表 <ChevronDown size={10} /></strong></div>
      <div className="amazon-orders"><small>退货</small><strong>与订单</strong></div>
      <div className="amazon-cart"><ShoppingCart size={26} /><strong>购物车</strong></div>
    </header>

    <nav className="amazon-subnav" aria-label="Amazon 导航">
      <span className="amazon-subnav-all"><Menu size={16} /> 全部</span>
      <span>今日优惠</span><span>Prime Video</span><span>礼品卡</span><span>客户服务</span><span>列表</span><span>销售</span>
    </nav>

    <div className="market-breadcrumb"><span>全部分类</span><ChevronRight size={11} /><span>商品预览</span><ChevronRight size={11} /><strong>{product.name}</strong></div>

    <div className="amazon-product-layout">
      <section className="amazon-gallery" aria-label="商品图片">
        <div className="amazon-thumbnails">
          {images.length > 0 ? images.map((image, index) => <button
            type="button"
            key={image.id}
            className={index === activeImage ? 'active' : ''}
            onClick={() => setActiveImage(index)}
            onMouseEnter={() => setActiveImage(index)}
            aria-label={`查看第 ${index + 1} 张商品图片`}
            aria-pressed={index === activeImage}
          ><img src={imageUrl(image)} alt="" loading={index === 0 ? 'eager' : 'lazy'} /></button>) : <div className="thumb-placeholder">暂无<br />主图</div>}
        </div>
        <div className="amazon-main-stage">
          <div className="amazon-main-image">
            {selectedImage ? <button type="button" className="amazon-image-preview" onClick={() => onPreview(selectedImage)} aria-label="放大查看商品主图"><img src={imageUrl(selectedImage)} alt={product.name} /></button> : <div className="preview-placeholder"><span>商品主图预览</span><small>上传主图后会显示在这里</small></div>}
            <button type="button" className="amazon-image-share" aria-label="分享（仅预览）"><Share2 size={16} /></button>
          </div>
          <p className="amazon-zoom-caption">{selectedImage ? '点击图片可查看完整视图' : '左侧上传主图后可在此预览'}</p>
        </div>
      </section>

      <main className="amazon-summary">
        <div className="amazon-visit-line">品牌或店铺：<span>{product.name}</span></div>
        <h1>{title}</h1>
        <div className="amazon-meta-line">
          <span>SKU / 编号：<strong>{product.sku}</strong></span>
          <span className="amazon-meta-dot">·</span>
          <span>评分与评论未配置</span>
        </div>
        <div className="amazon-divider" />
        <div className="amazon-price-block">
          {priceParts ? renderPrice(price, 'amazon-price') : <strong className="amazon-price-unset">价格未设置</strong>}
          <small>价格和退货说明以当前商品资料为准，未配置的促销信息不会自动编造。</small>
        </div>
        <div className="amazon-divider" />
        <section className="amazon-spec-table" aria-label="商品参数">
          <div><span>商品名称</span><strong>{product.name}</strong></div>
          <div><span>商品编号</span><strong>{product.sku}</strong></div>
          <div><span>主图数量</span><strong>{images.length ? `${images.length} 张` : '未上传'}</strong></div>
          <div><span>详情图（{device === 'desktop' ? '电脑版' : '手机版'}）</span><strong>{details.length ? `${details.length} 张` : '未上传'}</strong></div>
        </section>
        <div className="amazon-divider" />
        <section className="amazon-about">
          <h2>关于该商品</h2>
          <ul>
            <li>当前标题：{title}</li>
            {product.genericTitle && product.genericTitle !== title && <li>通用标题：{product.genericTitle}</li>}
            <li>主图支持悬停或点击缩略图切换，点击大图可放大查看；下方详情图按顺序纵向展示。</li>
          </ul>
        </section>
      </main>

      <aside className="amazon-buybox" aria-label="购买区域预览">
        <div className="amazon-buybox-main">
          <div className="amazon-buybox-price-row">{renderPrice(price, 'amazon-buybox-price')}</div>
          <div className="amazon-buybox-copy">
            <span>配送时间与运费未配置</span>
            <span className="amazon-buybox-location"><MapPin size={13} /> 配送至 选择配送地址</span>
          </div>
          <div className="amazon-stock-line">库存与购买限制未配置</div>
          <button type="button" className="amazon-quantity"><span>数量: 1</span><ChevronDown size={14} /></button>
          <div className="amazon-purchase-actions">
            <button type="button" className="amazon-cart-button">加入购物车</button>
            <button type="button" className="amazon-buy-button">立即购买</button>
          </div>
          <dl className="amazon-buybox-meta">
            <div><dt>发货方</dt><dd>Amazon 预览</dd></div>
            <div><dt>销售方</dt><dd>{product.name}</dd></div>
            <div><dt>退货</dt><dd>按商品实际说明</dd></div>
          </dl>
        </div>
        <button type="button" className="amazon-wishlist">添加到列表</button>
      </aside>
    </div>

    <section className="amazon-carousel-section" aria-labelledby="amazon-also-viewed-title">
      <div className="amazon-carousel-header">
        <h2 id="amazon-also-viewed-title">浏览此商品的顾客也同时浏览</h2>
        <span>第 1 页，共 1 页</span>
      </div>
      <div className="amazon-carousel-shell">
        <span className="amazon-carousel-arrow" aria-hidden="true"><ChevronLeft size={18} /></span>
        <div className="amazon-recommendations__list">
          {recommendationSlots.map((item, index) => {
            if (!item) return <div className="amazon-recommendation-card amazon-recommendation-card--empty" key={`empty-${index}`} aria-hidden="true"><div className="amazon-recommendation-card__image" /></div>;
            const image = item.effectiveImages.amazon.main[0] || item.effectiveImages.tmall.main[0];
            const itemTitle = item.platforms.amazon.title || item.genericTitle || item.name;
            const itemPrice = item.platforms.amazon.price ?? item.genericPrice;
            return <article className="amazon-recommendation-card" key={item.id}>
              <button
                type="button"
                className="amazon-recommendation-card__image"
                onClick={() => image && onPreview(image)}
                disabled={!image}
                aria-label={`查看 ${item.name} 主图`}
              >{image && <img src={imageUrl(image)} alt={item.name} loading="lazy" />}</button>
              <a
                href="#amazon-also-viewed-title"
                className="amazon-recommendation-card__title"
                onClick={(event) => event.preventDefault()}
                title={itemTitle}
              >{itemTitle}</a>
              <small className="amazon-recommendation-card__sku">SKU: {item.sku}</small>
              {itemPrice != null && renderPrice(itemPrice, 'amazon-recommendation-price')}
            </article>;
          })}
        </div>
        <span className="amazon-carousel-arrow" aria-hidden="true"><ChevronRight size={18} /></span>
      </div>
    </section>

    <section className="amazon-detail-section">
      <div className="amazon-detail-heading">
        <div className="amazon-detail-heading__left">
          <h2>商品描述 / A+ 详情预览</h2>
          <span>{device === 'desktop' ? '电脑端详情图' : '手机端详情图'} · 共 {detailRows.length} 行 · 支持同行左右滑动与点击放大</span>
        </div>
        <button type="button" className="detail-overview-trigger" onClick={() => setDetailOverviewOpen(true)} disabled={!details.length}>
          <Maximize2 size={14} /> 整体预览
        </button>
      </div>
      {detailRows.length > 0 ? (
        <div className="amazon-detail-images">
          {detailRows.map((row, rowIndex) => (
            <AmazonDetailCarouselRow
              key={row.map((item) => item.id).join('-')}
              row={row}
              rowIndex={rowIndex}
              productName={product.name}
              onPreview={onPreview}
            />
          ))}
        </div>
      ) : (
        <div className="amazon-detail-empty">详情图片上传后会按顺序纵向显示在这里</div>
      )}
    </section>
    <DetailLayoutOverviewModal
      open={detailOverviewOpen}
      rows={detailRows}
      title={`${product.name} · 亚马逊${device === 'desktop' ? '电脑端' : '手机端'}详情图整体预览`}
      onClose={() => setDetailOverviewOpen(false)}
    />
  </div>;
}
