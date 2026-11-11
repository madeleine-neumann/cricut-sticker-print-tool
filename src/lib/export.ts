import { cutSvg, pdfFromRgba, pngSetDpi, sheetGeometryMulti, sheetSvg, type SheetGeometry } from './engine/index.js';
import { alignmentPage, type AlignmentPage, type Notice, type PlanLayout, type SheetEntry, type SheetPlan, type SheetSettings } from './sheets.ts';
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
export function cutLayout(plan: SheetPlan, settings: SheetSettings, applyOffset = false): CutLayout {
  const layout = plan.matLayout ?? plan.layout, dpi = sheetDpiFor(plan, settings);
  // A measured offset moves only the cut lines; frame and check square stay on the paper.
  const shifted = applyOffset && (settings.offsetXMm || settings.offsetYMm)
    ? { ...layout, placements: layout.placements.map((p) => ({ ...p, cxMm: p.cxMm - settings.offsetXMm, cyMm: p.cyMm - settings.offsetYMm })) }
    : layout;
  const geo = geometryFor(plan, shifted, dpi);
  // The layout carries the mat's cutting area, measured from the paper's top-left corner.
  if (layout.limWMm >= layout.pageWMm - 0.05 && layout.limHMm >= layout.pageHMm - 0.05) return { layout, dpi, geo, matArea: null, overflow: false };
  const matArea = { w: Math.min(geo.pageW, (layout.limWMm / 25.4) * dpi), h: Math.min(geo.pageH, (layout.limHMm / 25.4) * dpi) };
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
  // Print and Cut files register on printed marks in Design Space, so only the cut-only file is corrected.
  const cut = cutLayout(plan, settings, !imageHref);
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

const TEST_DPI = 300;

/** Pen crosses on the measuring marks of the alignment test, corrected by the current offset like the cut file. */
export function alignmentTestSvg(settings: SheetSettings): { svg: string; filename: string } | null {
  const page = alignmentPage(settings);
  if (!page) return null;
  const px = (mm: number) => +(mm / 25.4 * TEST_DPI).toFixed(2), W = px(page.pageWMm), H = px(page.pageHMm);
  const area = { w: px(page.limWMm), h: px(page.limHMm) };
  const frame = settings.pageOutline
    ? (area.w < W - 0.5 || area.h < H - 0.5 ? openFrame(W, H, area) : `  <g id="page-outline" fill="none" stroke="#000000" stroke-width="1">\n    <rect x="0" y="0" width="${W}" height="${H}"/>\n  </g>\n`)
    : '';
  const arm = 8, crosses = page.marks.map(({ x, y }) => {
    const cx = x - settings.offsetXMm, cy = y - settings.offsetYMm;
    return `    <path d="M${px(cx - arm)},${px(cy)}H${px(cx + arm)}M${px(cx)},${px(cy - arm)}V${px(cy + arm)}"/>\n`;
  }).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${(page.pageWMm / 25.4).toFixed(4)}in" height="${(page.pageHMm / 25.4).toFixed(4)}in" viewBox="0 0 ${W} ${H}">\n${frame}  <g id="alignment-crosses" fill="none" stroke="#000000" stroke-width="1">\n${crosses}  </g>\n</svg>\n`;
  return { svg, filename: `alignment-test-${settings.paper}_draw.svg` };
}

/** Printed measuring scales (0.5 mm steps, ±4 mm) next to each mark, plus the 1 cm check square. */
function alignmentTestCanvas(page: AlignmentPage, title: string): HTMLCanvasElement {
  const s = TEST_DPI / 25.4, canvas = document.createElement('canvas');
  canvas.width = Math.round(page.pageWMm * s); canvas.height = Math.round(page.pageHMm * s);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas unavailable');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = '#000000'; g.fillStyle = '#000000'; g.lineWidth = 0.18 * s;
  g.font = `${1.5 * s}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  // The pen's vertical line crosses the X scale 5 mm below the mark, its horizontal line the Y scale 5 mm to the right.
  const tickLen = (t: number) => (t === 0 ? 2.6 : t % 2 === 0 ? 1.6 : 0.9);
  for (const { x, y } of page.marks) {
    g.beginPath(); g.arc(x * s, y * s, 1 * s, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo((x - 4.5) * s, (y + 5) * s); g.lineTo((x + 4.5) * s, (y + 5) * s); g.stroke();
    g.beginPath(); g.moveTo((x + 5) * s, (y - 4.5) * s); g.lineTo((x + 5) * s, (y + 4.5) * s); g.stroke();
    for (let t = -8; t <= 8; t++) {
      const v = t / 2, len = tickLen(t);
      g.beginPath(); g.moveTo((x + v) * s, (y + 5) * s); g.lineTo((x + v) * s, (y + 5 - len) * s); g.stroke();
      g.beginPath(); g.moveTo((x + 5) * s, (y + v) * s); g.lineTo((x + 5 - len) * s, (y + v) * s); g.stroke();
      if (t % 4 === 0) {
        const label = v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`;
        g.textAlign = 'center'; g.fillText(label, (x + v) * s, (y + 6.5) * s);
        g.textAlign = 'left'; g.fillText(label, (x + 5.8) * s, (y + v) * s);
      }
    }
  }
  g.textAlign = 'left'; g.font = `600 ${3 * s}px system-ui, sans-serif`;
  g.fillText(title, 25 * s, 32 * s);
  g.fillRect(25 * s, 40 * s, 10 * s, 10 * s);
  return canvas;
}

