const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const { createCollection, defaultCutSettings, loadMotifFiles, computeSticker } = await import('../src/lib/stickers.ts');
  const engine = await import('../src/lib/engine/index.js');
  const context = { CompressionStream, Response };
  vm.runInNewContext(fs.readFileSync('tests/fixtures/legacy-engine.js', 'utf8') + '\nthis.engine = SB;', context);
  const legacy = context.engine;
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const art = new Uint8ClampedArray(15 * 15 * 4);
  for (let y = 3; y < 12; y++) for (let x = 4; x < 11; x++) {
    const i = (y * 15 + x) * 4;
    art.set([30, 80, 180, 255], i);
  }
  const decode = async (file) => ({ rgba: art, width: file.width, height: file.height });
  const file = (name, type = 'image/png', width = 15, height = 15) => ({ name, type, width, height, arrayBuffer: async () => new ArrayBuffer(0) });
  const collection = createCollection();
  assert.equal(defaultCutSettings.alphaThreshold, 128);
  assert.equal(defaultCutSettings.borderMode, 'none');
  assert.equal(defaultCutSettings.bleedMm, 2);
  assert.equal(defaultCutSettings.insetMm, 0.2);
  assert.equal(defaultCutSettings.borderMm, 2);
  assert.equal(defaultCutSettings.smooth, 2);
  assert.equal(defaultCutSettings.fillHoles, true);
  assert.equal(defaultCutSettings.erodePx, 1);

  let result = await loadMotifFiles([file('first.jpg', 'image/jpeg')], collection, decode);
  assert.equal(result.added.length, 0);
  assert.equal(result.errors[0].key, 'error.notImage');
  result = await loadMotifFiles([file('large.png', 'image/png', 6001, 6001)], collection, decode);
  assert.equal(result.errors[0].key, 'error.fileTooLarge');
  result = await loadMotifFiles([file('a.png'), file('a.png')], collection, decode);
  assert.deepEqual(result.added.map((item) => item.name), ['a', 'a (2)']);
  assert.equal(collection.selectedId, result.added[0].id);
  assert.equal(result.added[0].heightMm, null, 'height starts empty so nothing is computed before input');
  assert.equal(result.added[0].suggestedHeightMm, null);
  assert.throws(() => computeSticker(result.added[0], defaultCutSettings), /height/i, 'computing needs a height');
  assert.equal(result.added[0].copies, '');
  assert.equal(result.added[0].noTransparency, false);
  collection.select(result.added[1].id);
  assert.equal(collection.selectedId, result.added[1].id);
  collection.remove(result.added[1].id);
  assert.equal(collection.selectedId, result.added[0].id);

  const png = engine.pngSetDpi(new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAAAD0lEQVQ4T2NkYGD4z0AEAAIYAR6h3IO0AAAAAElFTkSuQmCC', 'base64')), 300);
  const dpiFile = { ...file('dpi.png'), arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
  result = await loadMotifFiles([dpiFile], collection, decode);
  assert.equal(result.added[0].heightMm, null);
  assert.ok(Math.abs(result.added[0].suggestedHeightMm - 9 / 300 * 25.4) < 0.01, 'PNG DPI only suggests a height');

  const opaque = new Uint8ClampedArray(15 * 15 * 4);
  opaque.fill(255);
  result = await loadMotifFiles([file('opaque.webp', 'image/webp')], collection, async () => ({ rgba: opaque, width: 15, height: 15 }));
  assert.equal(result.added[0].noTransparency, true);
  const filled = createCollection();
  filled.items.push({ ...collection.items[0], id: 99, width: 4000, height: 9000 });
  result = await loadMotifFiles([file('over-total.webp', 'image/webp', 4000, 4000)], filled, async () => ({ rgba: new Uint8ClampedArray(4), width: 4000, height: 4000 }));
  assert.equal(result.errors[0].key, 'error.totalTooLarge');

  const motif = collection.items[0];
  motif.heightMm = 50;
  const settings = { ...defaultCutSettings, bleedMm: 2, borderMode: 'color', borderMm: 1, borderColor: '#3366cc' };
  const adapted = computeSticker(motif, settings);
  const bbox = legacy.alphaBBox(art, 15, 15, 128);
  const dpi = bbox.h / (motif.heightMm / 25.4);
  const old = legacy.computeBleed(art, 15, 15, {
    bleedPx: 2 / 25.4 * dpi, insetPx: 0.2 / 25.4 * dpi, mergePx: 0, borderPx: 1 / 25.4 * dpi,
    borderMode: 'color', borderColor: '#3366cc', alphaThreshold: 128, erodePx: 1,
    smooth: 2, fillHoles: true, bleedIntoHoles: false, whiteBg: false
  });
  assert.equal(adapted.res.width, old.width);
  assert.equal(adapted.res.height, old.height);
  assert.deepEqual(plain(adapted.res.printMask), plain(old.printMask));
  assert.deepEqual(plain(adapted.loops), plain(legacy.cutPath(old.cut, old.width, old.height, {})));
  assert.equal(computeSticker(motif, settings), adapted, 'unchanged computation should be cached');
  assert.notEqual(computeSticker(motif, { ...settings, bleedMm: 3 }), adapted, 'settings should invalidate the cache');
  console.log('Sticker load, limits, selection, DPI, alpha warning, cache and legacy parity OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
