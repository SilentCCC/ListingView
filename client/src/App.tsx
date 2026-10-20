import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, FileText, ImagePlus, LayoutTemplate, LoaderCircle, Save, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import { api, imageUrl } from './api';
import { ImageManager, PreviewModal, Section } from './components/ImageManager';
import { PreviewControls, initialDraft } from './components/PreviewControls';
import { ProductSidebar } from './components/ProductSidebar';
import { ProductPreview } from './templates/ProductPreview';
import type { Device, ImageDevice, ImageKind, ImageScope, Platform, Product, ProductImage, VisionStatus } from './types';
import './styles.css';

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState(initialDraft());
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<Platform>('amazon');
  const [device, setDevice] = useState<Device>('desktop');
  const [amazonDetailDevice, setAmazonDetailDevice] = useState<ImageDevice>('desktop');
  const [editMode, setEditMode] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<ProductImage | null>(null);
  const [visionConfigured, setVisionConfigured] = useState<boolean | null>(null);
  const [visionStatusUnavailable, setVisionStatusUnavailable] = useState(false);
  const [visionBaseUrl, setVisionBaseUrl] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [visionApiKey, setVisionApiKey] = useState('');
  const [visionApiKeyConfigured, setVisionApiKeyConfigured] = useState(false);
  const [visionConfigSource, setVisionConfigSource] = useState<VisionStatus['source']>('none');
  const [savingVisionConfig, setSavingVisionConfig] = useState(false);
  const [visionConfigMessage, setVisionConfigMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [recognitionImageIds, setRecognitionImageIds] = useState<number[]>([]);
  const [overwriteRecognition, setOverwriteRecognition] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionMessage, setRecognitionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectedProduct = useMemo(() => products.find((product) => product.id === selectedId) || null, [products, selectedId]);
  const applyVisionStatus = (status: VisionStatus) => {
    setVisionConfigured(status.configured);
    setVisionBaseUrl(status.baseUrl);
    setVisionModel(status.model);
    setVisionApiKeyConfigured(status.apiKeyConfigured);
    setVisionConfigSource(status.source);
  };

  const refresh = async (query = search) => {
    const result = await api.listProducts(query);
    setProducts(result.products);
    if (selectedId && !result.products.some((product) => product.id === selectedId)) setSelectedId(result.products[0]?.id ?? null);
    if (!selectedId && result.products[0]) setSelectedId(result.products[0].id);
  };

  useEffect(() => { void refresh(''); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(search).catch((error) => setNotice({ type: 'error', text: error.message })); }, 220);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (selectedProduct) setDraft(initialDraft(selectedProduct));
    const supportedImages = selectedProduct?.images.filter((image) => ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) || [];
    const mainImages = supportedImages.filter((image) => image.kind === 'main');
    const candidates = mainImages.length ? mainImages : supportedImages;
    setRecognitionImageIds(candidates.slice(0, 3).map((image) => image.id));
    setRecognitionMessage(null);
    setOverwriteRecognition(false);
  }, [selectedId]);
  useEffect(() => {
    void api.getVisionStatus().then((result) => { applyVisionStatus(result); setVisionStatusUnavailable(false); }).catch(() => { setVisionConfigured(false); setVisionStatusUnavailable(true); });
  }, []);

  const selectProduct = (product: Product, mode: 'edit' | 'preview') => { setSelectedId(product.id); setEditMode(mode === 'edit'); setWorkspaceOpen(true); setNotice(null); };
  const createProduct = () => { setSelectedId(null); setDraft(initialDraft()); setEditMode(true); setWorkspaceOpen(true); setNotice(null); };
  const updateDraft = (field: string, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const updatePlatformDraft = (key: 'title' | 'price', value: string) => setDraft((current) => ({ ...current, platforms: { ...current.platforms, [platform]: { ...current.platforms[platform], [key]: value } } }));
  const toggleRecognitionImage = (imageId: number) => {
    setRecognitionMessage(null);
    setRecognitionImageIds((current) => current.includes(imageId) ? current.filter((id) => id !== imageId) : current.length < 3 ? [...current, imageId] : current);
  };
  const saveVisionConfiguration = async () => {
    setSavingVisionConfig(true);
    setVisionConfigMessage(null);
    try {
      const settings = {
        baseUrl: visionBaseUrl,
        model: visionModel,
        ...(visionApiKey.trim() ? { apiKey: visionApiKey.trim() } : {}),
      };
      const status = await api.saveVisionConfig(settings);
      applyVisionStatus(status);
      setVisionApiKey('');
      setVisionConfigMessage({ type: 'success', text: '配置已安全保存到服务端数据目录。API Key 不会返回到浏览器。' });
    } catch (error: any) {
      setVisionConfigMessage({ type: 'error', text: error.message || '保存识图 API 配置失败' });
    } finally { setSavingVisionConfig(false); }
  };
  const resetVisionConfiguration = async () => {
    if (!window.confirm('将删除面板保存的 URL、模型和密钥，并恢复服务端环境变量配置。确定继续吗？')) return;
    setSavingVisionConfig(true);
    setVisionConfigMessage(null);
    try {
      const status = await api.resetVisionConfig();
      applyVisionStatus(status);
      setVisionApiKey('');
      setVisionConfigMessage({ type: 'success', text: '已恢复服务端环境变量配置。' });
    } catch (error: any) {
      setVisionConfigMessage({ type: 'error', text: error.message || '恢复环境配置失败' });
    } finally { setSavingVisionConfig(false); }
  };

  const recognizeImages = async () => {
    if (!selectedProduct) return;
    const validImageIds = recognitionImageIds.filter((id) => selectedProduct.images.some((image) => image.id === id));
    if (!validImageIds.length) { setRecognitionMessage({ type: 'error', text: '请先选择已上传的图片' }); return; }
    setRecognizing(true);
    setRecognitionMessage(null);
    try {
      const { result } = await api.recognizeProduct(selectedProduct.id, validImageIds);
      const fill = (current: string, suggestion: string) => suggestion && (overwriteRecognition || !current.trim()) ? suggestion : current;
      setDraft((current) => ({
        ...current,
        name: fill(current.name, result.name),
        genericTitle: fill(current.genericTitle, result.genericTitle),
        platforms: {
          amazon: { ...current.platforms.amazon, title: fill(current.platforms.amazon.title, result.amazonTitle) },
          tmall: { ...current.platforms.tmall, title: fill(current.platforms.tmall.title, result.tmallTitle) },
        },
      }));
      setRecognitionMessage({ type: 'success', text: '识别结果已填入左侧草稿。商品编号和价格未改动，请检查后手动保存。' });
    } catch (error: any) {
      setRecognitionMessage({ type: 'error', text: error.message || '图片识别失败，请稍后重试' });
    } finally { setRecognizing(false); }
  };
  const save = async () => {
    if (!draft.name.trim() || !draft.sku.trim()) { setNotice({ type: 'error', text: '商品名称和商品编号不能为空' }); return; }
    setBusy(true);
    try {
      const result = await api.saveProduct({ ...draft, genericPrice: draft.genericPrice === '' ? null : Number(draft.genericPrice), platforms: {
        amazon: { title: draft.platforms.amazon.title, price: draft.platforms.amazon.price === '' ? null : Number(draft.platforms.amazon.price) },
        tmall: { title: draft.platforms.tmall.title, price: draft.platforms.tmall.price === '' ? null : Number(draft.platforms.tmall.price) },
      } }, selectedId ?? undefined);
      setProducts((current) => selectedId ? current.map((item) => item.id === result.product.id ? result.product : item) : [result.product, ...current]);
      setSelectedId(result.product.id); setNotice({ type: 'success', text: selectedId ? '商品已保存' : '商品已创建' });
    } catch (error: any) { setNotice({ type: 'error', text: error.message }); } finally { setBusy(false); }
  };
  const removeProduct = async () => {
    if (!selectedProduct || !window.confirm(`确定删除「${selectedProduct.name}」吗？图片文件也会被删除。`)) return;
    setBusy(true);
    try { await api.deleteProduct(selectedProduct.id); const remaining = products.filter((item) => item.id !== selectedProduct.id); setProducts(remaining); setSelectedId(remaining[0]?.id ?? null); setNotice({ type: 'success', text: '商品已删除' }); } catch (error: any) { setNotice({ type: 'error', text: error.message }); } finally { setBusy(false); }
  };
  const withProductUpdate = async (operation: () => Promise<{ product: Product }>) => { if (!selectedProduct) return; setBusy(true); try { const result = await operation(); setProducts((current) => current.map((item) => item.id === result.product.id ? result.product : item)); } catch (error: any) { setNotice({ type: 'error', text: error.message }); } finally { setBusy(false); } };
  const upload = (scope: ImageScope, kind: ImageKind, imageDevice: ImageDevice = 'all') => (files: File[]) => withProductUpdate(() => api.uploadImages(selectedProduct!.id, files, scope, kind, imageDevice));
  const importCommon = (scope: ImageScope, kind: ImageKind, imageDevice: ImageDevice = 'all') => () => withProductUpdate(async () => {
    const result = await api.importCommonImages(selectedProduct!.id, scope, kind, imageDevice);
    setNotice({ type: 'success', text: `已将上方通用${kind === 'main' ? '主图' : '详情图'}导入到当前专属栏目` });
    return result;
  });
  const deleteImage = (image: ProductImage) => withProductUpdate(() => api.deleteImage(image.id));
  const reorder = (scope: ImageScope, kind: ImageKind, imageDevice: ImageDevice = 'all') => (images: ProductImage[], rows?: number[][]) => withProductUpdate(() => api.reorderImages(selectedProduct!.id, images.map((image) => image.id), scope, kind, imageDevice, rows));

  return <div className={`app-shell ${workspaceOpen ? 'app-shell--workspace' : 'app-shell--catalog'}`}>
    {!workspaceOpen ? <ProductSidebar products={products} search={search} onSearch={setSearch} onSelect={selectProduct} onCreate={createProduct} /> : <>
    <main className="workspace">
      <header className="workspace-header"><div className="breadcrumbs"><button className="back-to-catalog" onClick={() => setWorkspaceOpen(false)}><ChevronLeft size={16} /> 商品宫格</button><ChevronRight size={14} /><strong>{selectedProduct?.name || '新建商品'}</strong></div><div className="header-actions"><span className={`sync-status ${busy ? 'is-busy' : ''}`}><span />{busy ? '处理中' : '本地数据已同步'}</span>{selectedProduct && <button className="ghost-button danger" onClick={() => void removeProduct()}><Trash2 size={15} /> 删除商品</button>}{editMode && <button className="primary-button" onClick={() => void save()} disabled={busy}><Save size={16} /> 保存商品</button>}</div></header>
      {notice && <div className={`notice notice--${notice.type}`}><AlertCircle size={16} />{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
      <div className={`workspace-content ${!editMode ? 'workspace-content--preview' : ''}`}>
        <section className="editor-column">
          <div className="page-intro"><div><span className="eyebrow">PRODUCT WORKSPACE</span><h2>{!editMode ? '商品详情预览' : selectedProduct ? '编辑商品' : '创建新商品'}</h2><p>{editMode ? '维护商品信息、平台素材与详情展示内容' : '预览当前商品在所选平台和设备上的展示效果'}</p></div><div className="view-mode-toggle"><button className={editMode ? 'active' : ''} onClick={() => setEditMode(true)}><FileText size={15} /> 编辑内容</button><button className={!editMode ? 'active' : ''} onClick={() => setEditMode(false)}><LayoutTemplate size={15} /> 预览效果</button></div></div>
          {editMode ? <>
            <Section title="基础信息" action={<span className="section-hint">必填项以 * 标注</span>}><div className="form-grid"><label>商品名称 *<input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="例如：轻量通勤双肩包" /></label><label>商品编号 *<input value={draft.sku} onChange={(event) => updateDraft('sku', event.target.value)} placeholder="例如：LV-2026-001" /></label><label className="span-2">通用标题<textarea value={draft.genericTitle} onChange={(event) => updateDraft('genericTitle', event.target.value)} placeholder="未设置平台标题时使用此标题" rows={2} /></label><label>通用价格<input type="number" min="0" step="0.01" value={draft.genericPrice} onChange={(event) => updateDraft('genericPrice', event.target.value)} placeholder="可选" /></label></div></Section>
            <Section title="平台内容"><div className="platform-form-tabs"><button className={platform === 'amazon' ? 'active' : ''} onClick={() => setPlatform('amazon')}>亚马逊内容</button><button className={platform === 'tmall' ? 'active' : ''} onClick={() => setPlatform('tmall')}>天猫内容</button></div><div className="form-grid"><label className="span-2">{platform === 'amazon' ? '亚马逊' : '天猫'}标题<textarea value={draft.platforms[platform].title} onChange={(event) => updatePlatformDraft('title', event.target.value)} placeholder="留空时自动使用通用标题" rows={3} /></label><label>平台价格<input type="number" min="0" step="0.01" value={draft.platforms[platform].price} onChange={(event) => updatePlatformDraft('price', event.target.value)} placeholder="留空时使用通用价格" /></label></div></Section>
            {selectedProduct ? <><Section title="图片素材" action={<span className="section-hint"><UploadCloud size={14} /> 支持 JPG、PNG、WEBP、GIF，单张不超过 10 MB</span>}><div className="asset-scope-tabs"><span className="active">通用素材</span><span>亚马逊专属</span><span>天猫专属</span></div><ImageManager product={selectedProduct} scope="common" kind="main" onUpload={upload('common', 'main')} onDelete={deleteImage} onReorder={reorder('common', 'main')} onPreview={setPreviewImage} /><ImageManager product={selectedProduct} scope="common" kind="detail" onUpload={upload('common', 'detail')} onDelete={deleteImage} onReorder={reorder('common', 'detail')} onPreview={setPreviewImage} /><div className="asset-platform-note">平台专属素材可在对应平台预览中单独维护，未设置时自动使用通用素材。</div></Section><Section title="平台专属图片"><div className="platform-assets-grid"><div><h4>亚马逊 · 主图</h4><ImageManager product={selectedProduct} scope="amazon" kind="main" onUpload={upload('amazon', 'main')} onImportCommon={importCommon('amazon', 'main')} onDelete={deleteImage} onReorder={reorder('amazon', 'main')} onPreview={setPreviewImage} /></div><div><h4>亚马逊 · 详情图</h4><div className="device-image-tabs" role="tablist" aria-label="亚马逊详情图设备"><button type="button" role="tab" aria-selected={amazonDetailDevice === 'desktop'} className={amazonDetailDevice === 'desktop' ? 'active' : ''} onClick={() => setAmazonDetailDevice('desktop')}>电脑版</button><button type="button" role="tab" aria-selected={amazonDetailDevice === 'mobile'} className={amazonDetailDevice === 'mobile' ? 'active' : ''} onClick={() => setAmazonDetailDevice('mobile')}>手机版</button><button type="button" role="tab" aria-selected={amazonDetailDevice === 'all'} className={amazonDetailDevice === 'all' ? 'active' : ''} onClick={() => setAmazonDetailDevice('all')}>通用回退</button></div><p className="device-image-hint">{amazonDetailDevice === 'all' ? '通用详情图将在对应设备未配置专属图片时显示。支持宫格上下左右拖动，同行最多 3 张组成横滑。' : `当前管理${amazonDetailDevice === 'desktop' ? '电脑版' : '手机版'}详情图；支持宫格上下左右拖动，同行最多 3 张组成横滑。`}</p><ImageManager product={selectedProduct} scope="amazon" kind="detail" device={amazonDetailDevice} gridMode onUpload={upload('amazon', 'detail', amazonDetailDevice)} onImportCommon={importCommon('amazon', 'detail', amazonDetailDevice)} onDelete={deleteImage} onReorder={reorder('amazon', 'detail', amazonDetailDevice)} onPreview={setPreviewImage} /></div><div><h4>天猫 · 主图</h4><ImageManager product={selectedProduct} scope="tmall" kind="main" onUpload={upload('tmall', 'main')} onImportCommon={importCommon('tmall', 'main')} onDelete={deleteImage} onReorder={reorder('tmall', 'main')} onPreview={setPreviewImage} /></div><div><h4>天猫 · 详情图</h4><ImageManager product={selectedProduct} scope="tmall" kind="detail" onUpload={upload('tmall', 'detail')} onImportCommon={importCommon('tmall', 'detail')} onDelete={deleteImage} onReorder={reorder('tmall', 'detail')} onPreview={setPreviewImage} /></div></div></Section></> : <div className="create-tip"><UploadCloud size={22} /><strong>先保存商品，再上传图片</strong><span>保存后可管理主图、详情图及平台专属素材</span></div>}</> : <section className="preview-workspace"><div className="preview-workspace__header"><div><span className="eyebrow">LIVE PREVIEW</span><h2>商品详情预览</h2></div><PreviewControls platform={platform} device={device} onPlatform={setPlatform} onDevice={(nextPlatform, nextDevice) => { setPlatform(nextPlatform); setDevice(nextDevice); }} /></div>{selectedProduct ? <ProductPreview product={selectedProduct} products={products} platform={platform} device={device} onPreview={setPreviewImage} /> : <div className="empty-preview"><LoaderCircle size={25} /><span>保存商品后查看详情预览</span></div>}</section>}
        </section>
        {editMode && <aside className="right-rail"><div className="rail-title"><span>预览导航</span><small>LIVE</small></div><PreviewControls platform={platform} device={device} onPlatform={setPlatform} onDevice={(nextPlatform, nextDevice) => { setPlatform(nextPlatform); setDevice(nextDevice); }} /><div className="rail-tip"><strong>预览说明</strong><p>平台按钮位于上层，设备按钮位于平台下方。切换不会清空当前编辑草稿。</p></div><section className="vision-panel">
          <div className="vision-panel__heading"><span className="vision-panel__icon"><Sparkles size={15} /></span><div><strong>图片识别填资料</strong><small>第三方视觉 API</small></div></div>
          <details className="vision-config" open={visionConfigured !== true}>
            <summary><span>配置 URL、Key 和模型</span><small>{visionConfigured ? '已配置' : '尚未配置'}</small></summary>
            <div className="vision-config__fields">
              <label>API URL<input type="url" value={visionBaseUrl} onChange={(event) => setVisionBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" disabled={savingVisionConfig || recognizing} /></label>
              <label>API Key<input type="password" value={visionApiKey} onChange={(event) => setVisionApiKey(event.target.value)} placeholder={visionApiKeyConfigured ? '已保存；留空保持不变' : '粘贴服务商 API Key'} autoComplete="new-password" disabled={savingVisionConfig || recognizing} /></label>
              <label>模型名称<input type="text" value={visionModel} onChange={(event) => setVisionModel(event.target.value)} placeholder="支持图片输入的模型名称" disabled={savingVisionConfig || recognizing} /></label>
              <p className="vision-config__hint">{visionApiKeyConfigured ? '密钥已配置，不会回显；如需更换，输入新 Key 后保存。' : '部分兼容服务允许不填写 Key。配置保存在服务端数据目录，不会写入前端或源码。'}</p>
              <button type="button" className="vision-config__save" onClick={() => void saveVisionConfiguration()} disabled={savingVisionConfig || recognizing}>
                {savingVisionConfig ? <><LoaderCircle className="spin" size={13} /> 正在保存…</> : <><Save size={13} /> 保存 API 配置</>}
              </button>
              {visionConfigSource === 'saved' && <button type="button" className="vision-config__reset" onClick={() => void resetVisionConfiguration()} disabled={savingVisionConfig || recognizing}>恢复服务端环境变量</button>}
            </div>
          </details>
          {visionConfigMessage && <div className={`vision-result vision-result--${visionConfigMessage.type}`}>{visionConfigMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{visionConfigMessage.text}</span></div>}
          {visionStatusUnavailable && <div className="vision-panel__notice"><AlertCircle size={14} /><span>识图设置接口暂不可用，请重启后端服务并确认更新已部署。</span></div>}
          {selectedProduct ? <>
            <p className="vision-panel__intro">选择已上传的商品图，识别后填入左侧名称和标题草稿。</p>
            {visionConfigured === false && <div className="vision-panel__notice"><AlertCircle size={14} /><span>请先填写 API URL 和支持图片输入的模型名称。Key 是否必填取决于服务商。</span></div>}
            {visionConfigured === null && <div className="vision-panel__status"><LoaderCircle size={13} />正在检查识图服务配置…</div>}
            <div className="vision-image-list" aria-label="选择用于识别的已上传图片">
              {selectedProduct.images.length ? selectedProduct.images.map((image) => {
                const checked = recognitionImageIds.includes(image.id);
                const supported = ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType);
                const capped = recognitionImageIds.length >= 3 && !checked;
                return <label key={image.id} className={`vision-image-option ${checked ? 'is-selected' : ''} ${capped || !supported ? 'is-disabled' : ''}`}>
                  <input type="checkbox" checked={checked} disabled={capped || !supported || recognizing} onChange={() => toggleRecognitionImage(image.id)} />
                  <img src={imageUrl(image)} alt="" loading="lazy" />
                  <span title={image.originalName}>{image.originalName}{!supported ? '（不支持识图）' : ''}</span>
                </label>;
              }) : <div className="vision-no-images"><ImagePlus size={17} /><span>请先在左侧上传商品图片</span></div>}
            </div>
            <div className="vision-image-count">已选择 {recognitionImageIds.filter((id) => selectedProduct.images.some((image) => image.id === id && ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType))).length}/3 张 · 支持 JPG、PNG、WEBP</div>
            <label className="vision-overwrite"><input type="checkbox" checked={overwriteRecognition} onChange={(event) => setOverwriteRecognition(event.target.checked)} disabled={recognizing} /><span>覆盖已有名称和标题</span></label>
            <button type="button" className="vision-run-button" onClick={() => void recognizeImages()} disabled={!visionConfigured || recognizing || recognitionImageIds.length === 0 || selectedProduct.images.length === 0}>
              {recognizing ? <><LoaderCircle className="spin" size={15} /> 正在识别图片…</> : <><Sparkles size={15} /> 识别并填入资料</>}
            </button>
            {recognitionMessage && <div className={`vision-result vision-result--${recognitionMessage.type}`}>{recognitionMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{recognitionMessage.text}</span></div>}
            <p className="vision-panel__privacy">选中图片会发送至已配置的第三方服务。不会识别或修改商品编号、价格；结果仅写入草稿，不会自动保存。</p>
          </> : <div className="vision-no-images"><ImagePlus size={17} /><span>先保存商品并上传图片，再使用识别填资料</span></div>}
        </section><div className="rail-shortcuts"><div><span>⌘</span><small>保存商品</small><b>Ctrl S</b></div><div><span>⌁</span><small>拖拽排序</small><b>图片卡片</b></div></div></aside>}
      </div>
    </main>
    </>}
    <PreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
  </div>;
}

export default App;

