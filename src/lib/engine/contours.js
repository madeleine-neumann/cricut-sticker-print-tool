import { gaussianBlur } from './mask.js';

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

export { cutPath, pathData, cutSvg, polyArea, alphaBBox };
