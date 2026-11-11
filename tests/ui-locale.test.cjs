const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

(async () => {
  const root = path.join(__dirname, '..');
  const dist = path.join(root, 'dist');
  const script = fs.readdirSync(path.join(dist, 'assets')).find((name) => /^index-.*\.js$/.test(name));
  assert.ok(script, 'build the app before running the rendered UI test');

  const dom = new JSDOM('<!doctype html><html lang="de"><head><title>Stickerwerkstatt</title></head><body><div id="app"></div></body></html>', {
    url: 'https://example.test/cricut-sticker-print-tool/',
    pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'navigator', 'localStorage', 'Element', 'Node', 'Text', 'Comment', 'DocumentFragment', 'HTMLElement', 'HTMLMediaElement', 'SVGElement', 'MutationObserver', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  dom.window.localStorage.setItem('stickerwerkstatt.locale', 'de');
  await import(pathToFileURL(path.join(dist, 'assets', script)).href);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();

  const buttons = [...document.querySelectorAll('.language-control button')];
  const de = buttons.find((button) => button.textContent.trim() === 'DE');
  const en = buttons.find((button) => button.textContent.trim() === 'EN');
  assert.ok(de && en, 'both language buttons render');
  const subtitle = () => document.querySelector('.subtitle')?.textContent;
  const guide = () => document.querySelector('.guide-content h2')?.textContent;
  assert.equal(subtitle(), 'Aus deinen Motiven wird ein druckfertiger Stickerbogen.');
  assert.equal(guide(), 'So funktioniert die Stickerwerkstatt');
  assert.equal(document.documentElement.lang, 'de');
  assert.equal(document.title, 'Stickerwerkstatt – Stickerbogen gestalten');
  assert.equal(de.getAttribute('aria-pressed'), 'true');

  en.click();
  await flush();
  assert.equal(subtitle(), 'Turn your artwork into a print-ready sticker sheet.');
  assert.equal(guide(), 'How the Sticker Workshop works');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Sticker Workshop – Make a sticker sheet');
  assert.equal(en.getAttribute('aria-pressed'), 'true');
  assert.equal(de.getAttribute('aria-pressed'), 'false');
  assert.equal(dom.window.localStorage.getItem('stickerwerkstatt.locale'), 'en');

  de.click();
  await flush();
  assert.equal(subtitle(), 'Aus deinen Motiven wird ein druckfertiger Stickerbogen.');
  assert.equal(document.documentElement.lang, 'de');
  assert.equal(document.title, 'Stickerwerkstatt – Stickerbogen gestalten');
  assert.equal(de.getAttribute('aria-pressed'), 'true');
  dom.window.close();
  console.log('Rendered language switch updates content, pressed state, document language, and title OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
