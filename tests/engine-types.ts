import {
  PAPER, alphaBBox, anglesFor, computeBleed, cutPath, layoutSheet, nestGen,
  pdfFromRgba, pngReadDpi, pngSetDpi, sheetGeometry, sheetGeometryMulti, sheetSvg,
} from '../src/lib/engine/index.js';
import type { NestResult, PaperFormat } from '../src/lib/engine/index.js';

const rgba = new Uint8ClampedArray(4 * 4 * 4);
const bleed = computeBleed(rgba, 4, 4, {
  bleedPx: 1,
  alphaThreshold: 128,
  borderMode: 'paper',
});
const loops = cutPath(bleed.cut, bleed.width, bleed.height, { blur: 0.8 });
const layout = layoutSheet({
  paper: 'a4', orientation: 'auto', marginMm: 5, gapMm: 3,
  cellWMm: 20, cellHMm: 20, copies: 2, fitMat: true,
});
const geometry = sheetGeometry(layout, { x0: 0, y0: 0, w: 4, h: 4 }, 300, 150, loops);
const multiGeometry = sheetGeometryMulti(layout, [{ tile: { x0: 0, y0: 0, w: 4, h: 4 }, dpi: 300, loops }], 150);
const svg: string = sheetSvg(multiGeometry, 150, null, { outline: true });
const pdf: Promise<Uint8Array> = pdfFromRgba(rgba, 4, 4, 72, 72);
const a4: PaperFormat = PAPER.a4;
const bounds = alphaBBox(rgba, 4, 4, 128);
const nest: Generator<{ placed: number }, NestResult, void> = nestGen({
  pageWMm: 210, pageHMm: 297, marginMm: 5, gapMm: 3,
  angles: anglesFor('90'),
  items: [{ foot: { mask: new Uint8Array(16), w: 4, h: 4, spMm: 0.5 }, tileWMm: 20, tileHMm: 20, want: 1 }],
});
const png = pngSetDpi(new Uint8Array(33), 300);
const dpi: number | null = pngReadDpi(png);
const pageWidth: number = geometry.pageW;
// @ts-expect-error Pixel distance must be numeric.
computeBleed(rgba, 4, 4, { bleedPx: '1', alphaThreshold: 128 });
// @ts-expect-error A PNG buffer cannot be a number.
pngReadDpi(300);
void [dpi, pageWidth, svg, pdf, a4, bounds, nest];
