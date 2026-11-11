import { PAPER, anglesFor, fillHoles, layoutSheet, nestGen, type Footprint, type PaperFormat, type SheetLayout, type SheetPlacement, type Tile } from './engine/index.js';
import type { TranslationKey } from './locales/de.ts';
import type { Motif, StickerResult } from './stickers.ts';

export type PaperKey = 'letter' | 'a4' | 's9x12' | 's12x12' | 'joyxtra' | 'joy2' | 'joy2long';
export const paperKeys: PaperKey[] = ['letter', 'a4', 's9x12', 's12x12', 'joyxtra', 'joy2', 'joy2long'];
export type RotationMode = 'none' | '180' | '90' | '45' | '15';

export interface SheetSettings {
  paper: PaperKey;
  upOn: 'none' | 'letter' | 'a4';
  arrangement: 'nest' | 'grid';
  rotation: RotationMode;
  orientation: 'auto' | 'portrait' | 'landscape';
  marginMm: number;
  gapMm: number;
  dpiCap: 300 | 600;
  fitMat: boolean;
  pageOutline: boolean;
  /** Print a 1 × 1 cm square to check print scaling. */
  calibration: boolean;
}

export const defaultSheetSettings: SheetSettings = {
  paper: 'letter', upOn: 'none', arrangement: 'nest', rotation: '90', orientation: 'auto',
  marginMm: 6, gapMm: 1, dpiCap: 300, fitMat: true, pageOutline: true, calibration: true,
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

/** True when the paper is bigger than the Cricut mat's cutting area on at least one side. */
export function matLimited(key: string): boolean {
  const paper = PAPER[key];
  return !!paper && (paper.limW < paper.w - 0.05 || paper.limH < paper.h - 0.05);
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

interface Resolved { key: string; paper: PaperFormat; fitMat: boolean; upOn: 'none' | 'letter' | 'a4'; orientation: SheetSettings['orientation'] }

function resolvePaper(settings: SheetSettings): Resolved {
  const paper = PAPER[settings.paper];
  const upOn = paper.up ? settings.upOn : 'none';
  const orientation = upOn === 'none' ? settings.orientation : 'portrait';
  // The long mat is taller than Letter or A4, so for two side by side it is cut short to what the page holds.
  if (settings.paper === 'joy2long' && upOn !== 'none') {
    const big = PAPER[upOn], m = Math.max(0, settings.marginMm);
    const w = Math.max(1, Math.min(paper.limW, (big.w - 2 * m) / 2)), h = Math.max(1, Math.min(paper.limH, big.h - 2 * m));
    // layoutSheet reads formats by key, so the shortened mat is registered like in the original tool.
    PAPER._joy2longup = { name: paper.name, slug: paper.slug, w, h, limW: w, limH: h };
    return { key: '_joy2longup', paper: PAPER._joy2longup, fitMat: false, upOn, orientation };
  }
  return { key: settings.paper, paper, fitMat: matLimited(settings.paper) && settings.fitMat, upOn, orientation };
}

interface NestBest { placements: SheetPlacement[]; count: number; perItem: number[]; ori: 'portrait' | 'landscape'; pw: number; ph: number; lw: number; lh: number }

async function runNest(entries: SheetEntry[], tiles: SheetTile[], settings: SheetSettings, resolved: Resolved, cancelled: () => boolean): Promise<NestBest | null | 'cancelled'> {
  const { paper } = resolved;
  const items = entries.map((e, i) => ({ foot: footprint(e.result, 0.5), tileWMm: tiles[i].wMm, tileHMm: tiles[i].hMm, want: e.want }));
  const orients = resolved.orientation === 'auto' ? ['portrait', 'landscape'] as const : [resolved.orientation];
  let best: NestBest | null = null, lastYield = Date.now();
  for (const ori of orients) {
    for (const crit of ['top', 'bottom'] as const) {
      const port = ori === 'portrait';
      const pw = port ? paper.w : paper.h, ph = port ? paper.h : paper.w;
      const lw = resolved.fitMat ? Math.min(pw, port ? paper.limW : paper.limH) : pw;
      const lh = resolved.fitMat ? Math.min(ph, port ? paper.limH : paper.limW) : ph;
      const gen = nestGen({ pageWMm: lw, pageHMm: lh, marginMm: settings.marginMm, gapMm: settings.gapMm, items, angles: anglesFor(settings.rotation), cellMm: 0.5, crit });
      let step = gen.next();
      while (!step.done) {
        if (Date.now() - lastYield > 12) { await tick(); lastYield = Date.now(); }
        if (cancelled()) return 'cancelled';
        step = gen.next();
      }
      if (!best || step.value.count > best.count) best = { ...step.value, ori, pw, ph, lw, lh };
    }
  }
  return best;
}

/** Arrange every sticker on the page. Returns null when cancelled. */
export async function planSheet(entries: SheetEntry[], settings: SheetSettings, options: { cancelled?: () => boolean } = {}): Promise<PlanOutcome | null> {
  const cancelled = options.cancelled ?? (() => false);
  if (cancelled()) return null;
  const tiles = tilesFor(entries), resolved = resolvePaper(settings), { paper } = resolved;
  const multi = entries.length > 1;
  const summary: Notice[] = [], warnings: Notice[] = [];
  const cell = { w: tiles[0].wMm, h: tiles[0].hMm };
  let layout: PlanLayout, nestedNoGain = false;

  if (!multi) {
    const copies = entries[0].want;
    const grid = layoutSheet({ paper: resolved.key, orientation: resolved.orientation, marginMm: settings.marginMm, gapMm: settings.gapMm, cellWMm: cell.w, cellHMm: cell.h, copies, fitMat: resolved.fitMat });
    layout = grid;
    if (settings.arrangement === 'nest') {
      const best = await runNest(entries, tiles, settings, resolved, cancelled);
      if (best === 'cancelled') return null;
      const gridCount = grid.fits ? grid.count : 0;
      if (best && best.count > gridCount) {
        layout = {
          orientation: best.ori, pageWMm: best.pw, pageHMm: best.ph, limWMm: best.lw, limHMm: best.lh, paperName: paper.name, paperSlug: paper.slug,
          count: best.count, capacity: best.count, capped: copies > 0 && copies > best.count,
          fits: true, placements: best.placements, nested: true, gridCount,
        };
      } else nestedNoGain = true;
    }
  } else {
    const best = await runNest(entries, tiles, settings, resolved, cancelled);
    if (best === 'cancelled') return null;
    layout = {
      orientation: best ? best.ori : 'portrait', pageWMm: best ? best.pw : paper.w, pageHMm: best ? best.ph : paper.h,
      limWMm: best ? best.lw : paper.w, limHMm: best ? best.lh : paper.h, paperName: paper.name, paperSlug: paper.slug,
      count: best ? best.count : 0, capacity: best ? best.count : 0, capped: false,
      fits: !!(best && best.count > 0), placements: best ? best.placements : [], nested: true,
      perItem: best ? best.perItem : entries.map(() => 0),
    };
  }
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

  let matLayout: PlanLayout | null = null, paperKey = settings.paper as PaperKey;
  if (resolved.upOn !== 'none') {
    const tiled = tileMats(layout, PAPER[resolved.upOn], settings.marginMm);
    if (tiled) {
      summary.push({ key: 'sheet.upNote', params: { mats: tiled.mats, perMat: layout.count, paperKey: paperNameKey(resolved.upOn) } });
      matLayout = layout; layout = tiled; paperKey = resolved.upOn;
    } else warnings.push({ key: 'sheet.upNoFit', params: { paperKey: paperNameKey(resolved.upOn) } });
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
