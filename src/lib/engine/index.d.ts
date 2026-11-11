export type RgbaPixels = Uint8Array | Uint8ClampedArray;
export type Point = [number, number];
export type Loops = Point[][];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BleedOptions {
  bleedPx: number;
  alphaThreshold: number;
  insetPx?: number;
  mergePx?: number;
  /** Minimum bend radius of the cut line in pixels; 0 keeps the cut line on the artwork edge. */
  roundPx?: number;
  borderPx?: number;
  borderMode?: string;
  borderColor?: string;
  erodePx?: number;
  smooth?: number;
  fillHoles?: boolean;
  bleedIntoHoles?: boolean;
  whiteBg?: boolean;
  maxPixels?: number;
}

export interface BleedResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  pad: number;
  cut: Uint8Array;
  shape: Uint8Array;
  printMask: Uint8Array;
  bleedPx: number;
  bbox: Box;
}

export function computeBleed(rgba: RgbaPixels, width: number, height: number, options: BleedOptions): BleedResult;
export function edt(source: Uint8Array, width: number, height: number, wantIdx: true): { idx: Int32Array };
export function edt(source: Uint8Array, width: number, height: number, wantIdx?: false): { d2: Float32Array };
export function edt(source: Uint8Array, width: number, height: number, wantIdx: boolean): { idx: Int32Array } | { d2: Float32Array };
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array;
export function erode(mask: Uint8Array, width: number, height: number, iterations: number): Uint8Array;
export function gaussianBlur(source: Float32Array, width: number, height: number, sigma: number): Float32Array;

export interface CutPathOptions {
  blur?: number;
  simplify?: number;
  minArea?: number;
}

export function cutPath(cutMask: Uint8Array, width: number, height: number, options?: CutPathOptions): Loops;
export function pathData(loops: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, decimals?: number): string;
export function cutSvg(loops: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, width: number, height: number, dpi: number, extra?: string): string;
export function polyArea(points: ReadonlyArray<readonly [number, number]>): number;
export function alphaBBox(rgba: RgbaPixels, width: number, height: number, threshold: number): (Box & { w: number; h: number }) | null;

export interface PaperFormat {
  name: string;
  slug: string;
  w: number;
  h: number;
  limW: number;
  limH: number;
  up?: boolean;
}

export const PAPER: Record<string, PaperFormat>;

export interface SheetPlacement {
  cxMm: number;
  cyMm: number;
  angle: number;
  item?: number;
}

export interface SheetLayout {
  orientation: 'portrait' | 'landscape';
  pageWMm: number;
  pageHMm: number;
  limWMm: number;
  limHMm: number;
  paperName: string;
  paperSlug: string;
  cols: number;
  rows: number;
  capacity: number;
  count: number;
  capped: boolean;
  fits: boolean;
  placements: SheetPlacement[];
  nested: boolean;
}

export interface SheetLayoutOptions {
  paper: string;
  orientation: 'auto' | 'portrait' | 'landscape';
  marginMm: number;
  gapMm: number;
  cellWMm: number;
  cellHMm: number;
  copies: number;
  fitMat?: boolean;
}

export function layoutSheet(options: SheetLayoutOptions): SheetLayout;

export interface Tile {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface SheetGeometryItem {
  tile: Tile;
  dpi: number;
  loops: Loops;
}

export interface SheetGeometry {
  k: number;
  pageW: number;
  pageH: number;
  tiles: Array<{ cx: number; cy: number; angle: number; item: number; k: number; tw: number; th: number }>;
  paths: string[];
  tileW: number;
  tileH: number;
}

export function sheetGeometry(layout: Pick<SheetLayout, 'pageWMm' | 'pageHMm' | 'placements'>, tile: Tile, stickerDpi: number, sheetDpi: number, loops: Loops): SheetGeometry;
export function sheetGeometryMulti(layout: Pick<SheetLayout, 'pageWMm' | 'pageHMm' | 'placements'>, items: SheetGeometryItem[], sheetDpi: number): SheetGeometry;
export function sheetSvg(geometry: SheetGeometry, sheetDpi: number, imageHref?: string | null, options?: { outline?: boolean }): string;

export interface Footprint {
  mask: Uint8Array;
  w: number;
  h: number;
  spMm: number;
}

export interface NestItem {
  foot: Footprint;
  tileWMm: number;
  tileHMm: number;
  want: number;
}

export interface NestBaseOptions {
  pageWMm: number;
  pageHMm: number;
  marginMm: number;
  gapMm: number;
  angles: number[];
  cellMm?: number;
  crit?: 'top' | 'bottom';
  maxTotal?: number;
}

export type NestOptions = NestBaseOptions & (
  | { items: NestItem[]; foot?: never; tileWMm?: never; tileHMm?: never; want?: never }
  | { items?: never; foot: Footprint; tileWMm: number; tileHMm: number; want: number }
);

export interface NestResult {
  placements: Array<SheetPlacement & { item: number }>;
  count: number;
  perItem: number[];
}

export function anglesFor(mode: string): number[];
export function nestGen(options: NestOptions): Generator<{ placed: number }, NestResult, void>;
export function nestRun(options: NestOptions): NestResult;

export function pngSetDpi(buffer: ArrayBufferLike | Uint8Array, dpi: number): Uint8Array;
export function pngReadDpi(buffer: ArrayBufferLike | Uint8Array): number | null;
export function pdfFromRgba(rgba: RgbaPixels, width: number, height: number, pageWidthPoints: number, pageHeightPoints: number): Promise<Uint8Array>;
