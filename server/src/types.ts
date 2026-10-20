export type Platform = 'amazon' | 'tmall';
export type Device = 'desktop' | 'mobile';
export type ImageDevice = 'all' | Device;
export type ImageKind = 'main' | 'detail';
export type ImageScope = Platform | 'common';

export interface ProductImage {
  id: number;
  productId: number;
  scope: ImageScope;
  kind: ImageKind;
  device: ImageDevice;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  sortOrder: number;
  rowOrder: number;
  colOrder: number;
  createdAt: string;
}

export interface PlatformContent {
  title: string;
  price: number | null;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  genericTitle: string;
  genericPrice: number | null;
  platforms: Record<Platform, PlatformContent>;
  images: ProductImage[];
  effectiveImages: Record<Platform, { main: ProductImage[]; detail: ProductImage[]; detailByDevice: Record<Device, ProductImage[]> }>;
  createdAt: string;
  updatedAt: string;
}
