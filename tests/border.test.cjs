const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const engine = fs.readFileSync(path.join(__dirname, 'fixtures/legacy-engine.js'), 'utf8');
const scope = { Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, Int32Array, Uint32Array, DataView, Map, Set, Math, JSON, Number, String, Array, Promise, CompressionStream };
vm.runInNewContext(engine + '\nthis.SB = SB;', scope);
const art = new Uint8ClampedArray(15 * 15 * 4);
for (let y = 4; y <= 10; y++) for (let x = 4; x <= 10; x++) art.set([220, 40, 90, 255], (y * 15 + x) * 4);
const base = { bleedPx: 0, insetPx: 0, mergePx: 0, smooth: 0, fillHoles: true, bleedIntoHoles: false, whiteBg: false, alphaThreshold: 128, erodePx: 0 };
const none = scope.SB.computeBleed(art, 15, 15, base);
function pixel(result, x, y) {
  const at = ((y + result.pad) * result.width + x + result.pad);
  return { cut: result.cut[at], rgba: Array.from(result.rgba.slice(at * 4, at * 4 + 4)), mask: result.printMask[at] };
}
assert.equal(pixel(none, 7, 2).cut, 0);
const paper = scope.SB.computeBleed(art, 15, 15, { ...base, borderPx: 2, borderMode: 'paper' });
assert.equal(pixel(paper, 7, 2).cut, 1, 'paper border expands cut path');
assert.deepEqual(pixel(paper, 7, 3).rgba, [0, 0, 0, 0], 'paper border does not print');
assert.equal(pixel(paper, 7, 3).mask, 1, 'paper border still reserves space on sheet');
const color = scope.SB.computeBleed(art, 15, 15, { ...base, borderPx: 2, borderMode: 'color', borderColor: '#3366cc' });
assert.deepEqual(pixel(color, 7, 3).rgba, [51, 102, 204, 255], 'color border prints chosen color');
assert.deepEqual(pixel(color, 7, 7).rgba, [220, 40, 90, 255], 'original art remains intact');
console.log('Border modes: paper and color OK');
