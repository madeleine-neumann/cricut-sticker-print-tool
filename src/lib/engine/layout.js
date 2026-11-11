import { edt } from './mask.js';
import { pathData } from './contours.js';

  /* ---------- sheet layout ---------- */
  /* w, h: paper size (mm, portrait). limW, limH: the largest design a Cricut mat takes on that paper (mm, portrait),
   used to keep the cut layout inside the mat. 12 in mats take 11.5 in (292 mm); the Joy Xtra mat takes 8.25 x 11.75 in. */
  const PAPER = {
    letter: { name: "Letter", slug: "letter", w: 215.9, h: 279.4, limW: 215.9, limH: 279.4 },
    a4: { name: "A4", slug: "a4", w: 210, h: 297, limW: 210, limH: 292 },
    s9x12: { name: "9 × 12 in", slug: "9x12", w: 228.6, h: 304.8, limW: 228.6, limH: 292 },
    s12x12: { name: "12 × 12 in", slug: "12x12", w: 304.8, h: 304.8, limW: 292, limH: 292 },
    joyxtra: { name: "Cricut Joy Xtra Matte", slug: "joy-xtra-mat", w: 215.9, h: 304.8, limW: 209.55, limH: 298.45 },
    joy2: { name: "Cricut Joy 2 Matte", slug: "joy2-mat", w: 114.3, h: 165.1, limW: 107.95, limH: 158.75, up: true },
    joy2long: { name: "Cricut Joy 2 lange Matte", slug: "joy2-long-mat", w: 114.3, h: 304.8, limW: 107.95, limH: 298.45, up: true },
  };

  function gridFor(pw, ph, margin, gap, cw, ch) {
    const uw = pw - 2 * margin, uh = ph - 2 * margin;
    if (uw <= 0 || uh <= 0 || cw <= 0 || ch <= 0) return { cols: 0, rows: 0 };
    return {
      cols: Math.max(0, Math.floor((uw + gap) / (cw + gap) + 1e-9)),
      rows: Math.max(0, Math.floor((uh + gap) / (ch + gap) + 1e-9)),
    };
  }

  /* o: {paper:'letter'|'a4', orientation:'auto'|'portrait'|'landscape', marginMm, gapMm, cellWMm, cellHMm, copies}
     Returns layout in millimetres. Grid is centred horizontally and starts at the top margin. */
  function layoutSheet(o) {
    const p = PAPER[o.paper] || PAPER.letter;
    const opts = [];
    if (o.orientation !== "landscape") opts.push({ orientation: "portrait", pw: p.w, ph: p.h });
    if (o.orientation !== "portrait") opts.push({ orientation: "landscape", pw: p.h, ph: p.w });
    let best = null;
    for (const c of opts) {
      const port = c.orientation === "portrait";
      const lw = o.fitMat ? Math.min(c.pw, port ? p.limW : p.limH) : c.pw;
      const lh = o.fitMat ? Math.min(c.ph, port ? p.limH : p.limW) : c.ph;
      const g = gridFor(lw, lh, o.marginMm, o.gapMm, o.cellWMm, o.cellHMm);
      const cap = g.cols * g.rows;
      if (!best || cap > best.capacity) best = { ...c, lw, lh, cols: g.cols, rows: g.rows, capacity: cap };
    }
    const want = o.copies > 0 ? Math.floor(o.copies) : best.capacity;
    const count = Math.min(want, best.capacity);
    const colsUsed = Math.max(1, Math.min(best.cols, count));
    const positions = [];
    const uw = best.lw - 2 * o.marginMm;
    const blockW = colsUsed * o.cellWMm + (colsUsed - 1) * o.gapMm;
    const x0 = o.marginMm + (uw - blockW) / 2;
    for (let i = 0; i < count; i++) {
      const c = i % colsUsed, r = Math.floor(i / colsUsed);
      positions.push({ cxMm: x0 + c * (o.cellWMm + o.gapMm) + o.cellWMm / 2, cyMm: o.marginMm + r * (o.cellHMm + o.gapMm) + o.cellHMm / 2, angle: 0 });
    }
    return {
      orientation: best.orientation, pageWMm: best.pw, pageHMm: best.ph, limWMm: best.lw, limHMm: best.lh, paperName: p.name, paperSlug: p.slug,
      cols: colsUsed, rows: count ? Math.ceil(count / colsUsed) : 0, capacity: best.capacity, count,
      capped: o.copies > 0 && o.copies > best.capacity, fits: best.capacity > 0, placements: positions, nested: false,
    };
  }

  /* Turn a layout into pixel geometry for a sheet raster at `sheetDpi`.
     items: one entry per sticker design: {tile:{x0,y0,w,h}, dpi, loops}, where tile is the crop of that
     sticker's result canvas (result pixels), dpi its effective resolution and loops its cut loops in
     result pixel coordinates. Each placement is a tile centre (mm), a clockwise angle in degrees and an
     optional item index (default 0); its bounding box is snapped to whole sheet pixels so unrotated
     tiles stay crisp. */
  function sheetGeometryMulti(layout, items, sheetDpi) {
    const pageW = Math.round(layout.pageWMm / 25.4 * sheetDpi), pageH = Math.round(layout.pageHMm / 25.4 * sheetDpi);
    const tiles = [], paths = [];
    for (const p of layout.placements) {
      const ii = p.item || 0, it = items[ii], tile = it.tile, k = sheetDpi / it.dpi;
      const tw = tile.w * k, th = tile.h * k;
      const a = (p.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const bw = Math.abs(tw * c) + Math.abs(th * s), bh = Math.abs(tw * s) + Math.abs(th * c);
      const cx = Math.round(p.cxMm / 25.4 * sheetDpi - bw / 2) + bw / 2;
      const cy = Math.round(p.cyMm / 25.4 * sheetDpi - bh / 2) + bh / 2;
      tiles.push({ cx, cy, angle: a, item: ii, k, tw, th });
      const moved = it.loops.map((l) => l.map((pt) => {
        const dx = (pt[0] - tile.x0) * k - tw / 2, dy = (pt[1] - tile.y0) * k - th / 2;
        return [cx + dx * c - dy * s, cy + dx * s + dy * c];
      }));
      paths.push(pathData(moved, 2));
    }
    const k0 = items[0] ? sheetDpi / items[0].dpi : 1;
    return { k: k0, pageW, pageH, tiles, paths, tileW: items[0] ? items[0].tile.w * k0 : 0, tileH: items[0] ? items[0].tile.h * k0 : 0 };
  }

  /* One-design convenience wrapper. */
  function sheetGeometry(layout, tile, stickerDpi, sheetDpi, loops) {
    return sheetGeometryMulti(layout, [{ tile, dpi: stickerDpi, loops }], sheetDpi);
  }

  /* The sheet as an SVG at true paper size (width/height in inches, viewBox in sheet pixels).
     imageHref: optional data URL of the print layer. opts.outline: add a rectangle the size of the whole
     page, on its own layer, so software that crops to the artwork (Cricut Design Space and similar)
     keeps the paper's position and size. */
  function sheetSvg(geo, sheetDpi, imageHref, opts) {
    const wi = (geo.pageW / sheetDpi).toFixed(4), hi = (geo.pageH / sheetDpi).toFixed(4);
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + wi + 'in" height="' + hi + 'in" viewBox="0 0 ' + geo.pageW + " " + geo.pageH + '">\n';
    if (imageHref) s += '  <image id="print" x="0" y="0" width="' + geo.pageW + '" height="' + geo.pageH + '" href="' + imageHref + '" xlink:href="' + imageHref + '"/>\n';
    if (opts && opts.outline) {
      s += '  <g id="page-outline" fill="none" stroke="#000000" stroke-width="1">\n' +
           '    <rect x="0" y="0" width="' + geo.pageW + '" height="' + geo.pageH + '"/>\n  </g>\n';
    }
    s += '  <g id="cut" fill="none" stroke="#ff0000" stroke-width="1" fill-rule="evenodd">\n';
    geo.paths.forEach((d, i) => { s += '    <path id="cut-' + (i + 1) + '" d="' + d + '"/>\n'; });
    s += "  </g>\n</svg>\n";
    return s;
  }

  /* ---------- nesting: raster first-fit packing of the real printed outline ---------- */
  function anglesFor(mode) {
    const step = { none: 360, "180": 180, "90": 90, "45": 45, "15": 15 }[mode] || 90;
    const out = [];
    for (let a = 0; a < 360; a += step) out.push(a);
    return out;
  }

  /* o: {pageWMm, pageHMm, marginMm, gapMm, angles, cellMm, crit, maxTotal,
         items: [{foot, tileWMm, tileHMm, want}]}   (or, for one sticker: foot, tileWMm, tileHMm, want directly)
     foot = {mask, w, h, spMm}: the printed outline of one tile, hole-filled, sampled every spMm.
     want > 0 places exactly that many copies (as many as fit); want 0 means "fill the rest of the page".
     Big stickers go first, then fill stickers take turns until nothing more fits.
     Generator: yields {placed} after every sticker so callers can stay responsive; returns
     {placements:[{cxMm,cyMm,angle,item}], count, perItem}.
     Each footprint is grown by half the gap (circular), so printed edges stay at least `gapMm` apart. */
  function* nestGen(o) {
    const items = o.items || [{ foot: o.foot, tileWMm: o.tileWMm, tileHMm: o.tileHMm, want: o.want }];
    const cs = o.cellMm || 0.5;
    const r = Math.ceil((o.gapMm / 2 + cs * 0.5) / cs);
    const gw = Math.floor((o.pageWMm - 2 * o.marginMm) / cs) + 2 * r;
    const gh = Math.floor((o.pageHMm - 2 * o.marginMm) / cs) + 2 * r;
    const none = () => ({ placements: [], count: 0, perItem: items.map(() => 0) });
    if (gw <= 2 * r || gh <= 2 * r) return none();
    const gx0 = o.marginMm - r * cs, gy0 = o.marginMm - r * cs;
    const gnw = ((gw + 31) >> 5) + 2;
    const occ = new Uint32Array(gh * gnw);

    const buildRots = (it) => {
      const { mask, w: fw, h: fh, spMm } = it.foot;
      const px = [];
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
        if (mask[j * fw + i]) px.push((i + 0.5) * spMm - it.tileWMm / 2, (j + 0.5) * spMm - it.tileHMm / 2);
      }
      const hs = spMm / 2;
      const offs = [0, 0, -hs, -hs, hs, -hs, hs, hs, -hs, hs];
      const rots = [];
      for (const angle of o.angles) {
        const th = angle * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const rp = new Float32Array(px.length * 5);
        let n = 0;
        for (let q = 0; q < px.length; q += 2) {
          for (let t = 0; t < 10; t += 2) {
            const ux = px[q] + offs[t], uy = px[q + 1] + offs[t + 1];
            const rx = ux * c - uy * s, ry = ux * s + uy * c;
            rp[n++] = rx; rp[n++] = ry;
            if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
            if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
          }
        }
        const Wc = Math.ceil((maxX - minX) / cs) + 1 + 2 * r, Hc = Math.ceil((maxY - minY) / cs) + 1 + 2 * r;
        if (Wc > gw || Hc > gh) continue; // this rotation cannot fit on the page at all
        const base = new Uint8Array(Wc * Hc);
        for (let q = 0; q < n; q += 2) {
          const ix = Math.floor((rp[q] - minX) / cs) + r, iy = Math.floor((rp[q + 1] - minY) / cs) + r;
          base[iy * Wc + ix] = 1;
        }
        const d2 = edt(base, Wc, Hc, false).d2;
        const nwa = ((Wc + 31) >> 5) + 1;
        const shifts = [];
        for (let sft = 0; sft < 32; sft++) {
          const arr = new Uint32Array(Hc * nwa);
          for (let y = 0; y < Hc; y++) {
            for (let x = 0; x < Wc; x++) {
              if (d2[y * Wc + x] <= r * r) { const bit = x + sft; arr[y * nwa + (bit >> 5)] |= (1 << (bit & 31)); }
            }
          }
          shifts.push(arr);
        }
        // cy/cx: scan cursor. The page only ever gets fuller, so spots that failed once keep failing.
        rots.push({ angle, w: Wc, h: Hc, nwa, shifts, ax: -minX / cs + r, ay: -minY / cs + r, cy: 0, cx: 0, dead: false });
      }
      return rots;
    };

    const prep = items.map((it, idx) => ({
      idx, want: it.want > 0 ? Math.floor(it.want) : 0, rots: buildRots(it), placed: 0, done: false,
      area: (it.tileWMm || 0) * (it.tileHMm || 0),
    }));
    for (const P of prep) if (!P.rots.length) P.done = true;
    if (prep.every((P) => P.done)) return none();

    const fits = (R, x, y) => {
      const wx = x >> 5, sh = R.shifts[x & 31], nwa = R.nwa;
      for (let rr = 0; rr < R.h; rr++) {
        const ob = (y + rr) * gnw + wx, fb = rr * nwa;
        for (let k = 0; k < nwa; k++) if (occ[ob + k] & sh[fb + k]) return false;
      }
      return true;
    };

    const crit = o.crit || "bottom";
    // Find the best spot for one more copy of P; stamp it; return the placement (or null when none fits).
    const place = (P) => {
      let best = null;
      for (const R of P.rots) {
        if (R.dead) continue;
        const maxY = gh - R.h, maxX = gw - R.w;
        let y = R.cy, hit = false;
        for (; y <= maxY; y++) {
          // crit "bottom": minimise the lower edge; crit "top": minimise the upper edge
          const edge = crit === "top" ? y : y + R.h;
          if (best && edge > best.bottom) break;
          let found = -1;
          for (let x = (y === R.cy ? R.cx : 0); x <= maxX; x++) if (fits(R, x, y)) { found = x; break; }
          if (found >= 0) {
            R.cy = y; R.cx = found; hit = true;
            if (!best || edge < best.bottom || (edge === best.bottom && found < best.x)) best = { R, x: found, y, bottom: edge };
            break;
          }
        }
        if (!hit) {
          if (y > maxY) R.dead = true;                 // scanned the whole page: this rotation never fits again
          else if (y > R.cy) { R.cy = y; R.cx = 0; }   // pruned early: rows above y are known to be blocked
        }
      }
      if (!best) { P.done = true; return null; }
      const R = best.R, wx = best.x >> 5, sh = R.shifts[best.x & 31];
      for (let rr = 0; rr < R.h; rr++) {
        const ob = (best.y + rr) * gnw + wx, fb = rr * R.nwa;
        for (let k = 0; k < R.nwa; k++) occ[ob + k] |= sh[fb + k];
      }
      P.placed++;
      return { cxMm: gx0 + (best.x + R.ax) * cs, cyMm: gy0 + (best.y + R.ay) * cs, angle: R.angle, item: P.idx };
    };

    const placements = [];
    const maxTotal = o.maxTotal || 500;
    const bySize = prep.slice().sort((a, b) => b.area - a.area);
    for (const P of bySize.filter((p) => p.want > 0)) {
      while (!P.done && P.placed < P.want && placements.length < maxTotal) {
        const pl = place(P); if (!pl) break;
        placements.push(pl); yield { placed: placements.length };
      }
    }
    let fill = bySize.filter((p) => p.want === 0 && !p.done);
    while (fill.length && placements.length < maxTotal) {
      for (const P of fill) {
        if (placements.length >= maxTotal) break;
        const pl = place(P);
        if (pl) { placements.push(pl); yield { placed: placements.length }; }
      }
      fill = fill.filter((p) => !p.done);
    }
    return { placements, count: placements.length, perItem: prep.map((P) => P.placed) };
  }

  function nestRun(o) {
    const g = nestGen(o); let st;
    while (!(st = g.next()).done) { /* drain */ }
    return st.value;
  }

export { layoutSheet, sheetGeometry, sheetGeometryMulti, sheetSvg, PAPER, nestGen, nestRun, anglesFor };
