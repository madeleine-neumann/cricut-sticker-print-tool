const SB = (() => {
  const INF = 1e12;

  /* ---------- small helpers ---------- */
  function gaussianBlur(src, w, h, sigma) {
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          const xx = Math.min(w - 1, Math.max(0, x + i));
          s += src[row + xx] * k[i + r];
        }
        tmp[row + x] = s;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          const yy = Math.min(h - 1, Math.max(0, y + i));
          s += tmp[yy * w + x] * k[i + r];
        }
        out[y * w + x] = s;
      }
    }
    return out;
  }

  /* Fill holes: pixels not reachable from the border through background (4-connected). */
  function fillHoles(mask, w, h) {
    const reach = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = (i) => { if (!mask[i] && !reach[i]) { reach[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i - x) / w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = reach[i] ? 0 : 1;
    return out;
  }

  /* Erode with a cross-shaped structuring element; outside the image counts as empty. */
  function erode(mask, w, h, iters) {
    let cur = mask;
    for (let n = 0; n < iters; n++) {
      const nxt = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (cur[i] && cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w]) nxt[i] = 1;
        }
      }
      cur = nxt;
    }
    return cur;
  }

  /* ---------- exact Euclidean distance transform with nearest-source index ---------- */
  function dt1d(f, n, d, arg, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
      arg[q] = v[k];
    }
  }

  /* source: Uint8Array, 1 = source pixel. Without wantIdx: returns {d2} = squared distance to the nearest
     source for every pixel. With wantIdx: returns {idx} = offset (y*w+x) of that nearest source pixel
     (smaller memory footprint, since distances are not kept). */
  function edt(source, w, h, wantIdx) {
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), arg = new Int32Array(n);
    const v = new Int32Array(n), z = new Float64Array(n + 1);
    const d1 = new Float32Array(w * h);
    const ny = wantIdx ? new Int32Array(w * h) : null;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = source[y * w + x] ? 0 : INF;
      dt1d(f, h, d, arg, v, z);
      for (let y = 0; y < h; y++) { d1[y * w + x] = d[y]; if (wantIdx) ny[y * w + x] = arg[y]; }
    }
    if (wantIdx) {
      const idx = ny; // reuse: rewrite each row's entries in place once its row is done
      const rowTmp = new Int32Array(w);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = d1[y * w + x];
        dt1d(f, w, d, arg, v, z);
        for (let x = 0; x < w; x++) { const nx = arg[x]; rowTmp[x] = ny[y * w + nx] * w + nx; }
        idx.set(rowTmp, y * w);
      }
      return { idx };
    }
    // reuse d1 for the output: each row is read fully before it is overwritten
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = d1[y * w + x];
      dt1d(f, w, d, arg, v, z);
      for (let x = 0; x < w; x++) d1[y * w + x] = d[x];
    }
    return { d2: d1 };
  }

  /* ---------- main bleed computation ---------- */
  /* rgba: Uint8ClampedArray/Uint8Array (w0*h0*4). opts:
     bleedPx, insetPx, borderPx, borderMode, borderColor, alphaThreshold, erodePx, smooth, fillHoles, bleedIntoHoles, whiteBg */
  function computeBleed(rgba, w0, h0, opts) {
    const bleed = Math.max(0, opts.bleedPx);
    const inset = Math.max(0, opts.insetPx || 0);
    const merge = Math.max(0, opts.mergePx || 0);
    const border = opts.borderMode === "paper" || opts.borderMode === "color" ? Math.max(0, opts.borderPx || 0) : 0;
    const pad = Math.ceil(Math.max(bleed + border, merge)) + 2;
    const W = w0 + 2 * pad, H = h0 + 2 * pad;
    if (W * H > (opts.maxPixels || 40e6)) throw new Error("Bild, Rand und Beschnitt benötigen mehr als " + Math.round((opts.maxPixels || 40e6) / 1e6) + " Megapixel. Verkleinere das Bild oder reduziere Rand und Beschnitt.");

    const rgbaP = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < h0; y++) {
      rgbaP.set(rgba.subarray(y * w0 * 4, (y + 1) * w0 * 4), ((y + pad) * W + pad) * 4);
    }

    let shape = new Uint8Array(W * H);
    const thr = opts.alphaThreshold;
    for (let i = 0; i < shape.length; i++) shape[i] = rgbaP[i * 4 + 3] >= thr ? 1 : 0;
    const opaque = shape.slice(); // pixels that really carry artwork (before any hole filling or smoothing)
    if (merge > 0) { // close gaps narrower than 2 x merge so nearby pieces become one shape
      const r2 = merge * merge;
      const near1 = edt(shape, W, H, false).d2;
      const grown = new Uint8Array(W * H);
      for (let i = 0; i < grown.length; i++) grown[i] = near1[i] <= r2 ? 1 : 0;
      const notGrown = new Uint8Array(W * H);
      for (let i = 0; i < notGrown.length; i++) notGrown[i] = grown[i] ? 0 : 1;
      const far = edt(notGrown, W, H, false).d2;
      for (let i = 0; i < shape.length; i++) if (!shape[i] && grown[i] && far[i] > r2) shape[i] = 1;
    }
    if (opts.fillHoles) shape = fillHoles(shape, W, H);
    if (opts.smooth > 0) {
      const f = new Float32Array(W * H);
      for (let i = 0; i < f.length; i++) f[i] = shape[i];
      const b = gaussianBlur(f, W, H, opts.smooth);
      for (let i = 0; i < shape.length; i++) shape[i] = b[i] >= 0.5 ? 1 : 0;
    }
    let any = false;
    for (let i = 0; i < shape.length; i++) if (shape[i]) { any = true; break; }
    if (!any) throw new Error("Keine Pixel liegen über der Deckkraft-Schwelle. Senke den Wert oder verwende ein Bild mit transparentem Hintergrund.");

    let cut = shape;
    if (inset > 0) {
      const bg = new Uint8Array(W * H);
      for (let i = 0; i < bg.length; i++) bg[i] = shape[i] ? 0 : 1;
      const { d2 } = edt(bg, W, H, false);
      cut = new Uint8Array(W * H);
      const t = inset * inset;
      let anyCut = false;
      for (let i = 0; i < cut.length; i++) { if (shape[i] && d2[i] > t) { cut[i] = 1; anyCut = true; } }
      if (!anyCut) throw new Error("Die Schnittlinie ist zu weit nach innen versetzt. Verringere den Wert.");
    }

    if (border > 0) {
      const distance = edt(cut, W, H, false).d2;
      const expanded = new Uint8Array(W * H);
      for (let i = 0; i < expanded.length; i++) expanded[i] = distance[i] <= border * border ? 1 : 0;
      cut = expanded;
    }

    const dOut = edt(cut, W, H, false).d2;
    const bleedRegion = new Uint8Array(W * H);
    const b2 = bleed * bleed;
    for (let i = 0; i < bleedRegion.length; i++) bleedRegion[i] = dOut[i] <= b2 ? 1 : 0;

    if (!opts.bleedIntoHoles && !opts.fillHoles) {
      const outer = fillHoles(shape, W, H);
      for (let i = 0; i < bleedRegion.length; i++) if (outer[i] && !shape[i]) bleedRegion[i] = 0;
    }

    /* Colour source: only solid pixels. Anti-aliased edge pixels often carry a washed-out colour (artwork blended with white),
       and copying it outwards or printing it as-is is what leaves a pale ring along the edge. */
    const solid = new Uint8Array(W * H);
    let nSolid = 0;
    for (let i = 0; i < solid.length; i++) if (opaque[i] && rgbaP[i * 4 + 3] >= 250) { solid[i] = 1; nSolid++; }
    const base = nSolid > 0 ? solid : opaque;
    let source = base;
    if (opts.erodePx > 0) {
      const e = erode(base, W, H, opts.erodePx);
      let ok = false;
      for (let i = 0; i < e.length; i++) if (e[i]) { ok = true; break; }
      if (ok) source = e;
    }
    const near = edt(source, W, H, true);
    // edge pixels: opaque pixels right at the outer edge that are not solid, and thin slivers added by smoothing
    const outerOpaque = fillHoles(opaque, W, H);
    const notOpaque = new Uint8Array(W * H);
    for (let i = 0; i < notOpaque.length; i++) notOpaque[i] = opaque[i] ? 0 : 1;
    const dEdge = edt(notOpaque, W, H, false).d2;       // distance from an opaque pixel to the nearest non-opaque one
    const dArt = edt(opaque, W, H, false).d2;           // distance from a non-opaque pixel to the nearest artwork pixel
    const nearD2 = (i) => { const s = near.idx[i], dx = (i % W) - (s % W), dy = ((i / W) | 0) - ((s / W) | 0); return dx * dx + dy * dy; };
    const fringe2 = 2.5 * 2.5, sliver = merge > 0 ? 1.5 : (opts.smooth || 0) + 1.5, sliver2 = sliver * sliver;

    const out = new Uint8ClampedArray(W * H * 4);
    const color = /^#[0-9a-f]{6}$/i.test(opts.borderColor || "")
      ? [1, 3, 5].map((n) => parseInt(opts.borderColor.slice(n, n + 2), 16))
      : [255, 255, 255];
    for (let i = 0; i < shape.length; i++) {
      const o = i * 4;
      if (shape[i] && opaque[i]) {
        if (!solid[i] && nSolid > 0 && dEdge[i] <= fringe2 && nearD2(i) <= 9) { const s = near.idx[i] * 4; out[o] = rgbaP[s]; out[o + 1] = rgbaP[s + 1]; out[o + 2] = rgbaP[s + 2]; }
        else { out[o] = rgbaP[o]; out[o + 1] = rgbaP[o + 1]; out[o + 2] = rgbaP[o + 2]; }
        out[o + 3] = 255;
      } else if (shape[i] && outerOpaque[i] === opaque[i] && dArt[i] <= sliver2) { // thin sliver along the edge: take the artwork colour, not white
        const s = near.idx[i] * 4;
        out[o] = rgbaP[s]; out[o + 1] = rgbaP[s + 1]; out[o + 2] = rgbaP[s + 2]; out[o + 3] = 255;
      } else if (shape[i]) { // a filled hole or merged gap: solid white, like the paper the sticker is printed on
        out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255;
      } else if (border > 0 && bleedRegion[i]) {
        if (opts.borderMode === "color") {
          out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2]; out[o + 3] = 255;
        }
      } else if (bleedRegion[i]) { // bleed: the nearest artwork color
        const s = near.idx[i] * 4;
        out[o] = rgbaP[s]; out[o + 1] = rgbaP[s + 1]; out[o + 2] = rgbaP[s + 2]; out[o + 3] = 255;
      } else if (opts.whiteBg) {
        out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255;
      }
    }
    if (opts.whiteBg) {
      for (let i = 0; i < shape.length; i++) {
        const o = i * 4;
        if (!shape[i] && !bleedRegion[i]) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; }
      }
    }
    for (let i = 0; i < bleedRegion.length; i++) if (shape[i]) bleedRegion[i] = 1; // bleedRegion now = everything that prints
    // bounding box of everything that prints (artwork + bleed), end coordinates exclusive
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (bleedRegion[row + x]) {
          if (x < bx0) bx0 = x; if (x + 1 > bx1) bx1 = x + 1;
          if (y < by0) by0 = y; if (y + 1 > by1) by1 = y + 1;
        }
      }
    }
    return { rgba: out, width: W, height: H, pad, cut, shape, printMask: bleedRegion, bleedPx: bleed, bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 } };
  }

  /* ---------- cut path: marching squares on a lightly blurred mask ---------- */

  function traceContours(mask, w, h, sigma) {
    const f0 = new Float32Array(w * h);
    for (let i = 0; i < f0.length; i++) f0[i] = mask[i];
    const f = sigma > 0 ? gaussianBlur(f0, w, h, sigma) : f0;
    const T = 0.5;
    const hKey = (x, y) => y * w + x;                 // edge between (x,y) and (x+1,y)
    const vKey = (x, y) => w * h + y * w + x;         // edge between (x,y) and (x,y+1)
    const nbr = new Map();
    const link = (a, b) => {
      let la = nbr.get(a); if (!la) { la = []; nbr.set(a, la); } la.push(b);
      let lb = nbr.get(b); if (!lb) { lb = []; nbr.set(b, lb); } lb.push(a);
    };
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const tl = f[y * w + x], tr = f[y * w + x + 1], bl = f[(y + 1) * w + x], br = f[(y + 1) * w + x + 1];
        let c = 0;
        if (tl >= T) c |= 8; if (tr >= T) c |= 4; if (br >= T) c |= 2; if (bl >= T) c |= 1;
        if (c === 0 || c === 15) continue;
        const top = hKey(x, y), bottom = hKey(x, y + 1), left = vKey(x, y), right = vKey(x + 1, y);
        switch (c) {
          case 1: case 14: link(left, bottom); break;
          case 2: case 13: link(bottom, right); break;
          case 3: case 12: link(left, right); break;
          case 4: case 11: link(top, right); break;
          case 6: case 9: link(top, bottom); break;
          case 7: case 8: link(left, top); break;
          case 5: case 10: {
            const center = (tl + tr + bl + br) / 4 >= T;
            if (c === 5) { // tr and bl inside
              if (center) { link(left, top); link(bottom, right); } else { link(left, bottom); link(top, right); }
            } else {       // tl and br inside
              if (center) { link(left, bottom); link(top, right); } else { link(left, top); link(bottom, right); }
            }
            break;
          }
        }
      }
    }
    const pos = (key) => {
      if (key >= w * h) {
        const k = key - w * h, y = Math.floor(k / w), x = k - y * w;
        const a = f[y * w + x], b = f[(y + 1) * w + x];
        const t = (T - a) / (b - a);
        return [x + 0.5, y + t + 0.5];
      }
      const y = Math.floor(key / w), x = key - y * w;
      const a = f[y * w + x], b = f[y * w + x + 1];
      const t = (T - a) / (b - a);
      return [x + t + 0.5, y + 0.5];
    };
    const visited = new Set();
    const loops = [];
    for (const start of nbr.keys()) {
      if (visited.has(start)) continue;
      const keys = [];
      let prev = -1, cur = start;
      while (true) {
        visited.add(cur); keys.push(cur);
        const ns = nbr.get(cur);
        let next = ns[0] !== prev && !visited.has(ns[0]) ? ns[0] : (ns[1] !== prev && !visited.has(ns[1]) ? ns[1] : -1);
        if (next === -1) break;
        prev = cur; cur = next;
      }
      if (keys.length >= 3) loops.push(keys.map(pos));
    }
    return loops;
  }

  function polyArea(p) {
    let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] * p[i][1]) - (p[i][0] * p[j][1]);
    return a / 2;
  }

  function perpDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
  }

  function simplifyOpen(pts, eps) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let dmax = 0, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = perpDist(pts[i], pts[s], pts[e]);
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > eps && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  function simplifyClosed(pts, eps) {
    if (pts.length < 4 || eps <= 0) return pts;
    // split at the point farthest from point 0 so both halves are well conditioned
    let far = 0, dm = -1;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
      if (d > dm) { dm = d; far = i; }
    }
    const a = simplifyOpen(pts.slice(0, far + 1), eps);
    const b = simplifyOpen(pts.slice(far).concat([pts[0]]), eps);
    return a.concat(b.slice(1, -1));
  }

  /* Returns loops (arrays of [x,y]) in canvas pixel coordinates of the padded output. */
  function cutPath(cutMask, w, h, opts) {
    const eps = opts && opts.simplify != null ? opts.simplify : 0.35;
    const minArea = opts && opts.minArea != null ? opts.minArea : 4;
    const loops = traceContours(cutMask, w, h, opts && opts.blur != null ? opts.blur : 0.8);
    const out = [];
    for (const l of loops) {
      if (Math.abs(polyArea(l)) < minArea) continue;
      const s = simplifyClosed(l, eps);
      if (s.length >= 3) out.push(s);
    }
    return out;
  }

  function pathData(loops, decimals) {
    const d = decimals == null ? 2 : decimals;
    return loops.map((l) => "M" + l.map((p) => p[0].toFixed(d) + "," + p[1].toFixed(d)).join("L") + "Z").join("");
  }

  /* Cut path SVG at true physical size: viewBox is in pixels, width/height in inches. */
  function cutSvg(loops, w, h, dpi, extra) {
    const wi = (w / dpi).toFixed(4), hi = (h / dpi).toFixed(4);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + wi + 'in" height="' + hi + 'in" viewBox="0 0 ' + w + " " + h + '">\n' +
      (extra || "") +
      '  <path id="cut" d="' + pathData(loops) + '" fill="none" stroke="#ff0000" stroke-width="1" fill-rule="evenodd"/>\n</svg>\n';
  }

  /* ---------- artwork measurement ---------- */
  /* bounding box of pixels with alpha >= threshold in an unpadded RGBA image; null when empty */
  function alphaBBox(rgba, w, h, threshold) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4 + 3;
      for (let x = 0; x < w; x++) {
        if (rgba[row + x * 4] >= threshold) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x0, y0, x1: x1 + 1, y1: y1 + 1, w: x1 + 1 - x0, h: y1 + 1 - y0 };
  }

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

  /* ---------- PDF (one page, one RGB image) ---------- */

  async function deflate(bytes) {
    const cs = new CompressionStream("deflate");
    const wr = cs.writable.getWriter();
    wr.write(bytes); wr.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  /* rgba: opaque RGBA pixels (w*h*4). Page size in points. Returns Uint8Array of the PDF file. */
  async function pdfFromRgba(rgba, w, h, ptW, ptH) {
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
    const z = await deflate(rgb);
    const enc = new TextEncoder();
    const chunks = []; let off = 0; const offsets = [];
    const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); off += b.length; };
    const pw = ptW.toFixed(2), ph = ptH.toFixed(2);
    push("%PDF-1.4\n");
    offsets[1] = off; push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offsets[2] = off; push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    offsets[3] = off; push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n");
    offsets[4] = off; push("4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + w + " /Height " + h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length " + z.length + " >>\nstream\n");
    push(z); push("\nendstream\nendobj\n");
    const content = "q " + pw + " 0 0 " + ph + " 0 0 cm /Im0 Do Q\n";
    offsets[5] = off; push("5 0 obj\n<< /Length " + content.length + " >>\nstream\n" + content + "endstream\nendobj\n");
    const xref = off;
    let x = "xref\n0 6\n0000000000 65535 f \n";
    for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    push(x + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    const out = new Uint8Array(off); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /* ---------- PNG metadata ---------- */
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* Insert a pHYs chunk (pixels per metre) right after IHDR. */
  function pngSetDpi(buf, dpi) {
    const u8 = new Uint8Array(buf);
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + length + type + data + crc
    // drop an existing pHYs if present
    const parts = [u8.subarray(0, ihdrEnd), chunk];
    let p = ihdrEnd;
    const src = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    while (p + 8 <= u8.length) {
      const len = src.getUint32(p);
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      const end = p + 12 + len;
      if (type !== "pHYs") parts.push(u8.subarray(p, end));
      p = end;
    }
    let total = 0; for (const a of parts) total += a.length;
    const out = new Uint8Array(total);
    let o = 0; for (const a of parts) { out.set(a, o); o += a.length; }
    return out;
  }

  /* Read DPI from a PNG pHYs chunk; returns null when absent. */
  function pngReadDpi(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length < 33 || u8[1] !== 0x50 || u8[2] !== 0x4e || u8[3] !== 0x47) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let p = 8;
    while (p + 8 <= u8.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (type === "pHYs" && u8[p + 16] === 1) {
        const ppm = dv.getUint32(p + 8);
        if (ppm > 0) return Math.round(ppm * 0.0254 * 100) / 100;
      }
      if (type === "IDAT" || type === "IEND") break;
      p += 12 + len;
    }
    return null;
  }

  return { computeBleed, cutPath, pathData, cutSvg, pngSetDpi, pngReadDpi, edt, fillHoles, erode, gaussianBlur, polyArea,
           alphaBBox, layoutSheet, sheetGeometry, sheetGeometryMulti, sheetSvg, pdfFromRgba, PAPER, nestGen, nestRun, anglesFor };

})();
