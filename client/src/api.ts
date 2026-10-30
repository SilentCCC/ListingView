import type { AuthStatus, DownloadPlatform, PreviewPlatform, Product, ProductCategory, ProductImage, ImageDevice, ImageKind, ImageScope, Platform, RecognitionResult, RecognitionSpecsResult, SiteSettings, SyncPushResult, SyncStatus, VisionConfigInput, VisionStatus } from './types';

const apiBase = import.meta.env.VITE_API_BASE_URL || '';
const ADMIN_TOKEN_STORAGE_KEY = 'listingview_admin_token';
const SITE_SETTINGS_STORAGE_KEY = 'listingview_site_settings';

export function getStoredSiteSettings(): SiteSettings {
  try {
    const raw = window.localStorage.getItem(SITE_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SiteSettings>;
      if (typeof parsed.showPreviewDownload === 'boolean') {
        return { showPreviewDownload: parsed.showPreviewDownload };
      }
    }
  } catch {
    // Ignore localStorage parse errors
  }
  return { showPreviewDownload: true };
}

export function setStoredSiteSettings(settings: SiteSettings) {
  try {
    window.localStorage.setItem(SITE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function getStoredAdminToken(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)
      || window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)
      || '';
  } catch {
    return '';
  }
}

export function setStoredAdminToken(token: string) {
  try {
    if (token) {
      window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredAdminToken();
  const headers = new Headers(options?.headers || undefined);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`) as Error & { status?: number; diagnostic?: string; diagnosticTruncated?: boolean };
    error.status = response.status;
    if (typeof data.diagnostic === 'string') error.diagnostic = data.diagnostic;
    if (data.diagnosticTruncated === true) error.diagnosticTruncated = true;
    throw error;
  }
  return data as T;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>('/api/auth/status'),
  getSiteSettings: async (): Promise<SiteSettings> => {
    try {
      const settings = await request<SiteSettings>('/api/settings');
      setStoredSiteSettings(settings);
      return settings;
    } catch {
      return getStoredSiteSettings();
    }
  },
  saveSiteSettings: async (payload: SiteSettings): Promise<SiteSettings> => {
    setStoredSiteSettings(payload);
    try {
      const settings = await request<SiteSettings>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setStoredSiteSettings(settings);
      return settings;
    } catch (error: any) {
      if (error?.status === 401) throw error;
      return payload;
    }
  },
  getSyncStatus: () => request<SyncStatus>('/api/sync/status'),
  saveSyncConfig: (remoteUrl: string) => request<SyncStatus>('/api/sync/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remoteUrl }),
  }),
  pushSyncToServer: (payload: { remoteUrl: string; password?: string }) => request<{ result: SyncPushResult; status: SyncStatus }>('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  loginAdmin: async (password: string) => {
    const result = await request<{ status: AuthStatus; token: string }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (result.token) setStoredAdminToken(result.token);
    return result.status;
  },
  logoutAdmin: async () => {
    setStoredAdminToken('');
    const result = await request<{ status: AuthStatus }>('/api/auth/logout', { method: 'POST' });
    return result.status;
  },
  downloadPlatformImages: async (product: Product, platform: DownloadPlatform) => {
    const response = await fetch(`${apiBase}/api/products/${product.id}/export?platform=${platform}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '图片打包失败，请稍后重试');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    link.download = encodedName ? decodeURIComponent(encodedName) : product.sku.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-') + '-' + ({ amazon: '亚马逊', tmall: '天猫', temu: 'Temu', aliexpress: 'AliExpress' } as Record<PreviewPlatform, string>)[platform] + '.zip';
    link.href = objectUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Allow the browser to take ownership before releasing the object URL.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  },
  listProducts: (search = '') => request<{ products: Product[] }>(`/api/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getVisionStatus: () => request<VisionStatus>('/api/vision/status'),
  saveVisionConfig: (payload: VisionConfigInput) => request<VisionStatus>('/api/vision/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
  resetVisionConfig: () => request<VisionStatus>('/api/vision/config', { method: 'DELETE' }),
  recognizeProduct: (id: number, imageIds: number[]) => request<{ result: RecognitionResult }>(`/api/products/${id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds }),
  }),
  recognizeProductSpecs: (id: number, imageId: number, category: ProductCategory) => request<{ result: RecognitionSpecsResult }>(`/api/products/${id}/recognize-specs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId, category }),
  }),
  getProduct: (id: number) => request<{ product: Product }>(`/api/products/${id}`),
  saveProduct: (payload: Partial<Product> & { platforms: Product['platforms'] }, id?: number) => request<{ product: Product }>(id ? `/api/products/${id}` : '/api/products', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  deleteProduct: (id: number) => request<void>(`/api/products/${id}`, { method: 'DELETE' }),
  uploadImages: async (id: number, files: File[], scope: ImageScope, kind: ImageKind, device: ImageDevice = 'all') => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    formData.append('scope', scope);
    formData.append('kind', kind);
    formData.append('device', device);
    return request<{ product: Product }>(`/api/products/${id}/images`, { method: 'POST', body: formData });
  },
  importCommonImages: (id: number, scope: ImageScope, kind: ImageKind, device: ImageDevice = 'all') => request<{ product: Product }>(`/api/products/${id}/images/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, kind, device }),
  }),
  deleteImage: (id: number) => request<{ product: Product }>(`/api/images/${id}`, { method: 'DELETE' }),
  reorderImages: (id: number, imageIds: number[], scope: ImageScope, kind: ImageKind, device: ImageDevice = 'all', rows?: number[][]) => request<{ product: Product }>(`/api/products/${id}/images/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageIds, rows, scope, kind, device }),
  }),
};

export function formatPrice(price: number | null, currency = '¥') {
  return price == null ? '未设置价格' : `${currency}${price.toFixed(2)}`;
}

export function imageUrl(image: ProductImage) {
  return `${apiBase}${image.url}`;
}
