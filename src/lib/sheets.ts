import { PAPER, anglesFor, fillHoles, layoutSheet, nestGen, type Footprint, type PaperFormat, type SheetLayout, type SheetPlacement, type Tile } from './engine/index.js';
import type { TranslationKey } from './locales/de.ts';
import type { Motif, StickerResult } from './stickers.ts';

export type PaperKey = 'letter' | 'a4' | 's9x12' | 's12x12';
export const paperKeys: PaperKey[] = ['a4', 'letter', 's9x12', 's12x12'];

/**
 * Cricut machine mats: physical size and maximum cutting area in millimetres (portrait, feed direction = height).
 * Sources: Cricut help center (12 × 12, Venture 24 × 28, Joy Xtra) and Cricut-adjacent guides (12 × 24, Joy).
 */
export interface MatSpec { w: number; h: number; cutW: number; cutH: number; slug: string }
const inch = (value: number) => value * 25.4;
export const MATS = {
  m12x12: { w: inch(12), h: inch(12), cutW: inch(11.5), cutH: inch(11.5), slug: 'mat-12x12' },
  m12x24: { w: inch(12), h: inch(24), cutW: inch(11.5), cutH: inch(23.5), slug: 'mat-12x24' },
  v24x28: { w: inch(24), h: inch(28), cutW: inch(23.5), cutH: inch(27.5), slug: 'venture-24x28' },
  jx8x12: { w: inch(8.5), h: inch(12), cutW: inch(8.25), cutH: inch(11.75), slug: 'joy-xtra-8.5x12' },
  j45x65: { w: inch(4.5), h: inch(6.5), cutW: inch(4.25), cutH: inch(6.25), slug: 'joy-4.5x6.5' },
  j45x12: { w: inch(4.5), h: inch(12), cutW: inch(4.25), cutH: inch(11.75), slug: 'joy-4.5x12' },
} satisfies Record<string, MatSpec>;
export type MatKey = keyof typeof MATS;
export type MachineKey = 'maker' | 'venture' | 'joyxtra' | 'joy' | 'none';
export const MACHINES: Record<MachineKey, MatKey[]> = {
  maker: ['m12x12', 'm12x24'], venture: ['v24x28'], joyxtra: ['jx8x12'], joy: ['j45x65', 'j45x12'], none: [],
};
export const machineKeys = Object.keys(MACHINES) as MachineKey[];
export type RotationMode = 'none' | '180' | '90' | '45' | '15';

export interface SheetSettings {
  paper: PaperKey;
  /** The cutting machine and mat; stickers are only placed inside the mat's cutting area. */
  machine: MachineKey;
  mat: MatKey | null;
  arrangement: 'nest' | 'grid';
  rotation: RotationMode;
  orientation: 'auto' | 'portrait' | 'landscape';
  marginMm: number;
  gapMm: number;
  dpiCap: 300 | 600;
  pageOutline: boolean;
  /**
   * Measured offset of the cut against the print (right and down positive), e.g. from a printer that places its
   * image slightly off the paper edge. The cut-only SVG moves its cut lines back by this amount.
   */
  offsetXMm: number;
  offsetYMm: number;
  /** Print a 1 × 1 cm square to check print scaling. */
  calibration: boolean;
}

export const defaultSheetSettings: SheetSettings = {
  paper: 'letter', machine: 'maker', mat: 'm12x12', arrangement: 'nest', rotation: '90', orientation: 'auto',
  marginMm: 6, gapMm: 1, dpiCap: 300, pageOutline: true, calibration: true, offsetXMm: 0, offsetYMm: 0,
};

export interface SheetEntry { motif: Motif; result: StickerResult; want: number }
export interface SheetTile { tile: Tile; wMm: number; hMm: number }
export interface Region { x: number; y: number; w: number; h: number }
/** Top-left corner and edge length in millimetres. */
export interface CalibrationSquare { x: number; y: number; size: number }
export const CALIBRATION_MM = 10;

export interface PlanLayout extends Omit<SheetLayout, 'cols' | 'rows'> {
  cols?: number;
  rows?: number;
  placements: SheetPlacement[];
  perItem?: number[];
  gridCount?: number;
  regions?: Region[];
  calibration?: CalibrationSquare[];
}

