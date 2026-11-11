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
  const { planSheet, defaultSheetSettings, tileMats, formatNotice, MATS, MACHINES } = sheets;

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
  const layoutCut = { ...defaultCutSettings, contourMm: 0 }; // layout parity uses the unrounded cut line
  const entry = (m, want = 0) => ({ motif: m, result: computeSticker(m, layoutCut), want });

  assert.equal(defaultSheetSettings.marginMm, 6);
  assert.equal(defaultSheetSettings.gapMm, 1);
  assert.equal(defaultSheetSettings.arrangement, 'nest');
  assert.equal(defaultSheetSettings.rotation, '90');
  assert.equal(defaultSheetSettings.dpiCap, 300);
  assert.equal(defaultSheetSettings.machine, 'maker');
  assert.equal(defaultSheetSettings.mat, 'm12x12');
  assert.equal(defaultSheetSettings.pageOutline, true);

  // Researched Cricut cutting areas (mm) per mat.
  assert.deepEqual(MACHINES.maker, ['m12x12', 'm12x24']);
  assert.deepEqual(MACHINES.joy, ['j45x65', 'j45x12']);
  assert.ok(Math.abs(MATS.m12x12.cutW - 11.5 * 25.4) < 0.01 && Math.abs(MATS.m12x24.cutH - 23.5 * 25.4) < 0.01);
  assert.ok(Math.abs(MATS.v24x28.cutW - 23.5 * 25.4) < 0.01 && Math.abs(MATS.v24x28.cutH - 27.5 * 25.4) < 0.01);
  assert.ok(Math.abs(MATS.jx8x12.cutW - 8.25 * 25.4) < 0.01 && Math.abs(MATS.jx8x12.cutH - 11.75 * 25.4) < 0.01);

  // Without a cutting machine the grid matches the legacy engine for A4 and Letter.
  for (const paper of ['a4', 'letter']) {
    const settings = { ...defaultSheetSettings, paper, machine: 'none', mat: null, arrangement: 'grid', calibration: false };
    const outcome = await planSheet([entry(rect)], settings);
    assert.ok(outcome.ok, `${paper} grid fits`);
    const r = entry(rect).result, b = r.res.bbox;
    const expected = legacy.layoutSheet({
      paper, orientation: 'auto', marginMm: 6, gapMm: 1, copies: 0, fitMat: false,
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
  const nested = await planSheet([entry(tri)], { ...defaultSheetSettings, paper: 'a4', machine: 'none', mat: null, arrangement: 'nest', rotation: '180', calibration: false });
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
    for (const [pw, ph] of [[210, 297], [297, 210]]) for (const crit of ['top', 'bottom']) {
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

  // The cutting area limits where stickers go; print and cut file share it.
  const inside = (L, margin) => L.placements.every((p) => p.cyMm <= L.limHMm - margin + 1e-6 && p.cxMm <= L.limWMm - margin + 1e-6);
  const m12 = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid', orientation: 'portrait' });
  assert.ok(Math.abs(m12.plan.layout.limHMm - 292.1) < 0.01 && m12.plan.layout.limWMm === 210, 'A4 on the 12 x 12 mat is cut to 292.1 mm');
  assert.ok(inside(m12.plan.layout, 6));
  const m24 = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', mat: 'm12x24', arrangement: 'grid', orientation: 'portrait' });
  assert.equal(m24.plan.layout.limHMm, 297, 'the 12 x 24 mat cuts the whole A4 page');
  assert.ok(m24.plan.layout.count >= m12.plan.layout.count);
  const m24land = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', mat: 'm12x24', arrangement: 'grid', orientation: 'landscape' });
  assert.equal(m24land.plan.layout.orientation, 'landscape');
  assert.ok(Math.abs(m24land.plan.layout.limWMm - 292.1) < 0.01 && m24land.plan.layout.limHMm === 210, 'landscape A4 is limited by the mat width');
  const xtra = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', machine: 'joyxtra', mat: 'jx8x12', arrangement: 'grid' });
  assert.equal(xtra.plan.layout.orientation, 'portrait', 'A4 only fits the Joy Xtra mat upright');
  assert.ok(Math.abs(xtra.plan.layout.limWMm - 209.55) < 0.01);
  const venture = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 's12x12', machine: 'venture', mat: 'v24x28', arrangement: 'grid' });
  assert.equal(venture.plan.layout.limWMm, venture.plan.layout.pageWMm, 'Venture cuts the whole 12 x 12 page');

  // Paper larger than a Joy mat: mat-sized areas are printed to cut apart; the mat layout is kept for SVG.
  const up = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'letter', machine: 'joy', mat: 'j45x65', arrangement: 'grid' });
  assert.ok(up.ok);
  assert.ok(up.plan.layout.regions.length >= 2, 'several mats fit on Letter');
  assert.equal(up.plan.layout.count, up.plan.matLayout.count * up.plan.layout.regions.length);
  assert.equal(up.plan.layout.pageWMm * up.plan.layout.pageHMm, 215.9 * 279.4);
  assert.ok(up.plan.summary.some((n) => n.key === 'sheet.upNote'));
  assert.equal(up.plan.matLayout.pageWMm, 114.3);
  assert.ok(Math.abs(up.plan.matLayout.limWMm - 107.95) < 0.01, 'stickers stay in the Joy cutting area');
  const longUp = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', machine: 'joy', mat: 'j45x12', arrangement: 'grid' });
  assert.ok(longUp.ok, 'long Joy mat is shortened to fit on A4');
  assert.ok(longUp.plan.matLayout.pageHMm <= 297 - 12 + 1e-6);
  assert.equal(tileMats({ ...up.plan.matLayout }, { name: 'X', slug: 'x', w: 10, h: 10, limW: 10, limH: 10 }, 6), null, 'no mat fits a tiny page');

  // Notices render with translated nested keys and formatted numbers.
  const translate = (key, params = {}) => key === 'sheet.paper.a4' ? 'A4' : `${key}:${JSON.stringify(params)}`;
  const text = formatNotice({ key: 'sheet.summaryGrid', params: { count: 3, paperKey: 'sheet.paper.a4', size: 12.345 } }, translate, (n) => n.toFixed(1));
  assert.equal(text, 'sheet.summaryGrid:{"count":"3","paper":"A4","size":"12.3"}');

  // Exports: SVG physical size and cut paths, PDF page size, PNG DPI metadata.
  const plan = (await planSheet([entry(rect, 4)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' })).plan;
  const cut = exporter.sheetCutFile(plan, { ...defaultSheetSettings, paper: 'a4' }, null);
  assert.match(cut.svg, /width="8\.2677in" height="11\.6929in"/, 'A4 SVG keeps physical size');
  assert.equal((cut.svg.match(/<path id="cut-/g) || []).length, 4, 'one cut path per sticker');
  assert.match(cut.svg, /id="page-outline"/);
  assert.doesNotMatch(exporter.sheetCutFile(plan, { ...defaultSheetSettings, paper: 'a4', pageOutline: false }, null).svg, /page-outline/);
  // The SVG must match the print file exactly: same page size and coordinates, never shortened.
  const matFit = exporter.sheetCutFile(plan, { ...defaultSheetSettings, paper: 'a4' }, null);
  assert.match(matFit.svg, /width="8.2677in" height="11.6929in"/, "SVG keeps the full A4 page like the PDF");
  const fullGeo = exporter.geometryFor(plan, plan.layout, exporter.sheetDpiFor(plan, defaultSheetSettings));
  assert.match(matFit.svg, new RegExp(`viewBox="0 0 ${fullGeo.pageW} ${fullGeo.pageH}"`), 'SVG uses the print coordinates');
  // A4 is taller than the Cricut cutting area (292 mm), so the drawn frame is open at the bottom.
  const outline = matFit.svg.match(/<g id="page-outline"[^>]*>\s*<path d="([^"]+)"/);
  assert.ok(outline, 'page outline is an open path on paper larger than the mat');
  assert.doesNotMatch(outline[1], /Z/i, 'frame has no bottom edge');
  const ys = [...outline[1].matchAll(/[MLVH]?\s*(-?[\d.]+)/g)];
  const limit = 292.1 / 25.4 * exporter.sheetDpiFor(plan, defaultSheetSettings);
  assert.ok(outline[1].startsWith('M0,') && outline[1].includes(`H${fullGeo.pageW}`), 'frame starts at the paper corner and spans the full width');
  assert.ok(Math.abs(Number(outline[1].match(/^M0,([\d.]+)/)[1]) - limit) < 1, 'frame sides end at the cutting area limit');
  assert.ok(ys.length > 0);
  const m24Svg = exporter.sheetCutFile(m24.plan, { ...defaultSheetSettings, paper: 'a4', mat: 'm12x24' }, null).svg;
  assert.match(m24Svg, /<g id="page-outline"[^>]*>\s*<rect/, 'on the 12 x 24 mat A4 gets a closed frame');
  const letterPlan = (await planSheet([entry(rect, 4)], { ...defaultSheetSettings, paper: 'letter', arrangement: 'grid' })).plan;
  assert.match(exporter.sheetCutFile(letterPlan, { ...defaultSheetSettings, paper: 'letter' }, null).svg, /<g id="page-outline"[^>]*>\s*<rect/, 'Letter fits the mat and keeps a closed frame');
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
    ['full grid', { ...defaultSheetSettings, paper: 'a4', machine: 'joy', mat: 'j45x65', arrangement: 'grid' }],
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
  const fullOff = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', machine: 'joy', mat: 'j45x65', arrangement: 'grid', calibration: false });
  const fullOn = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'a4', machine: 'joy', mat: 'j45x65', arrangement: 'grid' });
  assert.equal(fullOff.plan.layout.calibration, undefined, 'check square can be switched off');
  if (fullOn.plan.layout.count < fullOff.plan.layout.count) assert.ok(fullOn.plan.summary.some((n) => n.key === 'sheet.calibrationMoved'));
  const tiledSq = await planSheet([entry(rect)], { ...defaultSheetSettings, paper: 'letter', machine: 'joy', mat: 'j45x65', arrangement: 'grid' });
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

  // Measured offset: the cut-only SVG moves its cut lines back; frame, check square and Print Then Cut file stay.
  const offPlan = (await planSheet([entry(rect, 2)], { ...defaultSheetSettings, paper: 'a4', arrangement: 'grid' })).plan;
  const offDpi = exporter.sheetDpiFor(offPlan, defaultSheetSettings), mmPx = offDpi / 25.4;
  const firstPoint = (svg) => svg.match(/<path id="cut-1" d="M(-?[\d.]+),(-?[\d.]+)/).slice(1).map(Number);
  const frameOf = (svg) => svg.match(/<g id="page-outline"[^>]*>\s*<[^>]+>/)[0];
  const plainCut = exporter.sheetCutFile(offPlan, { ...defaultSheetSettings, paper: 'a4' }, null).svg;
  const movedCut = exporter.sheetCutFile(offPlan, { ...defaultSheetSettings, paper: 'a4', offsetXMm: 1.5, offsetYMm: -0.5 }, null).svg;
  const [x0, y0] = firstPoint(plainCut), [x1, y1] = firstPoint(movedCut);
  assert.ok(Math.abs((x0 - x1) - 1.5 * mmPx) < 1.5 && Math.abs((y0 - y1) + 0.5 * mmPx) < 1.5, 'cut lines move against the measured offset');
  assert.equal(frameOf(movedCut), frameOf(plainCut), 'frame stays on the paper');
  const ptcPlain = exporter.sheetCutFile(offPlan, { ...defaultSheetSettings, paper: 'a4' }, 'data:image/png;base64,AA==').svg;
  const ptcMoved = exporter.sheetCutFile(offPlan, { ...defaultSheetSettings, paper: 'a4', offsetXMm: 1.5 }, 'data:image/png;base64,AA==').svg;
  assert.deepEqual(firstPoint(ptcMoved), firstPoint(ptcPlain), 'Print Then Cut file is not moved');

  // Alignment test: five pen crosses inside the cutting area, corrected like the cut file.
  const page = sheets.alignmentPage({ paper: 'a4', machine: 'maker', mat: 'm12x12' });
  assert.equal(page.marks.length, 5);
  assert.ok(page.marks.every((m) => m.x > 0 && m.x < page.limWMm && m.y > 0 && m.y < page.limHMm), 'marks lie inside the cutting area');
  assert.equal(sheets.alignmentPage({ paper: 'a4', machine: 'joy', mat: 'j45x65' }), null, 'no test when the paper does not fit the mat');
  const test0 = exporter.alignmentTestSvg({ ...defaultSheetSettings, paper: 'a4' });
  assert.match(test0.svg, /width="8\.2677in" height="11\.6929in"/);
  assert.match(test0.svg, /<g id="page-outline"/);
  const crossAt = (svg) => svg.match(/<g id="alignment-crosses"[^>]*>\s*<path d="M(-?[\d.]+),(-?[\d.]+)H/).slice(1).map(Number);
  const [tx, ty] = crossAt(test0.svg), tmm = 300 / 25.4;
  assert.ok(Math.abs(tx - (15 - 8) * tmm) < 0.05 && Math.abs(ty - 15 * tmm) < 0.05, 'first cross is centred on the first mark');
  const [cx2, cy2] = crossAt(exporter.alignmentTestSvg({ ...defaultSheetSettings, paper: 'a4', offsetXMm: 1, offsetYMm: 2 }).svg);
  assert.ok(Math.abs(tx - cx2 - tmm) < 0.05 && Math.abs(ty - cy2 - 2 * tmm) < 0.05, 'test crosses use the current correction');

  // Outer border on the sheet: blank paper stays transparent (white on the page), a coloured border keeps its colour.
  const bordered = (mode) => computeSticker(rect, { ...layoutCut, borderMode: mode, borderMm: 2, borderColor: '#3366cc' });
  const borderPixel = (result) => {
    const { res } = result, b = res.bbox, tw = b.x1 - b.x0, pixels = exporter.tilePixels(result);
    const y = Math.round((b.y1 - b.y0) / 2), x = 1; // left edge of the tile, inside the border
    assert.equal(res.printMask[(b.y0 + y) * res.width + b.x0 + x], 1);
    return Array.from(pixels.slice((y * tw + x) * 4, (y * tw + x) * 4 + 4));
  };
  assert.equal(borderPixel(bordered('paper'))[3], 0, 'blank paper border is transparent, not black');
  assert.deepEqual(borderPixel(bordered('color')), [51, 102, 204, 255], 'coloured border keeps the chosen colour');
  console.log('Sheet formats, grid, nesting, rotation, multi-motif, no-fit, mat tiling and export files OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
