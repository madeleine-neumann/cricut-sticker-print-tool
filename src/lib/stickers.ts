import { alphaBBox, computeBleed, cutPath, pngReadDpi, type BleedResult, type Loops } from './engine/index.js';
import type { TranslationKey } from './locales/de.ts';

export const MAX_ONE_PIXELS = 36_000_000;
export const MAX_TOTAL_PIXELS = 48_000_000;

export interface Motif {
  id: number;
  name: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Empty until the user enters a height; nothing is computed before that. */
  heightMm: number | null;
  /** Height derived from PNG DPI metadata, offered as a hint only. */
  suggestedHeightMm: number | null;
  copies: '' | number;
  noTransparency: boolean;
  thumbnail: string;
  /** Cut settings of this motif; new motifs start with the defaults. */
  cut: CutSettings;
}

export interface CutSettings {
  bleedMm: number;
  insetMm: number;
  mergeMm: number;
  borderMode: 'none' | 'paper' | 'color';
  borderMm: number;
  borderColor: string;
  smooth: number;
  fillHoles: boolean;
  bleedIntoHoles: boolean;
  alphaThreshold: number;
  erodePx: number;
}

export const defaultCutSettings: CutSettings = {
  bleedMm: 2, insetMm: 0.2, mergeMm: 0, borderMode: 'none', borderMm: 2,
  borderColor: '#ffffff', smooth: 2, fillHoles: true, bleedIntoHoles: false,
  alphaThreshold: 128, erodePx: 1,
};

export interface StickerResult {
  res: BleedResult;
  loops: Loops;
  dpi: number;
  bbox: { x0: number; y0: number; x1: number; y1: number; w: number; h: number };
}

export interface Collection {
  items: Motif[];
  selectedId: number | null;
  nextId: number;
  select(id: number): void;
  remove(id: number): void;
}

export function createCollection(): Collection {
  return {
    items: [], selectedId: null, nextId: 1,
    select(id) { if (this.items.some((item) => item.id === id)) this.selectedId = id; },
    remove(id) {
      const index = this.items.findIndex((item) => item.id === id);
      if (index < 0) return;
      this.items.splice(index, 1);
      if (this.selectedId === id) this.selectedId = this.items[Math.min(index, this.items.length - 1)]?.id ?? null;
    },
  };
}

export interface DecodedImage { rgba: Uint8ClampedArray; width: number; height: number; thumbnail?: string }
export type ImageDecoder = (file: File) => Promise<DecodedImage>;

export async function decodeImage(file: File): Promise<DecodedImage> {
  let image: ImageBitmap | HTMLImageElement;
  let objectUrl: string | undefined;
  try {
    try { image = await createImageBitmap(file); }
    catch {
      objectUrl = URL.createObjectURL(file);
      image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Image decode failed'));
        element.src = objectUrl!;
      });
    }
    const width = image.width, height = image.height;
    if (!width || !height || width * height > MAX_ONE_PIXELS) return { rgba: new Uint8ClampedArray(0), width, height };
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const thumb = document.createElement('canvas');
    thumb.width = 80; thumb.height = 80;
    const thumbContext = thumb.getContext('2d');
    if (thumbContext) {
      const scale = Math.min(80 / width, 80 / height);
      thumbContext.drawImage(canvas, (80 - width * scale) / 2, (80 - height * scale) / 2, width * scale, height * scale);
    }
    return { rgba, width, height, thumbnail: thumb.toDataURL('image/png') };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (typeof image! !== 'undefined' && 'close' in image!) image!.close();
  }
}

export interface LoadError { key: TranslationKey; params: Record<string, string | number> }
export interface LoadResult { added: Motif[]; errors: LoadError[] }

export async function loadMotifFiles(files: Iterable<File>, collection: Collection, decode: ImageDecoder = decodeImage): Promise<LoadResult> {
  const added: Motif[] = [], errors: LoadError[] = [];
  for (const file of files) {
    if (file.type !== 'image/png' && file.type !== 'image/webp') {
      errors.push({ key: 'error.notImage', params: { name: file.name } });
      continue;
    }
    try {
      const decoded = await decode(file);
      const pixels = decoded.width * decoded.height;
      if (!Number.isSafeInteger(pixels) || pixels < 1) {
        errors.push({ key: 'error.fileUnreadable', params: { name: file.name } });
        continue;
      }
      if (pixels > MAX_ONE_PIXELS) {
        errors.push({ key: 'error.fileTooLarge', params: { name: file.name, megapixels: (pixels / 1e6).toFixed(1) } });
        continue;
      }
      if (collection.items.reduce((sum, item) => sum + item.width * item.height, 0) + pixels > MAX_TOTAL_PIXELS) {
        errors.push({ key: 'error.totalTooLarge', params: { megapixels: 48 } });
        continue;
      }
      if (decoded.rgba.length !== pixels * 4) {
        errors.push({ key: 'error.fileUnreadable', params: { name: file.name } });
        continue;
      }
      let dpi: number | null = null;
      if (file.type === 'image/png') {
        try { dpi = pngReadDpi(await file.arrayBuffer()); } catch { /* Ignore malformed metadata. */ }
      }
      const bbox = alphaBBox(decoded.rgba, decoded.width, decoded.height, 128);
      const base = file.name.replace(/\.[^.]+$/, '') || 'Sticker';
      let name = base, suffix = 2;
      while (collection.items.some((item) => item.name === name)) name = `${base} (${suffix++})`;
      const motif: Motif = {
        id: collection.nextId++, name, rgba: decoded.rgba, width: decoded.width, height: decoded.height,
        heightMm: null,
        suggestedHeightMm: bbox && dpi && dpi > 0 ? Math.max(0.5, bbox.h / dpi * 25.4) : null,
        copies: '', noTransparency: !decoded.rgba.some((value, index) => index % 4 === 3 && value < 250),
        thumbnail: decoded.thumbnail ?? '', cut: { ...defaultCutSettings },
      };
      collection.items.push(motif);
      added.push(motif);
      if (collection.selectedId === null) collection.selectedId = motif.id;
    } catch {
      errors.push({ key: 'error.fileUnreadable', params: { name: file.name } });
    }
  }
  if (added.length) collection.selectedId = added[0].id;
  return { added, errors };
}

const resultCache = new WeakMap<Motif, { signature: string; value: StickerResult }>();

export function computeSticker(motif: Motif, settings: CutSettings): StickerResult {
  if (motif.heightMm === null) throw new Error('Motif height missing');
  const signature = JSON.stringify([motif.heightMm, settings]);
  const cached = resultCache.get(motif);
  if (cached?.signature === signature) return cached.value;
  const bbox = alphaBBox(motif.rgba, motif.width, motif.height, settings.alphaThreshold);
  if (!bbox) throw new Error('No pixels above alpha threshold');
  const dpi = bbox.h / (Math.max(0.5, motif.heightMm) / 25.4);
  const px = (mm: number) => mm / 25.4 * dpi;
  const res = computeBleed(motif.rgba, motif.width, motif.height, {
    bleedPx: px(settings.bleedMm), insetPx: px(settings.insetMm), mergePx: px(settings.mergeMm),
    borderMode: settings.borderMode, borderPx: px(settings.borderMm), borderColor: settings.borderColor,
    smooth: settings.smooth, fillHoles: settings.fillHoles, bleedIntoHoles: settings.bleedIntoHoles,
    whiteBg: false, alphaThreshold: settings.alphaThreshold, erodePx: settings.erodePx,
  });
  const value = { res, loops: cutPath(res.cut, res.width, res.height, {}), dpi, bbox };
  resultCache.set(motif, { signature, value });
  return value;
}