/** A message for the UI: params ending in `Key` are translation keys, numbers are formatted by locale. */
export interface Notice { key: TranslationKey; params: Record<string, string | number> }

export interface SheetPlan {
  layout: PlanLayout;
  /** One mat sheet when several mats are tiled on a bigger page; SVG cut files describe this one. */
  matLayout: PlanLayout | null;
  entries: SheetEntry[];
  tiles: SheetTile[];
  paperKey: PaperKey;
  summary: Notice[];
  warnings: Notice[];
}

export type PlanOutcome = { ok: true; plan: SheetPlan } | { ok: false; error: Notice };

export function formatNotice(notice: Notice, translate: (key: TranslationKey, params?: Record<string, string | number>) => string, format: (value: number) => string): string {
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(notice.params)) {
    if (name.endsWith('Key')) params[name.slice(0, -3)] = translate(value as TranslationKey);
    else if (typeof value === 'number') params[name] = Number.isInteger(value) ? String(value) : format(value);
    else params[name] = value;
  }
  return translate(notice.key, params);
}

export interface MatInfo { mat: MatSpec | null; fitsOnMat: boolean; limitedByMat: boolean }

/** How the chosen paper relates to the chosen mat, for hints in the interface. */
export function matInfo(settings: Pick<SheetSettings, 'paper' | 'machine' | 'mat'>): MatInfo {
  const paper = PAPER[settings.paper], mat = settings.machine === 'none' || !settings.mat ? null : MATS[settings.mat];
  if (!mat) return { mat: null, fitsOnMat: true, limitedByMat: false };
  const fitsOnMat = (paper.w <= mat.w + 0.01 && paper.h <= mat.h + 0.01) || (paper.h <= mat.w + 0.01 && paper.w <= mat.h + 0.01);
  return { mat, fitsOnMat, limitedByMat: fitsOnMat && (paper.w > mat.cutW + 0.01 || paper.h > mat.cutH + 0.01) };
}

export interface AlignmentPage { pageWMm: number; pageHMm: number; limWMm: number; limHMm: number; marks: Array<{ x: number; y: number }> }

