const assert = require('node:assert/strict');

(async () => {
  const engine = await import('../src/lib/engine/index.js');
  const { defaultCutSettings } = await import('../src/lib/stickers.ts');
  // A 40 × 40 block with thin 1 px needles sticking out and narrow notches cut in: the shape that shreds paper.
  const W = 120, H = 120, rgba = new Uint8ClampedArray(W * H * 4);
  const paint = (x, y) => rgba.set([30, 90, 40, 255], (y * W + x) * 4);
  for (let y = 40; y < 80; y++) for (let x = 40; x < 80; x++) paint(x, y);
  for (let i = 0; i < 18; i++) { paint(50, 39 - i); paint(60, 39 - i); paint(70, 39 - i); paint(80 + i, 55); paint(80 + i, 65); }
  for (let y = 40; y < 60; y++) { rgba[(y * W + 45) * 4 + 3] = 0; rgba[(y * W + 46) * 4 + 3] = 0; } // 2 px notch
  const base = { bleedPx: 4, alphaThreshold: 128, insetPx: 0, mergePx: 0, smooth: 0, fillHoles: true, bleedIntoHoles: false, whiteBg: false, erodePx: 0 };

  const distanceTo = (mask, w, h) => engine.edt(mask, w, h, false).d2;
  const grow = (mask, w, h, r) => { const d = distanceTo(mask, w, h); return Uint8Array.from(d, (v) => (v <= r * r ? 1 : 0)); };
  const invert = (mask) => Uint8Array.from(mask, (v) => 1 - v);
  const shrink = (mask, w, h, r) => invert(grow(invert(mask), w, h, r));
  const count = (mask) => mask.reduce((sum, v) => sum + v, 0);

  const plain = engine.computeBleed(rgba, W, H, base);
  const zero = engine.computeBleed(rgba, W, H, { ...base, roundPx: 0 });
  assert.deepEqual(Array.from(zero.cut), Array.from(plain.cut), 'radius 0 keeps the previous cut line');

  const r = 5;
  const smooth = engine.computeBleed(rgba, W, H, { ...base, roundPx: r });
  const { width: w, height: h, pad } = smooth;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (rgba[(y * W + x) * 4 + 3] >= 128) assert.equal(smooth.cut[(y + pad) * w + x + pad], 1, 'the cut line never cuts into the artwork');
  }
  // No protrusion narrower than about 2r (opening changes little) and no notch narrower than about 2r (closing changes little).
  const area = count(smooth.cut), k = r - 1;
  const opened = grow(shrink(smooth.cut, w, h, k), w, h, k), closed = shrink(grow(smooth.cut, w, h, k), w, h, k);
  assert.ok(area - count(opened) < area * 0.01, `thin spikes are rounded off (${area - count(opened)} px)`);
  assert.ok(count(closed) - area < area * 0.01, `narrow gaps are filled (${count(closed) - area} px)`);
  const plainArea = count(plain.cut);
  assert.ok(plainArea - count(grow(shrink(plain.cut, plain.width, plain.height, k), plain.width, plain.height, k)) > plainArea * 0.02, 'fixture really has thin spikes');
  // Enclosed areas print in the nearest artwork colour, so no white gaps appear inside the sticker.
  const inside = smooth.cut.reduce((n, v, i) => n + (v && smooth.rgba[i * 4 + 3] === 0 ? 1 : 0), 0);
  assert.equal(inside, 0, 'everything inside the cut line prints');
  assert.ok(smooth.loops === undefined);
  assert.equal(defaultCutSettings.contourMm, 1, 'contour smoothing is on by default');
  console.log('Contour smoothing: keeps artwork, rounds spikes and gaps, radius 0 unchanged OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
