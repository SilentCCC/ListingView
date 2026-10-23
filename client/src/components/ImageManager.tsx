import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, GripVertical, ImagePlus, Maximize2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { ImageDevice, ImageKind, ImageScope, Product, ProductImage } from '../types';
import { imageUrl } from '../api';

export function groupImagesIntoRows(images: ProductImage[], maxCols = 3): ProductImage[][] {
  const sorted = [...images].sort((a, b) => (a.rowOrder ?? a.sortOrder) - (b.rowOrder ?? b.sortOrder) || (a.colOrder ?? 0) - (b.colOrder ?? 0) || a.sortOrder - b.sortOrder || a.id - b.id);
  const grouped = new Map<number, ProductImage[]>();
  for (const image of sorted) {
    const key = image.rowOrder ?? image.sortOrder;
    const list = grouped.get(key) || [];
    list.push(image);
    grouped.set(key, list);
  }
  const rows: ProductImage[][] = [];
  for (const list of grouped.values()) {
    for (let index = 0; index < list.length; index += maxCols) {
      rows.push(list.slice(index, index + maxCols));
    }
  }
  return rows;
}

interface ImageManagerProps {
  product: Product;
  scope: ImageScope;
  kind: ImageKind;
  device?: ImageDevice;
  gridMode?: boolean;
  onUpload: (files: File[]) => Promise<void>;
  onImportCommon?: () => Promise<void>;
  onDelete: (image: ProductImage) => Promise<void>;
  onReorder: (images: ProductImage[], rows?: number[][]) => Promise<void>;
  onPreview: (image: ProductImage) => void;
}