export async function exportAlignmentTest(kind: 'pdf' | 'svg', settings: SheetSettings, title: string, report: (notice: Notice) => void): Promise<void> {
  try {
    const page = alignmentPage(settings);
    if (!page) return;
    if (kind === 'svg') {
      const file = alignmentTestSvg(settings);
      if (file) report(download(file.filename, new Blob([file.svg], { type: 'image/svg+xml' })));
      return;
    }
    const canvas = alignmentTestCanvas(page, title), data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
    if (!data) throw new Error('Canvas unavailable');
    const pdf = await pdfFromRgba(data.data, canvas.width, canvas.height, (page.pageWMm / 25.4) * 72, (page.pageHMm / 25.4) * 72);
    report(download(`alignment-test-${settings.paper}_print.pdf`, new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })));
  } catch (error) {
    report({ key: 'error.exportFailed', params: { reason: reason(error) } });
  }
}

export const sheetPdf = (rgba: Uint8ClampedArray, width: number, height: number, layout: PlanLayout) =>
  pdfFromRgba(rgba, width, height, (layout.pageWMm / 25.4) * 72, (layout.pageHMm / 25.4) * 72);

export const withPngDpi = (buffer: ArrayBufferLike | Uint8Array, dpi: number) => pngSetDpi(buffer, dpi);

/* ---------- canvas rendering ---------- */

const tileCanvases = new WeakMap<StickerResult, HTMLCanvasElement>();

/**
 * What prints of one sticker (artwork, bleed, border), cropped to its print area. Only pixels inside the print mask
 * are kept so nested neighbours stay visible; their own transparency stays too, so a blank paper border is not filled.
 */
export function tilePixels(result: StickerResult): Uint8ClampedArray<ArrayBuffer> {
  const { res } = result, b = res.bbox, tw = b.x1 - b.x0, th = b.y1 - b.y0;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const row = (b.y0 + y) * res.width + b.x0;
    for (let x = 0; x < tw; x++) {
      const si = row + x;
      if (res.printMask[si]) {
        const di = (y * tw + x) * 4, s4 = si * 4;
        out[di] = res.rgba[s4]; out[di + 1] = res.rgba[s4 + 1]; out[di + 2] = res.rgba[s4 + 2]; out[di + 3] = res.rgba[s4 + 3];
      }
    }
  }
  return out;
}

function tileCanvas(result: StickerResult): HTMLCanvasElement {
  const cached = tileCanvases.get(result);
  if (cached) return cached;
  const b = result.res.bbox, tw = b.x1 - b.x0, th = b.y1 - b.y0;
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  canvas.getContext('2d')?.putImageData(new ImageData(tilePixels(result), tw, th), 0, 0);
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
