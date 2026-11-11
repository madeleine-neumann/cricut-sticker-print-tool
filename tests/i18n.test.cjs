const assert = require('node:assert/strict');

(async () => {
  const { de } = await import('../src/lib/locales/de.ts');
  const { en } = await import('../src/lib/locales/en.ts');
  const { detectLocale, locale, translations, setLocale, t, formatNumber } = await import('../src/lib/i18n.ts');
  const { get } = await import('svelte/store');

  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort(), 'both languages must cover the same UI');
  assert.ok(Object.keys(de).length >= 60, 'dictionaries should cover the complete planned workflow and guide');
  const placeholders = (message) => [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(de)) {
    assert.deepEqual(placeholders(de[key]), placeholders(en[key]), `message parameters differ for ${key}`);
  }
  assert.equal(detectLocale('en', 'de-DE'), 'en', 'saved English overrides a German browser');
  assert.equal(detectLocale(null, 'de-AT'), 'de', 'German browser selects German on first visit');
  assert.equal(detectLocale(null, 'fr-FR'), 'en', 'other browser languages select English');
  assert.equal(detectLocale('invalid', 'de-DE'), 'de', 'invalid saved values do not override the browser');
  assert.equal('set' in locale, false, 'components must not bypass setLocale');
  assert.equal('update' in locale, false, 'components must not bypass setLocale');

  const writes = [];
  const oldDocument = global.document;
  const oldStorage = global.localStorage;
  global.document = { documentElement: { lang: '' }, title: '' };
  global.localStorage = { setItem: (...args) => writes.push(args) };
  try {
    setLocale('de');
    assert.equal(get(locale), 'de');
    assert.equal(get(translations)('app.step.cut'), 'Schnittkante');
    assert.equal(global.document.documentElement.lang, 'de');
    assert.equal(global.document.title, 'Stickerwerkstatt – Stickerbogen gestalten');
    assert.equal(formatNumber(1234.5, { minimumFractionDigits: 1 }), '1.234,5');
    assert.equal(t('error.fileUnreadable', { name: 'a$&<img>' }).includes('a$&<img>'), true,
      'interpolation keeps dynamic values literal, including replacement syntax and markup');
    setLocale('en');
    assert.equal(get(locale), 'en');
    assert.equal(get(translations)('app.step.cut'), 'Cut Line');
    assert.equal(global.document.documentElement.lang, 'en');
    assert.equal(global.document.title, 'Sticker Workshop – Make a sticker sheet');
    assert.equal(formatNumber(1234.5, { minimumFractionDigits: 1 }), '1,234.5');
    assert.equal(t('error.fileUnreadable', { name: 'art.png' }).includes('art.png'), true);
    assert.deepEqual(writes, [['stickerwerkstatt.locale', 'de'], ['stickerwerkstatt.locale', 'en']]);

    global.document.title = '';
    global.localStorage = { getItem: () => 'en' };
    const initial = await import('../src/lib/i18n.ts?initial-title-test');
    assert.equal(get(initial.locale), 'en');
    assert.equal(global.document.documentElement.lang, 'en');
    assert.equal(global.document.title, 'Sticker Workshop – Make a sticker sheet');
  } finally {
    global.document = oldDocument;
    global.localStorage = oldStorage;
  }
  console.log('Locale detection, parity, interpolation, title, persistence, and number formatting OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