/** Upright page with five measuring marks inside the cutting area; null when the paper does not fit the mat. */
export function alignmentPage(settings: Pick<SheetSettings, 'paper' | 'machine' | 'mat'>): AlignmentPage | null {
  const paper = PAPER[settings.paper], info = matInfo(settings);
  if (!info.fitsOnMat || (info.mat && (paper.w > info.mat.w + 0.01 || paper.h > info.mat.h + 0.01))) return null;
  const limWMm = Math.min(paper.w, info.mat?.cutW ?? paper.w), limHMm = Math.min(paper.h, info.mat?.cutH ?? paper.h);
  // Whole millimetres, so the printed scales sit on clean pixel rows.
  const inset = 15, xs = [inset, Math.floor(limWMm - inset)], ys = [inset, Math.floor(limHMm - inset)];
  const marks = [...ys.flatMap((y) => xs.map((x) => ({ x, y }))), { x: Math.round(limWMm / 2), y: Math.round(limHMm / 2) }];
  return { pageWMm: paper.w, pageHMm: paper.h, limWMm, limHMm, marks };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const paperNameKey = (key: string) => `sheet.paper.${key}` as TranslationKey;

/** Put copies of one mat sheet on a bigger page, turned 90 degrees when that fits more. */
export function tileMats(layout: PlanLayout, big: PaperFormat, marginMm: number): (PlanLayout & { mats: number }) | null {
  const rw = layout.pageWMm, rh = layout.pageHMm, m = marginMm;
  const pages = [{ ori: 'portrait' as const, w: big.w, h: big.h }, { ori: 'landscape' as const, w: big.h, h: big.w }];
  let best: { pg: typeof pages[number]; rot: boolean; cw: number; ch: number; cols: number; rows: number; n: number } | null = null;
  for (const pg of pages) {
    for (const rot of [false, true]) {
      const cw = rot ? rh : rw, ch = rot ? rw : rh;
      const cols = Math.floor((pg.w - 2 * m + 1e-6) / cw), rows = Math.floor((pg.h - 2 * m + 1e-6) / ch);
      const n = cols * rows;
      // Both counts must be positive: a margin wider than the page yields -1 × -1.
      if (cols > 0 && rows > 0 && (!best || n > best.n)) best = { pg, rot, cw, ch, cols, rows, n };
    }
  }
  if (!best) return null;
  const x0 = m + (best.pg.w - 2 * m - best.cols * best.cw) / 2;
  const placements: SheetPlacement[] = [], regions: Region[] = [], calibration: CalibrationSquare[] = [];
  for (let r = 0; r < best.rows; r++) {
    for (let c = 0; c < best.cols; c++) {
      const ox = x0 + c * best.cw, oy = m + r * best.ch;
      regions.push({ x: ox, y: oy, w: best.cw, h: best.ch });
      for (const p of layout.placements) {
        if (best.rot) placements.push({ ...p, cxMm: rh - p.cyMm + ox, cyMm: p.cxMm + oy, angle: (p.angle || 0) + 90 });
        else placements.push({ ...p, cxMm: p.cxMm + ox, cyMm: p.cyMm + oy });
      }
      for (const sq of layout.calibration ?? []) {
        const cx = sq.x + sq.size / 2, cy = sq.y + sq.size / 2;
        const [nx, ny] = best.rot ? [rh - cy + ox, cx + oy] : [cx + ox, cy + oy];
        calibration.push({ x: nx - sq.size / 2, y: ny - sq.size / 2, size: sq.size });
      }
    }
  }
  return {
    ...layout, orientation: best.pg.ori, pageWMm: best.pg.w, pageHMm: best.pg.h, limWMm: best.pg.w, limHMm: best.pg.h,
    placements, regions, calibration: layout.calibration ? calibration : undefined, count: layout.count * best.n, perItem: layout.perItem?.map((v) => v * best.n), nested: true,
    gridCount: (layout.gridCount || layout.count) * best.n, paperName: big.name, paperSlug: `${big.slug}-${best.n}x-${layout.paperSlug}`,
    mats: best.n,
  };
}

const footprints = new WeakMap<StickerResult, { cell: number; foot: Footprint }>();

/** Printed outline (artwork + bleed, holes filled) at a coarse resolution, for nesting. */
export function footprint(result: StickerResult, cellMm: number): Footprint {
  const cached = footprints.get(result);
  if (cached?.cell === cellMm) return cached.foot;
  const { res, dpi } = result, b = res.bbox, tw = b.x1 - b.x0, th = b.y1 - b.y0;
  const f = Math.max(1, Math.round(((cellMm / 2) / 25.4) * dpi));
  const cw = Math.ceil(tw / f), ch = Math.ceil(th / f);
  const mask = new Uint8Array(cw * ch);
  for (let y = 0; y < th; y++) {
    const row = (b.y0 + y) * res.width + b.x0, crow = ((y / f) | 0) * cw;
    for (let x = 0; x < tw; x++) if (res.printMask[row + x]) mask[crow + ((x / f) | 0)] = 1;
  }
  const foot = { mask: fillHoles(mask, cw, ch), w: cw, h: ch, spMm: (f / dpi) * 25.4 };
  footprints.set(result, { cell: cellMm, foot });
  return foot;
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Axis-aligned bounds of every placed sticker in millimetres. */
function stickerRects(layout: PlanLayout, tiles: SheetTile[]): Rect[] {
  return layout.placements.map((p) => {
    const t = tiles[p.item || 0], a = (p.angle || 0) * Math.PI / 180;
    const bw = Math.abs(t.wMm * Math.cos(a)) + Math.abs(t.hMm * Math.sin(a));
    const bh = Math.abs(t.wMm * Math.sin(a)) + Math.abs(t.hMm * Math.cos(a));
    return { x0: p.cxMm - bw / 2, y0: p.cyMm - bh / 2, x1: p.cxMm + bw / 2, y1: p.cyMm + bh / 2 };
  });
}

/** A free spot for the square, preferring the bottom-right corner; null when every candidate is covered. */
function freeSpot(rects: Rect[], area: Rect, size: number, gap: number): { x: number; y: number } | null {
  const maxX = area.x1 - size, maxY = area.y1 - size;
  if (maxX < area.x0 - 1e-9 || maxY < area.y0 - 1e-9) return null;
  // A free position, if any, can be slid against a page edge or a sticker edge on each axis.
  const xs = [area.x0, maxX, ...rects.flatMap((r) => [r.x1 + gap, r.x0 - gap - size])].filter((x) => x >= area.x0 - 1e-9 && x <= maxX + 1e-9);
  const ys = [area.y0, maxY, ...rects.flatMap((r) => [r.y1 + gap, r.y0 - gap - size])].filter((y) => y >= area.y0 - 1e-9 && y <= maxY + 1e-9);
  const candidates = xs.flatMap((x) => ys.map((y) => ({ x, y }))).sort((a, b) => (b.x + b.y) - (a.x + a.y));
  return candidates.find(({ x, y }) => rects.every((r) => x >= r.x1 + gap - 1e-9 || x + size <= r.x0 - gap + 1e-9 || y >= r.y1 + gap - 1e-9 || y + size <= r.y0 - gap + 1e-9)) ?? null;
}

/** Place the 1 cm square; when the sheet is full, drop the stickers nearest the bottom-right corner until it fits. */
export function placeCalibration(layout: PlanLayout, tiles: SheetTile[], marginMm: number, gapMm: number): { layout: PlanLayout; square: CalibrationSquare | null; removed: number } {
  const size = CALIBRATION_MM;
  const area = { x0: marginMm, y0: marginMm, x1: Math.min(layout.pageWMm, layout.limWMm || layout.pageWMm) - marginMm, y1: Math.min(layout.pageHMm, layout.limHMm || layout.pageHMm) - marginMm };
  const placements = [...layout.placements].sort((a, b) => (a.cxMm + a.cyMm) - (b.cxMm + b.cyMm));
  const perItem = layout.perItem ? [...layout.perItem] : undefined;
  let removed = 0;
  for (;;) {
    const current = { ...layout, placements };
    const spot = freeSpot(stickerRects(current, tiles), area, size, gapMm);
    if (spot) {
      const square = { ...spot, size };
      return { layout: { ...layout, placements, count: placements.length, perItem, calibration: [square] }, square, removed };
    }
    const dropped = placements.pop();
    if (!dropped) return { layout, square: null, removed: 0 };
    removed++;
    if (perItem) perItem[dropped.item || 0]--;
  }
}

export function tilesFor(entries: SheetEntry[]): SheetTile[] {
  return entries.map(({ result }) => {
    const b = result.res.bbox, tile = { x0: b.x0, y0: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    return { tile, wMm: (tile.w / result.dpi) * 25.4, hMm: (tile.h / result.dpi) * 25.4 };
  });
}

/** A page to lay out on, already turned to its orientation; limW/limH hold the mat's cutting area. */
interface Frame { key: string; paper: PaperFormat; orientation: 'portrait' | 'landscape' }
interface Resolved { frames: Frame[]; tileOn: PaperFormat | null }

function register(key: string, base: { name: string; slug: string }, w: number, h: number, limW: number, limH: number): PaperFormat {
  // layoutSheet reads formats by key, so the effective page is registered in the shared table.
  PAPER[key] = { name: base.name, slug: base.slug, w, h, limW: Math.min(w, limW), limH: Math.min(h, limH) };
  return PAPER[key];
}

function resolveFrames(settings: SheetSettings): Resolved {
  const paper = PAPER[settings.paper];
  const mat = settings.machine === 'none' || !settings.mat ? null : MATS[settings.mat];
  const frames: Frame[] = [];
  for (const orientation of ['portrait', 'landscape'] as const) {
    if (settings.orientation !== 'auto' && settings.orientation !== orientation) continue;
    const [w, h] = orientation === 'portrait' ? [paper.w, paper.h] : [paper.h, paper.w];
    // The paper lies on the mat with its top-left corner at the mat origin; it must fit the mat itself.
    if (mat && (w > mat.w + 0.01 || h > mat.h + 0.01)) continue;
    const key = `_sheet_${orientation}`;
    frames.push({ key, orientation, paper: register(key, paper, w, h, mat ? mat.cutW : w, mat ? mat.cutH : h) });
  }
  if (frames.length) return { frames, tileOn: null };
  if (settings.orientation !== 'auto') {
    const any = resolveFrames({ ...settings, orientation: 'auto' });
    if (!any.tileOn) return any;
  }
  // The paper is larger than the mat: print mat-sized areas that are cut apart and placed on the mat one by one.
  const m = Math.max(0, settings.marginMm), spec = mat as MatSpec;
  const shortest = Math.min(paper.w, paper.h) - 2 * m, longest = Math.max(paper.w, paper.h) - 2 * m;
  const w = Math.max(1, Math.min(spec.w, shortest)), h = Math.max(1, Math.min(spec.h, longest));
  const region = register('_mat', { name: paper.name, slug: spec.slug }, w, h, spec.cutW, spec.cutH);
  return { frames: [{ key: '_mat', paper: region, orientation: 'portrait' }], tileOn: paper };
}

interface NestBest { placements: SheetPlacement[]; count: number; perItem: number[] }

async function runNest(entries: SheetEntry[], tiles: SheetTile[], settings: SheetSettings, frame: Frame, cancelled: () => boolean): Promise<NestBest | null | 'cancelled'> {
  const { paper } = frame;
  const items = entries.map((e, i) => ({ foot: footprint(e.result, 0.5), tileWMm: tiles[i].wMm, tileHMm: tiles[i].hMm, want: e.want }));
  let best: NestBest | null = null, lastYield = Date.now();
  for (const crit of ['top', 'bottom'] as const) {
    const gen = nestGen({ pageWMm: paper.limW, pageHMm: paper.limH, marginMm: settings.marginMm, gapMm: settings.gapMm, items, angles: anglesFor(settings.rotation), cellMm: 0.5, crit });
    let step = gen.next();
    while (!step.done) {
      if (Date.now() - lastYield > 12) { await tick(); lastYield = Date.now(); }
      if (cancelled()) return 'cancelled';
      step = gen.next();
    }
    if (!best || step.value.count > best.count) best = step.value;
  }
  return best;
}

async function planFrame(entries: SheetEntry[], tiles: SheetTile[], settings: SheetSettings, frame: Frame, cancelled: () => boolean): Promise<{ layout: PlanLayout; nestedNoGain: boolean } | 'cancelled'> {
  const { paper } = frame, cell = { w: tiles[0].wMm, h: tiles[0].hMm };
  const base = { orientation: frame.orientation, pageWMm: paper.w, pageHMm: paper.h, limWMm: paper.limW, limHMm: paper.limH, paperName: paper.name, paperSlug: paper.slug };
  if (entries.length === 1) {
    const copies = entries[0].want;
    const grid: PlanLayout = { ...layoutSheet({ paper: frame.key, orientation: 'portrait', marginMm: settings.marginMm, gapMm: settings.gapMm, cellWMm: cell.w, cellHMm: cell.h, copies, fitMat: true }), orientation: frame.orientation };
    if (settings.arrangement !== 'nest') return { layout: grid, nestedNoGain: false };
    const best = await runNest(entries, tiles, settings, frame, cancelled);
    if (best === 'cancelled') return 'cancelled';
    const gridCount = grid.fits ? grid.count : 0;
    if (!best || best.count <= gridCount) return { layout: grid, nestedNoGain: true };
    return { layout: { ...base, count: best.count, capacity: best.count, capped: copies > 0 && copies > best.count, fits: true, placements: best.placements, nested: true, gridCount }, nestedNoGain: false };
  }
  const best = await runNest(entries, tiles, settings, frame, cancelled);
  if (best === 'cancelled') return 'cancelled';
  return { layout: {
    ...base, count: best ? best.count : 0, capacity: best ? best.count : 0, capped: false, fits: !!(best && best.count > 0),
    placements: best ? best.placements : [], nested: true, perItem: best ? best.perItem : entries.map(() => 0),
  }, nestedNoGain: false };
}

/** Arrange every sticker on the page. Returns null when cancelled. */
export async function planSheet(entries: SheetEntry[], settings: SheetSettings, options: { cancelled?: () => boolean } = {}): Promise<PlanOutcome | null> {
  const cancelled = options.cancelled ?? (() => false);
  if (cancelled()) return null;
  const tiles = tilesFor(entries), resolved = resolveFrames(settings);
  const multi = entries.length > 1;
  const summary: Notice[] = [], warnings: Notice[] = [];
  const cell = { w: tiles[0].wMm, h: tiles[0].hMm };
  let chosen: { layout: PlanLayout; nestedNoGain: boolean } | null = null;
  for (const frame of resolved.frames) {
    const planned = await planFrame(entries, tiles, settings, frame, cancelled);
    if (planned === 'cancelled') return null;
    const score = (l: PlanLayout) => (l.fits ? l.count : -1);
    if (!chosen || score(planned.layout) > score(chosen.layout)) chosen = planned;
  }
  let layout = (chosen as { layout: PlanLayout }).layout;
  const nestedNoGain = (chosen as { nestedNoGain: boolean }).nestedNoGain;
  if (cancelled()) return null;
  if (!layout.fits) {
    return { ok: false, error: multi ? { key: 'error.noFit', params: {} } : { key: 'error.noFitSingle', params: { w: cell.w, h: cell.h } } };
  }

  if (settings.calibration) {
    const placed = placeCalibration(layout, tiles, settings.marginMm, settings.gapMm);
    layout = placed.layout;
    if (!placed.square) warnings.push({ key: 'sheet.calibrationNoRoom', params: {} });
    else if (placed.removed) summary.push({ key: 'sheet.calibrationMoved', params: { removed: placed.removed } });
  }

  let matLayout: PlanLayout | null = null;
  const paperKey = settings.paper;
  if (resolved.tileOn) {
    const tiled = tileMats(layout, resolved.tileOn, settings.marginMm);
    if (!tiled) return { ok: false, error: { key: 'sheet.upNoFit', params: { paperKey: paperNameKey(paperKey) } } };
    summary.push({ key: 'sheet.upNote', params: { mats: tiled.mats, perMat: layout.count, paperKey: paperNameKey(paperKey) } });
    matLayout = layout; layout = tiled;
  }

  const orientationKey = `sheet.orientation.${layout.orientation}` as TranslationKey;
  const pagePaperKey = paperNameKey(paperKey);
  if (multi) {
    const perItem = layout.perItem ?? [];
    summary.push({ key: 'sheet.summaryMulti', params: { count: layout.count, paperKey: pagePaperKey, orientationKey, parts: entries.map((e, i) => `${perItem[i]} × ${e.motif.name}`).join(', ') } });
    entries.forEach((e, i) => {
      if (e.want > 0 && perItem[i] < e.want) warnings.push({ key: 'error.partialFit', params: { name: e.motif.name, actual: perItem[i], requested: e.want } });
      else if (e.want === 0 && perItem[i] === 0) warnings.push({ key: 'sheet.noRoom', params: { name: e.motif.name } });
    });
  } else {
    if (layout.nested) {
      summary.push({ key: 'sheet.summaryNested', params: { count: layout.count, paperKey: pagePaperKey, orientationKey, grid: layout.gridCount ?? 0 } });
      const rotated = layout.placements.filter((p) => p.angle % 360 !== 0).length;
      if (rotated && !matLayout) summary.push({ key: 'sheet.rotated', params: { count: rotated } });
    } else {
      summary.push({ key: 'sheet.summaryGrid', params: { count: layout.count, cols: layout.cols ?? 0, rows: layout.rows ?? 0, paperKey: pagePaperKey, orientationKey } });
      if (nestedNoGain) summary.push({ key: 'sheet.nestNoGain', params: {} });
    }
    summary.push({ key: 'sheet.cellSize', params: { w: cell.w, h: cell.h } });
    if (layout.capped) warnings.push({ key: 'sheet.capped', params: { capacity: layout.capacity } });
  }
  return { ok: true, plan: { layout, matLayout, entries, tiles, paperKey, summary, warnings } };
}
