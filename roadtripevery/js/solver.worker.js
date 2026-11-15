/* Road Trip Every – tour solver (Web Worker).
   Per landmass group: nearest-neighbour open path, then 2-opt + Or-opt local search (neighbour lists, work queue)
   re-opened at its longest edge (path treated as a loop), and a short iterated local search
   (segment-swap kicks, keep improvements only). The path is oriented to start nearest the previous landmass.
   Straight-line (great-circle) distances only; road distance is estimated in the UI. */
'use strict';
const R = 6371.0088;
function hav(la1, lo1, la2, lo2) {
  const p1 = la1 * Math.PI / 180, p2 = la2 * Math.PI / 180;
  const dp = p2 - p1, dl = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function solveGroup(lat, lng, startHint, budgetMs, report) {
  const n = lat.length;
  if (n === 1) return [0];
  // local planar projection (km) for fast distance + grid
  let mLat = 0; for (let i = 0; i < n; i++) mLat += lat[i]; mLat /= n;
  const kx = 111.32 * Math.cos(mLat * Math.PI / 180), ky = 110.57;
  const X = new Float64Array(n), Y = new Float64Array(n);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    X[i] = lng[i] * kx; Y[i] = lat[i] * ky;
    if (X[i] < minx) minx = X[i]; if (X[i] > maxx) maxx = X[i];
    if (Y[i] < miny) miny = Y[i]; if (Y[i] > maxy) maxy = Y[i];
  }
  const d = (a, b) => hav(lat[a], lng[a], lat[b], lng[b]);
  // grid
  const side = Math.max(1, Math.ceil(Math.sqrt(n / 2)));
  const w = Math.max(maxx - minx, 1e-6), h = Math.max(maxy - miny, 1e-6);
  const cs = Math.max(w, h) / side;
  const gw = Math.ceil(w / cs) + 1, gh = Math.ceil(h / cs) + 1;
  const cell = new Int32Array(n), head = new Int32Array(gw * gh).fill(-1), next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((X[i] - minx) / cs), cy = Math.floor((Y[i] - miny) / cs);
    cell[i] = cy * gw + cx; next[i] = head[cell[i]]; head[cell[i]] = i;
  }
  // K nearest neighbours per point (ring search on grid)
  const K = Math.min(16, n - 1);
  const nb = new Int32Array(n * K);
  for (let i = 0; i < n; i++) {
    const cx = cell[i] % gw, cy = (cell[i] / gw) | 0;
    let best = [], r = 0;
    while (true) {
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
        if (Math.max(Math.abs(yy - cy), Math.abs(xx - cx)) !== r) continue;
        for (let j = head[yy * gw + xx]; j !== -1; j = next[j]) if (j !== i) {
          const dx = X[j] - X[i], dy = Y[j] - Y[i]; best.push([dx * dx + dy * dy, j]);
        }
      }
      if (best.length >= K && r * cs >= Math.sqrt(best.sort((a, b) => a[0] - b[0])[K - 1][0])) break;
      r++; if (r > gw + gh) break;
    }
    best.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < K; k++) nb[i * K + k] = best[k][1];
  }
  // nearest neighbour path using grid with removal
  const used = new Uint8Array(n), tour = new Int32Array(n);
  let cur = startHint; used[cur] = 1; tour[0] = cur;
  const alive = new Int32Array(gw * gh); for (let i = 0; i < n; i++) alive[cell[i]]++;
  alive[cell[cur]]--;
  for (let t = 1; t < n; t++) {
    const cx = cell[cur] % gw, cy = (cell[cur] / gw) | 0;
    let bj = -1, bd = Infinity;
    for (let r = 0; r <= gw + gh; r++) {
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
        if (Math.max(Math.abs(yy - cy), Math.abs(xx - cx)) !== r) continue;
        const c = yy * gw + xx; if (!alive[c]) continue;
        for (let j = head[c]; j !== -1; j = next[j]) if (!used[j]) {
          const dx = X[j] - X[cur], dy = Y[j] - Y[cur], dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; bj = j; }
        }
      }
      if (bj !== -1 && Math.sqrt(bd) <= r * cs) break;
    }
    used[bj] = 1; alive[cell[bj]]--; tour[t] = bj; cur = bj;
  }
  // ---- local search: 2-opt + Or-opt on the open path, neighbour lists, work queue ----
  const pos = new Int32Array(n); for (let i = 0; i < n; i++) pos[tour[i]] = i;
  const rev = (i, j) => { while (i < j) { const a = tour[i], b = tour[j]; tour[i] = b; tour[j] = a; pos[b] = i; pos[a] = j; i++; j--; } };
  const touched = [];
  let gainAcc = 0; // total length change applied by moves (negative = shorter)
  function twoOpt(a) {
    for (let k = 0; k < K; k++) {
      const c = nb[a * K + k], pa = pos[a], pc = pos[c];
      if (pa + 1 < n) {
        const a1 = tour[pa + 1];
        if (c !== a1) {
          if (pc + 1 < n) {
            const c1 = tour[pc + 1], delta = d(a, c) + d(a1, c1) - d(a, a1) - d(c, c1);
            if (delta < -1e-9) { if (pa < pc) rev(pa + 1, pc); else rev(pc + 1, pa); touched.push(a, a1, c, c1); gainAcc += delta; return true; }
          } else if (pc > pa) {
            const delta = d(a, c) - d(a, a1);
            if (delta < -1e-9) { rev(pa + 1, n - 1); touched.push(a, a1, c); gainAcc += delta; return true; }
          }
        }
      }
      if (pa > 0) {
        const a0 = tour[pa - 1];
        if (c !== a0) {
          if (pc > 0) {
            const c0 = tour[pc - 1], delta = d(a, c) + d(a0, c0) - d(a0, a) - d(c0, c);
            if (delta < -1e-9) { if (pa < pc) rev(pa, pc - 1); else rev(pc, pa - 1); touched.push(a, a0, c, c0); gainAcc += delta; return true; }
          } else if (pc < pa) {
            const delta = d(a, c) - d(a0, a);
            if (delta < -1e-9) { rev(0, pa - 1); touched.push(a, a0, c); gainAcc += delta; return true; }
          }
        }
      }
    }
    return false;
  }
  // Or-opt: move a segment of 1-3 stops starting at a next to a neighbour (either orientation)
  function orOpt(a) {
    const pa = pos[a];
    for (let L = 1; L <= 3; L++) {
      const s0 = pa, s1 = pa + L - 1; if (s1 >= n) break;
      const A = tour[s0], B = tour[s1];
      const prev = s0 > 0 ? tour[s0 - 1] : -1, nxt = s1 < n - 1 ? tour[s1 + 1] : -1;
      const removeGain = (prev >= 0 ? d(prev, A) : 0) + (nxt >= 0 ? d(B, nxt) : 0) - (prev >= 0 && nxt >= 0 ? d(prev, nxt) : 0);
      if (removeGain <= 1e-9) continue;
      for (const end of (L === 1 ? [A] : [A, B])) for (let k = 0; k < K; k++) {
        const c = nb[end * K + k], pc = pos[c]; if (pc >= s0 && pc <= s1) continue;
        for (const side of [1, -1]) {
          const pc2 = pc + side, c2 = (pc2 >= 0 && pc2 < n) ? tour[pc2] : -1;
          if (c2 >= 0 && pos[c2] >= s0 && pos[c2] <= s1) continue;
          const other = end === A ? B : A;
          const add = d(c, end) + (c2 >= 0 ? d(other, c2) : 0) - (c2 >= 0 ? d(c, c2) : 0);
          if (add < removeGain - 1e-9) {
            const seg = Array.from(tour.subarray(s0, s1 + 1)); if (side === 1 ? end !== A : end !== B) seg.reverse();
            // shift the block between the segment and the insertion point (O(distance))
            if (pc > s1) { // insertion point after the segment
              const at = side === 1 ? pc : pc - 1; // last index of the stretch that moves left
              for (let i = s1 + 1; i <= at; i++) { tour[i - L] = tour[i]; pos[tour[i - L]] = i - L; }
              for (let t = 0; t < L; t++) { tour[at - L + 1 + t] = seg[t]; pos[seg[t]] = at - L + 1 + t; }
            } else { // insertion point before the segment
              const at = side === 1 ? pc + 1 : pc; // first index of the stretch that moves right
              for (let i = s0 - 1; i >= at; i--) { tour[i + L] = tour[i]; pos[tour[i + L]] = i + L; }
              for (let t = 0; t < L; t++) { tour[at + t] = seg[t]; pos[seg[t]] = at + t; }
            }
            touched.push(A, B, c); if (c2 >= 0) touched.push(c2); if (prev >= 0) touched.push(prev); if (nxt >= 0) touched.push(nxt);
            gainAcc += add - removeGain; return true;
          }
        }
      }
    }
    return false;
  }
  const flip = () => { for (let i = 0, j = n - 1; i < j; i++, j--) { const t = tour[i]; tour[i] = tour[j]; tour[j] = t; } for (let i = 0; i < n; i++) pos[tour[i]] = i; };
  const inQ = new Uint8Array(n), Q = [];
  const push = (q) => { if (!inQ[q]) { inQ[q] = 1; Q.push(q); } };
  let moves = 0, checks = 0;
  function localSearch(deadline) {
    while (Q.length) {
      const a = Q.pop(); inQ[a] = 0;
      touched.length = 0;
      if (twoOpt(a) || orOpt(a)) { moves++; for (const q of touched) { push(q); const pq = pos[q]; if (pq > 0) push(tour[pq - 1]); if (pq < n - 1) push(tour[pq + 1]); } }
      if ((++checks & 255) === 0 && performance.now() > deadline) return false;
    }
    return true;
  }
  const t0 = performance.now(), deadline = t0 + budgetMs;
  const pathLen = () => { let L = 0; for (let i = 1; i < n; i++) L += d(tour[i - 1], tour[i]); return L; };
  const setTour = (arr) => { for (let i = 0; i < n; i++) { tour[i] = arr[i]; pos[arr[i]] = i; } };
  // two starts: nearest neighbour and Hilbert curve; keep whichever local search makes shorter
  const lsAll = () => { for (let i = n - 1; i >= 0; i--) push(tour[i]); return localSearch(deadline); };
  let converged = lsAll(); const initUsed = 'nearest neighbour';
  // Cut-at-the-longest-edge: treat the path as a loop (end joined to start) and re-open it at its longest edge.
  // The path can only get shorter, and it removes the long "jump back" legs nearest-neighbour leaves behind.
  // End moves: reverse the head or tail of the path when that joins a long jump to a path end instead (checked against every stop).
  const endMoves = () => {
    let any = false;
    for (let iter = 0; iter < 50; iter++) {
      let bd = -1e-9, bi = -1, bt = 0; const first = tour[0], last = tour[n - 1];
      for (let i = 0; i < n - 1; i++) {
        const e = d(tour[i], tour[i + 1]);
        const tail = d(tour[i], last) - e; if (tail < bd) { bd = tail; bi = i; bt = 1; }
        const head = d(first, tour[i + 1]) - e; if (head < bd) { bd = head; bi = i; bt = 2; }
      }
      if (bi < 0) break;
      if (bt === 1) rev(bi + 1, n - 1); else rev(0, bi);
      any = true;
    }
    return any;
  };
  for (let rot = 0; rot < 8; rot++) {
    if (endMoves()) converged = lsAll() && converged;
    let k = -1, best = d(tour[n - 1], tour[0]);
    for (let i = 0; i < n - 1; i++) { const e = d(tour[i], tour[i + 1]); if (e > best + 1e-9) { best = e; k = i; } }
    if (k < 0) break;
    setTour(Array.from(tour.subarray(k + 1)).concat(Array.from(tour.subarray(0, k + 1))));
    converged = lsAll() && converged;
  }
  const lsMs = performance.now() - t0;
  report(1, moves);
  // ---- iterated local search: segment-swap kicks near each other, keep only improvements ----
  let kicks = 0, kept = 0;
  if (converged && n >= 8) {
    const best = new Int32Array(tour); let seed = 12345;
    const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
    const iterDeadline = Math.min(deadline, t0 + lsMs * 3 + 250);
    while (performance.now() < iterDeadline) {
      const span = Math.min(50, Math.floor((n - 1) / 3)); if (span < 1) break;
      const i = 1 + rnd(n - 3 * span - 1 > 0 ? n - 3 * span - 1 : 1), j = i + 1 + rnd(span), k = j + 1 + rnd(span);
      if (k >= n) continue;
      const before = d(tour[i - 1], tour[i]) + d(tour[j - 1], tour[j]) + d(tour[k - 1], tour[k]);
      const after = d(tour[i - 1], tour[j]) + d(tour[k - 1], tour[i]) + d(tour[j - 1], tour[k]);
      const block = Array.from(tour.subarray(j, k)).concat(Array.from(tour.subarray(i, j)));
      for (let t = 0; t < block.length; t++) { tour[i + t] = block[t]; pos[block[t]] = i + t; }
      gainAcc = after - before;
      for (const q of [tour[i - 1], tour[i], tour[i + k - j - 1], tour[i + k - j], tour[k - 1], tour[k]]) push(q);
      const done = localSearch(iterDeadline + 200); kicks++;
      if (done && gainAcc < -1e-9) { best.set(tour); kept++; }
      else { tour.set(best); for (let t = 0; t < n; t++) pos[tour[t]] = t; while (Q.length) inQ[Q.pop()] = 0; }
    }
  }
  if (d(tour[n - 1], startHint) < d(tour[0], startHint)) flip();
  const passes = kicks, timedOut = !converged;
  return { tour: Array.from(tour), passes, moves, kicks, kept, timedOut, initUsed };
}

