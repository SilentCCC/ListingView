import type { ChangeEvent, KeyboardEvent } from 'react';
import { Eye, Lock, LogOut, Pencil, Plus, Search } from 'lucide-react';
import type { Product } from '../types';
import { imageUrl, formatPrice } from '../api';

interface ProductSidebarProps {
  products: Product[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (product: Product, mode: 'edit' | 'preview') => void;
  onCreate: () => void;
  canEdit?: boolean;
  passwordRequired?: boolean;
  onRequestUnlock?: () => void;
  onLock?: () => void;
  compact?: boolean;
}

export function ProductSidebar({
  products,
  search,
  onSearch,
  onSelect,
  onCreate,
  canEdit = false,
  passwordRequired = false,
  onRequestUnlock,
  onLock,
  compact = false,
}: ProductSidebarProps) {
  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLElement>, product: Product) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(product, 'preview');
    }
  };

  return <main className={`product-catalog ${compact ? 'product-catalog--compact' : ''}`}>
    <header className="catalog-header">
      <div>
        <span className="eyebrow">LISTINGVIEW · CATALOG</span>
        <h1>商品库</h1>
        <p>{canEdit ? '管理商品信息，快速进入详情预览或编辑' : '查看商品详情预览，支持切换平台设备并下载原图'}</p>
      </div>
      <div className="catalog-header__actions">
        {passwordRequired && !canEdit && onRequestUnlock && (
          <button type="button" className="ghost-button auth-button" onClick={onRequestUnlock}>
            <Lock size={15} /> 输入密码编辑
          </button>
        )}
        {passwordRequired && canEdit && onLock && (
          <button type="button" className="ghost-button auth-button" onClick={onLock}>
            <LogOut size={15} /> 退出编辑
          </button>
        )}
        {canEdit && (
          <button type="button" className="primary-button" onClick={onCreate}>
            <Plus size={16} /> 新建商品
          </button>
        )}
      </div>
    </header>
    <div className="search-box"><Search size={16} /><input value={search} onChange={(event: ChangeEvent<HTMLInputElement>) => onSearch(event.target.value)} placeholder="搜索名称或编号" /></div>
    <div className="product-grid">{products.map((product) => {
      const cover = product.effectiveImages.amazon.main[0] || product.effectiveImages.tmall.main[0] || product.images.find((image) => image.kind === 'main');
      return <article className="catalog-card" key={product.id}>
        <div
          className="catalog-card__image"
          role="button"
          tabIndex={0}
          title={`点击预览：${product.name}`}
          onClick={() => onSelect(product, 'preview')}
          onKeyDown={(event) => handlePreviewKeyDown(event, product)}
        >
          {cover ? <img src={imageUrl(cover)} alt={product.name} loading="lazy" /> : <span>暂无图片</span>}
        </div>
        <div
          className="catalog-card__body"
          onClick={() => onSelect(product, 'preview')}
        >
          <strong title={product.name}>{product.name}</strong>
          <span className="catalog-card__sku">编号：{product.sku}</span>
          <span className="catalog-card__price">{formatPrice(product.genericPrice)}</span>
        </div>
        <div className={`catalog-card__actions ${!canEdit ? 'catalog-card__actions--single' : ''}`}>
          <button type="button" className="catalog-preview" onClick={() => onSelect(product, 'preview')}><Eye size={15} />预览</button>
          {canEdit && <button type="button" className="catalog-edit" onClick={() => onSelect(product, 'edit')}><Pencil size={15} />编辑</button>}
        </div>
      </article>;
    })}</div>
    {!products.length && <div className="catalog-empty">{search ? '没有找到匹配商品' : canEdit ? '还没有商品，点击“新建商品”开始添加' : '暂无可预览的商品'}</div>}
  </main>;
}