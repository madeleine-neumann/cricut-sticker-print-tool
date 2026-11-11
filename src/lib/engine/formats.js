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

export { pngSetDpi, pngReadDpi, pdfFromRgba };
