import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Download, FileText, ImagePlus, KeyRound, LayoutTemplate, LoaderCircle, Lock, LogOut, Plus, Save, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { api, getStoredSiteSettings, imageUrl, setStoredAdminToken } from './api';
import { ImageManager, PreviewModal, Section } from './components/ImageManager';
import { BAG_SPEC_FIELDS, PRODUCT_CATEGORIES, PreviewControls, TRIPOD_SPEC_FIELDS, initialDraft } from './components/PreviewControls';
import { ProductSidebar } from './components/ProductSidebar';
import { ProductPreview } from './templates/ProductPreview';
import type { Device, DownloadPlatform, ImageDevice, ImageKind, ImageScope, Platform, PreviewPlatform, Product, ProductCategory, ProductImage, SyncStatus, VisionStatus } from './types';
import './styles.css';

interface PendingImageReorder {
  scope: ImageScope;
  kind: ImageKind;
  device: ImageDevice;
  imageIds: number[];
  rows?: number[][];
}

interface PendingImageChanges {
  deletedImageIds: number[];
  reorders: PendingImageReorder[];
}

const emptyPendingImageChanges = (): PendingImageChanges => ({ deletedImageIds: [], reorders: [] });

function applyPendingImageChanges(product: Product, changes: PendingImageChanges): Product {
  const deleted = new Set(changes.deletedImageIds);
  const images = product.images.filter((image) => !deleted.has(image.id)).map((image) => ({ ...image }));
  for (const reorder of changes.reorders) {
    const group = images.filter((image) => image.scope === reorder.scope && image.kind === reorder.kind && image.device === reorder.device);
    const byId = new Map(group.map((image) => [image.id, image]));
    const ordered = reorder.imageIds.map((id) => byId.get(id)).filter((image): image is ProductImage => Boolean(image));
    const included = new Set(ordered.map((image) => image.id));
    ordered.push(...group.filter((image) => !included.has(image.id)));
    const rowById = new Map<number, { rowOrder: number; colOrder: number }>();
    reorder.rows?.forEach((row, rowOrder) => row.forEach((id, colOrder) => rowById.set(id, { rowOrder, colOrder })));
    ordered.forEach((image, index) => {
      const position = rowById.get(image.id);
      image.sortOrder = index;
      image.rowOrder = position?.rowOrder ?? index;
      image.colOrder = position?.colOrder ?? 0;
    });
  }
  return { ...product, images };
}

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState(initialDraft());
  const [pendingImageChanges, setPendingImageChanges] = useState<Record<number, PendingImageChanges>>({});
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<Platform>('amazon');
  const [previewPlatform, setPreviewPlatform] = useState<PreviewPlatform>('amazon');
  const [device, setDevice] = useState<Device>('desktop');
  const [amazonDetailDevice, setAmazonDetailDevice] = useState<Device>('desktop');
  const [canEdit, setCanEdit] = useState(true);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAuthAction, setPendingAuthAction] = useState<'none' | 'edit' | 'create'>('none');
  const [exitDraftDialogOpen, setExitDraftDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(true);
  const activeEditMode = canEdit && editMode;
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showPreviewDownload, setShowPreviewDownload] = useState<boolean>(() => getStoredSiteSettings().showPreviewDownload);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncRemoteUrl, setSyncRemoteUrl] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncPassword, setSyncPassword] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<DownloadPlatform | null>(null);
  const downloadInFlight = useRef(false);
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
  const [specRecognitionImageId, setSpecRecognitionImageId] = useState<number | null>(null);
  const [recognizingSpecs, setRecognizingSpecs] = useState(false);
  const [specRecognitionMessage, setSpecRecognitionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [specRecognitionDiagnostic, setSpecRecognitionDiagnostic] = useState<{ text: string; truncated: boolean } | null>(null);
  const [specRecognitionDiagnosticOpen, setSpecRecognitionDiagnosticOpen] = useState(false);

  const baseSelectedProduct = useMemo(() => products.find((product) => product.id === selectedId) || null, [products, selectedId]);
  const selectedPendingImages = selectedId == null ? emptyPendingImageChanges() : pendingImageChanges[selectedId] || emptyPendingImageChanges();
  const selectedProduct = useMemo(() => baseSelectedProduct ? applyPendingImageChanges(baseSelectedProduct, selectedPendingImages) : null, [baseSelectedProduct, selectedPendingImages]);
  const hasUnsavedDraft = Boolean(editMode && workspaceOpen && (JSON.stringify(draft) !== JSON.stringify(initialDraft(selectedProduct)) || selectedPendingImages.deletedImageIds.length > 0 || selectedPendingImages.reorders.length > 0));
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
    void api.getSiteSettings().then((settings) => {
      setShowPreviewDownload(settings.showPreviewDownload);
    });
  }, []);
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
    void api.getAuthStatus().then((status) => {
      setCanEdit(status.authenticated);
      setPasswordRequired(status.passwordRequired);
      if (!status.authenticated) {
        setEditMode(false);
      }
    }).catch(() => {
      setCanEdit(true);
      setPasswordRequired(false);
    });
  }, []);
  useEffect(() => {
    if (!canEdit) return;
    void api.getVisionStatus().then((result) => { applyVisionStatus(result); setVisionStatusUnavailable(false); }).catch(() => { setVisionConfigured(false); setVisionStatusUnavailable(true); });
  }, [canEdit]);

  const openUnlockDialog = (nextAction: 'none' | 'edit' | 'create' = 'none', message: string | null = null) => {
    setPendingAuthAction(nextAction);
    setAuthPassword('');
    setAuthError(message);
    setAuthDialogOpen(true);
  };
  const handleUnauthorizedError = (error: any, retryAction: 'none' | 'edit' | 'create' = 'edit'): boolean => {
    if (error?.status === 401) {
      setStoredAdminToken('');
      setCanEdit(false);
      setPasswordRequired(true);
      setEditMode(false);
      openUnlockDialog(retryAction, '需要输入管理员密码才能编辑');
      return true;
    }
    return false;
  };
  const submitUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authPassword.trim()) {
      setAuthError('请输入管理员密码');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const status = await api.loginAdmin(authPassword);
      setCanEdit(status.authenticated);
      setPasswordRequired(status.passwordRequired);
      setAuthDialogOpen(false);
      setAuthPassword('');
      if (pendingAuthAction === 'create') {
        setSelectedId(null);
        setDraft(initialDraft());
        setEditMode(true);
        setWorkspaceOpen(true);
      } else if (pendingAuthAction === 'edit') {
        setEditMode(true);
      }
      setPendingAuthAction('none');
      setNotice({ type: 'success', text: '已进入编辑管理模式' });
    } catch (error: any) {
      setAuthError(error.message || '密码验证失败');
    } finally {
      setAuthBusy(false);
    }
  };
  const lockEditing = async () => {
    if (hasUnsavedDraft) {
      setExitDraftDialogOpen(true);
      return;
    }
    await finishLockEditing();
  };
  const finishLockEditing = async () => {
    setDraft(initialDraft(selectedProduct));
    await api.logoutAdmin().catch(() => undefined);
    setCanEdit(false);
    setEditMode(false);
    setSettingsOpen(false);
    if (!selectedProduct) setWorkspaceOpen(false);
    setNotice({ type: 'success', text: '已退出编辑模式，当前为访客只读视图' });
  };
  const openSettings = () => {
    if (!canEdit) {
      openUnlockDialog('none');
      return;
    }
    setSettingsNotice(null);
    setWorkspaceOpen(false);
    setSettingsOpen(true);
    void api.getSyncStatus().then((status) => {
      setSyncStatus(status);
      if (status.remoteUrl) setSyncRemoteUrl(status.remoteUrl);
    }).catch(() => undefined);
  };
  const openSyncModal = () => {
    if (!syncRemoteUrl.trim()) {
      setSettingsNotice({ type: 'error', text: '请先填写目标云服务器地址' });
      return;
    }
    setSyncPassword('');
    setSyncError(null);
    setSyncModalOpen(true);
  };
  const closeSyncModal = () => {
    if (syncBusy) return;
    setSyncModalOpen(false);
    setSyncPassword('');
    setSyncError(null);
  };
  const submitSyncToServer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!syncRemoteUrl.trim()) {
      setSyncError('请填写目标云服务器地址');
      return;
    }
    setSyncBusy(true);
    setSyncError(null);
    try {
      const response = await api.pushSyncToServer({
        remoteUrl: syncRemoteUrl.trim(),
        password: syncPassword,
      });
      setSyncStatus(response.status);
      setSyncRemoteUrl(response.status.remoteUrl);
      setSyncPassword('');
      setSyncModalOpen(false);
      setSettingsNotice({
        type: 'success',
        text: `已成功同步到云服务器（共同步 ${response.result.productCount} 个商品，本次新增/更新图片 ${response.result.uploadedImageFiles} 张，清理远端旧图 ${response.result.removedRemoteFiles} 张）`,
      });
    } catch (error: any) {
      if (!handleUnauthorizedError(error, 'none')) {
        setSyncError(error.message || '同步到云服务器失败');
      }
    } finally {
      setSyncBusy(false);
    }
  };
  const togglePreviewDownloadSetting = async (nextValue: boolean) => {
    const previous = showPreviewDownload;
    setShowPreviewDownload(nextValue);
    setSavingSettings(true);
    setSettingsNotice(null);
    try {
      const updated = await api.saveSiteSettings({ showPreviewDownload: nextValue });
      setShowPreviewDownload(updated.showPreviewDownload);
      setSettingsNotice({
        type: 'success',
        text: updated.showPreviewDownload ? '已开启预览界面图片下载按钮' : '已隐藏预览界面图片下载按钮',
      });
    } catch (error: any) {
      setShowPreviewDownload(previous);
      if (!handleUnauthorizedError(error, 'none')) {
        setSettingsNotice({ type: 'error', text: error.message || '保存设置失败' });
      }
    } finally {
      setSavingSettings(false);
    }
  };
  const selectProduct = (product: Product, mode: 'edit' | 'preview') => {
    setSelectedId(product.id);
    if (mode === 'edit' && !canEdit) {
      setEditMode(false);
      setWorkspaceOpen(true);
      openUnlockDialog('edit');
      return;
    }
    setEditMode(mode === 'edit' && canEdit);
    setSettingsOpen(false);
    setWorkspaceOpen(true);
    setNotice(null);
  };
  const createProduct = () => {
    if (!canEdit) {
      openUnlockDialog('create');
      return;
    }
    setSelectedId(null);
    setDraft(initialDraft());
    setEditMode(true);
    setSettingsOpen(false);
    setWorkspaceOpen(true);
    setNotice(null);
  };
  const updateDraft = (field: string, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const hasFilledSpecsForCategory = (category: ProductCategory) => {
    if (category === 'bag') return Object.values(draft.specs.bag).some((val) => val.trim().length > 0);
    if (category === 'tripod') return Object.values(draft.specs.tripod).some((val) => val.trim().length > 0);
    return draft.specs.other.some((item) => item.label.trim().length > 0 || item.value.trim().length > 0);
  };
  const updateCategoryDraft = (nextCategory: ProductCategory) => {
    if (nextCategory === draft.category) return;
    if (hasFilledSpecsForCategory(draft.category)) {
      const currentLabel = PRODUCT_CATEGORIES.find((item) => item.key === draft.category)?.label || '';
      const nextLabel = PRODUCT_CATEGORIES.find((item) => item.key === nextCategory)?.label || '';
      if (!window.confirm(`一个商品只能选择一个类目。从「${currentLabel}」切换到「${nextLabel}」将清空当前已填写的${currentLabel}参数，确定切换吗？`)) {
        return;
      }
    }
    const emptySpecs = initialDraft(null).specs;
    setDraft((current) => ({
      ...current,
      category: nextCategory,
      specs: emptySpecs,
    }));
  };
  const updatePresetSpec = (category: 'bag' | 'tripod', key: string, value: string) => setDraft((current) => ({
    ...current,
    specs: {
      ...current.specs,
      [category]: {
        ...current.specs[category],
        [key]: value,
      },
    },
  }));
  const updateOtherSpec = (index: number, field: 'label' | 'value', value: string) => setDraft((current) => ({
    ...current,
    specs: {
      ...current.specs,
      other: current.specs.other.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    },
  }));
  const addOtherSpec = () => setDraft((current) => ({
    ...current,
    specs: {
      ...current.specs,
      other: [...current.specs.other, { label: '', value: '' }],
    },
  }));
  const removeOtherSpec = (index: number) => setDraft((current) => ({
    ...current,
    specs: {
      ...current.specs,
      other: current.specs.other.length > 1 ? current.specs.other.filter((_, itemIndex) => itemIndex !== index) : [{ label: '', value: '' }],
    },
  }));
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
      if (!handleUnauthorizedError(error, 'edit')) setVisionConfigMessage({ type: 'error', text: error.message || '保存识图 API 配置失败' });
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
      if (!handleUnauthorizedError(error, 'edit')) setVisionConfigMessage({ type: 'error', text: error.message || '恢复环境配置失败' });
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
      setRecognitionMessage({ type: 'success', text: '识别结果已填入左侧草稿。商品型号和价格未改动，请检查后手动保存。' });
    } catch (error: any) {
      if (!handleUnauthorizedError(error, 'edit')) setRecognitionMessage({ type: 'error', text: error.message || '图片识别失败，请稍后重试' });
    } finally { setRecognizing(false); }
  };
  const recognizeSpecs = async () => {
    const product = selectedProduct;
    if (!product) return;
    const image = product.images.find((item) => item.id === specRecognitionImageId);
    if (!image) { setSpecRecognitionMessage({ type: 'error', text: '请先选择一张已上传的图片' }); return; }
    const category = draft.category;
    setRecognizingSpecs(true);
    setSpecRecognitionMessage(null);
    setSpecRecognitionDiagnostic(null);
    setSpecRecognitionDiagnosticOpen(false);
    try {
      const { result } = await api.recognizeProductSpecs(product.id, image.id, category);
      if (selectedId !== product.id) return;
      setDraft((current) => {
        if (current.category !== category) return current;
        if (category === 'bag' || category === 'tripod') {
          const currentValues = current.specs[category];
          const nextValues = { ...currentValues };
          for (const [key, value] of Object.entries(result.values)) {
            if (value.trim() && !nextValues[key]?.trim()) nextValues[key] = value;
          }
          return { ...current, specs: { ...current.specs, [category]: nextValues } };
        }
        const other = current.specs.other.map((item) => ({ ...item }));
        for (const item of result.other) {
          const normalizedLabel = item.label.trim().toLocaleLowerCase();
          const existing = other.find((entry) => entry.label.trim().toLocaleLowerCase() === normalizedLabel);
          if (existing) {
            if (!existing.value.trim()) existing.value = item.value;
          } else if (normalizedLabel) {
            other.push({ label: item.label.trim(), value: item.value.trim() });
          }
        }
        return { ...current, specs: { ...current.specs, other } };
      });
      setSpecRecognitionMessage({ type: 'success', text: '识别参数已填入左侧草稿；已有参数未覆盖，请检查后保存商品。' });
    } catch (error: any) {
      setSpecRecognitionDiagnostic({
        text: typeof error?.diagnostic === 'string' && error.diagnostic ? error.diagnostic : error?.message || '参数识别失败，请稍后重试',
        truncated: error?.diagnosticTruncated === true,
      });
      if (!handleUnauthorizedError(error, 'edit')) setSpecRecognitionMessage({ type: 'error', text: error.message || '参数识别失败，请稍后重试' });
    } finally { setRecognizingSpecs(false); }
  };
  const downloadImages = async (targetPlatform: DownloadPlatform) => {
    if (!selectedProduct || downloadInFlight.current) return;
    downloadInFlight.current = true;
    setDownloading(targetPlatform);
    try {
      await api.downloadPlatformImages(selectedProduct, targetPlatform);
      setNotice({ type: 'success', text: '图片 ZIP 已交给浏览器下载，原图画质和尺寸保持不变。' });
    } catch (error: any) {
      setNotice({ type: 'error', text: error.message || '图片下载失败，请重试' });
    } finally {
      downloadInFlight.current = false;
      setDownloading(null);
    }
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.sku.trim()) { setNotice({ type: 'error', text: '商品名称和商品型号不能为空' }); return false; }
    setBusy(true);
    try {
      const result = await api.saveProduct({ ...draft, genericPrice: draft.genericPrice === '' ? null : Number(draft.genericPrice), platforms: {
        amazon: { title: draft.platforms.amazon.title, price: draft.platforms.amazon.price === '' ? null : Number(draft.platforms.amazon.price) },
        tmall: { title: draft.platforms.tmall.title, price: draft.platforms.tmall.price === '' ? null : Number(draft.platforms.tmall.price) },
      } }, selectedId ?? undefined);
      let latestProduct = result.product;
      const wasExistingProduct = selectedId != null;
      const changes = wasExistingProduct ? pendingImageChanges[result.product.id] || emptyPendingImageChanges() : emptyPendingImageChanges();
      setProducts((current) => wasExistingProduct ? current.map((item) => item.id === latestProduct.id ? latestProduct : item) : [latestProduct, ...current]);
      setSelectedId(latestProduct.id);

      for (const imageId of changes.deletedImageIds) {
        const deletedResult = await api.deleteImage(imageId);
        latestProduct = deletedResult.product;
        setProducts((current) => current.map((item) => item.id === latestProduct.id ? latestProduct : item));
        setPendingImageChanges((current) => {
          const pending = current[latestProduct.id];
          if (!pending) return current;
          const next = { ...pending, deletedImageIds: pending.deletedImageIds.filter((id) => id !== imageId) };
          return next.deletedImageIds.length || next.reorders.length ? { ...current, [latestProduct.id]: next } : Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== latestProduct.id));
        });
      }

      for (const reorder of changes.reorders) {
        const deletedIds = new Set(changes.deletedImageIds);
        const groupIds = latestProduct.images
          .filter((image) => image.scope === reorder.scope && image.kind === reorder.kind && image.device === reorder.device)
          .map((image) => image.id);
        const groupIdSet = new Set(groupIds);
        const orderedIds = reorder.imageIds.filter((id) => groupIdSet.has(id) && !deletedIds.has(id));
        const included = new Set(orderedIds);
        orderedIds.push(...groupIds.filter((id) => !included.has(id)));
        const rows = reorder.rows?.map((row) => row.filter((id) => groupIdSet.has(id) && !deletedIds.has(id))).filter((row) => row.length > 0);
        if (rows) {
          const rowIds = new Set(rows.flat());
          rows.push(...groupIds.filter((id) => !rowIds.has(id)).map((id) => [id]));
        }
        const reorderedResult = await api.reorderImages(latestProduct.id, orderedIds, reorder.scope, reorder.kind, reorder.device, rows);
        latestProduct = reorderedResult.product;
        setProducts((current) => current.map((item) => item.id === latestProduct.id ? latestProduct : item));
        setPendingImageChanges((current) => {
          const pending = current[latestProduct.id];
          if (!pending) return current;
          const next = { ...pending, reorders: pending.reorders.filter((item) => item.scope !== reorder.scope || item.kind !== reorder.kind || item.device !== reorder.device) };
          return next.deletedImageIds.length || next.reorders.length ? { ...current, [latestProduct.id]: next } : Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== latestProduct.id));
        });
      }

      setProducts((current) => current.map((item) => item.id === latestProduct.id ? latestProduct : item));
      setDraft(initialDraft(latestProduct));
      setNotice({ type: 'success', text: wasExistingProduct ? '商品已保存' : '商品已创建' });
      return true;
    } catch (error: any) { if (!handleUnauthorizedError(error, 'edit')) setNotice({ type: 'error', text: error.message }); return false; } finally { setBusy(false); }
  };
  const discardAndExitEditing = async () => {
    if (selectedId != null) setPendingImageChanges((current) => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== selectedId)));
    setExitDraftDialogOpen(false);
    await finishLockEditing();
  };
  const removeProduct = async () => {
    if (!selectedProduct || !window.confirm(`确定删除「${selectedProduct.name}」吗？图片文件也会被删除。`)) return;
    setBusy(true);
    try { await api.deleteProduct(selectedProduct.id); const remaining = products.filter((item) => item.id !== selectedProduct.id); setProducts(remaining); setSelectedId(remaining[0]?.id ?? null); setNotice({ type: 'success', text: '商品已删除' }); } catch (error: any) { if (!handleUnauthorizedError(error, 'edit')) setNotice({ type: 'error', text: error.message }); } finally { setBusy(false); }
  };
  const withProductUpdate = async (operation: () => Promise<{ product: Product }>) => { if (!selectedProduct) return; setBusy(true); try { const result = await operation(); setProducts((current) => current.map((item) => item.id === result.product.id ? result.product : item)); } catch (error: any) { if (!handleUnauthorizedError(error, 'edit')) setNotice({ type: 'error', text: error.message }); } finally { setBusy(false); } };
  const upload = (scope: ImageScope, kind: ImageKind, imageDevice: ImageDevice = 'all') => (files: File[]) => withProductUpdate(() => api.uploadImages(selectedProduct!.id, files, scope, kind, imageDevice));
  const importCommon = (scope: ImageScope, kind: ImageKind, imageDevice: ImageDevice = 'all') => () => withProductUpdate(async () => {
    const result = await api.importCommonImages(selectedProduct!.id, scope, kind, imageDevice);
    setNotice({ type: 'success', text: `已将上方通用${kind === 'main' ? '主图' : '详情图'}导入到当前专属栏目` });
    return result;
  });
  const deleteImage = async (image: ProductImage) => {
    if (selectedId == null) return;
    setPendingImageChanges((current) => {
      const pending = current[selectedId] || emptyPendingImageChanges();
      if (pending.deletedImageIds.includes(image.id)) return current;
      return { ...current, [selectedId]: { ...pending, deletedImageIds: [...pending.deletedImageIds, image.id] } };
    });
  };
  const reorder = (scope: ImageScope, kind: ImageKind, imageDevice: ImageDevice = 'all') => async (images: ProductImage[], rows?: number[][]) => {
    if (selectedId == null) return;
    const nextReorder: PendingImageReorder = { scope, kind, device: imageDevice, imageIds: images.map((image) => image.id), rows };
    setPendingImageChanges((current) => {
      const pending = current[selectedId] || emptyPendingImageChanges();
      const reorders = pending.reorders.filter((item) => item.scope !== scope || item.kind !== kind || item.device !== imageDevice);
      return { ...current, [selectedId]: { ...pending, reorders: [...reorders, nextReorder] } };
    });
  };

  return <div className={`app-shell ${workspaceOpen || settingsOpen ? 'app-shell--workspace' : 'app-shell--catalog'}`}>
    {settingsOpen ? <main className="workspace settings-workspace">
      <header className="workspace-header">
        <div className="breadcrumbs">
          <button type="button" className="back-to-catalog" onClick={() => setSettingsOpen(false)}><ChevronLeft size={16} /> 商品宫格</button>
          <ChevronRight size={14} />
          <strong>系统设置</strong>
        </div>
        <div className="header-actions">
          <span className={`sync-status ${savingSettings ? 'is-busy' : ''}`}><span />{savingSettings ? '保存中' : '设置已同步'}</span>
          {passwordRequired && canEdit && <button type="button" className="ghost-button auth-button" onClick={() => void lockEditing()}><LogOut size={15} /> 退出编辑</button>}
        </div>
      </header>
      {settingsNotice && <div className={`notice notice--${settingsNotice.type}`}><AlertCircle size={16} />{settingsNotice.text}<button onClick={() => setSettingsNotice(null)}>×</button></div>}
      <div className="settings-page">
        <div className="page-intro">
          <div>
            <span className="eyebrow">SYSTEM SETTINGS</span>
            <h2>界面与功能设置</h2>
            <p>控制商品详情预览界面的统一显示项，修改后立即生效</p>
          </div>
        </div>
        <section className="settings-card">
          <div className="settings-item">
            <div className="settings-item__info">
              <div className="settings-item__title">
                <span className="settings-item__icon"><Download size={16} /></span>
                <div>
                  <strong>显示预览界面的图片下载按钮</strong>
                  <p>开启后，在商品详情预览界面的平台/设备切换栏中显示“下载”按钮（打包下载该平台原图 ZIP）；关闭后统一隐藏该下载入口。</p>
                </div>
              </div>
            </div>
            <label className="settings-switch" aria-label="显示预览界面的图片下载按钮">
              <input
                type="checkbox"
                checked={showPreviewDownload}
                disabled={savingSettings}
                onChange={(event) => void togglePreviewDownloadSetting(event.target.checked)}
              />
              <span className="settings-switch__slider" />
              <span className="settings-switch__label">{showPreviewDownload ? '已开启' : '已关闭'}</span>
            </label>
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-item settings-item--sync">
            <div className="settings-item__info">
              <div className="settings-item__title">
                <span className="settings-item__icon"><UploadCloud size={16} /></span>
                <div>
                  <strong>同步本地商品与图片到云服务器</strong>
                  <p>在本地完成商品信息与图片排版后，可将本地数据库与上传图片一键增量同步到目标云服务器。同步前需弹窗确认并输入云服务器的一次性管理员密码（密码不会保存在本地项目）。</p>
                </div>
              </div>
              <div className="settings-sync-controls">
                <label className="settings-sync-field">
                  <span>目标云服务器地址</span>
                  <input
                    type="url"
                    value={syncRemoteUrl}
                    onChange={(event) => setSyncRemoteUrl(event.target.value)}
                    placeholder="例如：https://your-server.example.com:端口"
                    disabled={syncBusy}
                  />
                </label>
                <div className="settings-sync-meta">
                  <span>本地待同步商品：<strong>{syncStatus?.localProductCount ?? products.length}</strong> 个</span>
                  <span>本地图片文件：<strong>{syncStatus?.localImageFileCount ?? 0}</strong> 张</span>
                  {syncStatus?.lastSyncedAt && <span>上次同步时间：{new Date(syncStatus.lastSyncedAt).toLocaleString('zh-CN')}</span>}
                </div>
              </div>
            </div>
            <div className="settings-sync-action">
              <button
                type="button"
                className="primary-button"
                onClick={openSyncModal}
                disabled={syncBusy}
              >
                <UploadCloud size={16} /> 同步到服务器
              </button>
            </div>
          </div>
        </section>
      </div>
    </main> : !workspaceOpen ? <ProductSidebar products={products} search={search} onSearch={setSearch} onSelect={selectProduct} onCreate={createProduct} onOpenSettings={openSettings} canEdit={canEdit} passwordRequired={passwordRequired} onRequestUnlock={() => openUnlockDialog('none')} onLock={() => void lockEditing()} /> : <>
    <main className="workspace">
      <header className="workspace-header"><div className="breadcrumbs"><button className="back-to-catalog" onClick={() => setWorkspaceOpen(false)}><ChevronLeft size={16} /> 商品宫格</button><ChevronRight size={14} /><strong>{selectedProduct?.name || '新建商品'}</strong></div><div className="header-actions"><span className={`sync-status ${busy ? 'is-busy' : ''}`}><span />{busy ? '处理中' : '本地数据已同步'}</span>{passwordRequired && !canEdit && <button type="button" className="ghost-button auth-button" onClick={() => openUnlockDialog('edit')}><Lock size={15} /> 输入密码编辑</button>}{passwordRequired && canEdit && <button type="button" className="ghost-button auth-button" onClick={() => void lockEditing()}><LogOut size={15} /> 退出编辑</button>}{canEdit && selectedProduct && <button className="ghost-button danger" onClick={() => void removeProduct()}><Trash2 size={15} /> 删除商品</button>}{activeEditMode && <button className="primary-button" onClick={() => void save()} disabled={busy}><Save size={16} /> 保存商品</button>}</div></header>
      {notice && <div className={`notice notice--${notice.type}`}><AlertCircle size={16} />{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
      <div className={`workspace-content ${!activeEditMode ? 'workspace-content--preview' : ''}`}>
        <section className="editor-column">
          <div className="page-intro"><div><span className="eyebrow">PRODUCT WORKSPACE</span><h2>{!activeEditMode ? '商品详情预览' : selectedProduct ? '编辑商品' : '创建新商品'}</h2><p>{activeEditMode ? '维护商品信息、平台素材与详情展示内容' : '预览当前商品在所选平台和设备上的展示效果'}</p></div>{canEdit && <div className="view-mode-toggle"><button className={activeEditMode ? 'active' : ''} onClick={() => setEditMode(true)}><FileText size={15} /> 编辑内容</button><button className={!activeEditMode ? 'active' : ''} onClick={() => setEditMode(false)}><LayoutTemplate size={15} /> 预览效果</button></div>}</div>
          {activeEditMode ? <>
            <Section title="基础信息" action={<span className="section-hint">必填项以 * 标注</span>}><div className="form-grid"><label>商品名称 *<input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="例如：轻量通勤双肩包" /></label><label>商品型号 *<input value={draft.sku} onChange={(event) => updateDraft('sku', event.target.value)} placeholder="例如：LV-2026-001" /></label><label className="span-2">通用标题<textarea value={draft.genericTitle} onChange={(event) => updateDraft('genericTitle', event.target.value)} placeholder="未设置平台标题时使用此标题" rows={2} /></label><label>通用价格<input type="number" min="0" step="0.01" value={draft.genericPrice} onChange={(event) => updateDraft('genericPrice', event.target.value)} placeholder="可选" /></label></div></Section>
            <Section title="商品参数" action={<span className="section-hint">每个商品仅选择一个所属类目</span>}>
              <div className="platform-form-tabs" role="tablist" aria-label="商品类目">
                {PRODUCT_CATEGORIES.map((item) => (
                  <button
                    type="button"
                    role="tab"
                    key={item.key}
                    aria-selected={draft.category === item.key}
                    className={draft.category === item.key ? 'active' : ''}
                    onClick={() => updateCategoryDraft(item.key)}
                    disabled={recognizingSpecs}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {draft.category === 'bag' && (
                <div className="form-grid">
                  {BAG_SPEC_FIELDS.map((field) => (
                    <label key={field.key} className={field.key === 'other' ? 'span-2' : undefined}>
                      {field.label}
                      <input
                        value={draft.specs.bag[field.key] || ''}
                        onChange={(event) => updatePresetSpec('bag', field.key, event.target.value)}
                        placeholder={field.placeholder}
                      />
                    </label>
                  ))}
                </div>
              )}
              {draft.category === 'tripod' && (
                <div className="form-grid">
                  {TRIPOD_SPEC_FIELDS.map((field) => (
                    <label key={field.key} className={field.key === 'other' ? 'span-2' : undefined}>
                      {field.label}
                      <input
                        value={draft.specs.tripod[field.key] || ''}
                        onChange={(event) => updatePresetSpec('tripod', field.key, event.target.value)}
                        placeholder={field.placeholder}
                      />
                    </label>
                  ))}
                </div>
              )}
              {draft.category === 'other' && (
                <div className="custom-specs">
                  <div className="custom-specs__list">
                    {draft.specs.other.map((item, index) => (
                      <div className="custom-specs__row" key={index}>
                        <input
                          value={item.label}
                          onChange={(event) => updateOtherSpec(index, 'label', event.target.value)}
                          placeholder="参数名称（例如：最大尺寸 / 最小尺寸 / 重量）"
                          aria-label={`自定义参数名称 ${index + 1}`}
                        />
                        <input
                          value={item.value}
                          onChange={(event) => updateOtherSpec(index, 'value', event.target.value)}
                          placeholder="参数内容（例如：45 × 30 × 18 cm）"
                          aria-label={`自定义参数内容 ${index + 1}`}
                        />
                        <button
                          type="button"
                          className="icon-button custom-specs__remove"
                          onClick={() => removeOtherSpec(index)}
                          title="删除该参数"
                          aria-label={`删除第 ${index + 1} 项参数`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="custom-specs__add" onClick={addOtherSpec}>
                    <Plus size={14} /> 添加参数
                  </button>
                </div>
              )}
            </Section>
            <Section title="平台内容"><div className="platform-form-tabs"><button className={platform === 'amazon' ? 'active' : ''} onClick={() => setPlatform('amazon')}>亚马逊内容</button><button className={platform === 'tmall' ? 'active' : ''} onClick={() => setPlatform('tmall')}>天猫内容</button></div><div className="form-grid"><label className="span-2">{platform === 'amazon' ? '亚马逊' : '天猫'}标题<textarea value={draft.platforms[platform].title} onChange={(event) => updatePlatformDraft('title', event.target.value)} placeholder="留空时自动使用通用标题" rows={3} /></label><label>平台价格<input type="number" min="0" step="0.01" value={draft.platforms[platform].price} onChange={(event) => updatePlatformDraft('price', event.target.value)} placeholder="留空时使用通用价格" /></label></div></Section>
            {selectedProduct ? <><Section title="图片素材" action={<span className="section-hint"><UploadCloud size={14} /> 支持 JPG、PNG、WEBP、GIF，单张不超过 10 MB</span>}><ImageManager product={selectedProduct} scope="common" kind="main" onUpload={upload('common', 'main')} onDelete={deleteImage} onReorder={reorder('common', 'main')} onPreview={setPreviewImage} /><ImageManager product={selectedProduct} scope="common" kind="detail" onUpload={upload('common', 'detail')} onDelete={deleteImage} onReorder={reorder('common', 'detail')} onPreview={setPreviewImage} /><div className="asset-platform-note">此处上传的图片作为商品公共素材库，需在下方「平台专属图片」中点击「导入图片」或直接上传后，才会在预览界面中显示。</div></Section><Section title="平台专属图片"><div className="platform-assets-grid"><div><h4>亚马逊 · 主图</h4><ImageManager product={selectedProduct} scope="amazon" kind="main" onUpload={upload('amazon', 'main')} onImportCommon={importCommon('amazon', 'main')} onDelete={deleteImage} onReorder={reorder('amazon', 'main')} onPreview={setPreviewImage} /></div><div><h4>亚马逊 · 详情图</h4><div className="device-image-tabs" role="tablist" aria-label="亚马逊详情图设备"><button type="button" role="tab" aria-selected={amazonDetailDevice === 'desktop'} className={amazonDetailDevice === 'desktop' ? 'active' : ''} onClick={() => setAmazonDetailDevice('desktop')}>电脑版</button><button type="button" role="tab" aria-selected={amazonDetailDevice === 'mobile'} className={amazonDetailDevice === 'mobile' ? 'active' : ''} onClick={() => setAmazonDetailDevice('mobile')}>手机版</button></div><p className="device-image-hint">{`当前管理${amazonDetailDevice === 'desktop' ? '电脑版' : '手机版'}详情图；支持宫格上下左右拖动，同行最多 3 张组成横滑。`}</p><ImageManager product={selectedProduct} scope="amazon" kind="detail" device={amazonDetailDevice} gridMode onUpload={upload('amazon', 'detail', amazonDetailDevice)} onImportCommon={importCommon('amazon', 'detail', amazonDetailDevice)} onDelete={deleteImage} onReorder={reorder('amazon', 'detail', amazonDetailDevice)} onPreview={setPreviewImage} /></div><div><h4>天猫 · 主图</h4><ImageManager product={selectedProduct} scope="tmall" kind="main" onUpload={upload('tmall', 'main')} onImportCommon={importCommon('tmall', 'main')} onDelete={deleteImage} onReorder={reorder('tmall', 'main')} onPreview={setPreviewImage} /></div><div><h4>天猫 · sku</h4><ImageManager product={selectedProduct} scope="tmall" kind="sku" onUpload={upload('tmall', 'sku')} onDelete={deleteImage} onReorder={reorder('tmall', 'sku')} onPreview={setPreviewImage} /></div><div className="span-2"><h4>天猫 · 详情图</h4><ImageManager product={selectedProduct} scope="tmall" kind="detail" onUpload={upload('tmall', 'detail')} onImportCommon={importCommon('tmall', 'detail')} onDelete={deleteImage} onReorder={reorder('tmall', 'detail')} onPreview={setPreviewImage} /></div></div></Section></> : <div className="create-tip"><UploadCloud size={22} /><strong>先保存商品，再上传图片</strong><span>保存后可管理主图、详情图及平台专属素材</span></div>}</> : <section className="preview-workspace"><div className="preview-workspace__header"><div><span className="eyebrow">LIVE PREVIEW</span><h2>商品详情预览</h2></div><PreviewControls onDownload={showPreviewDownload ? downloadImages : undefined} downloading={downloading} downloadDisabled={!selectedProduct} platform={previewPlatform} device={device} onPlatform={setPreviewPlatform} onDevice={(nextPlatform, nextDevice) => { setPreviewPlatform(nextPlatform); setDevice(nextDevice); }} /></div>{selectedProduct ? <ProductPreview product={selectedProduct} products={products} platform={previewPlatform} device={device} onPreview={setPreviewImage} onSelectProduct={(target) => selectProduct(target, 'preview')} /> : <div className="empty-preview"><LoaderCircle size={25} /><span>保存商品后查看详情预览</span></div>}</section>}
        </section>
        {activeEditMode && <aside className="right-rail"><div className="rail-title"><span>预览导航</span><small>LIVE</small></div><PreviewControls platform={previewPlatform} device={device} onPlatform={setPreviewPlatform} onDevice={(nextPlatform, nextDevice) => { setPreviewPlatform(nextPlatform); setDevice(nextDevice); }} /><div className="rail-tip"><strong>预览说明</strong><p>平台按钮位于上层，设备按钮位于平台下方。切换不会清空当前编辑草稿。</p></div><section className="vision-panel">
          <div className="vision-panel__heading"><span className="vision-panel__icon"><Sparkles size={15} /></span><div><strong>图片识别填资料</strong><small>第三方视觉 API</small></div></div>
          <details className="vision-config" open={visionConfigured !== true}>
            <summary><span>配置 URL、Key 和模型</span><small>{visionConfigured ? '已配置' : '尚未配置'}</small></summary>
            <div className="vision-config__fields">
              <label>API URL<input type="url" value={visionBaseUrl} onChange={(event) => setVisionBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" disabled={savingVisionConfig || recognizing || recognizingSpecs} /></label>
              <label>API Key<input type="password" value={visionApiKey} onChange={(event) => setVisionApiKey(event.target.value)} placeholder={visionApiKeyConfigured ? '已保存；留空保持不变' : '粘贴服务商 API Key'} autoComplete="new-password" disabled={savingVisionConfig || recognizing || recognizingSpecs} /></label>
              <label>模型名称<input type="text" value={visionModel} onChange={(event) => setVisionModel(event.target.value)} placeholder="支持图片输入的模型名称" disabled={savingVisionConfig || recognizing || recognizingSpecs} /></label>
              <p className="vision-config__hint">{visionApiKeyConfigured ? '密钥已配置，不会回显；如需更换，输入新 Key 后保存。' : '部分兼容服务允许不填写 Key。配置保存在服务端数据目录，不会写入前端或源码。'}</p>
              <button type="button" className="vision-config__save" onClick={() => void saveVisionConfiguration()} disabled={savingVisionConfig || recognizing || recognizingSpecs}>
                {savingVisionConfig ? <><LoaderCircle className="spin" size={13} /> 正在保存…</> : <><Save size={13} /> 保存 API 配置</>}
              </button>
              {visionConfigSource === 'saved' && <button type="button" className="vision-config__reset" onClick={() => void resetVisionConfiguration()} disabled={savingVisionConfig || recognizing || recognizingSpecs}>恢复服务端环境变量</button>}
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
                return <div key={image.id} className={`vision-image-option ${checked ? 'is-selected' : ''} ${capped || !supported ? 'is-disabled' : ''}`}>
                  <input type="checkbox" checked={checked} disabled={capped || !supported || recognizing || recognizingSpecs} onChange={() => toggleRecognitionImage(image.id)} />
                  <button type="button" className="vision-image-preview" onClick={() => setPreviewImage(image)} aria-label={`预览图片：${image.originalName}`} title="点击预览图片"><img src={imageUrl(image)} alt="" loading="lazy" /></button>
                  <span title={image.originalName}>{image.originalName}{!supported ? '（不支持识图）' : ''}</span>
                </div>;
              }) : <div className="vision-no-images"><ImagePlus size={17} /><span>请先在左侧上传商品图片</span></div>}
            </div>
            <div className="vision-image-count">已选择 {recognitionImageIds.filter((id) => selectedProduct.images.some((image) => image.id === id && ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType))).length}/3 张 · 支持 JPG、PNG、WEBP</div>
            <label className="vision-overwrite"><input type="checkbox" checked={overwriteRecognition} onChange={(event) => setOverwriteRecognition(event.target.checked)} disabled={recognizing || recognizingSpecs} /><span>覆盖已有名称和标题</span></label>
            <button type="button" className="vision-run-button" onClick={() => void recognizeImages()} disabled={!visionConfigured || recognizing || recognizingSpecs || recognitionImageIds.length === 0 || selectedProduct.images.length === 0}>
              {recognizing ? <><LoaderCircle className="spin" size={15} /> 正在识别图片…</> : <><Sparkles size={15} /> 识别并填入资料</>}
            </button>
            {recognitionMessage && <div className={`vision-result vision-result--${recognitionMessage.type}`}>{recognitionMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{recognitionMessage.text}</span></div>}
            <p className="vision-panel__privacy">选中图片会发送至已配置的第三方服务。不会识别或修改商品型号、价格；结果仅写入草稿，不会自动保存。</p>
            <div className="vision-spec-recognition">
              <div className="vision-spec-recognition__heading"><strong>参数识别</strong><span>{PRODUCT_CATEGORIES.find((item) => item.key === draft.category)?.label}</span></div>
              <p>选择一张图片，提取图片中明确展示的商品参数。</p>
              <div className="vision-spec-image-list" role="radiogroup" aria-label="选择用于参数识别的图片">
                {selectedProduct.images.length ? selectedProduct.images.map((image) => {
                  const supported = ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType);
                  const checked = specRecognitionImageId === image.id;
                  return <div key={image.id} className={`vision-image-option ${checked ? 'is-selected' : ''} ${!supported ? 'is-disabled' : ''}`}>
                    <input type="radio" name="spec-recognition-image" checked={checked} disabled={!supported || recognizing || recognizingSpecs} onChange={() => setSpecRecognitionImageId(image.id)} />
                    <button type="button" className="vision-image-preview" onClick={() => setPreviewImage(image)} aria-label={`预览图片：${image.originalName}`} title="点击预览图片"><img src={imageUrl(image)} alt="" loading="lazy" /></button>
                    <span title={image.originalName}>{image.originalName}{!supported ? '（不支持识图）' : ''}</span>
                  </div>;
                }) : <div className="vision-no-images"><ImagePlus size={17} /><span>请先在左侧上传商品图片</span></div>}
              </div>
              <button type="button" className="vision-run-button vision-run-button--specs" onClick={() => void recognizeSpecs()} disabled={!visionConfigured || recognizing || recognizingSpecs || !specRecognitionImageId || !selectedProduct.images.some((image) => image.id === specRecognitionImageId && ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType))}>
                {recognizingSpecs ? <><LoaderCircle className="spin" size={15} /> 正在识别参数…</> : <><Sparkles size={15} /> 识别并填入参数</>}
              </button>
              {specRecognitionMessage && <div className={`vision-result vision-result--${specRecognitionMessage.type}`}>{specRecognitionMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}<span>{specRecognitionMessage.text}</span>{specRecognitionMessage.type === 'error' && specRecognitionDiagnostic && <button type="button" className="vision-result__details" aria-label="查看模型返回内容" title="查看模型返回内容" onClick={() => setSpecRecognitionDiagnosticOpen(true)}><AlertCircle size={15} /></button>}</div>}
              <p className="vision-panel__privacy">参数识别只补充空白项，不覆盖已有内容；结果仅写入草稿，检查后点击“保存商品”生效。</p>
            </div>
          </> : <div className="vision-no-images"><ImagePlus size={17} /><span>先保存商品并上传图片，再使用识别填资料</span></div>}
        </section><div className="rail-shortcuts"><div><span>⌘</span><small>保存商品</small><b>Ctrl S</b></div><div><span>⌁</span><small>拖拽排序</small><b>图片卡片</b></div></div></aside>}
      </div>
    </main>
    </>}
    {specRecognitionDiagnosticOpen && specRecognitionDiagnostic && <div className="modal-backdrop vision-diagnostic-backdrop" role="dialog" aria-modal="true" aria-labelledby="vision-diagnostic-title" onClick={() => setSpecRecognitionDiagnosticOpen(false)}>
      <section className="vision-diagnostic" onClick={(event) => event.stopPropagation()}>
        <header><h2 id="vision-diagnostic-title">参数识别返回内容</h2><button type="button" className="icon-button" aria-label="关闭" onClick={() => setSpecRecognitionDiagnosticOpen(false)}><X size={17} /></button></header>
        <p>以下为识别服务返回的内容或错误信息；内容不会自动填入商品参数。</p>
        <pre>{specRecognitionDiagnostic.text}</pre>
        {specRecognitionDiagnostic.truncated && <small>内容过长，已截取前 12,000 个字符。</small>}
      </section>
    </div>}
    {authDialogOpen && (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="输入管理员密码解锁编辑" onClick={() => !authBusy && setAuthDialogOpen(false)}>
        <form className="auth-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submitUnlock(event)}>
          <div className="auth-modal__header">
            <span className="auth-modal__icon"><KeyRound size={18} /></span>
            <div>
              <h3>管理员密码验证</h3>
              <p>输入管理员密码后将显示新建、编辑、删除与图片上传选项</p>
            </div>
          </div>
          <label className="auth-modal__field">
            <span>管理员密码</span>
            <input
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="请输入管理员密码"
              autoFocus
              disabled={authBusy}
            />
          </label>
          {authError && <div className="auth-modal__error"><AlertCircle size={14} /><span>{authError}</span></div>}
          <div className="auth-modal__actions">
            <button type="button" className="ghost-button" onClick={() => setAuthDialogOpen(false)} disabled={authBusy}>取消</button>
            <button type="submit" className="primary-button" disabled={authBusy}>
              {authBusy ? <><LoaderCircle className="spin" size={15} /> 验证中…</> : '解锁编辑'}
            </button>
          </div>
        </form>
      </div>
    )}
    {exitDraftDialogOpen && (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="exit-draft-title" onClick={() => setExitDraftDialogOpen(false)}>
        <section className="auth-modal" onClick={(event) => event.stopPropagation()}>
          <div className="auth-modal__header">
            <span className="auth-modal__icon"><AlertCircle size={18} /></span>
            <div>
              <h3 id="exit-draft-title">商品修改尚未保存</h3>
              <p>图片上传和导入已即时保存。商品资料、图片删除和排序只有点击“保存商品”后才会保存；退出时可丢弃未保存修改。</p>
            </div>
          </div>
          <div className="auth-modal__actions">
            <button type="button" className="ghost-button" onClick={() => setExitDraftDialogOpen(false)} disabled={busy}>继续编辑</button>
            <button type="button" className="ghost-button danger" onClick={() => void discardAndExitEditing()} disabled={busy}>丢弃并退出</button>
          </div>
        </section>
      </div>
    )}
    {syncModalOpen && (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="确认同步商品到云服务器" onClick={closeSyncModal}>
        <form className="auth-modal sync-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submitSyncToServer(event)}>
          <div className="auth-modal__header">
            <span className="auth-modal__icon"><UploadCloud size={18} /></span>
            <div>
              <h3>确认同步到云服务器？</h3>
              <p>确定将当前本地的 <strong>{syncStatus?.localProductCount ?? products.length}</strong> 个商品及相关图片同步并覆盖到目标服务器（<code>{syncRemoteUrl.trim()}</code>）吗？</p>
            </div>
          </div>
          <label className="auth-modal__field">
            <span>云服务器管理员密码（一次性验证，不保存）</span>
            <input
              type="password"
              value={syncPassword}
              onChange={(event) => setSyncPassword(event.target.value)}
              placeholder="请输入目标云服务器管理员密码（未设置可留空）"
              autoFocus
              disabled={syncBusy}
            />
          </label>
          {syncError && <div className="auth-modal__error"><AlertCircle size={14} /><span>{syncError}</span></div>}
          <div className="auth-modal__actions">
            <button type="button" className="ghost-button" onClick={closeSyncModal} disabled={syncBusy}>取消</button>
            <button type="submit" className="primary-button" disabled={syncBusy}>
              {syncBusy ? <><LoaderCircle className="spin" size={15} /> 正在同步到服务器…</> : <><UploadCloud size={15} /> 确认同步</>}
            </button>
          </div>
        </form>
      </div>
    )}
    <PreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
  </div>;
}

export default App;

