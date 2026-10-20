import type { Product, ProductImage, ImageDevice, ImageKind, ImageScope, RecognitionResult, VisionConfigInput, VisionStatus } from './types';

const apiBase = import.meta.env.VITE_API_BASE_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}

export const api = {
  listProducts: (search = '') => request<{ products: Product[] }>(`/api/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getVisionStatus: () => request<VisionStatus>('/api/vision/status'),
  saveVisionConfig: (payload: VisionConfigInput) => request<VisionStatus>('/api/vision/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
  resetVisionConfig: () => request<VisionStatus>('/api/vision/config', { method: 'DELETE' }),
  recognizeProduct: (id: number, imageIds: number[]) => request<{ result: RecognitionResult }>(`/api/products/${id}/recognize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds }),
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
