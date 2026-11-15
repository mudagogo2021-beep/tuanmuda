/* Minimal CSV parsing + column detection for user lists. */
'use strict';
window.RTECSV = (() => {
  function parse(text) {
    const rows = []; let row = [], f = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.map(r => r.map(s => s.trim())).filter(r => r.some(s => s !== ''));
  }
  const LAT = ['lat', 'latitude', 'y'], LNG = ['lng', 'lon', 'long', 'longitude', 'x'];
  const NAME = ['name', 'label', 'title', 'store', 'place'], ADDR = ['address', 'addr', 'full_address', 'location'];
  function toPlaces(text, maxRows) {
    const rows = parse(text); if (!rows.length) throw new Error('The list is empty.');
    const h = rows[0].map(s => s.toLowerCase());
    const find = (keys) => h.findIndex(x => keys.includes(x));
    let iLat = find(LAT), iLng = find(LNG), iName = find(NAME), iAddr = find(ADDR), body = rows.slice(1);
    const num = (s) => s !== '' && isFinite(+s);
    if (iLat < 0 && iLng < 0 && iAddr < 0) {
      // no header: accept "lat,lng[,name]" rows
      if (rows[0].length >= 2 && num(rows[0][0]) && num(rows[0][1])) { iLat = 0; iLng = 1; iName = rows[0].length > 2 ? 2 : -1; body = rows; }
      else throw new Error('Could not find lat/lng (or address) columns. Use a header like: name,lat,lng');
    }
    if (body.length > maxRows) throw new Error(`That list has ${body.length.toLocaleString()} rows. The limit is ${maxRows.toLocaleString()}.`);
    const out = [], bad = [];
    body.forEach((r, k) => {
      const name = (iName >= 0 ? r[iName] : '') || (iAddr >= 0 ? r[iAddr] : '') || `Stop ${k + 1}`;
      const la = iLat >= 0 ? r[iLat] : '', lo = iLng >= 0 ? r[iLng] : '';
      if (num(la) && num(lo)) {
        const lat = +la, lng = +lo;
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push({ lat, lng, label: name.slice(0, 80) });
        else bad.push(k + 2);
      } else if (iAddr >= 0 && r[iAddr]) out.push({ address: r[iAddr], label: name.slice(0, 80) });
      else bad.push(k + 2);
    });
    return { places: out, badLines: bad };
  }
  return { parse, toPlaces };
})();
