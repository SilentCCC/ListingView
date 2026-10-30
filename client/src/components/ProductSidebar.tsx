import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Eye, LayoutGrid, Lock, LogOut, Pencil, Plus, Search, Settings, Table2 } from 'lucide-react';
import type { Product, ProductCategory } from '../types';
import { imageUrl, formatPrice } from '../api';
import { BAG_SPEC_FIELDS, PRODUCT_CATEGORIES, TRIPOD_SPEC_FIELDS } from './PreviewControls';

type CatalogCategoryFilter = 'all' | ProductCategory;
type CatalogViewMode = 'grid' | 'table';

const CATEGORY_FILTER_OPTIONS: Array<{ key: CatalogCategoryFilter; label: string }> = [
  { key: 'all', label: '全部商品' },
  ...PRODUCT_CATEGORIES,
];

interface ProductSidebarProps {
  products: Product[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (product: Product, mode: 'edit' | 'preview') => void;
  onCreate: () => void;
  onOpenSettings?: () => void;
  canEdit?: boolean;
  passwordRequired?: boolean;
  onRequestUnlock?: () => void;
  onLock?: () => void;
  compact?: boolean;
}

function getProductCover(product: Product) {
  return (
    product.effectiveImages.amazon.main[0] ||
    product.effectiveImages.tmall.main[0] ||
    product.images.find((image) => image.kind === 'main')
  );
}

export function ProductSidebar({
  products,
  search,
  onSearch,
  onSelect,
  onCreate,
  onOpenSettings,
  canEdit = false,
  passwordRequired = false,
  onRequestUnlock,
  onLock,
  compact = false,
}: ProductSidebarProps) {
  const [categoryFilter, setCategoryFilter] = useState<CatalogCategoryFilter>('all');
  const [viewMode, setViewMode] = useState<CatalogViewMode>('grid');

  const categoryCounts = useMemo(() => {
    const counts: Record<CatalogCategoryFilter, number> = {
      all: products.length,
      bag: 0,
      tripod: 0,
      other: 0,
    };
    for (const product of products) {
      const cat: ProductCategory = product.category || 'bag';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (categoryFilter === 'all') return products;
    return products.filter((product) => (product.category || 'bag') === categoryFilter);
  }, [products, categoryFilter]);

  const visibleCategoryGroups = useMemo(() => {
    const targetCategories: ProductCategory[] =
      categoryFilter === 'all' ? ['bag', 'tripod', 'other'] : [categoryFilter];

    return targetCategories
      .map((categoryKey) => {
        const categoryInfo = PRODUCT_CATEGORIES.find((item) => item.key === categoryKey)!;
        const items = filteredProducts.filter((product) => (product.category || 'bag') === categoryKey);
        return {
          key: categoryKey,
          label: categoryInfo.label,
          items,
        };
      })
      .filter((group) => group.items.length > 0);
  }, [filteredProducts, categoryFilter]);

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLElement>, product: Product) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(product, 'preview');
    }
  };

  const renderCategoryTable = (group: { key: ProductCategory; label: string; items: Product[] }) => {
    const MAX_SPEC_COLS = 8;
    let specColumns: Array<{ key: string; label: string }> = [];

    if (group.key === 'bag') {
      specColumns = BAG_SPEC_FIELDS.map((f) => ({ key: f.key, label: f.label }));
    } else if (group.key === 'tripod') {
      specColumns = TRIPOD_SPEC_FIELDS.map((f) => ({ key: f.key, label: f.label }));
    } else {
      const seenLabels = new Set<string>();
      for (const product of group.items) {
        for (const item of product.specs?.other || []) {
          const label = (item.label || '').trim();
          const value = (item.value || '').trim();
          if (label && value && !seenLabels.has(label)) {
            seenLabels.add(label);
            specColumns.push({ key: label, label });
          }
        }
      }
      if (specColumns.length === 0) {
        specColumns = [{ key: '__empty__', label: '商品参数' }];
      }
    }

    const totalSpecCols = Math.max(MAX_SPEC_COLS, specColumns.length);
    const fillerCount = Math.max(0, totalSpecCols - specColumns.length);

    return (
      <section className="catalog-table-section" key={group.key}>
        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <colgroup>
              <col className="catalog-table__col-image" />
              <col className="catalog-table__col-model" />
              {Array.from({ length: totalSpecCols }).map((_, idx) => (
                <col key={idx} className="catalog-table__col-spec" />
              ))}
              <col className="catalog-table__col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th className="catalog-table__th-category">
                  <div className="catalog-table__category-heading">
                    <strong>{group.label}</strong>
                    <span>{group.items.length} 款</span>
                  </div>
                </th>
                <th className="catalog-table__th-model">型号</th>
                {specColumns.map((col) => (
                  <th key={col.key} className="catalog-table__th-spec">{col.label}</th>
                ))}
                {Array.from({ length: fillerCount }).map((_, idx) => (
                  <th key={`filler-th-${idx}`} className="catalog-table__th-spec is-filler" aria-hidden="true" />
                ))}
                <th className="catalog-table__th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((product) => {
                const cover = getProductCover(product);
                const presetMap = (group.key === 'bag' ? product.specs?.bag : group.key === 'tripod' ? product.specs?.tripod : undefined) || {};
                const otherMap = new Map<string, string>();
                if (group.key === 'other') {
                  for (const item of product.specs?.other || []) {
                    const label = (item.label || '').trim();
                    const value = (item.value || '').trim();
                    if (label && value && !otherMap.has(label)) {
                      otherMap.set(label, value);
                    }
                  }
                }

                return (
                  <tr key={product.id}>
                    <td className="catalog-table__td-image">
                      <div
                        className="catalog-table__thumb"
                        role="button"
                        tabIndex={0}
                        title={`点击预览：${product.name}`}
                        onClick={() => onSelect(product, 'preview')}
                        onKeyDown={(event) => handlePreviewKeyDown(event, product)}
                      >
                        {cover ? <img src={imageUrl(cover)} alt={product.name} loading="lazy" /> : <span>暂无图片</span>}
                      </div>
                    </td>
                    <td
                      className="catalog-table__td-model"
                      onClick={() => onSelect(product, 'preview')}
                      title={`点击预览：${product.name}`}
                    >
                      <strong className="catalog-table__sku">{product.sku}</strong>
                      <span className="catalog-table__name">{product.name}</span>
                      {product.genericPrice != null && (
                        <span className="catalog-table__price">{formatPrice(product.genericPrice)}</span>
                      )}
                    </td>
                    {specColumns.map((col) => {
                      if (col.key === '__empty__') {
                        return <td key={col.key} className="catalog-table__td-spec is-empty">暂未录入</td>;
                      }
                      const value = group.key === 'other'
                        ? (otherMap.get(col.key) || '')
                        : (presetMap[col.key] || '').trim();
                      return (
                        <td key={col.key} className={value ? 'catalog-table__td-spec' : 'catalog-table__td-spec is-empty'}>
                          {value || '-'}
                        </td>
                      );
                    })}
                    {Array.from({ length: fillerCount }).map((_, idx) => (
                      <td key={`filler-td-${idx}`} className="catalog-table__td-spec is-filler" aria-hidden="true" />
                    ))}
                    <td className="catalog-table__td-actions">
                      <div className="catalog-table__action-btns">
                        <button type="button" className="catalog-preview" onClick={() => onSelect(product, 'preview')}>
                          <Eye size={14} />预览
                        </button>
                        {canEdit && (
                          <button type="button" className="catalog-edit" onClick={() => onSelect(product, 'edit')}>
                            <Pencil size={14} />编辑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
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
        {canEdit && onOpenSettings && (
          <button type="button" className="ghost-button auth-button" onClick={onOpenSettings}>
            <Settings size={15} /> 设置
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

    <div className="catalog-toolbar">
      <div className="catalog-category-tabs" role="tablist" aria-label="商品类目筛选">
        {CATEGORY_FILTER_OPTIONS.map((option) => (
          <button
            type="button"
            role="tab"
            key={option.key}
            aria-selected={categoryFilter === option.key}
            className={`catalog-category-tab ${categoryFilter === option.key ? 'is-active' : ''}`}
            onClick={() => setCategoryFilter(option.key)}
          >
            <span>{option.label}</span>
            <small>{categoryCounts[option.key]}</small>
          </button>
        ))}
      </div>

      <div className="catalog-toolbar__right">
        <div className="search-box catalog-search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSearch(event.target.value)}
            placeholder="搜索名称或型号"
          />
        </div>

        <div className="catalog-view-toggle" role="group" aria-label="商品库视图切换">
          <button
            type="button"
            className={viewMode === 'grid' ? 'is-active' : ''}
            onClick={() => setViewMode('grid')}
            title="宫格视图"
          >
            <LayoutGrid size={15} />
            <span>宫格</span>
          </button>
          <button
            type="button"
            className={viewMode === 'table' ? 'is-active' : ''}
            onClick={() => setViewMode('table')}
            title="表格视图"
          >
            <Table2 size={15} />
            <span>表格</span>
          </button>
        </div>
      </div>
    </div>

    {viewMode === 'grid' ? (
      <div className="product-grid">{filteredProducts.map((product) => {
        const cover = getProductCover(product);
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
            <span className="catalog-card__sku">型号：{product.sku}</span>
            <span className="catalog-card__price">{formatPrice(product.genericPrice)}</span>
          </div>
          <div className={`catalog-card__actions ${!canEdit ? 'catalog-card__actions--single' : ''}`}>
            <button type="button" className="catalog-preview" onClick={() => onSelect(product, 'preview')}><Eye size={15} />预览</button>
            {canEdit && <button type="button" className="catalog-edit" onClick={() => onSelect(product, 'edit')}><Pencil size={15} />编辑</button>}
          </div>
        </article>;
      })}</div>
    ) : (
      <div className="catalog-table-groups">
        {visibleCategoryGroups.map((group) => renderCategoryTable(group))}
      </div>
    )}

    {!filteredProducts.length && (
      <div className="catalog-empty">
        {search || categoryFilter !== 'all'
          ? '没有找到符合筛选条件的商品'
          : canEdit
            ? '还没有商品，点击“新建商品”开始添加'
            : '暂无可预览的商品'}
      </div>
    )}
  </main>;
}
