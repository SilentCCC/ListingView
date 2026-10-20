import type { ChangeEvent } from 'react';
import { Eye, Pencil, Plus, Search } from 'lucide-react';
import type { Product } from '../types';
import { imageUrl, formatPrice } from '../api';

interface ProductSidebarProps {
  products: Product[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (product: Product, mode: 'edit' | 'preview') => void;
  onCreate: () => void;
  compact?: boolean;
}

export function ProductSidebar({ products, search, onSearch, onSelect, onCreate, compact = false }: ProductSidebarProps) {
  return <main className={`product-catalog ${compact ? 'product-catalog--compact' : ''}`}>
    <header className="catalog-header"><div><span className="eyebrow">LISTINGVIEW · CATALOG</span><h1>商品库</h1><p>管理商品信息，快速进入详情预览或编辑</p></div><button className="primary-button" onClick={onCreate}><Plus size={16} /> 新建商品</button></header>
    <div className="search-box"><Search size={16} /><input value={search} onChange={(event: ChangeEvent<HTMLInputElement>) => onSearch(event.target.value)} placeholder="搜索名称或编号" /></div>
    <div className="product-grid">{products.map((product) => {
      const cover = product.effectiveImages.amazon.main[0] || product.effectiveImages.tmall.main[0];
      return <article className="catalog-card" key={product.id}>
        <div className="catalog-card__image">{cover ? <img src={imageUrl(cover)} alt={product.name} loading="lazy" /> : <span>暂无图片</span>}</div>
        <div className="catalog-card__body"><strong title={product.name}>{product.name}</strong><span className="catalog-card__sku">编号：{product.sku}</span><span className="catalog-card__price">{formatPrice(product.genericPrice)}</span></div>
        <div className="catalog-card__actions"><button className="catalog-preview" onClick={() => onSelect(product, 'preview')}><Eye size={15} />预览</button><button className="catalog-edit" onClick={() => onSelect(product, 'edit')}><Pencil size={15} />编辑</button></div>
      </article>;
    })}</div>
    {!products.length && <div className="catalog-empty">{search ? '没有找到匹配商品' : '还没有商品，点击“新建商品”开始添加'}</div>}
  </main>;
}