export function ImageManager({ product, scope, kind, device = 'all', gridMode = false, onUpload, onImportCommon, onDelete, onReorder, onPreview }: ImageManagerProps) {
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [activeInsertRow, setActiveInsertRow] = useState<number | null>(null);
  const images = product.images
    .filter((image) => image.scope === scope && image.kind === kind && image.device === device)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const commonImagesCount = scope !== 'common'
    ? product.images.filter((image) => image.scope === 'common' && image.kind === kind && image.device === 'all').length
    : 0;
  const rows = gridMode ? groupImagesIntoRows(images, 3) : [];
  const overviewRows = gridMode ? rows : images.map((image) => [image]);

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (files.length) await onUpload(files);
  };

  const dragImage = (event: DragEvent<HTMLElement>, image: ProductImage) => {
    event.dataTransfer.setData('text/plain', String(image.id));
    event.dataTransfer.effectAllowed = 'move';
    setActiveInsertRow(null);
  };

  const dropImage = async (event: DragEvent<HTMLElement>, target: ProductImage) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = Number(event.dataTransfer.getData('text/plain'));
    if (!sourceId || sourceId === target.id) return;
    const next = [...images];
    const sourceIndex = next.findIndex((item) => item.id === sourceId);
    const targetIndex = next.findIndex((item) => item.id === target.id);
    if (sourceIndex === -1 || targetIndex === -1) return;
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    await onReorder(next);
  };

  const commitGridRows = async (nextRows: ProductImage[][]) => {
    const cleaned = nextRows.map((row) => row.filter(Boolean)).filter((row) => row.length > 0);
    const normalized: ProductImage[][] = [];
    for (const row of cleaned) {
      for (let index = 0; index < row.length; index += 3) {
        normalized.push(row.slice(index, index + 3));
      }
    }
    const flatImages = normalized.flat();
    const rowIds = normalized.map((row) => row.map((item) => item.id));
    await onReorder(flatImages, rowIds);
  };

  const moveToGridPosition = async (sourceId: number, targetRowIndex: number, targetColIndex: number, createNewRow = false) => {
    if (!sourceId) return;
    const currentRows = rows.map((row) => [...row]);
    let movedImage: ProductImage | null = null;
    let sourceRowIndex = -1;
    let sourceColIndex = -1;

    for (let r = 0; r < currentRows.length; r += 1) {
      const c = currentRows[r].findIndex((item) => item.id === sourceId);
      if (c !== -1) {
        sourceRowIndex = r;
        sourceColIndex = c;
        [movedImage] = currentRows[r].splice(c, 1);
        break;
      }
    }
    if (!movedImage) return;

    if (createNewRow) {
      // A source row that becomes empty collapses. Adjust the requested gap
      // when that row was above it so the image lands between the intended rows.
      const sourceRowCollapsed = currentRows[sourceRowIndex].length === 0;
      if (sourceRowCollapsed) currentRows.splice(sourceRowIndex, 1);
      const adjustedTargetRow = targetRowIndex - (sourceRowCollapsed && sourceRowIndex < targetRowIndex ? 1 : 0);
      const insertAt = Math.max(0, Math.min(adjustedTargetRow, currentRows.length));
      currentRows.splice(insertAt, 0, [movedImage]);
      await commitGridRows(currentRows);
      return;
    }

    const boundedRow = Math.max(0, Math.min(targetRowIndex, currentRows.length - 1));
    const targetRow = currentRows[boundedRow] || [];

    if (sourceRowIndex !== boundedRow && targetRow.length >= 3) {
      const clampedCol = Math.max(0, Math.min(targetColIndex, 2));
      const displaced = targetRow[clampedCol];
      targetRow[clampedCol] = movedImage;
      if (sourceRowIndex !== -1 && currentRows[sourceRowIndex]) {
        currentRows[sourceRowIndex].splice(sourceColIndex, 0, displaced);
      } else {
        currentRows.splice(boundedRow + 1, 0, [displaced]);
      }
      await commitGridRows(currentRows);
      return;
    }

    const insertCol = Math.max(0, Math.min(targetColIndex, targetRow.length));
    targetRow.splice(insertCol, 0, movedImage);
    currentRows[boundedRow] = targetRow;
    await commitGridRows(currentRows);
  };

  const stepMove = async (rowIndex: number, colIndex: number, direction: 'up' | 'down' | 'left' | 'right') => {
    const currentRows = rows.map((row) => [...row]);
    const image = currentRows[rowIndex]?.[colIndex];
    if (!image) return;

    if (direction === 'left' && colIndex > 0) {
      const row = currentRows[rowIndex];
      [row[colIndex - 1], row[colIndex]] = [row[colIndex], row[colIndex - 1]];
      await commitGridRows(currentRows);
      return;
    }
    if (direction === 'right' && colIndex < currentRows[rowIndex].length - 1) {
      const row = currentRows[rowIndex];
      [row[colIndex + 1], row[colIndex]] = [row[colIndex], row[colIndex + 1]];
      await commitGridRows(currentRows);
      return;
    }
    if (direction === 'up') {
      if (rowIndex > 0 && currentRows[rowIndex - 1].length < 3) {
        currentRows[rowIndex].splice(colIndex, 1);
        currentRows[rowIndex - 1].push(image);
      } else if (rowIndex > 0 && currentRows[rowIndex].length === 1) {
        [currentRows[rowIndex - 1], currentRows[rowIndex]] = [currentRows[rowIndex], currentRows[rowIndex - 1]];
      } else if (currentRows[rowIndex].length > 1) {
        currentRows[rowIndex].splice(colIndex, 1);
        currentRows.splice(rowIndex, 0, [image]);
      }
      await commitGridRows(currentRows);
      return;
    }
    if (direction === 'down') {
      if (rowIndex < currentRows.length - 1 && currentRows[rowIndex + 1].length < 3) {
        currentRows[rowIndex].splice(colIndex, 1);
        currentRows[rowIndex + 1].push(image);
      } else if (rowIndex < currentRows.length - 1 && currentRows[rowIndex].length === 1) {
        [currentRows[rowIndex + 1], currentRows[rowIndex]] = [currentRows[rowIndex], currentRows[rowIndex + 1]];
      } else if (currentRows[rowIndex].length > 1) {
        currentRows[rowIndex].splice(colIndex, 1);
        currentRows.splice(rowIndex + 1, 0, [image]);
      }
      await commitGridRows(currentRows);
    }
  };

  return (
    <div className={`image-manager ${gridMode ? 'image-manager--grid' : ''}`}>
      <div className="image-manager__header">
        <div>
          <h4>{kind === 'main' ? '主图' : '详情图'}</h4>
          <span>
            {gridMode
              ? `${images.length} 张 · 共 ${rows.length} 行（每行最多 3 张，可上下左右拖动编排）`
              : `${images.length} 张 · 拖动卡片调整顺序`}
          </span>
        </div>
        <div className="image-manager__actions">
          {kind === 'detail' && (
            <button
              type="button"
              className="import-common-button"
              onClick={() => setOverviewOpen(true)}
              disabled={images.length === 0}
              title={images.length > 0 ? '按当前排版整体预览所有详情图（支持滚轮缩放与按住拖动）' : '上传详情图后可整体预览'}
            >
              <Maximize2 size={13} /> 整体预览
            </button>
          )}
          {scope !== 'common' && onImportCommon && (
            <button
              type="button"
              className="import-common-button"
              onClick={() => void onImportCommon()}
              disabled={commonImagesCount === 0}
              title={commonImagesCount > 0 ? `从上方通用${kind === 'main' ? '主图' : '详情图'}导入 ${commonImagesCount} 张图片` : `请先在上方上传通用${kind === 'main' ? '主图' : '详情图'}`}
            >
              <Download size={13} /> 导入图片
            </button>
          )}
          <label className="icon-button" title="选择图片">
            <ImagePlus size={17} />
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files.length) void onUpload(files);
              event.currentTarget.value = '';
            }} />
          </label>
        </div>
      </div>

      {gridMode ? (
        <div className="image-dropzone image-dropzone--grid" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          {rows.length ? (
            <div className="detail-grid-rows">
              <div
                className={`detail-grid-insert-row ${activeInsertRow === 0 ? 'is-drag-over' : ''}`}
                title="拖到这里，在最前面插入新行"
                onDragEnter={() => setActiveInsertRow(0)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'move';
                  setActiveInsertRow(0);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveInsertRow(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveInsertRow(null);
                  const sourceId = Number(event.dataTransfer.getData('text/plain'));
                  if (sourceId) void moveToGridPosition(sourceId, 0, 0, true);
                }}
              >
                <Plus size={12} /> 在最前面插入新行
              </div>
              {rows.map((row, rowIndex) => (
                <div className="detail-grid-row-wrap" key={`row-${rowIndex}`}>
                  <div className="detail-grid-row">
                    <div className="detail-grid-row__header">
                      <strong>第 {rowIndex + 1} 行</strong>
                      <span>{row.length > 1 ? `横滑组（${row.length}/3 张，预览可左右滑动）` : '单张展示（拖入右侧空位可组成横滑）'}</span>
                    </div>
                    <div className="detail-grid-slots">
                      {[0, 1, 2].map((colIndex) => {
                        const image = row[colIndex];
                        if (image) {
                          const canUp = rowIndex > 0 || row.length > 1;
                          const canDown = rowIndex < rows.length - 1 || row.length > 1;
                          return (
                            <div
                              key={image.id}
                              className="image-tile image-tile--grid"
                              draggable
                              onDragStart={(event) => dragImage(event, image)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const sourceId = Number(event.dataTransfer.getData('text/plain'));
                                if (sourceId && sourceId !== image.id) {
                                  void moveToGridPosition(sourceId, rowIndex, colIndex, false);
                                }
                              }}
                              onClick={() => onPreview(image)}
                            >
                              <img src={imageUrl(image)} alt={image.originalName} loading="lazy" />
                              <span className="image-tile__order">{rowIndex + 1}-{colIndex + 1}</span>
                              <span className="image-tile__drag" title="拖拽可移动到任意行/列"><GripVertical size={14} /></span>
                              <div className="image-tile__arrows" onClick={(event) => event.stopPropagation()}>
                                <button type="button" title="上移一行" disabled={!canUp} onClick={() => void stepMove(rowIndex, colIndex, 'up')}><ArrowUp size={11} /></button>
                                <button type="button" title="下移一行" disabled={!canDown} onClick={() => void stepMove(rowIndex, colIndex, 'down')}><ArrowDown size={11} /></button>
                                <button type="button" title="左移一格" disabled={colIndex === 0} onClick={() => void stepMove(rowIndex, colIndex, 'left')}><ArrowLeft size={11} /></button>
                                <button type="button" title="右移一格" disabled={colIndex >= row.length - 1} onClick={() => void stepMove(rowIndex, colIndex, 'right')}><ArrowRight size={11} /></button>
                              </div>
                              <button
                                type="button"
                                className="image-tile__delete"
                                title="删除图片"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onDelete(image);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={`empty-${rowIndex}-${colIndex}`}
                            className="detail-grid-slot--empty"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const sourceId = Number(event.dataTransfer.getData('text/plain'));
                              if (sourceId) void moveToGridPosition(sourceId, rowIndex, colIndex, false);
                            }}
                          >
                            <Plus size={14} />
                            <span>拖入第 {colIndex + 1} 列</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div
                    className={`detail-grid-insert-row ${activeInsertRow === rowIndex + 1 ? 'is-drag-over' : ''}`}
                    title={`拖到这里，在第 ${rowIndex + 1} 行之后插入新行`}
                    onDragEnter={() => setActiveInsertRow(rowIndex + 1)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = 'move';
                      setActiveInsertRow(rowIndex + 1);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveInsertRow(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveInsertRow(null);
                      const sourceId = Number(event.dataTransfer.getData('text/plain'));
                      if (sourceId) void moveToGridPosition(sourceId, rowIndex + 1, 0, true);
                    }}
                  >
                    <Plus size={12} /> 在此处插入新行
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-upload"><ImagePlus size={20} /><span>拖拽图片到这里，或点击右上角导入 / 上传</span></div>
          )}
        </div>
      ) : (
        <div className="image-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          {images.length ? images.map((image, index) => (
            <button className="image-tile" key={image.id} draggable onDragStart={(event) => dragImage(event, image)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropImage(event, image)} onClick={() => onPreview(image)}>
              <img src={imageUrl(image)} alt={image.originalName} loading="lazy" />
              <span className="image-tile__order">{index + 1}</span>
              <span className="image-tile__drag"><GripVertical size={15} /></span>
              <span className="image-tile__delete" role="button" title="删除图片" onClick={(event) => { event.stopPropagation(); void onDelete(image); }}><Trash2 size={14} /></span>
            </button>
          )) : <div className="empty-upload"><ImagePlus size={20} /><span>拖拽图片到这里，或点击右上角上传</span></div>}
        </div>
      )}
      {kind === 'detail' && (
        <DetailLayoutOverviewModal
          open={overviewOpen}
          rows={overviewRows}
          title={`${product.name} · 详情图整体排版预览`}
          onClose={() => setOverviewOpen(false)}
        />
      )}
    </div>
  );
}

