export type Platform = 'amazon' | 'tmall';
export type ImageDevice = 'all' | Device;
export type Device = 'desktop' | 'mobile';
export type ImageKind = 'main' | 'detail';
export type ImageScope = Platform | 'common';

export interface AuthStatus {
  authenticated: boolean;
  passwordRequired: boolean;
}

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

export interface VisionStatus {
  configured: boolean;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  source: 'saved' | 'environment' | 'none';
}

export interface VisionConfigInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface RecognitionResult {
  name: string;
  genericTitle: string;
  amazonTitle: string;
  tmallTitle: string;
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
