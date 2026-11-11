const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

(async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    url: 'https://example.test/cricut-sticker-print-tool/', pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'navigator', 'localStorage', 'Element', 'Node', 'Text', 'Comment', 'DocumentFragment', 'HTMLElement', 'HTMLMediaElement', 'SVGElement', 'MutationObserver', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  globalThis.createImageBitmap = async () => ({ width: 15, height: 15, close() {} });
  globalThis.ImageData = class ImageData { constructor(data, width, height) { if (typeof data === 'number') { height = width; width = data; data = new Uint8ClampedArray(width * height * 4); } Object.assign(this, { data, width, height }); } };
  const art = new Uint8ClampedArray(15 * 15 * 4);
  for (let y = 3; y < 12; y++) for (let x = 3; x < 12; x++) art.set([30, 80, 180, 255], (y * 15 + x) * 4);
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    return { drawImage() {}, clearRect() {}, putImageData() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, strokeRect() {}, setLineDash() {}, fillText() {}, getImageData: () => ({ data: art }) };
  };
  dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
  dom.window.localStorage.setItem('stickerwerkstatt.locale', 'en');
  const root = path.join(__dirname, '..');
  const script = fs.readdirSync(path.join(root, 'dist/assets')).find((name) => /^index-.*\.js$/.test(name));
  await import(pathToFileURL(path.join(root, 'dist/assets', script)).href);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  assert.equal(document.querySelector('.preview-panel'), null, 'empty state offers upload without a sample preview');
  const pngFile = (name) => {
    const file = new dom.window.File([new Uint8Array(0)], name, { type: 'image/png' });
    file.arrayBuffer = async () => new ArrayBuffer(0);
    return file;
  };
  const input = document.querySelector('input[type=file]');
  // A real FileList is live: clearing the input's value empties it.
  const liveFiles = [pngFile('shape.png'), pngFile('second.png'), new dom.window.File([''], 'photo.jpg', { type: 'image/jpeg' })];
  Object.defineProperty(input, 'files', { configurable: true, get: () => liveFiles });
  Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: () => { liveFiles.length = 0; } });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(document.querySelectorAll('.motif-list li').length, 2, 'every selected PNG is loaded even though the input is cleared');
  assert.match(document.querySelector('.workspace-messages').textContent, /photo\.jpg/, 'unsupported file is reported');
  assert.ok(document.querySelector('.preview-panel'), 'uploaded motif opens the preview');
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(document.querySelector('.cut-overlay'), null, 'no cut line is computed before a height is entered');
  assert.match(document.querySelector('.preview-empty').textContent, /Enter an artwork height/);
  const heightInputs = [...document.querySelectorAll('.motif-list li input[aria-label^="Artwork height"]')];
  assert.equal(heightInputs.length, 2, 'height field sits inside each motif list item');
  for (const heightInput of heightInputs.reverse()) { heightInput.value = '50'; heightInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
  for (let i = 0; i < 5; i++) await flush();
  assert.match(document.querySelector('.preview-panel').textContent, /shape/);
  assert.ok(document.querySelector('.cut-overlay path').getAttribute('d'), 'preview includes the cut path');
  const cutStep = [...document.querySelectorAll('.steps button')][1];
  cutStep.click(); await flush();
  const sections = [...document.querySelectorAll('details.cut-motif')];
  assert.equal(sections.length, 2, 'every motif has its own collapsible cut section');
  assert.equal(sections[0].open, true, 'first motif is expanded by default');
  assert.equal(sections[1].open, false, 'other motifs start collapsed');
  assert.ok(document.querySelector('#bleed-1') && document.querySelector('#bleed-2'), 'each motif has its own bleed control');
  const bleed2 = document.querySelector('#bleed-2');
  bleed2.value = '5'; bleed2.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(document.querySelector('#bleed-1').value, '2', 'changing one motif keeps the others');
  assert.equal(document.querySelector('#bleed-2').value, '5');
  const border = document.querySelector('#border-mode-1');
  border.value = 'color'; border.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.ok(document.querySelector('#border-width-1'), 'colored border exposes width control');
  assert.ok(document.querySelector('#border-color-1'), 'colored border exposes color control');
  assert.equal(document.querySelector('#border-width-2'), null, 'border stays on its own motif');
  sections[0].querySelector('.apply-all').click(); await flush();
  assert.ok(document.querySelector('#border-width-2'), 'settings can be copied to all motifs');
  assert.equal(document.querySelector('#bleed-2').value, '2');
  const sheetStep = [...document.querySelectorAll('.steps button')][2];
  const exportButtons = () => [...document.querySelectorAll('.export-group:not(.single-export) .export-buttons button')];
  sheetStep.click(); await flush();
  assert.ok(exportButtons().every((button) => button.disabled), 'exports wait for the sheet');
  for (let i = 0; i < 40 && !document.querySelector('.sheet-summary'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(document.querySelector('.sheet-summary').textContent, /stickers on US Letter/, 'sheet summary names count and paper');
  assert.ok(document.querySelector('.sheet-page[role=img]').getAttribute('aria-label').includes('stickers'), 'sheet preview has a text alternative');
  assert.ok(document.querySelector('.sheet-page .cut-overlay path').getAttribute('d'), 'sheet preview shows cut paths');
  assert.ok(exportButtons().some((button) => !button.disabled), 'exports are enabled once the sheet is ready');
  const paper = document.querySelector('#paper');
  paper.value = 'joy2'; paper.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.ok(document.querySelector('#up-on'), 'small Cricut mats offer several mats per page');
  assert.ok(exportButtons().every((button) => button.disabled), 'sheet exports are disabled while the sheet is stale');
  const margin = document.querySelector('#margin');
  margin.value = '200'; margin.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 40 && !document.querySelector('.sheet-stage + [role=alert]'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(document.querySelector('.sheet-stage + [role=alert]').textContent, /(does not fit|fits on this sheet)/, 'no-fit error explains the fix');
  const artworkStep = [...document.querySelectorAll('.steps button')][0];
  artworkStep.click(); await flush();
  document.querySelector('.remove-button').click(); await flush();
  document.querySelector('.remove-button').click(); await flush();
  assert.equal(document.querySelector('.preview-panel'), null, 'removing the last motif restores empty state');
  dom.window.close();
  console.log('Rendered upload, cut preview, border controls, removal, and empty state OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
