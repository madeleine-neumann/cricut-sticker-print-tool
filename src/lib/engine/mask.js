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

export { computeBleed, edt, fillHoles, erode, gaussianBlur };