self.onmessage = (ev) => {
  const { lat, lng, grp, groupOrder, budgetMs } = ev.data;
  const t0 = performance.now();
  const order = [], legsKm = [], hops = [];
  let prevEnd = -1, totalKm = 0, nnInfo = [];
  const nTotal = lat.length; // time budget per landmass is proportional to its number of stops
  const remaining = groupOrder.slice(); const seqGroups = [];
  for (let gi = 0; gi < groupOrder.length; gi++) {
    // first group = the main landmass; then always the landmass nearest to where we are
    let g = remaining[0];
    if (prevEnd >= 0 && remaining.length > 1) { let bd = Infinity; for (const cand of remaining) for (let i = 0; i < lat.length; i++) if (grp[i] === cand) { const dd = hav(lat[prevEnd], lng[prevEnd], lat[i], lng[i]); if (dd < bd) { bd = dd; g = cand; } } }
    remaining.splice(remaining.indexOf(g), 1); seqGroups.push(g);
    const idx = []; for (let i = 0; i < lat.length; i++) if (grp[i] === g) idx.push(i);
    if (!idx.length) continue;
    const la = idx.map(i => lat[i]), lo = idx.map(i => lng[i]);
    // start: nearest to previous group's end, else the point farthest from the centroid
    let s = 0;
    if (prevEnd >= 0) { let bd = Infinity; idx.forEach((i, k) => { const dd = hav(lat[prevEnd], lng[prevEnd], lat[i], lng[i]); if (dd < bd) { bd = dd; s = k; } }); }
    else {
      const cy = la.reduce((a, b) => a + b, 0) / la.length, cx = lo.reduce((a, b) => a + b, 0) / lo.length;
      let bd = -1; la.forEach((v, k) => { const dd = hav(cy, cx, v, lo[k]); if (dd > bd) { bd = dd; s = k; } });
    }
    self.postMessage({ type: 'progress', msg: `Solving ${g} (${idx.length} stops)…`, frac: gi / groupOrder.length });
    const gBudget = Math.max(300, budgetMs * idx.length / nTotal);
    const rep = (p, m) => self.postMessage({ type: 'progress', msg: `${g}: improving the route…`, frac: gi / groupOrder.length });
    let res;
    if (idx.length === 1) res = { tour: [0], passes: 0, moves: 0, timedOut: false };
    else if (prevEnd >= 0 || idx.length < 4) res = solveGroup(la, lo, s, gBudget, rep);
    else {
      // main landmass: two starts (farthest-from-centre stop, and the stop farthest from that); keep the shorter path
      let s2 = 0, bd = -1; la.forEach((v, k) => { const dd = hav(la[s], lo[s], v, lo[k]); if (dd > bd) { bd = dd; s2 = k; } });
      const len = (t) => { let L = 0; for (let k = 1; k < t.length; k++) L += hav(la[t[k - 1]], lo[t[k - 1]], la[t[k]], lo[t[k]]); return L; };
      const r1 = solveGroup(la, lo, s, gBudget / 2, rep);
      self.postMessage({ type: 'progress', msg: `${g}: trying a second start…`, frac: (gi + 0.5) / groupOrder.length });
      const r2 = solveGroup(la, lo, s2, gBudget / 2, rep);
      res = len(r2.tour) < len(r1.tour) ? r2 : r1;
    }
    const path = res.tour.map(k => idx[k]);
    if (prevEnd >= 0) hops.push({ from: prevEnd, to: path[0], km: hav(lat[prevEnd], lng[prevEnd], lat[path[0]], lng[path[0]]), atIndex: order.length });
    let gkm = 0;
    for (let k = 1; k < path.length; k++) gkm += hav(lat[path[k - 1]], lng[path[k - 1]], lat[path[k]], lng[path[k]]);
    totalKm += gkm; legsKm.push({ group: g, stops: path.length, km: gkm, passes: res.passes, moves: res.moves, kicks: res.kicks || 0, kept: res.kept || 0, timedOut: res.timedOut, initUsed: res.initUsed || 'nearest neighbour' });
    order.push(...path); prevEnd = path[path.length - 1];
  }
  self.postMessage({ type: 'done', order, legsKm, hops, straightKm: totalKm, ms: performance.now() - t0 });
};
