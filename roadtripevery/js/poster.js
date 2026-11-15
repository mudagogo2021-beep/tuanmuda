/* Road Trip Every – free PNG poster renderer (2D canvas, offline basemap from Natural Earth). */
'use strict';
window.RTEPoster = (() => {
  const C = { bg: '#0b0e14', sea: '#080b12', land: '#242832', landMain: '#2c313d', edge: 'rgba(168,176,190,.75)', state: 'rgba(168,176,190,.35)',
    route: '#ffb020', core: '#ffe8aa', dot: '#ffb020', start: '#5eead4', text: '#f5f4f0', muted: '#babec6', grid: '#141924' };
  const URL = 'mudagogo2021-beep.github.io/tuanmuda';
  const merc = (lat, lng) => [lng * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360))];

  function bboxOf(list) { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, y] of list) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; } return a; }
  function makeView(points, rect, padFrac) {
    const pm = points.map(p => merc(p.lat, p.lng)); let b = bboxOf(pm);
    let w = b[2] - b[0], h = b[3] - b[1]; const minSpan = 0.004;
    if (w < minSpan) { b[0] -= minSpan / 2; b[2] += minSpan / 2; w = minSpan; }
    if (h < minSpan) { b[1] -= minSpan / 2; b[3] += minSpan / 2; h = minSpan; }
    const pad = padFrac; const s = Math.min(rect.w * (1 - 2 * pad) / w, rect.h * (1 - 2 * pad) / h);
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const fn = (lat, lng) => { const [x, y] = merc(lat, lng); return [rect.x + rect.w / 2 + (x - cx) * s, rect.y + rect.h / 2 - (y - cy) * s]; };
    // geographic bounds of the rect (for culling)
    const inv = (px, py) => { const x = (px - rect.x - rect.w / 2) / s + cx, y = -(py - rect.y - rect.h / 2) / s + cy; return [x * 180 / Math.PI, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI]; };
    const [lo0, la1] = inv(rect.x, rect.y), [lo1, la0] = inv(rect.x + rect.w, rect.y + rect.h);
    return { fn, s, geo: [lo0, la0, lo1, la1] };
  }
  function featBBoxes(gj) { if (gj._bb) return; for (const f of gj.features) { let b = [180, 90, -180, -90]; const walk = c => { if (typeof c[0] === 'number') { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; } else c.forEach(walk); }; walk(f.geometry.coordinates); f._bb = b; } gj._bb = true; }
  function drawGeo(ctx, gj, view, fill, stroke, lw) {
    featBBoxes(gj); const g = view.geo;
    ctx.beginPath();
    for (const f of gj.features) {
      const b = f._bb; if (b[2] < g[0] || b[0] > g[2] || b[3] < g[1] || b[1] > g[3]) continue;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) { ring.forEach(([lng, lat], i) => { const [x, y] = view.fn(lat, lng); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
    }
    if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function drawRoute(ctx, view, seq, lw) {
    if (seq.length < 2) return;
    const path = new Path2D(); seq.forEach((p, i) => { const [x, y] = view.fn(p.lat, p.lng); i ? path.lineTo(x, y) : path.moveTo(x, y); });
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,176,32,.16)'; ctx.lineWidth = lw * 4.5; ctx.stroke(path);
    ctx.strokeStyle = C.route; ctx.lineWidth = lw; ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255,232,170,.8)'; ctx.lineWidth = Math.max(.6, lw * .35); ctx.stroke(path);
  }
  function drawDots(ctx, view, seq, r) { ctx.fillStyle = C.core; for (const p of seq) { const [x, y] = view.fn(p.lat, p.lng); ctx.fillRect(x - r / 2, y - r / 2, r, r); } }
  function pin(ctx, view, p, color, r) { const [x, y] = view.fn(p.lat, p.lng); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#0b0e14'; ctx.stroke(); }
  function wrap(ctx, text, maxW) { const words = text.split(/\s+/); const lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

  async function render(canvas, o) {
    const W = 1080, H = 1350; canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
    try { await document.fonts.load('900 40px "Barlow Condensed"'); await document.fonts.load('600 20px "Barlow Condensed"'); await document.fonts.load('400 20px Inter'); } catch (e) {}
    const big = '"Barlow Condensed", Impact, sans-serif', body = 'Inter, system-ui, sans-serif';
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // header
    ctx.fillStyle = C.route; ctx.font = `900 30px ${big}`; ctx.textBaseline = 'top'; ctx.fillText('ROAD TRIP EVERY', 48, 40);
    ctx.fillStyle = C.text; ctx.font = `900 66px ${big}`;
    const tl = wrap(ctx, o.title.toUpperCase(), W - 96).slice(0, 2); tl.forEach((l, i) => ctx.fillText(l, 48, 80 + i * 66));
    ctx.font = `500 22px ${body}`; ctx.fillStyle = C.muted; ctx.fillText(o.subtitle, 48, 92 + tl.length * 66);
    // map area
    const rect = { x: 32, y: 150 + tl.length * 66, w: W - 64, h: 0 }; rect.h = 1040 - rect.y;
    ctx.save(); rrect(ctx, rect.x, rect.y, rect.w, rect.h, 18); ctx.clip();
    ctx.fillStyle = C.sea; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; for (let x = rect.x; x < rect.x + rect.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke(); } for (let y = rect.y; y < rect.y + rect.h; y += 40) { ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke(); }
    const seq = o.order.map(i => o.points[i]);
    const isInset = (p) => o.insetGroups && o.insetGroups.has(o.groupNames[p.g].split(' · ')[0]);
    const mainPts = seq.filter(p => !isInset(p));
    const view = makeView(mainPts.length ? mainPts : seq, rect, 0.06);
    drawGeo(ctx, o.basemap.countries, view, C.land, C.edge, 1.1);
    if (o.basemap.states) drawGeo(ctx, o.basemap.states, view, null, C.state, .8);
    const n = seq.length, lw = n > 5000 ? 1.3 : n > 1500 ? 1.8 : n > 300 ? 2.4 : 3.2;
    // split route into drivable runs (hops are not drawn as road)
    const runs = []; let run = [];
    seq.forEach((p, k) => { if (k && p.g !== seq[k - 1].g) { runs.push(run); run = []; } run.push(p); }); runs.push(run);
    runs.filter(r => !isInset(r[0])).forEach(r => drawRoute(ctx, view, r, lw));
    drawDots(ctx, view, mainPts, n > 5000 ? 1.4 : n > 1500 ? 2 : 3);
    // insets (e.g. Alaska, Hawaii)
    const insetNames = [...new Set(seq.filter(isInset).map(p => o.groupNames[p.g].split(' · ')[0]))];
    insetNames.forEach((nm, i) => {
      const r = { x: rect.x + 18 + i * 236, y: rect.y + rect.h - 190, w: 220, h: 172 };
      ctx.save(); rrect(ctx, r.x, r.y, r.w, r.h, 12); ctx.fillStyle = 'rgba(8,11,18,.96)'; ctx.fill(); ctx.strokeStyle = 'rgba(168,176,190,.45)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.clip();
      const ip = seq.filter(p => isInset(p) && o.groupNames[p.g].split(' · ')[0] === nm);
      const v = makeView(ip, { x: r.x, y: r.y + 22, w: r.w, h: r.h - 22 }, 0.12);
      drawGeo(ctx, o.basemap.countries, v, C.land, C.edge, .9);
      runs.filter(rr => isInset(rr[0]) && o.groupNames[rr[0].g].split(' · ')[0] === nm).forEach(rr => drawRoute(ctx, v, rr, Math.max(1.4, lw)));
      drawDots(ctx, v, ip, 2.2);
      ctx.fillStyle = C.muted; ctx.font = `600 18px ${big}`; ctx.fillText(`${nm.toUpperCase()} · ${ip.length}`, r.x + 10, r.y + 6);
      ctx.restore();
    });
    if (seq.length) { pin(ctx, view, mainPts[0] || seq[0], C.start, 9); pin(ctx, view, mainPts[mainPts.length - 1] || seq[seq.length - 1], C.route, 9); }
    // free-tier watermark across the map
    ctx.save(); ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2); ctx.rotate(-0.42); ctx.fillStyle = 'rgba(245,244,240,.055)'; ctx.font = `900 64px ${big}`; ctx.textAlign = 'center';
    for (let yy = -3; yy <= 3; yy++) ctx.fillText('ROAD TRIP EVERY · @YOUNGSIRMUDA', (yy % 2) * 160, yy * 150); ctx.restore();
    ctx.restore();
    // stats
    const sy = 1062, bw = (W - 96 - 3 * 14) / 4;
    o.stats.forEach((s, i) => { const x = 48 + i * (bw + 14); rrect(ctx, x, sy, bw, 112, 14); ctx.fillStyle = '#141821'; ctx.fill(); ctx.strokeStyle = '#2a303c'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = C.route; let fs = 44; ctx.font = `900 ${fs}px ${big}`; while (ctx.measureText(s.v).width > bw - 24 && fs > 18) { fs -= 2; ctx.font = `900 ${fs}px ${big}`; } ctx.fillText(s.v, x + 12, sy + 14 + (44 - fs) / 2);
      ctx.fillStyle = C.muted; ctx.font = `500 17px ${body}`; ctx.fillText(s.l, x + 12, sy + 70); });
    // notes + branding footer
    ctx.fillStyle = '#8a919e'; ctx.font = `400 15px ${body}`;
    wrap(ctx, o.note, W - 96).slice(0, 3).forEach((l, i) => ctx.fillText(l, 48, 1188 + i * 20));
    ctx.fillStyle = '#141821'; ctx.fillRect(0, H - 86, W, 86);
    if (o.avatar) ctx.drawImage(o.avatar, 48, H - 72, 58, 58);
    ctx.fillStyle = C.text; ctx.font = `900 30px ${big}`; ctx.fillText('ROAD TRIP EVERY', 120, H - 72);
    ctx.fillStyle = C.muted; ctx.font = `500 18px ${body}`; ctx.fillText('by Tuan Muda @youngsirmuda', 120, H - 38);
    ctx.textAlign = 'right'; ctx.fillStyle = C.route; ctx.font = `600 22px ${big}`; ctx.fillText(URL, W - 48, H - 66);
    ctx.fillStyle = '#7d8594'; ctx.font = `400 13px ${body}`; ctx.fillText(o.attrib, W - 48, H - 36); ctx.textAlign = 'left';
    return canvas;
  }
  return { render };
})();
