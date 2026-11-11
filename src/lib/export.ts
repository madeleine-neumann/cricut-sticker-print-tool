import { PAPER, cutSvg, pdfFromRgba, pngSetDpi, sheetGeometryMulti, sheetSvg, type SheetGeometry } from './engine/index.js';
import { matLimited, type Notice, type PlanLayout, type SheetEntry, type SheetPlan, type SheetSettings } from './sheets.ts';
import type { Motif, StickerResult } from './stickers.ts';

export type SheetExportKind = 'print' | 'pdf' | 'png' | 'svg' | 'both';
export type StickerExportKind = 'png' | 'svg' | 'both';

/* ---------- pure file builders ---------- */

export const sheetDpiFor = (plan: SheetPlan, settings: SheetSettings) =>
  Math.min(Math.max(...plan.entries.map((e) => e.result.dpi)), settings.dpiCap);

export function geometryFor(plan: SheetPlan, layout: PlanLayout, dpi: number): SheetGeometry {
  return sheetGeometryMulti(layout, plan.entries.map((e, i) => ({ tile: plan.tiles[i].tile, dpi: e.result.dpi, loops: e.result.loops })), dpi);
}

export function sheetFileName(plan: SheetPlan, suffix: string, layout: PlanLayout = plan.layout): string {
  const base = plan.entries.length === 1 ? plan.entries[0].motif.name : 'stickers';
  return `${base}_sheet-${layout.paperSlug || 'sheet'}${suffix}`;
}

export interface CutLayout { layout: PlanLayout; dpi: number; geo: SheetGeometry; matArea: { w: number; h: number } | null; overflow: boolean }

/**
 * The SVG describes one mat sheet (one Cricut job) on exactly the same page and coordinates as the print file.
 * When the paper is larger than the mat's cutting area, `matArea` holds that area in sheet pixels.
 */
export function cutLayout(plan: SheetPlan, settings: SheetSettings): CutLayout {
  const layout = plan.matLayout ?? plan.layout, dpi = sheetDpiFor(plan, settings), geo = geometryFor(plan, layout, dpi);
  const paper = PAPER[settings.paper];
  if (!matLimited(settings.paper) || plan.matLayout) return { layout, dpi, geo, matArea: null, overflow: false };
  const portrait = layout.pageWMm <= layout.pageHMm;
  const limW = portrait ? paper.limW : paper.limH, limH = portrait ? paper.limH : paper.limW;
  const matArea = { w: Math.min(geo.pageW, (limW / 25.4) * dpi), h: Math.min(geo.pageH, (limH / 25.4) * dpi) };
  let maxX = 0, maxY = 0;
  for (const d of geo.paths) for (const m of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) { maxX = Math.max(maxX, +m[1]); maxY = Math.max(maxY, +m[2]); }
  for (const sq of layout.calibration ?? []) { maxX = Math.max(maxX, (sq.x + sq.size) / 25.4 * dpi); maxY = Math.max(maxY, (sq.y + sq.size) / 25.4 * dpi); }
  return { layout, dpi, geo, matArea, overflow: maxX > matArea.w + 0.5 || maxY > matArea.h + 0.5 };
}

/**
 * A pen frame that starts at the paper's top-left corner. Cricut Design Space aligns an import to its outermost
 * shape, so the frame pins the cut paths to the paper. Edges beyond the cutting area are left out: the paper
 * sticks out there instead of the frame being drawn smaller than the paper.
 */
export function openFrame(pageW: number, pageH: number, area: { w: number; h: number }): string {
  const w = +Math.min(pageW, area.w).toFixed(2), h = +Math.min(pageH, area.h).toFixed(2);
  const fullW = w >= pageW - 0.5, fullH = h >= pageH - 0.5;
  let d = `M0,${h}V0H${w}`;
  if (fullW) d += `V${h}`;
  if (fullW && fullH) d += 'Z';
  return `  <g id="page-outline" fill="none" stroke="#000000" stroke-width="1">\n    <path d="${d}"/>\n  </g>\n`;
}

export function sheetCutFile(plan: SheetPlan, settings: SheetSettings, imageHref: string | null) {
  const cut = cutLayout(plan, settings);
  let svg = sheetSvg(cut.geo, cut.dpi, imageHref, { outline: settings.pageOutline && !cut.matArea });
  if (settings.pageOutline && cut.matArea) svg = svg.replace('  <g id="cut"', `${openFrame(cut.geo.pageW, cut.geo.pageH, cut.matArea)}  <g id="cut"`);
  svg = withCalibrationLayer(svg, cut.layout, cut.dpi);
  // Same physical size as the PDF page, which stretches the same pixels to the exact paper size.
  svg = svg.replace(/width="[\d.]+in" height="[\d.]+in"/, `width="${(cut.layout.pageWMm / 25.4).toFixed(4)}in" height="${(cut.layout.pageHMm / 25.4).toFixed(4)}in"`);
  return { ...cut, svg, filename: sheetFileName(plan, imageHref ? '_print-and-cut.svg' : '_cut.svg', cut.layout) };
}

