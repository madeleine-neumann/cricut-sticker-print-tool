const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const { createCollection, defaultCutSettings, loadMotifFiles, computeSticker, duplicateMotif, mirrorMotif } = await import('../src/lib/stickers.ts');
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
  const settings = { ...defaultCutSettings, contourMm: 0, bleedMm: 2, borderMode: 'color', borderMm: 1, borderColor: '#3366cc' };
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

  // Duplicate: an independent copy right after the original, selected, with its own cut settings.
  const dupCollection = createCollection();
  const asym = new Uint8ClampedArray(15 * 15 * 4);
  for (let y = 3; y < 12; y++) for (let x = 2; x < 6 + y / 2; x++) asym.set([200, 40, 90, 255], (y * 15 + x) * 4);
  await loadMotifFiles([file('left.png'), file('other.png')], dupCollection, async () => ({ rgba: asym, width: 15, height: 15 }));
  const original = dupCollection.items[0];
  original.heightMm = 30; original.copies = 4; original.cut.bleedMm = 3;
  const copy = duplicateMotif(dupCollection, original.id);
  assert.equal(dupCollection.items[1], copy, 'copy sits right after the original');
  assert.equal(dupCollection.selectedId, copy.id, 'copy is selected');
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, 'left (2)');
  assert.equal(copy.heightMm, 30); assert.equal(copy.copies, 4); assert.equal(copy.cut.bleedMm, 3);
  copy.cut.bleedMm = 1;
  assert.equal(original.cut.bleedMm, 3, 'cut settings are independent');
  assert.equal(duplicateMotif(dupCollection, 9999), null);

  // Mirror: flips the pixels left to right, the cut line follows, mirroring twice restores the original.
  const before = Array.from(copy.rgba);
  const resultBefore = computeSticker(copy, copy.cut);
  mirrorMotif(copy);
  assert.equal(copy.mirrored, true);
  assert.deepEqual(Array.from(copy.rgba.slice((5 * 15 + 14) * 4, (5 * 15 + 14) * 4 + 4)), before.slice((5 * 15) * 4, (5 * 15) * 4 + 4), 'pixel row is reversed');
  assert.deepEqual(Array.from(original.rgba), before, 'mirroring a copy leaves the original alone');
  const resultAfter = computeSticker(copy, copy.cut);
  assert.notEqual(resultAfter, resultBefore, 'mirroring invalidates the cached cut line');
  const xs = (r) => r.loops.flat().map((p) => p[0]);
  assert.ok(Math.abs((Math.min(...xs(resultAfter)) + Math.max(...xs(resultBefore))) - resultAfter.res.width) < 1.5, 'cut line is mirrored too');
  mirrorMotif(copy);
  assert.equal(copy.mirrored, false);
  assert.deepEqual(Array.from(copy.rgba), before, 'mirroring twice restores the artwork');

  // Removing single cut lines: a click point picks the nearest loop; it survives recomputation, mirroring and duplication.
  const twoCollection = createCollection();
  const two = new Uint8ClampedArray(40 * 20 * 4);
  for (let y = 4; y < 16; y++) { for (let x = 3; x < 15; x++) two.set([30, 80, 180, 255], (y * 40 + x) * 4); for (let x = 28; x < 34; x++) two.set([30, 80, 180, 255], (y * 40 + x) * 4); }
  await loadMotifFiles([{ ...file('two.png'), width: 40, height: 20 }], twoCollection, async () => ({ rgba: two, width: 40, height: 20 }));
  const islands = twoCollection.items[0];
  islands.heightMm = 20;
  const cut = { ...defaultCutSettings, contourMm: 0, mergeMm: 0 };
  assert.deepEqual(islands.removedCuts, []);
  const full = computeSticker(islands, cut);
  assert.equal(full.loops.length, 2);
  const smallLoop = full.loops.find((l) => Math.min(...l.map((p) => p[0])) > full.res.pad + 20);
  const [px, py] = smallLoop[0];
  islands.removedCuts.push({ x: px - full.res.pad, y: py - full.res.pad });
  const trimmed = computeSticker(islands, cut);
  assert.equal(trimmed.loops.length, 1, 'clicked cut line is removed');
  assert.equal(trimmed.removedLoops.length, 1, 'removed cut line is kept for display');
  assert.ok(Math.min(...trimmed.loops[0].map((p) => p[0])) < full.res.pad + 20, 'the other cut line stays');
  assert.equal(computeSticker(islands, { ...cut, bleedMm: 3 }).loops.length, 1, 'removal survives other settings');
  const islandCopy = duplicateMotif(twoCollection, islands.id);
  islandCopy.removedCuts.length = 0;
  assert.equal(islands.removedCuts.length, 1, 'duplicates keep their own removed cut lines');
  mirrorMotif(islands);
  const mirroredResult = computeSticker(islands, cut);
  assert.equal(mirroredResult.loops.length, 1, 'removal follows the mirrored artwork');
  assert.ok(Math.max(...mirroredResult.loops[0].map((p) => p[0])) > mirroredResult.res.pad + 20, 'the large piece is mirrored to the right');
  console.log('Sticker load, limits, selection, DPI, alpha warning, cache and legacy parity OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
