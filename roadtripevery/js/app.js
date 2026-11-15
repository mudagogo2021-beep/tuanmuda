/* Road Trip Every – Map Maker (static, client-side only). */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_ROWS = 2000, MAX_GEOCODE = 25;
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
  const KM_PER_MI = 1.609344, L_PER_GAL = 3.785411784;
  const CUR = { USD: '$', MYR: 'RM' };
  // Defaults for custom lists (labelled assumptions; sources in DATA.md)
  const CUSTOM_DEF = { units: 'imperial', currency: 'USD', factor: 1.3, speed: 37.1, stop_min: 10, mpg: 25, price: 3.943,
    price_note: 'AAA US national average, regular, 11 Nov 2026', factor_note: 'our OSRM-routed Shorts measured 1.29–1.58× straight line' };
  const S = { index: [], ds: null, sel: new Set(), mode: 'preset', result: null, points: [], groupNames: [], map: null, mapOk: false, basemap: null, avatar: null, title: '', subtitle: '' };
  document.querySelectorAll('.maxrows').forEach(e => e.textContent = MAX_ROWS.toLocaleString());

  // ---------- helpers ----------
  const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmtDur = (h0) => { const h = h0 >= 23.95 ? Math.round(h0) : h0; const d = Math.floor(h / 24), r = Math.round(h - d * 24); return d ? `${d} day${d === 1 ? '' : 's'}${r ? ` ${r} hr${r === 1 ? '' : 's'}` : ''}` : `${fmt(h, 1)} hrs`; };
  const showErr = (m) => { const e = $('err'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
  const prog = (frac, msg) => { const p = $('prog'); p.classList.toggle('hidden', frac == null); if (frac != null) { p.querySelector('i').style.width = `${Math.round(frac * 100)}%`; p.querySelector('span').textContent = msg || ''; } };
  async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(`Could not load ${u} (${r.status})`); return r.json(); }

  // ---------- assumptions / units ----------
  function setAssumptions(def) {
    $('units').value = def.units; $('factor').value = def.factor; $('stopmin').value = def.stop_min;
    if (def.units === 'imperial') { $('speed').value = def.speed; $('eff').value = def.mpg; $('price').value = def.price; }
    else { $('speed').value = def.speed; $('eff').value = def.l100; $('price').value = def.price; }
    S.currency = def.currency; S.unitsShown = def.units; labelUnits();
    $('assump-note').textContent = def.factor_note
      ? `Defaults are assumptions: road factor ${def.factor} and ${def.speed} mph (${def.factor_note}; McDonald's USA averaged 37.1 mph). Fuel price: ${def.price_note}. Change any of them.`
      : `Defaults: road factor ${def.factor} and ${def.speed} ${def.units === 'imperial' ? 'mph' : 'km/h'} were measured on our OSRM-routed Short for this dataset. Fuel price: ${def.price_note}. Change any of them.`;
  }
  function labelUnits() {
    const imp = $('units').value === 'imperial', c = CUR[S.currency] || S.currency;
    $('speed-lbl').textContent = imp ? 'Avg speed (mph)' : 'Avg speed (km/h)';
    $('eff-lbl').textContent = imp ? 'Fuel economy (mpg)' : 'Fuel use (L/100 km)';
    $('price-lbl').textContent = imp ? `Fuel price (${c}/gal)` : `Fuel price (${c}/L)`;
    $('s-dist-l').textContent = imp ? 'est. road miles' : 'est. road km';
  }
  $('units').addEventListener('change', () => {
    const toMetric = $('units').value === 'metric'; if ((S.unitsShown === 'metric') === toMetric) return;
    const sp = +$('speed').value, ef = +$('eff').value, pr = +$('price').value;
    if (toMetric) { $('speed').value = +(sp * KM_PER_MI).toFixed(1); $('eff').value = +(235.214583 / ef).toFixed(2); $('price').value = +(pr / L_PER_GAL).toFixed(3); }
    else { $('speed').value = +(sp / KM_PER_MI).toFixed(1); $('eff').value = +(235.214583 / ef).toFixed(1); $('price').value = +(pr * L_PER_GAL).toFixed(3); }
    S.unitsShown = toMetric ? 'metric' : 'imperial'; labelUnits(); updateStats();
  });
  ['factor', 'speed', 'stopmin', 'eff', 'price'].forEach(id => $(id).addEventListener('input', updateStats));

  // ---------- presets ----------
  async function loadPreset(id) {
    const meta = S.index.find(d => d.id === id); showErr('');
    S.ds = await getJSON(meta.file);
    S.sel = new Set(S.ds.states.map((_, i) => i));
    const box = $('states'); box.textContent = '';
    const counts = new Array(S.ds.states.length).fill(0); S.ds.pts.forEach(p => counts[p[2]]++);
    S.ds.states.forEach((st, i) => { const c = document.createElement('span'); c.className = 'chip on'; c.textContent = `${st} · ${counts[i]}`; c.dataset.i = i;
      c.onclick = () => { S.sel.has(i) ? S.sel.delete(i) : S.sel.add(i); c.classList.toggle('on'); }; box.appendChild(c); });
    const s = S.ds.source;
    $('src').innerHTML = '';
    const t = document.createElement('span');
    t.textContent = `${S.ds.count.toLocaleString()} locations · ${s.name}, collected ${s.collected} (originally from ${s.origin}) · ${s.license}. ${s.note ? s.note + '.' : ''}`;
    const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' Source file';
    $('src').append(t, a);
    setAssumptions(S.ds.defaults);
  }
  function setAllStates(on) { S.sel = new Set(on ? S.ds.states.map((_, i) => i) : []); document.querySelectorAll('#states .chip').forEach(c => c.classList.toggle('on', on)); }
  $('st-all').onclick = () => setAllStates(true); $('st-none').onclick = () => setAllStates(false);
  $('preset').addEventListener('change', e => loadPreset(e.target.value).catch(x => showErr(x.message)));

  // ---------- tabs ----------
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
    S.mode = b.dataset.tab; $('pane-preset').classList.toggle('hidden', S.mode !== 'preset'); $('pane-custom').classList.toggle('hidden', S.mode !== 'custom');
    if (S.mode === 'custom') setAssumptions(CUSTOM_DEF); else if (S.ds) setAssumptions(S.ds.defaults);
  });
  $('file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 2e6) return showErr('File is larger than 2 MB.'); $('csv').value = await f.text(); });
  $('sample').onclick = () => { $('csv').value = 'name,lat,lng\nTimes Square NY,40.7580,-73.9855\nLincoln Memorial DC,38.8893,-77.0502\nIndependence Hall PA,39.9489,-75.1500\nFenway Park MA,42.3467,-71.0972\nNiagara Falls NY,43.0962,-79.0377\nCleveland OH,41.4993,-81.6944\nChicago IL,41.8781,-87.6298\nNashville TN,36.1627,-86.7816\nAtlanta GA,33.7490,-84.3880\nCharleston SC,32.7765,-79.9311'; $('ctitle').value = 'My East Coast landmarks'; };

  // ---------- geocoding (Nominatim, polite: 1 req/s, capped) ----------
  async function geocode(places) {
    const need = places.filter(p => p.address); if (!need.length) return places;
    if (!$('geocode-ok').checked) throw new Error(`${need.length} row(s) only have an address. Tick the address look-up box, or add lat/lng columns.`);
    if (need.length > MAX_GEOCODE) throw new Error(`Address look-up is limited to ${MAX_GEOCODE} rows (${need.length} given). Add lat/lng for the rest.`);
    let k = 0;
    for (const p of need) {
      prog(k / need.length, `Looking up address ${k + 1} of ${need.length} (OpenStreetMap Nominatim)…`);
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(p.address)}`, { headers: { 'Accept-Language': 'en' } });
      const js = r.ok ? await r.json() : [];
      if (js[0]) { p.lat = +js[0].lat; p.lng = +js[0].lon; } else p.failed = true;
      k++; await new Promise(res => setTimeout(res, 1100));
    }
    const failed = need.filter(p => p.failed).length;
    if (failed) showErr(`${failed} address(es) could not be found and were skipped.`);
    return places.filter(p => !p.failed);
  }

  // ---------- solve ----------
  let worker = null;
  async function build() {
    showErr(''); stopAnim();
    let pts = [], groupNames;
    if (S.mode === 'preset') {
      if (!S.ds) return;
      for (const p of S.ds.pts) if (S.sel.has(p[2])) pts.push({ lat: p[0], lng: p[1], g: p[3], label: p[4], st: S.ds.states[p[2]] });
      if (pts.length < 2) return showErr('Pick at least one state/region with 2 or more locations.');
      groupNames = S.ds.groups;
      const allSel = S.sel.size === S.ds.states.length;
      const selNames = [...S.sel].map(i => S.ds.states[i]);
      const where = allSel ? (S.ds.region === 'US' ? (S.ds.id.includes('newengland') ? 'New England' : 'the USA') : 'Malaysia') : (selNames.length <= 3 ? selNames.join(', ') : '');
      S.title = `How long to road-trip to every ${S.ds.title.split(' · ')[0]}${where ? ' in ' + where : ''}?`;
      S.subtitle = allSel ? `${pts.length.toLocaleString()} locations` : `${pts.length.toLocaleString()} locations in ${[...S.sel].map(i => S.ds.states[i]).join(', ').slice(0, 70)}${[...S.sel].length > 8 ? '…' : ''}`;
      S.fullPreset = allSel;
    } else {
      let parsed; try { parsed = RTECSV.toPlaces($('csv').value, MAX_ROWS); } catch (e) { return showErr(e.message); }
      let places; try { places = await geocode(parsed.places); } catch (e) { prog(null); return showErr(e.message); }
      if (parsed.badLines.length) showErr(`Skipped ${parsed.badLines.length} row(s) without usable coordinates (lines ${parsed.badLines.slice(0, 8).join(', ')}${parsed.badLines.length > 8 ? '…' : ''}).`);
      pts = places.map(p => ({ lat: p.lat, lng: p.lng, g: 0, label: p.label }));
      if (pts.length < 2) return showErr('Add at least 2 places.');
      groupNames = ['Your list']; S.fullPreset = false;
      S.title = ($('ctitle').value.trim() || 'My road trip'); S.subtitle = `${pts.length} stops · custom list`;
    }
    S.points = pts; S.groupNames = groupNames;
    $('go').disabled = true; prog(0, 'Starting solver…');
    if (worker) worker.terminate();
    worker = new Worker('js/solver.worker.js');
    const budget = pts.length > 8000 ? 8000 : pts.length > 2000 ? 5000 : 3000;
    const present = [...new Set(pts.map(p => p.g))].sort((a, b) => a - b);
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') prog(m.frac, m.msg);
      else if (m.type === 'done') { $('go').disabled = false; prog(null); S.result = m; onSolved(); }
    };
    worker.onerror = (e) => { $('go').disabled = false; prog(null); showErr('Solver error: ' + e.message); };
    worker.postMessage({ lat: pts.map(p => p.lat), lng: pts.map(p => p.lng), grp: pts.map(p => p.g), groupOrder: present, budgetMs: budget });
  }
  $('go').onclick = () => build();

  // ---------- stats ----------
  function calc() {
    const r = S.result; if (!r) return null;
    const imp = $('units').value === 'imperial';
    const factor = +$('factor').value || 1, speed = +$('speed').value || 1, stopMin = +$('stopmin').value || 0, eff = +$('eff').value || 1, price = +$('price').value || 0;
    const roadKm = r.straightKm * factor, dist = imp ? roadKm / KM_PER_MI : roadKm;
    const driveH = dist / speed, stopH = S.points.length * stopMin / 60, totalH = driveH + stopH;
    const fuel = imp ? dist / eff : roadKm * eff / 100, cost = fuel * price;
    const c = CUR[S.currency] || S.currency;
    return { imp, factor, speed, stopMin, eff, price, dist, driveH, stopH, totalH, cost, c, straight: imp ? r.straightKm / KM_PER_MI : r.straightKm };
  }
  function updateStats() {
    const k = calc(); if (!k) return; const r = S.result, u = k.imp ? 'mi' : 'km';
    $('res-title').textContent = S.title;
    $('s-stops').textContent = S.points.length.toLocaleString();
    $('s-dist').textContent = '~' + fmt(k.dist);
    $('s-days').textContent = fmtDur(k.totalH);
    $('s-gas').textContent = `~${k.c}${fmt(k.cost)}`;
    $('s-note').innerHTML = '';
    $('s-note').append('Estimate: ', Object.assign(document.createElement('b'), { textContent: `${fmt(k.straight)} ${u} straight-line × ${k.factor}` }),
      ` road factor. Time = ${fmt(k.driveH)} h driving at ${k.speed} ${k.imp ? 'mph' : 'km/h'} + ${k.stopMin} min per stop. Not a routed drive.`);
    $('s-hops').textContent = r.hops.length ? `+ ${r.hops.length} flight/ferry hop${r.hops.length > 1 ? 's' : ''} between landmasses (${r.legsKm.map(g => S.groupNames[g.group]).join(' → ')}). Hop distance and time are not included.` : '';
    const v = S.ds && S.ds.video;
    $('s-video').innerHTML = '';
    if (S.mode === 'preset' && S.fullPreset && v) {
      $('s-video').append(`Our routed Short (OSRM roads, LKH/2-opt tour, ${v.stops.toLocaleString()} stops): ${v.road}, ${v.time} incl. flights/ferries. `);
      const a = document.createElement('a'); a.href = v.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Watch'; $('s-video').append(a);
      if (v.note) $('s-video').append(` (${v.note}.)`);
    }
    const t = r.legsKm.reduce((a, g) => a + g.moves, 0);
    $('s-solver').textContent = `Tour: nearest neighbour + 2-opt/Or-opt in your browser, ${fmt(r.ms / 1000, 1)} s${r.legsKm.some(g => g.timedOut) ? ' (stopped at the time limit; a longer run could be shorter)' : ''}. Short, but not a proven optimum.`;
  }

  // ---------- map ----------
  function initMap() {
    try {
      const test = document.createElement('canvas'); if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('no webgl');
      S.map = new maplibregl.Map({ container: 'map', style: STYLE_URL, center: [-96, 38], zoom: 2.6, attributionControl: { compact: false }, preserveDrawingBuffer: true, canvasContextAttributes: { preserveDrawingBuffer: true } });
      S.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      S.map.on('load', () => {
        const empty = { type: 'FeatureCollection', features: [] };
        for (const id of ['route', 'hops', 'stops', 'ends']) S.map.addSource(id, { type: 'geojson', data: empty });
        S.map.addLayer({ id: 'hops', type: 'line', source: 'hops', paint: { 'line-color': '#babec6', 'line-width': 1.4, 'line-dasharray': [2, 2], 'line-opacity': .7 } });
        S.map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffb020', 'line-width': 7, 'line-opacity': .18, 'line-blur': 3 } });
        S.map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffb020', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 8, 3] } });
        S.map.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-color': '#ffe8aa', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.3, 10, 5], 'circle-stroke-color': '#0b0e14', 'circle-stroke-width': .5 } });
        S.map.addLayer({ id: 'ends', type: 'circle', source: 'ends', paint: { 'circle-color': ['get', 'c'], 'circle-radius': 7, 'circle-stroke-color': '#0b0e14', 'circle-stroke-width': 2 } });
        S.map.on('click', 'stops', (e) => { const f = e.features[0]; const div = document.createElement('div'); div.textContent = `#${f.properties.n} · ${f.properties.label}`;
          new maplibregl.Popup({ closeButton: false }).setLngLat(f.geometry.coordinates).setDOMContent(div).addTo(S.map); });
        S.map.on('mouseenter', 'stops', () => S.map.getCanvas().style.cursor = 'pointer'); S.map.on('mouseleave', 'stops', () => S.map.getCanvas().style.cursor = '');
        S.mapOk = true; window.__rteMapReady = true; if (S.result) drawMap();
      });
      S.map.on('error', (e) => { console.warn('map error', e && e.error && e.error.message); });
    } catch (e) { console.warn('Map unavailable, using static preview', e); S.mapOk = false; $('map').classList.add('hidden'); $('fallback').classList.remove('hidden'); window.__rteMapReady = 'fallback'; }
  }
  function routeRuns(order) { const runs = []; let run = []; order.forEach((i, k) => { const p = S.points[i]; if (k && p.g !== S.points[order[k - 1]].g) { runs.push(run); run = []; } run.push([p.lng, p.lat]); }); runs.push(run); return runs; }
  function drawMap() {
    const r = S.result; if (!r) return;
    $('animate').disabled = !S.mapOk; $('fit').disabled = !S.mapOk; $('export').disabled = false;
    if (!S.mapOk) { renderPoster($('fallback')); return; }
    const runs = routeRuns(r.order); S.runs = runs;
    S.map.getSource('route').setData({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: runs } });
    S.map.getSource('hops').setData({ type: 'FeatureCollection', features: r.hops.map(h => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[S.points[h.from].lng, S.points[h.from].lat], [S.points[h.to].lng, S.points[h.to].lat]] } })) });
    S.map.getSource('stops').setData({ type: 'FeatureCollection', features: r.order.map((i, k) => ({ type: 'Feature', properties: { n: k + 1, label: S.points[i].label }, geometry: { type: 'Point', coordinates: [S.points[i].lng, S.points[i].lat] } })) });
    const a = S.points[r.order[0]], b = S.points[r.order[r.order.length - 1]];
    S.map.getSource('ends').setData({ type: 'FeatureCollection', features: [[a, '#5eead4'], [b, '#ffb020']].map(([p, c]) => ({ type: 'Feature', properties: { c }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) });
    fit();
  }
  function fit() {
    if (!S.mapOk || !S.result) return;
    const main = S.result.order.map(i => S.points[i]).filter(p => p.g === S.result.legsKm[0].group);
    let b = [180, 90, -180, -90]; for (const p of main) { b[0] = Math.min(b[0], p.lng); b[1] = Math.min(b[1], p.lat); b[2] = Math.max(b[2], p.lng); b[3] = Math.max(b[3], p.lat); }
    S.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 0, maxZoom: 12 });
  }
  $('fit').onclick = fit;
  let anim = null;
  function stopAnim() { if (anim) cancelAnimationFrame(anim); anim = null; $('animate').textContent = '▶ Animate route'; }
  $('animate').onclick = () => {
    if (anim) { stopAnim(); drawMap(); return; }
    if (!S.mapOk) return;
    const flat = S.runs.flatMap((r, i) => r.map(c => [i, c])), total = flat.length, dur = Math.min(14000, 4000 + total * 2); const t0 = performance.now();
    $('animate').textContent = '■ Stop';
    const step = (t) => { const k = Math.max(2, Math.floor(total * Math.min(1, (t - t0) / dur))); const runs = []; for (let j = 0; j < k; j++) { const [ri, c] = flat[j]; (runs[ri] = runs[ri] || []).push(c); }
      S.map.getSource('route').setData({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: runs.filter(Boolean) } });
      if (k < total) anim = requestAnimationFrame(step); else { anim = null; $('animate').textContent = '▶ Animate route'; } };
    anim = requestAnimationFrame(step);
  };

  // ---------- poster ----------
  async function ensureBasemap() {
    if (!S.basemap) { const [countries, states] = await Promise.all([getJSON('data/ne_countries_50m.json'), getJSON('data/ne_us_states_50m.json')]); S.basemap = { countries, statesUS: states }; }
    if (!S.avatar) { S.avatar = new Image(); S.avatar.src = 'assets/avatar-256.png'; await S.avatar.decode().catch(() => {}); }
  }
  async function renderPoster(canvas) {
    await ensureBasemap(); const k = calc(), u = k.imp ? 'miles' : 'km';
    const isUS = S.mode === 'preset' ? S.ds.region === 'US' : false;
    const chain = S.mode === 'preset' ? S.ds.title.split(' · ')[0] : null;
    const src = S.mode === 'preset' ? `Stores: All the Places (CC0), ${S.ds.source.collected}` : 'Places: your list';
    return RTEPoster.render(canvas, {
      title: S.title, subtitle: S.subtitle, points: S.points, order: S.result.order, groupNames: S.groupNames,
      insetGroups: isUS ? new Set(['Alaska', 'Hawaii']) : null,
      basemap: { countries: S.basemap.countries, states: isUS || (S.mode === 'custom') ? S.basemap.statesUS : null },
      stats: [{ v: S.points.length.toLocaleString(), l: 'stops' }, { v: '~' + fmt(k.dist), l: `est. road ${u}` }, { v: fmtDur(k.totalH), l: 'non-stop' }, { v: `~${k.c}${fmt(k.cost)}`, l: 'est. fuel' }],
      note: `Estimate: straight-line distance × ${k.factor} road factor, ${k.speed} ${k.imp ? 'mph' : 'km/h'} average + ${k.stopMin} min per stop, ${k.eff} ${k.imp ? 'mpg' : 'L/100 km'} at ${k.c}${k.price}/${k.imp ? 'gal' : 'L'}. Tour: nearest neighbour + 2-opt/Or-opt, not a proven optimum.${S.result.hops.length ? ` ${S.result.hops.length} flight/ferry hop(s) not counted.` : ''}${chain ? ` Not affiliated with ${chain}.` : ''}`,
      attrib: `${src} · Boundaries: Natural Earth`, avatar: S.avatar,
    });
  }
  $('export').onclick = async () => {
    const c = document.createElement('canvas'); await renderPoster(c);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `road-trip-every-${S.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
  };

  // ---------- boot ----------
  window.__rte = { S, build, renderPoster };
  (async () => {
    initMap();
    try {
      S.index = await getJSON('data/index.json');
      S.index.forEach(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.title} (${d.count.toLocaleString()})`; $('preset').appendChild(o); });
      const q = new URLSearchParams(location.search).get('preset');
      await loadPreset(q && S.index.some(d => d.id === q) ? q : S.index[0].id); if (q) $('preset').value = q;
    } catch (e) { showErr(e.message); }
  })();
  const _onSolved = () => { updateStats(); drawMap(); };
  var onSolved = _onSolved; // eslint-disable-line
})();
