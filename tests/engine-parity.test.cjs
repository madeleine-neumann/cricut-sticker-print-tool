const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const legacySource = fs.readFileSync(path.join(root, 'tests/fixtures/legacy-engine.js'), 'utf8');
const legacyContext = { CompressionStream, Response };
vm.runInNewContext(legacySource + '\nthis.engine = SB;', legacyContext);
const legacy = legacyContext.engine;

// Convert cross-realm objects and typed arrays to plain values for comparisons.
const plain = (value) => JSON.parse(JSON.stringify(value));

(async () => {
  const engine = await import(pathToFileURL(path.join(root, 'src/lib/engine/index.js')));
  assert.deepEqual(Object.keys(engine).sort(), Object.keys(legacy).sort(), 'public API matches the legacy engine');

  const art = new Uint8ClampedArray(15 * 15 * 4);
  for (let y = 3; y <= 11; y++) for (let x = 3; x <= 11; x++) {
    if (x >= 6 && x <= 8 && y >= 6 && y <= 8) continue;
    art.set([x * 13, y * 17, 75, 255], (y * 15 + x) * 4);
  }
  const opts = { bleedPx: 2, insetPx: 0, mergePx: 0, borderPx: 1, borderMode: 'color', borderColor: '#3366cc', alphaThreshold: 128, erodePx: 0, smooth: 0, fillHoles: false, bleedIntoHoles: false, whiteBg: false };
  const oldBleed = legacy.computeBleed(art, 15, 15, opts);
  const newBleed = engine.computeBleed(art, 15, 15, opts);
  assert.deepEqual(plain(newBleed), plain(oldBleed), 'bleed pixels, masks and dimensions match');

  const pathOpts = { blur: 0.8, simplify: 0.2, minArea: 1 };
  const oldLoops = legacy.cutPath(oldBleed.cut, oldBleed.width, oldBleed.height, pathOpts);
  const newLoops = engine.cutPath(newBleed.cut, newBleed.width, newBleed.height, pathOpts);
  assert.deepEqual(plain(newLoops), plain(oldLoops), 'cut contours match');
  assert.equal(engine.cutSvg(newLoops, newBleed.width, newBleed.height, 300), legacy.cutSvg(oldLoops, oldBleed.width, oldBleed.height, 300));

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPp0AAAAASUVORK5CYII=', 'base64');
  const oldPng = legacy.pngSetDpi(png, 300);
  const newPng = engine.pngSetDpi(png, 300);
  assert.deepEqual(Array.from(newPng), Array.from(oldPng), 'PNG DPI bytes match');
  assert.equal(engine.pngReadDpi(newPng), legacy.pngReadDpi(oldPng), 'PNG DPI reading matches');

  const layoutOpts = { paper: 'a4', orientation: 'auto', marginMm: 5, gapMm: 3, cellWMm: 52, cellHMm: 40, copies: 9, fitMat: true };
  const oldLayout = legacy.layoutSheet(layoutOpts);
  const newLayout = engine.layoutSheet(layoutOpts);
  assert.deepEqual(plain(newLayout), plain(oldLayout), 'sheet layout matches');
  const tile = { x0: 0, y0: 0, w: 30, h: 30 };
  const oldGeo = legacy.sheetGeometry(oldLayout, tile, 300, 150, oldLoops);
  const newGeo = engine.sheetGeometry(newLayout, tile, 300, 150, newLoops);
  assert.deepEqual(plain(newGeo), plain(oldGeo), 'sheet geometry matches');
  console.log('Engine module parity: bleed, cut path, PNG DPI and sheet layout OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