export function DetailLayoutOverviewModal({
  open,
  rows,
  title = '详情图整体排版预览',
  onClose,
}: {
  open: boolean;
  rows: ProductImage[][];
  title?: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    dragStateRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const element = backdropRef.current;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
      setScale((current) => Math.min(4, Math.max(0.18, Number((current * factor).toFixed(2)))));
    };
    window.addEventListener('keydown', handleKeyDown);
    element?.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      element?.removeEventListener('wheel', handleWheel);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setDragging(false);
  };

  const totalCount = rows.reduce((sum, row) => sum + row.length, 0);

  return (
    <div
      ref={backdropRef}
      className={`modal-backdrop detail-overview-backdrop ${dragging ? 'is-dragging' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div className="detail-overview-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <div className="detail-overview-toolbar__meta">
          <strong>{title}</strong>
          <span>共 {rows.length} 行 · {totalCount} 张图片</span>
        </div>
        <div className="detail-overview-toolbar__actions">
          <button
            type="button"
            className="detail-overview-action"
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            title="重置缩放与位置"
          >
            <RotateCcw size={14} /> 重置视图
          </button>
          <button
            type="button"
            className="detail-overview-close"
            onClick={onClose}
            title="关闭整体预览 (Esc)"
          >
            <X size={16} /> 关闭
          </button>
        </div>
      </div>

      <div className="detail-overview-HUD" onPointerDown={(event) => event.stopPropagation()}>
        <span>{Math.round(scale * 100)}%</span>
        <small>滚轮缩放 · 按住左键拖动平移 · Esc 关闭</small>
      </div>

      <div
        className="detail-overview-canvas"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
        }}
      >
        {rows.map((row, rowIndex) => (
          <div
            key={row.map((item) => item.id).join('-') || `row-${rowIndex}`}
            className={`detail-overview-row detail-overview-row--cols-${row.length}`}
          >
            {row.map((image, colIndex) => (
              <div className="detail-overview-cell" key={image.id}>
                <img
                  src={imageUrl(image)}
                  alt={image.originalName || `第 ${rowIndex + 1} 行第 ${colIndex + 1} 张`}
                  draggable={false}
                />
                {row.length > 1 && (
                  <span className="detail-overview-cell__badge">
                    {rowIndex + 1}-{colIndex + 1}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PreviewModal({ image, onClose }: { image: ProductImage | null; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setScale(1);
  }, [image?.id]);

  useEffect(() => {
    if (!image) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const element = backdropRef.current;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setScale((current) => Math.min(4, Math.max(0.5, Number((current * factor).toFixed(2)))));
    };
    window.addEventListener('keydown', handleKeyDown);
    element?.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      element?.removeEventListener('wheel', handleWheel);
    };
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div ref={backdropRef} className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="图片放大预览">
      <div className="preview-modal" onClick={onClose}>
        <div className="preview-modal__HUD" onClick={(event) => event.stopPropagation()}>
          <span>{Math.round(scale * 100)}%</span>
          <small>滚轮缩放 · 点击任意位置关闭</small>
        </div>
        <button type="button" className="modal-close icon-button" title="关闭预览" onClick={(event) => { event.stopPropagation(); onClose(); }}>
          <X size={18} />
        </button>
        <img
          src={imageUrl(image)}
          alt={image.originalName}
          style={{ transform: `scale(${scale})` }}
          title="滚轮缩放，点击关闭"
        />
      </div>
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel-section"><div className="section-heading"><h3>{title}</h3>{action}</div>{children}</section>;
}