/**
 * The check square as its own SVG layer, so it can be hidden in Cricut Design Space.
 * It is kept out of the embedded print image for the same reason.
 */
export function withCalibrationLayer(svg: string, layout: PlanLayout, dpi: number): string {
  if (!layout.calibration?.length) return svg;
  const px = (mm: number) => +(mm / 25.4 * dpi).toFixed(3);
  const rects = layout.calibration.map((sq) => `    <rect x="${px(sq.x)}" y="${px(sq.y)}" width="${px(sq.size)}" height="${px(sq.size)}"/>\n`).join('');
  return svg.replace('  <g id="cut"', `  <g id="calibration-1cm" fill="#000000" stroke="none">\n${rects}  </g>\n  <g id="cut"`);
}

export const sheetPdf = (rgba: Uint8ClampedArray, width: number, height: number, layout: PlanLayout) =>
  pdfFromRgba(rgba, width, height, (layout.pageWMm / 25.4) * 72, (layout.pageHMm / 25.4) * 72);

export const withPngDpi = (buffer: ArrayBufferLike | Uint8Array, dpi: number) => pngSetDpi(buffer, dpi);

/* ---------- canvas rendering ---------- */

const tileCanvases = new WeakMap<StickerResult, HTMLCanvasElement>();

/** What prints of one sticker (artwork + bleed). Only printed pixels are painted, so nested neighbours stay visible. */
function tileCanvas(result: StickerResult): HTMLCanvasElement {
  const cached = tileCanvases.get(result);
  if (cached) return cached;
  const { res } = result, b = res.bbox, tw = b.x1 - b.x0, th = b.y1 - b.y0;
  const image = new ImageData(tw, th), out = image.data;
  for (let y = 0; y < th; y++) {
    const row = (b.y0 + y) * res.width + b.x0;
    for (let x = 0; x < tw; x++) {
      const si = row + x;
      if (res.printMask[si]) {
        const di = (y * tw + x) * 4, s4 = si * 4;
        out[di] = res.rgba[s4]; out[di + 1] = res.rgba[s4 + 1]; out[di + 2] = res.rgba[s4 + 2]; out[di + 3] = 255;
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  tileCanvases.set(result, canvas);
  return canvas;
}

export function drawSheet(geo: SheetGeometry, white: boolean, entries: SheetEntry[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = geo.pageW; canvas.height = geo.pageH;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas unavailable');
  if (white) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height); }
  const scaled = new Map<number, HTMLCanvasElement>();
  for (const p of geo.tiles) {
    let tile = scaled.get(p.item);
    if (!tile) {
      const source = tileCanvas(entries[p.item].result);
      if (Math.abs(p.k - 1) > 1e-6) {
        tile = document.createElement('canvas');
        tile.width = Math.max(1, Math.ceil(p.tw)); tile.height = Math.max(1, Math.ceil(p.th));
        const tg = tile.getContext('2d');
        if (tg) { tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = 'high'; tg.drawImage(source, 0, 0, p.tw, p.th); }
      } else tile = source;
      scaled.set(p.item, tile);
    }
    g.save(); g.translate(p.cx, p.cy); g.rotate(p.angle);
    g.drawImage(tile, -p.tw / 2, -p.th / 2);
    g.restore();
  }
  return canvas;
}

/** Dashed scissor lines around each mat sheet, printed in light grey. */
export function drawScissors(canvas: HTMLCanvasElement, layout: PlanLayout): void {
  if (!layout.regions) return;
  const g = canvas.getContext('2d'), s = canvas.width / layout.pageWMm;
  if (!g) return;
  g.save();
  g.strokeStyle = '#8a8a8a'; g.lineWidth = Math.max(1, 0.25 * s); g.setLineDash([2.5 * s, 2 * s]);
  for (const r of layout.regions) g.strokeRect(r.x * s, r.y * s, r.w * s, r.h * s);
  g.restore();
}

/** Solid 1 × 1 cm squares with a small label, measured after printing to check scaling. */
export function drawCalibration(canvas: HTMLCanvasElement, layout: PlanLayout): void {
  if (!layout.calibration?.length) return;
  const g = canvas.getContext('2d'), s = canvas.width / layout.pageWMm;
  if (!g) return;
  g.save();
  for (const sq of layout.calibration) {
    g.fillStyle = '#000000';
    g.fillRect(sq.x * s, sq.y * s, sq.size * s, sq.size * s);
    g.fillStyle = '#ffffff';
    g.font = `700 ${2.6 * s}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('1 cm', (sq.x + sq.size / 2) * s, (sq.y + sq.size / 2) * s);
  }
  g.restore();
}

/* ---------- browser adapters ---------- */

async function canvasPngBlob(canvas: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return new Blob([withPngDpi(await blob.arrayBuffer(), dpi) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function download(filename: string, blob: Blob): Notice {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { key: 'export.saved', params: { filename } };
}

/** Print at true size through a hidden frame so the browser's print dialog opens directly. */
function printImage(url: string, wMm: number, hMm: number, report: (notice: Notice) => void): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'print-frame';
  const cleanup = () => { setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 1000); };
  frame.addEventListener('load', () => {
    const win = frame.contentWindow, img = win?.document.querySelector('img');
    if (!win || !img) { cleanup(); report({ key: 'export.printPrepareFailed', params: {} }); return; }
    const go = () => {
      try {
        win.addEventListener('afterprint', cleanup);
        win.focus(); win.print();
        report({ key: 'export.printOpened', params: {} });
        setTimeout(cleanup, 120_000);
      } catch {
        cleanup();
        report({ key: 'export.printFailed', params: {} });
      }
    };
    if (img.complete) go();
    else {
      img.addEventListener('load', go);
      img.addEventListener('error', () => { cleanup(); report({ key: 'export.printPrepareFailed', params: {} }); });
    }
  });
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Sticker sheet</title><style>`
    + `@page{size:${wMm.toFixed(2)}mm ${hMm.toFixed(2)}mm;margin:0}html,body{margin:0;padding:0;background:#fff}`
    + `img{display:block;width:${wMm.toFixed(2)}mm;height:${hMm.toFixed(2)}mm;page-break-after:avoid}`
    + `</style></head><body><img src="${url}" alt=""></body></html>`;
  document.body.appendChild(frame);
}

export const pdfSupported = () => typeof CompressionStream !== 'undefined';

const reason = (error: unknown) => (error instanceof Error && error.message) || 'unknown';

/** Create and download one sheet file. Returns the notices to show in the status area. */
export async function exportSheet(kind: SheetExportKind, plan: SheetPlan, settings: SheetSettings, report: (notice: Notice) => void): Promise<void> {
  try {
    if (kind === 'svg' || kind === 'both') {
      const cut = cutLayout(plan, settings);
      if (cut.overflow) report({ key: 'export.trimOverflow', params: {} });
      let href: string | null = null;
      if (kind === 'both') {
        const canvas = drawSheet(cut.geo, false, plan.entries);
        drawScissors(canvas, cut.layout);
        href = await blobToDataUrl(await canvasPngBlob(canvas, cut.dpi));
      }
      const file = sheetCutFile(plan, settings, href);
      report(download(file.filename, new Blob([file.svg], { type: 'image/svg+xml' })));
      return;
    }
    const dpi = sheetDpiFor(plan, settings), layout = plan.layout, geo = geometryFor(plan, layout, dpi);
    const canvas = drawSheet(geo, kind !== 'png', plan.entries);
    drawScissors(canvas, layout);
    drawCalibration(canvas, layout);
    if (kind === 'print') {
      const png = await canvasPngBlob(canvas, dpi);
      printImage(URL.createObjectURL(png), layout.pageWMm, layout.pageHMm, report);
      return;
    }
    if (kind === 'pdf') {
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
      if (!data) throw new Error('Canvas unavailable');
      const pdf = await sheetPdf(data.data, canvas.width, canvas.height, layout);
      report(download(sheetFileName(plan, '.pdf'), new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })));
      return;
    }
    report(download(sheetFileName(plan, '.png'), await canvasPngBlob(canvas, dpi)));
  } catch (error) {
    report({ key: 'error.exportFailed', params: { reason: reason(error) } });
  }
}

async function stickerPng(result: StickerResult): Promise<Blob> {
  const { res } = result, canvas = document.createElement('canvas');
  canvas.width = res.width; canvas.height = res.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(res.rgba), res.width, res.height), 0, 0);
  return canvasPngBlob(canvas, result.dpi);
}

export async function exportSticker(kind: StickerExportKind, motif: Motif, result: StickerResult, report: (notice: Notice) => void): Promise<void> {
  const { res, loops, dpi } = result;
  try {
    if (kind === 'png') { report(download(`${motif.name}_bleed.png`, await stickerPng(result))); return; }
    let extra: string | undefined;
    if (kind === 'both') {
      const url = await blobToDataUrl(await stickerPng(result));
      extra = `  <image id="print" x="0" y="0" width="${res.width}" height="${res.height}" href="${url}" xlink:href="${url}"/>\n`;
    }
    const svg = cutSvg(loops, res.width, res.height, dpi, extra);
    report(download(`${motif.name}${kind === 'both' ? '_print-and-cut.svg' : '_cut.svg'}`, new Blob([svg], { type: 'image/svg+xml' })));
  } catch (error) {
    report({ key: 'error.exportFailed', params: { reason: reason(error) } });
  }
}
