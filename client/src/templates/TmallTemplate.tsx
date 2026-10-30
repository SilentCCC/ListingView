import { useEffect, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Grid2x2,
  Heart,
  Info,
  Maximize2,
  MessageCircle,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Store,
  Truck
} from 'lucide-react';
import type { Device, Product, ProductImage } from '../types';
import { imageUrl } from '../api';
import { DetailLayoutOverviewModal } from '../components/ImageManager';
import { getDisplaySpecs } from '../components/PreviewControls';

export function TmallTemplate({ product, device, onPreview }: { product: Product; device: Device; onPreview: (image: ProductImage) => void }) {
  const [activeImage, setActiveImage] = useState(0);
  const [activeSkuIndex, setActiveSkuIndex] = useState<number | null>(null);
  const [skuGridLarge, setSkuGridLarge] = useState(false);
  const [galleryTab, setGalleryTab] = useState<'image' | 'params'>('image');
  const [detailOverviewOpen, setDetailOverviewOpen] = useState(false);

  const images = product.effectiveImages.tmall.main;
  const skuImages = product.effectiveImages.tmall.sku || [];
  const details = product.effectiveImages.tmall.detail;
  const detailRows = details.map((image) => [image]);

  const title = product.platforms.tmall.title || product.genericTitle || product.name;
  const price = product.platforms.tmall.price ?? product.genericPrice;
  const numericPrice = typeof price === 'number' && Number.isFinite(price) ? price : null;
  const priceText = numericPrice !== null ? (Number.isInteger(numericPrice) ? String(numericPrice) : numericPrice.toFixed(2)) : '待定';
  const originalPrice = numericPrice !== null ? Math.round(numericPrice * 1.2) : null;
  const discountAmount = numericPrice !== null && originalPrice !== null ? Math.max(1, Math.round(originalPrice - numericPrice)) : 39;
  const coinDiscount = numericPrice !== null ? Math.max(1.2, Math.round(numericPrice * 0.02 * 100) / 100).toFixed(2) : '4.21';

  const safeActiveIndex = Math.min(activeImage, Math.max(images.length - 1, 0));
  const selectedMain = images[safeActiveIndex];
  const selectedSku = activeSkuIndex !== null ? skuImages[activeSkuIndex] : undefined;
  const selected = selectedSku || selectedMain || skuImages[0];
  const avatarImage = images[0] || skuImages[0];
  const reviewImages = (images.length > 0 ? images : skuImages).slice(0, 2);

  const displaySpecs = getDisplaySpecs(product);
  const brandValue = displaySpecs.find((s) => s.label.includes('品牌'))?.value || `${product.name.slice(0, 8) || 'besnfoto'}`;
  const materialValue = displaySpecs.find((s) => s.label.includes('面料') || s.label.includes('材质'))?.value || '防泼水面料';
  const styleValue = displaySpecs.find((s) => s.label.includes('风格'))?.value || '简约';
  const typeValue = displaySpecs.find((s) => s.label.includes('款式') || s.label.includes('节数'))?.value || (product.category === 'tripod' ? '便携三脚架' : '单肩斜挎');

  const highlightSpecs = [
    { label: '品牌', value: brandValue },
    { label: '材质', value: materialValue },
    { label: '风格', value: styleValue },
    { label: '款式', value: typeValue }
  ];

  const detailSpecRows = [
    { label: '型号', value: product.sku || '标准型号' },
    { label: '生产企业', value: `${brandValue}数码配件制品厂` },
    ...displaySpecs.filter((s) => !['品牌', '主面料', '主要材质', '风格', '款式'].includes(s.label))
  ];

  const skuSummaryText = skuImages.length > 0
    ? skuImages.map((_, idx) => `【规格 ${idx + 1}】${product.name.slice(0, 10) || '标准款'}`).join('  ')
    : `【默认规格】${product.name.slice(0, 12) || '标准配置'}`;

  useEffect(() => {
    setActiveImage(0);
    setActiveSkuIndex(null);
    setGalleryTab('image');
  }, [product.id]);

  const stepImage = (delta: number) => {
    if (!images.length) return;
    setActiveSkuIndex(null);
    setGalleryTab('image');
    setActiveImage((current) => (current + delta + images.length) % images.length);
  };

  return (
    <div className={`market-frame tmall-frame ${device}`}>
      {/* 1. Top Row: Tmall Logo on left, Capsule Search on right */}
      <div className="tmall-top-bar">
        <div className="tmall-logo-mark" aria-label="天猫">
          <strong>天猫</strong>
          <small>理想生活上天猫</small>
        </div>

        <div className="tmall-search-capsule">
          <div className="tmall-search-capsule__input">
            <input value={product.name.slice(0, 14) || '搜索天猫商品'} readOnly aria-label="搜索关键词" />
            <Camera size={16} className="tmall-search-capsule__camera" />
          </div>
          <button type="button" className="tmall-search-capsule__global">搜索</button>
          <button type="button" className="tmall-search-capsule__shop">搜本店</button>
        </div>
      </div>

      {/* 2. Store Header Row: Store Info & Actions aligned above Left Column */}
      <header className="tmall-store-bar">
        <div className="tmall-store-bar__inner">
          <div className="tmall-store-bar__left">
            <div className="tmall-store-avatar">
              {avatarImage ? (
                <img src={imageUrl(avatarImage)} alt={product.name} />
              ) : (
                <span>旗舰</span>
              )}
            </div>
            <div className="tmall-store-meta">
              <div className="tmall-store-meta__title">
                <strong>{product.name.slice(0, 8) || '品牌'}旗舰店</strong>
                <ChevronRight size={14} />
              </div>
              <div className="tmall-store-meta__sub">
                <span className="tmall-red-tag">天猫</span>
                <span className="tmall-stars" aria-label="店铺评分 4.7">
                  <Star size={11} fill="currentColor" />
                  <Star size={11} fill="currentColor" />
                  <Star size={11} fill="currentColor" />
                  <Star size={11} fill="currentColor" />
                  <Star size={11} fill="currentColor" />
                  <b>4.7</b>
                </span>
                <span className="tmall-store-divider">|</span>
                <span className="tmall-store-stats">90天新增74条好评 &nbsp;平均20小时发货 &nbsp;平均15小时退款</span>
              </div>
            </div>
          </div>

          <div className="tmall-store-bar__actions">
            <button type="button" className="tmall-pill-action">
              <MessageCircle size={13} className="tmall-pill-action__chat" /> 客服
            </button>
            <button type="button" className="tmall-pill-action">
              <Store size={13} /> 进店
            </button>
          </div>
        </div>
      </header>

      {/* 3. Authentic Two-Column Split Layout:
          Left Column = Gallery -> Tabs -> Reviews -> Q&A -> Params -> Detail Images
          Right Column = Sticky Product Purchase Panel + Bottom Floating CTA Dock */}
      <div className="tmall-pc-body">
        {/* LEFT COLUMN */}
        <div className="tmall-left-flow">
          <div className="tmall-gallery">
            <div className="tmall-gallery__stage">
              <div className="tmall-thumbnails">
                {images.length ? (
                  images.map((image, index) => (
                    <button
                      type="button"
                      key={image.id}
                      className={galleryTab === 'image' && activeSkuIndex === null && index === safeActiveIndex ? 'active' : ''}
                      onClick={() => {
                        setGalleryTab('image');
                        setActiveSkuIndex(null);
                        setActiveImage(index);
                      }}
                      aria-label={`查看第 ${index + 1} 张商品图片`}
                      aria-pressed={galleryTab === 'image' && activeSkuIndex === null && index === safeActiveIndex}
                    >
                      <img src={imageUrl(image)} alt="商品缩略图" />
                    </button>
                  ))
                ) : (
                  <div className="tmall-thumb-empty">主图</div>
                )}

                <button
                  type="button"
                  className={`tmall-param-thumb ${galleryTab === 'params' ? 'active' : ''}`}
                  onClick={() => setGalleryTab((current) => (current === 'params' ? 'image' : 'params'))}
                >
                  <SlidersHorizontal size={14} />
                  <span>参数</span>
                </button>
              </div>

              <div className="tmall-main-image">
                {galleryTab === 'params' ? (
                  <div className="tmall-stage-params">
                    <h4>商品核心参数</h4>
                    <div className="tmall-stage-params__grid">
                      {highlightSpecs.concat(detailSpecRows).map((spec, index) => (
                        <div key={`${spec.label}-${index}`}>
                          <span>{spec.label}</span>
                          <b>{spec.value}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : selected ? (
                  <>
                    <div
                      className="tmall-main-image__backdrop"
                      style={{ backgroundImage: `url(${imageUrl(selected)})` }}
                      aria-hidden="true"
                    />
                    {images.length > 1 && (
                      <button
                        type="button"
                        className="tmall-stage-arrow tmall-stage-arrow--left"
                        onClick={() => stepImage(-1)}
                        aria-label="上一张主图"
                      >
                        <ChevronLeft size={18} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="tmall-image-preview"
                      onClick={() => onPreview(selected)}
                      aria-label="放大查看商品主图"
                    >
                      <img src={imageUrl(selected)} alt={product.name} />
                    </button>
                    {images.length > 1 && (
                      <button
                        type="button"
                        className="tmall-stage-arrow tmall-stage-arrow--right"
                        onClick={() => stepImage(1)}
                        aria-label="下一张主图"
                      >
                        <ChevronRight size={18} />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="preview-placeholder tmall-placeholder">
                    <span>商品主图预览</span>
                    <small>请在左侧上传主图</small>
                  </div>
                )}
              </div>
            </div>

            <div className="tmall-gallery__Docked">
              <div className="tmall-media-switcher" role="tablist" aria-label="主图模式切换">
                <button
                  type="button"
                  className={galleryTab === 'image' ? 'active' : ''}
                  onClick={() => setGalleryTab('image')}
                >
                  视频
                </button>
                <button
                  type="button"
                  className={galleryTab === 'image' ? 'is-sub-active' : ''}
                  onClick={() => setGalleryTab('image')}
                >
                  图集
                </button>
                <button
                  type="button"
                  className={galleryTab === 'params' ? 'active' : ''}
                  onClick={() => setGalleryTab('params')}
                >
                  参数
                </button>
              </div>
            </div>
          </div>

          {/* Detail Navigation Tabs inside Left Column */}
          <div className="tmall-detail-tabs">
            <div className="tmall-detail-tabs__links">
              <strong>用户评价</strong>
              <span>参数信息</span>
              <span>图文详情</span>
              <span>本店推荐</span>
              <span>看了又看</span>
            </div>
            <button
              type="button"
              className="detail-overview-trigger detail-overview-trigger--tmall"
              onClick={() => setDetailOverviewOpen(true)}
              disabled={!details.length}
            >
              <Maximize2 size={13} /> 整体预览
            </button>
          </div>

          {/* User Reviews Section (用户评价 · 26) */}
          <section className="tmall-reviews-section" aria-label="用户评价">
            <h3 className="tmall-section-heading">用户评价 · 26</h3>
            <div className="tmall-review-tags">
              <span>整体体验好 2</span>
              <span>相机置放很合适 1</span>
              <span>对比更优 1</span>
              <span>质感不错 1</span>
              <span>空间很大 1</span>
              <span>设计合理 1</span>
              <span>拉链顺滑 1</span>
            </div>

            <div className="tmall-review-list">
              <article className="tmall-review-item">
                <div className="tmall-review-item__user">
                  <span className="tmall-review-avatar">买</span>
                  <div>
                    <strong>匿名买家</strong>
                    <small>2026-09-14</small>
                  </div>
                </div>
                <p>性价比高，同价位里用料挺舍得的，拉链顺滑、隔板厚实，日常出门收纳非常方便。</p>
              </article>

              <article className="tmall-review-item">
                <div className="tmall-review-item__user">
                  <span className="tmall-review-avatar">买</span>
                  <div>
                    <strong>匿名买家</strong>
                    <small>2026-09-07</small>
                  </div>
                </div>
                <p>相当不错，空间布局合理，分区清晰，做工细节很扎实。</p>
                {reviewImages.length > 0 && (
                  <div className="tmall-review-photos">
                    {reviewImages.map((img) => (
                      <button key={img.id} type="button" onClick={() => onPreview(img)}>
                        <img src={imageUrl(img)} alt="买家秀" />
                      </button>
                    ))}
                  </div>
                )}
              </article>
            </div>

            <div className="tmall-section-more">
              <button type="button" className="tmall-outline-pill">查看全部评价</button>
            </div>
          </section>

          {/* Ask Everyone Section (问大家 · 21) */}
          <section className="tmall-qa-section" aria-label="问大家">
            <h3 className="tmall-section-heading">问大家 · 21</h3>
            <div className="tmall-qa-grid">
              <div className="tmall-qa-card">
                <div className="tmall-qa-row">
                  <span className="tmall-qa-badge tmall-qa-badge--ask">问</span>
                  <b>这款日常出门装设备空间够用吗？</b>
                </div>
                <div className="tmall-qa-row">
                  <span className="tmall-qa-badge tmall-qa-badge--ans">答</span>
                  <span>完全够用，内部隔板可以根据需求自由调节。</span>
                </div>
                <small>更多回答 &gt;</small>
              </div>

              <div className="tmall-qa-card">
                <div className="tmall-qa-row">
                  <span className="tmall-qa-badge tmall-qa-badge--ask">问</span>
                  <b>面料防水耐磨效果怎么样？</b>
                </div>
                <div className="tmall-qa-row">
                  <span className="tmall-qa-badge tmall-qa-badge--ans">答</span>
                  <span>防泼水材质很厚实，日常小雨和剐蹭都没问题。</span>
                </div>
                <small>更多回答 &gt;</small>
              </div>
            </div>
            <div className="tmall-section-more">
              <button type="button" className="tmall-outline-pill">查看全部问答</button>
            </div>
          </section>

          {/* Parameters Section (参数信息) matching Tmall screenshot */}
          <section className="tmall-params-section" aria-label="参数信息">
            <h3 className="tmall-section-heading">参数信息</h3>
            <div className="tmall-params-highlights">
              {highlightSpecs.map((item, idx) => (
                <div key={`${item.label}-${idx}`} className="tmall-params-highlight-item">
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>

            <div className="tmall-params-kv-grid">
              {detailSpecRows.map((spec, idx) => (
                <div key={`${spec.label}-${idx}`} className="tmall-params-kv-item">
                  <span>{spec.label}</span>
                  <b>{spec.value}</b>
                </div>
              ))}
              <div className="tmall-params-kv-item tmall-params-kv-item--full">
                <span>颜色分类</span>
                <b>{skuSummaryText}</b>
              </div>
            </div>
          </section>

          {/* Graphic Details Section (图文详情 + 公益宝贝 + Detail Images) */}
          <section className="tmall-detail-section" aria-label="图文详情">
            <h3 className="tmall-section-heading">图文详情</h3>
            <div className="tmall-charity-banner">
              <div className="tmall-charity-icon">🌱</div>
              <div>
                <strong>公益宝贝</strong>
                <p>每笔成交将为 <b>零废星球</b> 捐赠 <em>0.1元</em>，已累计捐赠 <b>464</b> 笔。</p>
              </div>
            </div>

            {details.length > 0 ? (
              <div className="tmall-detail-images">
                {details.map((image, index) => (
                  <button
                    type="button"
                    key={image.id}
                    onClick={() => onPreview(image)}
                    aria-label={`放大查看第 ${index + 1} 张详情图`}
                  >
                    <img src={imageUrl(image)} alt={`${product.name}详情图 ${index + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="tmall-detail-empty">上传详情图后将在此处纵向展示</div>
            )}
          </section>
        </div>

        {/* RIGHT STICKY PURCHASE COLUMN */}
        <aside className="tmall-right-sticky">
          <section className="tmall-info">
            <h1 className="tmall-title">{title}</h1>

            <div className="tmall-sales-strip">
              <span className="tmall-sales-strip__sold">已售 28</span>
              <span className="tmall-sales-strip__sep">|</span>
              <span>可开发票</span>
              <span className="tmall-sales-strip__sep">|</span>
              <span>多人评价“整体体验好”</span>
            </div>

            <div className="tmall-price-area">
              <div className="tmall-price-line">
                <span className="tmall-price-line__label">平台加补后</span>
                <span className="tmall-price-line__currency">¥</span>
                <strong className="tmall-price-line__amount">{priceText}</strong>
                <span className="tmall-price-line__unit">起</span>
                {originalPrice !== null && (
                  <span className="tmall-price-line__origin">优惠前 ¥ {originalPrice}起</span>
                )}
              </div>

              <div className="tmall-benefit-line">
                <span className="tmall-benefit-line__title">已享受:</span>
                <span>淘金币已抵{coinDiscount}元</span>
                <span className="tmall-benefit-line__sep">|</span>
                <span>立减{discountAmount}元</span>
              </div>

              <div className="tmall-gift-line">
                <span className="tmall-benefit-line__title">可再享:</span>
                <span className="tmall-gift-tag">送赠品</span>
              </div>
            </div>

            <div className="tmall-service-lines">
              <div className="tmall-service-line">
                <Truck size={15} className="tmall-service-line__icon" />
                <div className="tmall-service-line__content">
                  <span className="tmall-green-badge">⚡后日达</span>
                  <span className="tmall-green-text">现在下单，预计后天送达</span>
                  <span>快递: 免运费</span>
                  <span className="tmall-service-line__sep">|</span>
                  <span>广东中山 至 中山市</span>
                  <ChevronDown size={13} className="tmall-service-line__caret" />
                </div>
              </div>

              <div className="tmall-service-line">
                <ShieldCheck size={15} className="tmall-service-line__icon" />
                <div className="tmall-service-line__content">
                  <span>退货宝</span>
                  <span>7天价保</span>
                  <span>7天无理由退换</span>
                  <span>假一赔四</span>
                  <span>极速退款</span>
                  <ChevronDown size={13} className="tmall-service-line__caret" />
                </div>
              </div>

              <div className="tmall-service-line">
                <CreditCard size={15} className="tmall-service-line__icon" />
                <div className="tmall-service-line__content">
                  <span>信用卡支付</span>
                  <Info size={13} className="tmall-service-line__caret" />
                </div>
              </div>
            </div>

            <div className="tmall-sku-section">
              <div className="tmall-sku-section__header">
                <span>颜色分类</span>
                <button
                  type="button"
                  className="tmall-sku-mode-toggle"
                  onClick={() => setSkuGridLarge((current) => !current)}
                >
                  <Grid2x2 size={13} /> {skuGridLarge ? '切换列表模式' : '切换大图模式'}
                </button>
              </div>

              {skuImages.length > 0 ? (
                <div className={`tmall-sku-list ${skuGridLarge ? 'is-large' : ''}`} role="list" aria-label="天猫规格图片">
                  {skuImages.map((image, index) => {
                    const isSelected = activeSkuIndex === index || (activeSkuIndex === null && !images.length && index === 0);
                    const cornerBadge = index === 0 ? '多人加购' : index === 1 ? '店长主推' : null;
                    return (
                      <button
                        type="button"
                        key={image.id}
                        className={`tmall-sku-option ${isSelected ? 'selected-spec' : ''}`}
                        onClick={() => {
                          setGalleryTab('image');
                          setActiveSkuIndex((current) => (current === index && images.length > 0 ? null : index));
                        }}
                        onDoubleClick={() => onPreview(image)}
                        title={`规格 ${index + 1}（点击在主图区预览，双击放大）`}
                        aria-pressed={isSelected}
                      >
                        {cornerBadge && <em className="tmall-sku-corner">{cornerBadge}</em>}
                        <img src={imageUrl(image)} alt={`规格 ${index + 1}`} />
                        <span>【规格 {index + 1}】{product.name.slice(0, 10) || '标准款'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="tmall-sku-list">
                  <button type="button" className="tmall-sku-option selected-spec">
                    <em className="tmall-sku-corner">多人加购</em>
                    {avatarImage && <img src={imageUrl(avatarImage)} alt="默认规格" />}
                    <span>【默认规格】{product.name.slice(0, 12) || '标准配置'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="tmall-qty-section">
              <span className="tmall-qty-section__label">数量</span>
              <div className="tmall-quantity-row">
                <div className="quantity-demo">
                  <button type="button">−</button>
                  <b>1</b>
                  <button type="button">+</button>
                </div>
                <small>有货</small>
              </div>
            </div>

            {/* Bottom Floating Action Bar inside Right Column */}
            <div className="tmall-action-dock">
              <div className="tmall-cta-pill">
                <button type="button" className="tmall-cart">加入购物车</button>
                <button type="button" className="tmall-buy">领券购买</button>
              </div>
              <button type="button" className="tmall-fav">
                <Heart size={16} />
                <span>收藏</span>
              </button>
            </div>
          </section>
        </aside>
      </div>

      <DetailLayoutOverviewModal
        open={detailOverviewOpen}
        rows={detailRows}
        title={`${product.name} · 天猫详情图整体预览`}
        onClose={() => setDetailOverviewOpen(false)}
      />
    </div>
  );
}
