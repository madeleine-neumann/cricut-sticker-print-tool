const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const { computeSticker, defaultCutSettings } = await import('../src/lib/stickers.ts');
  const sheets = await import('../src/lib/sheets.ts');
  const exporter = await import('../src/lib/export.ts');
  const engine = await import('../src/lib/engine/index.js');
  const context = { CompressionStream, Response, Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, Int32Array, Uint32Array, DataView, Map, Set, Math, JSON, Number, String, Array, Promise };
  vm.runInNewContext(fs.readFileSync('tests/fixtures/legacy-engine.js', 'utf8') + '\nthis.engine = SB;', context);
  const legacy = context.engine;
  const { planSheet, defaultSheetSettings, tileMats, matLimited, formatNotice } = sheets;

  // A 40 x 60 px opaque rectangle and a 40 x 40 px triangle, on transparent 60 x 80 px canvases.
  function motif(id, name, shape, heightMm = 30) {
    const width = 60, height = 80, rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 10; y < 70; y++) for (let x = 10; x < 50; x++) {
      if (shape === 'triangle' && (x - 10) > (y - 10) * 40 / 60) continue;
      rgba.set([200, 40, 90, 255], (y * width + x) * 4);
    }
    return { id, name, rgba, width, height, heightMm, copies: '', noTransparency: false, thumbnail: '' };
  }
  const rect = motif(1, 'rect', 'rect');
  const tri = motif(2, 'tri', 'triangle', 40);
  const entry = (m, want = 0) => ({ motif: m, result: computeSticker(m, defaultCutSettings), want });

  assert.equal(defaultSheetSettings.marginMm, 6);
  assert.equal(defaultSheetSettings.gapMm, 1);
  assert.equal(defaultSheetSettings.arrangement, 'nest');
  assert.equal(defaultSheetSettings.rotation, '90');
  assert.equal(defaultSheetSettings.dpiCap, 300);
  assert.equal(defaultSheetSettings.fitMat, true);
  assert.equal(defaultSheetSettings.pageOutline, true);

  // Grid matches the legacy engine for A4, Letter and a Cricut mat, with requested copies.
  for (const paper of ['a4', 'letter', 'joyxtra']) {
    const settings = { ...defaultSheetSettings, paper, arrangement: 'grid', calibration: false };
    const outcome = await planSheet([entry(rect)], settings);
    assert.ok(outcome.ok, `${paper} grid fits`);
    const r = entry(rect).result, b = r.res.bbox;
    const expected = legacy.layoutSheet({
      paper, orientation: 'auto', marginMm: 6, gapMm: 1, copies: 0, fitMat: matLimited(paper),
      cellWMm: (b.x1 - b.x0) / r.dpi * 25.4, cellHMm: (b.y1 - b.y0) / r.dpi * 25.4,
    });
    assert.equal(outcome.plan.layout.count, expected.count, `${paper} grid count matches legacy`);
    assert.equal(outcome.plan.layout.cols, expected.cols);
    assert.equal(outcome.plan.layout.orientation, expected.orientation);
  }
  const capped = await planSheet([entry(rect, 5)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' });
  assert.equal(capped.plan.layout.count, 5, 'requested copies limit the grid');
  const tooMany = await planSheet([entry(rect, 5000)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' });
  assert.ok(tooMany.plan.layout.capped, 'too many copies are capped');
  assert.ok(tooMany.plan.warnings.some((n) => n.key === 'sheet.capped'));

  // Margins and gaps change capacity like the legacy engine.
  const wide = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid', marginMm: 30, gapMm: 8 });
  assert.ok(wide.plan.layout.count < (await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' })).plan.layout.count);

  // Nesting a triangle with rotation packs at least as many as the grid and matches the legacy nester.
  const nested = await planSheet([entry(tri)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'nest', rotation: '180', calibration: false });
  assert.ok(nested.ok);
  assert.ok(nested.plan.layout.count >= nested.plan.layout.gridCount || !nested.plan.layout.nested);
  if (nested.plan.layout.nested) {
    assert.ok(nested.plan.layout.placements.some((p) => p.angle % 360 !== 0), 'rotation is used when it helps');
    const r = entry(tri).result, b = r.res.bbox;
    const legacyFoot = (() => {
      const f = Math.max(1, Math.round((0.25 / 25.4) * r.dpi)), tw = b.x1 - b.x0, th = b.y1 - b.y0;
      const cw = Math.ceil(tw / f), ch = Math.ceil(th / f), m = new Uint8Array(cw * ch);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (r.res.printMask[(b.y0 + y) * r.res.width + b.x0 + x]) m[((y / f) | 0) * cw + ((x / f) | 0)] = 1;
      return { mask: legacy.fillHoles(m, cw, ch), w: cw, h: ch, spMm: (f / r.dpi) * 25.4 };
    })();
    let best = 0;
    for (const [pw, ph] of [[210, 292], [292, 210]]) /* A4 limited to the Cricut mat by default */ for (const crit of ['top', 'bottom']) {
      const res = legacy.nestRun({ pageWMm: pw, pageHMm: ph, marginMm: 6, gapMm: 1, angles: legacy.anglesFor('180'), cellMm: 0.5, crit,
        items: [{ foot: legacyFoot, tileWMm: (b.x1 - b.x0) / r.dpi * 25.4, tileHMm: (b.y1 - b.y0) / r.dpi * 25.4, want: 0 }] });
      best = Math.max(best, res.count);
    }
    assert.equal(nested.plan.layout.count, best, 'nested count matches legacy nester');
  }
  const noRotation = await planSheet([entry(tri)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'nest', rotation: 'none' });
  assert.ok(noRotation.plan.layout.placements.every((p) => (p.angle || 0) % 360 === 0), 'rotation can be disabled');

  // Several motifs are always nested and report per-motif counts and shortfalls.
  const multi = await planSheet([entry(rect, 3), entry(tri, 1000)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' });
  assert.ok(multi.ok);
  assert.ok(multi.plan.layout.nested, 'several motifs ignore grid choice');
  assert.equal(multi.plan.layout.perItem[0], 3);
  assert.ok(multi.plan.warnings.some((n) => n.key === 'error.partialFit' && n.params.name === 'tri'));

  // No fit.
  const huge = await planSheet([entry(motif(3, 'huge', 'rect', 400))], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' });
  assert.equal(huge.ok, false);
  assert.equal(huge.error.key, 'error.noFitSingle');
  const hugeMulti = await planSheet([entry(motif(3, 'huge', 'rect', 400)), entry(motif(4, 'huge2', 'rect', 400))], { ...defaultSheetSettings, paper: 'a4' });
  assert.equal(hugeMulti.error.key, 'error.noFit');

  // Cancelled plans return null.
  assert.equal(await planSheet([entry(tri)], { ...defaultSheetSettings, paper: 'a4' }, { cancelled: () => true }), null);

  // Several Joy 2 mats on Letter: tiled regions and the single mat layout kept for SVG.
  const up = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'joy2', upOn: 'letter', arrangement: 'grid' });
  assert.ok(up.ok);
  assert.ok(up.plan.layout.regions.length >= 2, 'several mats fit on Letter');
  assert.equal(up.plan.layout.count, up.plan.matLayout.count * up.plan.layout.regions.length);
  assert.equal(up.plan.layout.pageWMm * up.plan.layout.pageHMm, 215.9 * 279.4);
  assert.ok(up.plan.summary.some((n) => n.key === 'sheet.upNote'));
  const longUp = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'joy2long', upOn: 'a4', arrangement: 'grid' });
  assert.ok(longUp.ok, 'long mat is shortened to fit two on A4');
  assert.equal(longUp.plan.layout.regions.length, 2);
  assert.equal(tileMats({ ...up.plan.matLayout }, { name: 'X', slug: 'x', w: 10, h: 10, limW: 10, limH: 10 }, 6), null, 'no mat fits a tiny page');
  assert.equal(matLimited('a4'), true);
  assert.equal(matLimited('letter'), false);

  // Notices render with translated nested keys and formatted numbers.
  const translate = (key, params = {}) => key === 'sheet.paper.a4' ? 'A4' : `${key}:${JSON.stringify(params)}`;
  const text = formatNotice({ key: 'sheet.summaryGrid', params: { count: 3, paperKey: 'sheet.paper.a4', size: 12.345 } }, translate, (n) => n.toFixed(1));
  assert.equal(text, 'sheet.summaryGrid:{"count":"3","paper":"A4","size":"12.3"}');

  // Exports: SVG physical size and cut paths, PDF page size, PNG DPI metadata.
  const plan = (await planSheet([entry(rect, 4)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' })).plan;
  const cut = exporter.sheetCutFile(plan, { ...defaultSheetSettings, paper: 'a4', fitMat: false }, null);
  assert.match(cut.svg, /width="8\.2677in" height="11\.6929in"/, 'A4 SVG keeps physical size');
  assert.equal((cut.svg.match(/<path id="cut-/g) || []).length, 4, 'one cut path per sticker');
  assert.match(cut.svg, /id="page-outline"/);
  assert.doesNotMatch(exporter.sheetCutFile(plan, { ...defaultSheetSettings, paper: 'a4', pageOutline: false }, null).svg, /page-outline/);
  const trimmed = exporter.sheetCutFile(plan, { ...defaultSheetSettings, paper: 'a4', fitMat: true }, null);
  assert.ok(trimmed.trim, 'A4 SVG is shortened to the Cricut mat');
  assert.match(trimmed.svg, /height="11\.4961in"/);
  assert.equal(exporter.sheetFileName(plan, '.pdf'), 'rect_sheet-a4.pdf');
  const pdf = await exporter.sheetPdf(new Uint8ClampedArray(4 * 4 * 4).fill(255), 4, 4, plan.layout);
  const pdfText = Buffer.from(pdf).toString('latin1');
  assert.match(pdfText, /\/MediaBox \[0 0 595\.28 841\.89\]/, 'PDF page is A4');
  const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a80000000049454e44ae426082', 'hex');
  assert.equal(engine.pngReadDpi(exporter.withPngDpi(tinyPng, 300)), 300);

  // 1 x 1 cm check square: free spot inside margins and the mat area, never overlapping stickers.
  assert.equal(defaultSheetSettings.calibration, true);
  const overlaps = (sq, layout, tiles, gap) => layout.placements.some((p) => {
    const t = tiles[p.item || 0], a = (p.angle || 0) * Math.PI / 180;
    const bw = Math.abs(t.wMm * Math.cos(a)) + Math.abs(t.hMm * Math.sin(a)), bh = Math.abs(t.wMm * Math.sin(a)) + Math.abs(t.hMm * Math.cos(a));
    return sq.x < p.cxMm + bw / 2 + gap && sq.x + sq.size > p.cxMm - bw / 2 - gap && sq.y < p.cyMm + bh / 2 + gap && sq.y + sq.size > p.cyMm - bh / 2 - gap;
  });
  for (const [label, settings] of [
    ['sparse grid', { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' }],
    ['full nest', { ...defaultSheetSettings, paper: 'letter', arrangement: 'nest' }],
    ['full grid', { ...defaultSheetSettings, paper: 'joy2', arrangement: 'grid' }],
  ]) {
    const want = label === 'sparse grid' ? 3 : 0;
    const out = await planSheet([entry(rect, want)], settings);
    const L = out.plan.layout, sq = L.calibration?.[0];
    assert.ok(sq, `${label}: check square placed`);
    assert.equal(sq.size, 10);
    assert.ok(sq.x >= settings.marginMm - 1e-6 && sq.y >= settings.marginMm - 1e-6, `${label}: inside margin`);
    assert.ok(sq.x + sq.size <= Math.min(L.pageWMm, L.limWMm) - settings.marginMm + 1e-6, `${label}: inside width`);
    assert.ok(sq.y + sq.size <= Math.min(L.pageHMm, L.limHMm) - settings.marginMm + 1e-6, `${label}: inside height`);
    assert.ok(!overlaps(sq, L, out.plan.tiles, settings.gapMm), `${label}: no overlap with stickers`);
    assert.equal(L.count, L.placements.length, `${label}: count follows removed placements`);
    if (label === 'sparse grid') assert.equal(L.count, 3, 'free space is used before removing stickers');
  }
  const fullOff = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'joy2', arrangement: 'grid', calibration: false });
  const fullOn = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'joy2', arrangement: 'grid' });
  assert.equal(fullOff.plan.layout.calibration, undefined, 'check square can be switched off');
  if (fullOn.plan.layout.count < fullOff.plan.layout.count) assert.ok(fullOn.plan.summary.some((n) => n.key === 'sheet.calibrationMoved'));
  const tiledSq = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'joy2', upOn: 'letter', arrangement: 'grid' });
  assert.equal(tiledSq.plan.layout.calibration.length, tiledSq.plan.layout.regions.length, 'one check square per mat');
  assert.equal(tiledSq.plan.matLayout.calibration.length, 1);
  const sqPlan = (await planSheet([entry(rect, 3)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' })).plan;
  const sqSvg = exporter.sheetCutFile(sqPlan, { ...defaultSheetSettings, paper: 'a4' }, null).svg;
  const dpi = exporter.sheetDpiFor(sqPlan, defaultSheetSettings);
  const rectTag = sqSvg.match(/<g id="calibration-1cm"[^>]*>\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(rectTag, 'SVG has the check square on its own layer');
  assert.ok(Math.abs(+rectTag[3] - 10 / 25.4 * dpi) < 0.01 && Math.abs(+rectTag[4] - 10 / 25.4 * dpi) < 0.01, 'SVG square is 10 mm');
  const sqOff = (await planSheet([entry(rect, 3)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid', calibration: false })).plan;
  assert.doesNotMatch(exporter.sheetCutFile(sqOff, { ...defaultSheetSettings, paper: 'a4', calibration: false }, null).svg, /calibration-1cm/);
  console.log('Sheet formats, grid, nesting, rotation, multi-motif, no-fit, mat tiling and export files OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
