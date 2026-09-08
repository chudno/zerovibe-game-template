// Минимальный разбор TrueType без зависимостей: таблицы head (unitsPerEm),
// hhea/hmtx (ширины), cmap формата 4 (символ → глиф), name (записи),
// loca/glyf (контуры простых глифов). Из него tests/fontgen.js растрирует
// пиксельный шрифт в game/fontdata.js, а тест сверяет, что данные в
// репозитории совпадают с файлом шрифта.
"use strict";

function parseTTF(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = dv.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    tables[tag] = { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
  }
  const head = tables.head, hhea = tables.hhea, hmtx = tables.hmtx, cmap = tables.cmap, maxp = tables.maxp;
  const unitsPerEm = dv.getUint16(head.offset + 18);
  const numGlyphs = dv.getUint16(maxp.offset + 4);
  const numHMetrics = dv.getUint16(hhea.offset + 34);
  const advance = (gid) => dv.getUint16(hmtx.offset + Math.min(gid, numHMetrics - 1) * 4);

  // cmap: берём подтаблицу формата 4 (BMP).
  const n = dv.getUint16(cmap.offset + 2);
  let sub = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmap.offset + 4 + i * 8;
    const off = dv.getUint32(rec + 4);
    if (dv.getUint16(cmap.offset + off) === 4) { sub = cmap.offset + off; break; }
  }
  if (sub < 0) throw new Error("нет cmap формата 4");
  const segX2 = dv.getUint16(sub + 6), seg = segX2 / 2;
  const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  const map = new Map();
  for (let s = 0; s < seg; s++) {
    const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2);
    const delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ranges + s * 2);
    if (start === 0xFFFF) continue;
    for (let c = start; c <= end; c++) {
      let gid;
      if (ro === 0) gid = (c + delta) & 0xFFFF;
      else {
        const addr = ranges + s * 2 + ro + (c - start) * 2;
        gid = dv.getUint16(addr);
        if (gid !== 0) gid = (gid + delta) & 0xFFFF;
      }
      if (gid) map.set(c, gid);
    }
  }
  const names = [];
  if (tables.name) {
    const nt = tables.name.offset, count = dv.getUint16(nt + 2), strOff = dv.getUint16(nt + 4);
    for (let i = 0; i < count; i++) {
      const r = nt + 6 + i * 12;
      const platform = dv.getUint16(r), nameID = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10);
      const bytes = buf.subarray(nt + strOff + off, nt + strOff + off + len);
      const text = platform === 3 ? Buffer.from(bytes).swap16().toString("utf16le") : Buffer.from(bytes).toString("latin1");
      names.push({ platform, nameID, text });
    }
  }
  // loca/glyf: контуры простого глифа (составные и кривые здесь не нужны —
  // у пиксельного шрифта их нет; на всякий случай кривые отвергаются).
  const indexToLocFormat = dv.getInt16(head.offset + 50);
  const loca = tables.loca, glyf = tables.glyf;
  function glyphOffset(gid) {
    return indexToLocFormat === 0 ? dv.getUint16(loca.offset + gid * 2) * 2 : dv.getUint32(loca.offset + gid * 4);
  }
  function contours(gid) {
    const start = glyphOffset(gid), end = glyphOffset(gid + 1);
    if (end <= start) return { empty: true, contours: [] };
    let p = glyf.offset + start;
    const nContours = dv.getInt16(p);
    if (nContours < 0) throw new Error(`глиф ${gid} составной`);
    const xMin = dv.getInt16(p + 2), yMin = dv.getInt16(p + 4), xMax = dv.getInt16(p + 6), yMax = dv.getInt16(p + 8);
    p += 10;
    const ends = [];
    for (let i = 0; i < nContours; i++) { ends.push(dv.getUint16(p)); p += 2; }
    const nPts = nContours ? ends[nContours - 1] + 1 : 0;
    const instrLen = dv.getUint16(p); p += 2 + instrLen;
    const flags = [];
    while (flags.length < nPts) {
      const f = buf[p++]; flags.push(f);
      if (f & 8) { let r = buf[p++]; while (r-- > 0) flags.push(f); }
    }
    const xs = [], ys = [];
    let v = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 2) { const d = buf[p++]; v += (f & 16) ? d : -d; } else if (!(f & 16)) { v += dv.getInt16(p); p += 2; }
      xs.push(v);
    }
    v = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 4) { const d = buf[p++]; v += (f & 32) ? d : -d; } else if (!(f & 32)) { v += dv.getInt16(p); p += 2; }
      ys.push(v);
    }
    const out = [];
    let s = 0;
    for (let c = 0; c < nContours; c++) {
      const pts = [];
      for (let i = s; i <= ends[c]; i++) {
        if (!(flags[i] & 1)) throw new Error(`глиф ${gid}: точка вне контура (кривая)`);
        pts.push([xs[i], ys[i]]);
      }
      out.push(pts);
      s = ends[c] + 1;
    }
    return { empty: false, xMin, yMin, xMax, yMax, contours: out };
  }

  return { tables: Object.keys(tables), unitsPerEm, numGlyphs, cmap: map, advance, names, contours };
}

// Растр прямоугольного глифа на сетке: unit — размер пикселя в единицах
// шрифта; закраска по ненулевому индексу обхода в центре пикселя.
function rasterize(glyph, unit) {
  if (glyph.empty) return null;
  const x0 = Math.floor(glyph.xMin / unit), x1 = Math.ceil(glyph.xMax / unit);
  const y0 = Math.floor(glyph.yMin / unit), y1 = Math.ceil(glyph.yMax / unit);
  const w = x1 - x0, h = y1 - y0;
  const rows = [];
  for (let row = 0; row < h; row++) {
    const py = (y1 - row - 0.5) * unit;   // сверху вниз
    let bits = "";
    for (let col = 0; col < w; col++) {
      const px = (x0 + col + 0.5) * unit;
      let wind = 0;
      for (const pts of glyph.contours) {
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
          if (ay === by) continue;                        // горизонтальное ребро не пересекает луч
          if ((ay > py) === (by > py)) continue;          // ребро не накрывает py
          const ix = ax + (py - ay) * (bx - ax) / (by - ay);
          if (ix > px) wind += by > ay ? 1 : -1;
        }
      }
      bits += wind !== 0 ? "1" : "0";
    }
    rows.push(bits);
  }
  return { x: x0, top: y1, w, h, rows };
}

module.exports = { parseTTF, rasterize };
