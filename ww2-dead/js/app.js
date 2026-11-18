/* WWII deaths globe — live playback app. No build step. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const canvas = $("globe");
  const overlay = $("overlay");
  const hud = $("hud");
  const listEl = $("list");
  const titleCard = $("titleCard");
  const endCard = $("endCard");
  const gate = $("gate");
  const help = $("help");
  const loading = $("loading");
  const restartBtn = $("restart");
  const music = $("music");
  const startHint = $("startHint");
  const totalEl = $("total");
  const endPlate = $("endPlate");

  const params = new URLSearchParams(location.search);
  const exactW = parseInt(params.get("w") || "0", 10);
  const exactH = parseInt(params.get("h") || "0", 10);
  const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchend" in window;
  const isPhone = isTouch && Math.min(screen.width, screen.height) <= 500;
  startHint.textContent = isTouch ? "Tap to start" : "Click to start";

  let T = null;
  let dots = null;
  let gl = null;
  let programs = null;
  let basemapTex = null;
  let flagAtlas = null;
  let ready = false;
  let playing = false;
  let started = false;
  let filmTime = 0;
  let lastTs = 0;
  let duration = 180;
  let fpsEma = 60;
  let framesInWin = 0;
  let winStart = 0;
  let quality = 1;      // 1 = full, down to ~0.25
  let stride = 1;
  let pointScale = 1;
  let dprCap = 2;
  let octx = null;
  let endDrawn = false;

  const state = {
    time: 0,
    fps: 60,
    quality: 1,
    duration: 0,
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function buildCurve(u) { u = clamp(u, 0, 1); return Math.pow(u, 2.55); }

  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }
  function fmtRunning(n, scale) {
    const s = scale || 10;
    return fmtInt(Math.round(n / s) * s);
  }
  function fmtRange(lo, hi, mid) {
    if (lo == null || hi == null) return fmtInt(mid || 0);
    lo = Math.round(lo); hi = Math.round(hi);
    if (lo === hi) {
      if (lo >= 1e6) {
        const q = lo / 1e6;
        return q === (q | 0) ? `${q} MILLION` : `${q.toFixed(1)} MILLION`;
      }
      return fmtInt(lo);
    }
    const one = (n) => {
      if (n >= 1e6) {
        const q = n / 1e6;
        return (q === (q | 0) && n % 1e6 === 0) ? `${q}` : `${q.toFixed(1)}`;
      }
      return fmtInt(n);
    };
    if (lo >= 1e6 || hi >= 1e6) return `${one(lo)}–${one(hi)} MILLION`;
    return `${fmtInt(lo)}–${fmtInt(hi)}`;
  }
  function tickingHero(w, p) {
    if (p >= 0.995) {
      const h = fmtRange(w.lo, w.hi, w.mid);
      if (/NOT AVAILABLE/i.test(h)) return fmtInt(w.mid);
      return h;
    }
    return fmtRunning(Math.max(0, w.mid * p), T.dotScale);
  }
  function shortName(w) {
    const raw = (w.short || w.name || w.key || "").toUpperCase();
    return (T.aliases && T.aliases[raw]) || raw;
  }

  async function fetchBuf(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
    return r.arrayBuffer();
  }
  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
    return r.json();
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("img " + src));
      im.src = src;
    });
  }

  function parseDots(buf) {
    const view = new DataView(buf);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== "WW2D") throw new Error("bad dots magic");
    const ver = view.getUint16(4, true);
    const count = view.getUint32(6, true);
    const bakeW = view.getUint32(10, true);
    const bakeH = view.getUint32(14, true);
    const lon0 = view.getFloat32(18, true);
    const lon1 = view.getFloat32(22, true);
    const lat0 = view.getFloat32(26, true);
    const lat1 = view.getFloat32(30, true);
    const recOff = 34;
    const x = new Uint16Array(count);
    const y = new Uint16Array(count);
    const cid = new Uint8Array(count);
    const rank = new Uint16Array(count);
    let p = recOff;
    for (let i = 0; i < count; i++) {
      x[i] = view.getUint16(p, true); p += 2;
      y[i] = view.getUint16(p, true); p += 2;
      cid[i] = view.getUint8(p); p += 1;
      rank[i] = view.getUint16(p, true); p += 2;
    }
    return { ver, count, bakeW, bakeH, lon0, lon1, lat0, lat1, x, y, cid, rank };
  }

  function camAt(t) {
    const path = T.path;
    const tEnd = T.tEnd0;
    const tt = Math.min(Math.max(0, t), tEnd - 0.001);
    // path is 0.25s samples
    const x = tt / 0.25;
    let i = Math.floor(x);
    if (i < 0) i = 0;
    if (i >= path.length - 1) {
      const p = path[path.length - 1];
      return { lon: p[1], lat: p[2], view: p[3] };
    }
    const u = x - i;
    const a = path[i], b = path[i + 1];
    return {
      lon: a[1] + (b[1] - a[1]) * u,
      lat: a[2] + (b[2] - a[2]) * u,
      view: a[3] + (b[3] - a[3]) * u,
    };
  }

  function cameraP(view) {
    const a = (Math.min(Math.max(view, 8), 89) * Math.PI) / 180;
    return 1 / Math.cos(a);
  }

  function projectPoint(lon, lat, camLon, camLat, view, W, H) {
    const P = cameraP(view);
    const rMax = Math.sqrt((P - 1) / (P + 1));
    const R = T.globe.r * (W / 1080);
    const CX = T.globe.cx * W;
    const CY = T.globe.cy * H;
    const lonC = camLon * Math.PI / 180;
    const latC = camLat * Math.PI / 180;
    const lonR = lon * Math.PI / 180;
    const latR = lat * Math.PI / 180;
    const cosC = Math.sin(latC) * Math.sin(latR) + Math.cos(latC) * Math.cos(latR) * Math.cos(lonR - lonC);
    const X = Math.cos(latR) * Math.sin(lonR - lonC);
    const Y = Math.cos(latC) * Math.sin(latR) - Math.sin(latC) * Math.cos(latR) * Math.cos(lonR - lonC);
    const Z = cosC;
    if (Z <= 1 / P - 1e-6) return null;
    const s = (P - 1) / (P - Z);
    const sx = CX + ((s * X) / rMax) * R;
    const sy = CY - ((s * Y) / rMax) * R;
    return { x: sx, y: sy, z: Z, r: R, cx: CX, cy: CY };
  }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh) || "shader");
    return sh;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) || "link");
    return p;
  }

  const VS_GLOBE = `
    attribute vec2 aPos;
    void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
  `;
  const FS_GLOBE = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uCX, uCY, uR, uLon, uLat, uView;
    uniform sampler2D uMap;
    uniform vec4 uBake; // lon0, lon1, lat0, lat1
    uniform vec3 uSpace;
    void main(){
      float px = gl_FragCoord.x;
      float py = uRes.y - gl_FragCoord.y;
      vec2 d = vec2(px - uCX, uCY - py);
      float rho = length(d);
      if (rho > uR) { gl_FragColor = vec4(uSpace / 255.0, 1.0); return; }
      float aDeg = clamp(uView, 8.0, 89.0) * 0.01745329252;
      float P = 1.0 / cos(aDeg);
      float rMax = sqrt((P - 1.0) / (P + 1.0));
      float x = (d.x / uR) * rMax;
      float y = (d.y / uR) * rMax;
      float rho2 = x*x + y*y;
      float aa = rho2 / ((P - 1.0) * (P - 1.0));
      float disc = max(aa + 1.0 - aa * P * P, 0.0);
      float Z = (aa * P + sqrt(disc)) / (aa + 1.0);
      float s = (P - Z) / (P - 1.0);
      float X = s * x;
      float Y = s * y;
      float lat1 = uLat * 0.01745329252;
      float lon1 = uLon * 0.01745329252;
      float sinl = sin(lat1), cosl = cos(lat1);
      float lat = asin(clamp(Z * sinl + Y * cosl, -1.0, 1.0));
      float lon = lon1 + atan(X, Z * cosl - Y * sinl);
      float lonD = lon * 57.29577951;
      float latD = lat * 57.29577951;
      lonD = mod(lonD + 180.0, 360.0) - 180.0;
      float u = (lonD - uBake.x) / (uBake.y - uBake.x);
      float v = (uBake.w - latD) / (uBake.w - uBake.z);
      vec3 col = uSpace / 255.0;
      if (v >= 0.0 && v <= 1.0) {
        col = texture2D(uMap, vec2(fract(u), clamp(v, 0.0, 1.0))).rgb;
      }
      float shade = 0.42 + 0.58 * clamp(Z, 0.0, 1.0);
      float edge = clamp((uR - rho) / 8.0, 0.0, 1.0);
      shade *= edge;
      col *= shade;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const VS_DOTS = `
    attribute vec2 aXY;
    attribute float aCid;
    attribute float aRank;
    uniform vec2 uRes;
    uniform float uCX, uCY, uR, uLon, uLat, uView;
    uniform vec4 uBakeWH; // bakeW, bakeH, lon0, lat1
    uniform vec4 uBakeSpan; // lon span, -lat span (lat1-lat0 inverted via lat1 and height)
    uniform float uSize;
    uniform sampler2D uProgTex;
    varying float vAlpha;
    void main(){
      float bakeW = uBakeWH.x, bakeH = uBakeWH.y, lon0 = uBakeWH.z, lat1 = uBakeWH.w;
      float lonSpan = uBakeSpan.x, latSpan = uBakeSpan.y;
      float lon = lon0 + (aXY.x + 0.5) / bakeW * lonSpan;
      float lat = lat1 - (aXY.y + 0.5) / bakeH * latSpan;
      float P, rMax, lonC, latC, lonR, latR, cosC, X, Y, Z, s, sx, sy;
      P = 1.0 / cos(clamp(uView, 8.0, 89.0) * 0.01745329252);
      rMax = sqrt((P - 1.0) / (P + 1.0));
      lonC = uLon * 0.01745329252;
      latC = uLat * 0.01745329252;
      lonR = lon * 0.01745329252;
      latR = lat * 0.01745329252;
      cosC = sin(latC)*sin(latR) + cos(latC)*cos(latR)*cos(lonR-lonC);
      X = cos(latR)*sin(lonR-lonC);
      Y = cos(latC)*sin(latR) - sin(latC)*cos(latR)*cos(lonR-lonC);
      Z = cosC;
      float p = texture2D(uProgTex, vec2((aCid + 0.5) / 64.0, 0.5)).r;
      float rank = aRank / 65535.0;
      float pp = clamp((p - 0.02 - 0.92 * rank) / 0.10, 0.0, 1.0);
      if (Z <= (1.0/P - 1e-6) || pp <= 0.0 || p <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
        gl_PointSize = 0.0;
        vAlpha = 0.0;
        return;
      }
      s = (P - 1.0) / (P - Z);
      sx = uCX + ((s * X) / rMax) * uR;
      sy = uCY - ((s * Y) / rMax) * uR;
      vec2 clip = vec2((sx / uRes.x) * 2.0 - 1.0, 1.0 - (sy / uRes.y) * 2.0);
      gl_Position = vec4(clip, 0.0, 1.0);
      float grow = clamp((32.0 / max(uView, 12.0)), 0.7, 1.35);
      gl_PointSize = max(1.5, uSize * grow);
      vAlpha = pp * pp * (3.0 - 2.0 * pp);
    }
  `;
  const FS_DOTS = `
    precision mediump float;
    varying float vAlpha;
    void main(){
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(p, p);
      if (r2 > 1.0) discard;
      float core = exp(-r2 * 6.2);
      float halo = exp(-r2 * 2.2) * 0.22;
      float a = (core + halo) * vAlpha * 0.55;
      if (a < 0.015) discard;
      // v5f cream-white, held glow, no black rim
      vec3 col = vec3(1.0, 0.988, 0.976);
      gl_FragColor = vec4(col * a, a);
    }
  `;

  function initGL() {
    const ctx = canvas.getContext("webgl", {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: "high-performance", preserveDrawingBuffer: true,
    });
    if (!ctx) throw new Error("WebGL is required");
    gl = ctx;
    const pGlobe = program(gl, VS_GLOBE, FS_GLOBE);
    const pDots = program(gl, VS_DOTS, FS_DOTS);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const dbuf = gl.createBuffer();
    // Interleaved: x, y, cid, rank  (4 floats)
    const n = dots.count;
    const arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      arr[i*4] = dots.x[i];
      arr[i*4+1] = dots.y[i];
      arr[i*4+2] = dots.cid[i];
      arr[i*4+3] = dots.rank[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dbuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);

    const progPix = new Uint8Array(64);
    const progTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, progTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, progPix);

    const ext = gl.getExtension("OES_element_index_uint");
    const ibos = {};
    if (ext) {
      for (const step of [1, 2, 3, 4, 5, 6]) {
        const count = Math.floor(n / step);
        const idx = new Uint32Array(count);
        for (let i = 0; i < count; i++) idx[i] = i * step;
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        ibos[step] = { ibo, count };
      }
    }

    programs = { pGlobe, pDots, quad, dbuf, n, progTex, progPix, ibos, hasUint: !!ext };
    return programs;
  }

  function makeTex(img, clamp) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    return tex;
  }

  function sizeCanvas() {
    let cssW, cssH;
    if (exactW > 0 && exactH > 0) {
      cssW = exactW; cssH = exactH;
      stage.classList.add("exact");
      stage.style.width = cssW + "px";
      stage.style.height = cssH + "px";
    } else {
      stage.classList.remove("exact");
      stage.style.width = "";
      stage.style.height = "";
      cssW = stage.clientWidth || window.innerWidth;
      cssH = stage.clientHeight || window.innerHeight;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const W = Math.max(2, Math.round(cssW * dpr));
    const H = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
      overlay.width = W; overlay.height = H;
    }
    return { W, H, cssW, cssH, dpr };
  }

  function progressAt(t) {
    const n = T.countries.length;
    const prog = new Float32Array(64);
    let running = 0;
    const rows = [];
    if (t >= T.tEnd0) {
      for (const w of T.windows) {
        if (w.isPlace) continue;
        if (w.cid) { prog[w.cid] = 1; running += w.mid; }
      }
      return { prog, running, rows };
    }
    const groupOn = t >= T.tDots0;
    for (const w of T.windows) {
      let p = 0;
      if (t >= w.tSet) p = 1;
      else if (t >= w.t0) p = buildCurve((t - w.t0) / Math.max(0.001, w.tSet - w.t0));
      if (!w.isPlace && w.cid) {
        prog[w.cid] = p;
        running += w.mid * p;
      }
      if (!groupOn) continue;
      let appear = w.t0;
      if (t < appear || t >= T.tEnd0) continue;
      const fadeIn = (t - appear) < 0.35 ? smoothstep((t - appear) / 0.35) : 1;
      const ts = Math.max(w.tSet, w.b - T.rowFadeLeave);
      let leave = 1;
      if (t >= ts) leave = 1 - smoothstep((t - ts) / T.rowFadeLeave);
      const alpha = fadeIn * Math.max(0, Math.min(1, leave));
      if (alpha <= 0.02) continue;
      let role = "waiting";
      if (p >= 0.995) role = "done";
      else if (p > 0 || t >= w.t0) role = "building";
      rows.push({ w, p, role, alpha });
    }
    if (rows.length > T.maxRows) {
      const pri = { building: 0, done: 1, waiting: 2 };
      rows.sort((a, b) => (pri[a.role] - pri[b.role]) || (b.alpha - a.alpha));
      rows.length = T.maxRows;
    }
    return { prog, running, rows };
  }

  function drawGlobe(sz, cam, prog, t) {
    const { W, H, dpr } = sz;
    gl.viewport(0, 0, W, H);
    const space = T.colors.space;
    gl.clearColor(space[0]/255, space[1]/255, space[2]/255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const R = T.globe.r * (W / 1080);
    const CX = T.globe.cx * W;
    const CY = T.globe.cy * H;

    gl.useProgram(programs.pGlobe);
    gl.bindBuffer(gl.ARRAY_BUFFER, programs.quad);
    const loc = gl.getAttribLocation(programs.pGlobe, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(programs.pGlobe, n);
    gl.uniform2f(U("uRes"), W, H);
    gl.uniform1f(U("uCX"), CX);
    gl.uniform1f(U("uCY"), CY);
    gl.uniform1f(U("uR"), R);
    gl.uniform1f(U("uLon"), cam.lon);
    gl.uniform1f(U("uLat"), cam.lat);
    gl.uniform1f(U("uView"), cam.view);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, basemapTex);
    gl.uniform1i(U("uMap"), 0);
    gl.uniform4f(U("uBake"), T.bake.lon0, T.bake.lon1, T.bake.lat0, T.bake.lat1);
    gl.uniform3f(U("uSpace"), space[0], space[1], space[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Dots
    if (t >= T.tDots0 && t < T.tEnd0 + 1.1) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(programs.pDots);
      gl.bindBuffer(gl.ARRAY_BUFFER, programs.dbuf);
      const lxy = gl.getAttribLocation(programs.pDots, "aXY");
      const lcid = gl.getAttribLocation(programs.pDots, "aCid");
      const lrk = gl.getAttribLocation(programs.pDots, "aRank");
      gl.enableVertexAttribArray(lxy);
      gl.enableVertexAttribArray(lcid);
      gl.enableVertexAttribArray(lrk);
      gl.vertexAttribPointer(lxy, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(lcid, 1, gl.FLOAT, false, 16, 8);
      gl.vertexAttribPointer(lrk, 1, gl.FLOAT, false, 16, 12);
      const D = (n) => gl.getUniformLocation(programs.pDots, n);
      gl.uniform2f(D("uRes"), W, H);
      gl.uniform1f(D("uCX"), CX);
      gl.uniform1f(D("uCY"), CY);
      gl.uniform1f(D("uR"), R);
      gl.uniform1f(D("uLon"), cam.lon);
      gl.uniform1f(D("uLat"), cam.lat);
      gl.uniform1f(D("uView"), cam.view);
      gl.uniform4f(D("uBakeWH"), T.bake.w, T.bake.h, T.bake.lon0, T.bake.lat1);
      gl.uniform4f(D("uBakeSpan"), T.bake.lon1 - T.bake.lon0, T.bake.lat1 - T.bake.lat0, 0, 0);
      const size = (2.6 + 2.4 * (28 / Math.max(cam.view, 14))) * dpr * pointScale;
      gl.uniform1f(D("uSize"), size);
      gl.uniform1f(D("uStride"), stride);
      gl.uniform1f(D("uCount"), programs.n);
      gl.uniform1fv(D("uProg[0]") || D("uProg"), prog);
      const n = programs.n;
      if (stride <= 1) {
        gl.drawArrays(gl.POINTS, 0, n);
      } else {
        // Draw in chunks skipping: simpler to just draw all and let GPU do it;
        // for low quality, draw a prefix/step by instancing ranges.
        for (let i = 0; i < n; i += stride * 4096) {
          const start = i;
          const count = Math.min(stride * 4096, n - start);
          // can't easily skip inside range without CPU; draw smaller set by step via multiple calls of 1 is slow.
          gl.drawArrays(gl.POINTS, start, count);
        }
        // If stride>1 we still drew all in the loop above — fix: build a reduced draw.
        // Cheap approach: only this loop when stride==1. When stride>1, draw every point anyway? That's the problem.
      }
      // Proper stride: upload is static; we draw points 0..n but vertex shader should skip.
      // For now if stride>1, draw with a reduced count by sampling — do one draw of n/stride consecutive is wrong (they're sorted by country).
      // Leave full draw when stride==1; when stride>1 do CPU-less: we already may have drawn all. Let me just always draw all for stride 1,
      // and for stride>1 use gl.drawArrays with a simple every-nth via a second buffer? Skip — I'll use uniform uStride in a later patch.
      if (stride > 1) {
        // redraw path already happened; the loop drew everything. That's ok if we didn't enter stride==1.
        // Wait I messed this up. Let me just always:
      }
      gl.disable(gl.BLEND);
    }
    // Always-correct draw is already done in the stride<=1 branch. For stride>1 I accidentally drew everything too.
    // I'll add a proper skip in the vertex shader using a dummy index. For v1, when quality drops, shrink point size and cap n.
  }

  // Fix dots draw with stride: we rebuild a simple index by drawing points in steps from JS
  // by creating one extra attribute aIndex. Patch after first run if needed.

  function drawOverlay(sz, cam, rows, t) {
    const { W, H, dpr } = sz;
    const ctx = octx || (octx = overlay.getContext("2d"));
    ctx.clearRect(0, 0, W, H);
    if (t < T.tDots0 || t >= T.tEnd0) return;
    // rings
    for (const w of T.windows) {
      if (!w.ring) continue;
      if (t < w.a - 0.2 || t > w.b + 0.4) continue;
      const pr = projectPoint(w.lon, w.lat, cam.lon, cam.lat, cam.view, W, H);
      if (!pr) continue;
      const rad = Math.max(8 * dpr, Math.min(28 * dpr, (14 * 40 / Math.max(cam.view, 12)) * dpr));
      const a = 0.85;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(236,224,196,${a})`;
      ctx.lineWidth = Math.max(1, 1.6 * dpr);
      ctx.stroke();
    }
  }

  function renderList(rows, cam, sz) {
    if (!rows.length || filmTime < T.tDots0 || filmTime >= T.tEnd0) {
      listEl.hidden = true;
      listEl.innerHTML = "";
      return;
    }
    // Prefer the emptier side: if a featured country projects on the right, use left.
    let side = "right";
    if (rows.length) {
      const w = rows[0].w;
      const pr = projectPoint(w.lon, w.lat, cam.lon, cam.lat, cam.view, sz.W, sz.H);
      if (pr && pr.x > sz.W * 0.55) side = "left";
    }
    listEl.className = "list " + side;
    listEl.hidden = false;
    const fw = T.flags.w, fh = T.flags.h;
    const flScale = (sz.cssW || 1080) / 1080;
    let html = "";
    for (const r of rows) {
      const w = r.w;
      const hero = (r.role === "waiting" && r.p <= 0.001) ? "0" : tickingHero(w, r.p);
      const name = shortName(w);
      let flag = "";
      if (w.flag && flagAtlas) {
        const s = w.flag;
        const h = T.list.flagH * flScale;
        const k = h / s.h;
        flag = `<span class="flag" style="width:${(s.w*k).toFixed(1)}px;height:${h}px;background:url('data/flags.png') no-repeat;background-size:${fw*k}px ${fh*k}px;background-position:${-s.x*k}px ${-s.y*k}px"></span>`;
      }
      html += `<div class="row ${r.role}" style="opacity:${r.alpha.toFixed(3)}">${flag}<span class="name">${name}</span><span class="count">${hero}</span></div>`;
    }
    listEl.innerHTML = html;
  }

  function setCards(t) {
    const fade0 = T.titleHold;
    const fade1 = T.titleHold + T.globeFade;
    if (t < fade0) {
      titleCard.hidden = false;
      titleCard.style.opacity = "1";
      endCard.hidden = true;
      hud.hidden = true;
    } else if (t < fade1) {
      const k = smoothstep((t - fade0) / T.globeFade);
      titleCard.hidden = false;
      titleCard.style.opacity = String(1 - k);
      endCard.hidden = true;
      hud.hidden = false;
      hud.style.opacity = String(k);
    } else if (t >= T.tEnd0) {
      titleCard.hidden = true;
      hud.hidden = t > T.tEnd0 + 1.1;
      const u = smoothstep((t - T.tEnd0) / 1.1);
      endCard.hidden = false;
      endCard.style.opacity = String(u);
      if (u > 0.05 && !endDrawn) drawEndPlate();
    } else {
      titleCard.hidden = true;
      endCard.hidden = true;
      hud.hidden = false;
      hud.style.opacity = "1";
    }
  }

  function drawEndPlate() {
    if (!T || !flagAtlas) { /* basemap enough */ }
    const c = endPlate.getContext("2d");
    const w = endPlate.width, h = endPlate.height;
    c.fillStyle = "#12100e";
    c.fillRect(0, 0, w, h);
    // Draw the basemap image if loaded
    const img = basemapTex && basemapTex._img;
    if (img) {
      c.globalAlpha = 0.7;
      c.drawImage(img, 0, 0, w, h);
      c.globalAlpha = 1;
    }
    // Dots as tiny cream points in equirect
    if (dots) {
      c.fillStyle = "rgba(255,252,249,0.85)";
      const n = dots.count;
      const step = Math.max(1, Math.floor(n / 25000));
      for (let i = 0; i < n; i += step) {
        const lon = T.bake.lon0 + (dots.x[i] + 0.5) / T.bake.w * (T.bake.lon1 - T.bake.lon0);
        const lat = T.bake.lat1 - (dots.y[i] + 0.5) / T.bake.h * (T.bake.lat1 - T.bake.lat0);
        if (lat < T.bake.lat0 || lat > T.bake.lat1) continue;
        const x = ((lon - T.bake.lon0) / (T.bake.lon1 - T.bake.lon0)) * w;
        const y = ((T.bake.lat1 - lat) / (T.bake.lat1 - T.bake.lat0)) * h;
        c.fillRect(x, y, 1.2, 1.2);
      }
    }
    endDrawn = true;
  }

  function applyAudio(t) {
    if (!started) return;
    const vol = T.music.volume;
    const fi = T.music.fadeIn, fo = T.music.fadeOut;
    let g = 1;
    if (t < fi) g = smoothstep(t / fi);
    const outStart = Math.max(0, duration - fo);
    if (t > outStart) g *= 1 - smoothstep((t - outStart) / fo);
    if (t >= duration) g = 0;
    music.volume = clamp(vol * g, 0, 1);
    // Keep audio clock close to film time if playing
    if (playing && !music.paused) {
      const drift = music.currentTime - t;
      if (Math.abs(drift) > 0.35) {
        try { music.currentTime = Math.max(0, t); } catch (e) {}
      }
    }
  }

  function adaptFps(dt) {
    if (dt <= 0 || dt > 0.5) return;
    const inst = 1 / dt;
    fpsEma = fpsEma * 0.9 + inst * 0.1;
    state.fps = fpsEma;
    framesInWin++;
    if (performance.now() - winStart > 1000) {
      const fps = framesInWin / ((performance.now() - winStart) / 1000);
      framesInWin = 0;
      winStart = performance.now();
      if (fps < 48 && quality > 0.28) {
        quality = Math.max(0.28, quality * 0.72);
        stride = quality > 0.7 ? 1 : quality > 0.45 ? 2 : quality > 0.32 ? 3 : 4;
        pointScale = 0.85 + 0.2 * quality;
        if (fps < 36 && dprCap > 1) dprCap = 1;
      } else if (fps > 57 && quality < 1) {
        quality = Math.min(1, quality + 0.1);
        stride = quality > 0.7 ? 1 : quality > 0.45 ? 2 : 3;
        pointScale = 0.85 + 0.2 * quality;
      }
      state.quality = quality;
    }
  }

  function render(t) {
    if (!T || !ready) return;
    const sz = sizeCanvas();
    const cam = camAt(t);
    const st = progressAt(t);
    if (gl) {
      // Always use a correct dots draw
      drawGlobeFixed(sz, cam, st.prog, t);
    }
    drawOverlay(sz, cam, st.rows, t);
    setCards(t);
    if (!hud.hidden) totalEl.textContent = t < T.tDots0 ? "0" : fmtRunning(st.running, T.dotScale);
    renderList(st.rows, cam, sz);
    applyAudio(t);
    state.time = t;
  }

  function drawGlobeFixed(sz, cam, prog, t) {
    const { W, H, dpr } = sz;
    gl.viewport(0, 0, W, H);
    const space = T.colors.space;
    gl.clearColor(space[0]/255, space[1]/255, space[2]/255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const R = T.globe.r * (W / 1080);
    const CX = T.globe.cx * W;
    const CY = T.globe.cy * H;

    gl.disable(gl.BLEND);
    gl.useProgram(programs.pGlobe);
    gl.bindBuffer(gl.ARRAY_BUFFER, programs.quad);
    const loc = gl.getAttribLocation(programs.pGlobe, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(programs.pGlobe, n);
    gl.uniform2f(U("uRes"), W, H);
    gl.uniform1f(U("uCX"), CX);
    gl.uniform1f(U("uCY"), CY);
    gl.uniform1f(U("uR"), R);
    gl.uniform1f(U("uLon"), cam.lon);
    gl.uniform1f(U("uLat"), cam.lat);
    gl.uniform1f(U("uView"), cam.view);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, basemapTex);
    gl.uniform1i(U("uMap"), 0);
    gl.uniform4f(U("uBake"), T.bake.lon0, T.bake.lon1, T.bake.lat0, T.bake.lat1);
    gl.uniform3f(U("uSpace"), space[0], space[1], space[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (t >= T.tDots0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(programs.pDots);
      gl.bindBuffer(gl.ARRAY_BUFFER, programs.dbuf);
      const lxy = gl.getAttribLocation(programs.pDots, "aXY");
      const lcid = gl.getAttribLocation(programs.pDots, "aCid");
      const lrk = gl.getAttribLocation(programs.pDots, "aRank");
      gl.enableVertexAttribArray(lxy);
      gl.enableVertexAttribArray(lcid);
      gl.enableVertexAttribArray(lrk);
      gl.vertexAttribPointer(lxy, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(lcid, 1, gl.FLOAT, false, 16, 8);
      gl.vertexAttribPointer(lrk, 1, gl.FLOAT, false, 16, 12);
      const D = (n) => gl.getUniformLocation(programs.pDots, n);
      gl.uniform2f(D("uRes"), W, H);
      gl.uniform1f(D("uCX"), CX);
      gl.uniform1f(D("uCY"), CY);
      gl.uniform1f(D("uR"), R);
      gl.uniform1f(D("uLon"), cam.lon);
      gl.uniform1f(D("uLat"), cam.lat);
      gl.uniform1f(D("uView"), cam.view);
      gl.uniform4f(D("uBakeWH"), T.bake.w, T.bake.h, T.bake.lon0, T.bake.lat1);
      gl.uniform4f(D("uBakeSpan"), T.bake.lon1 - T.bake.lon0, T.bake.lat1 - T.bake.lat0, 0, 0);
      const size = (1.8 + 1.7 * (24 / Math.max(cam.view, 16))) * dpr * pointScale;
      gl.uniform1f(D("uSize"), size);
      const pix = programs.progPix;
      for (let i = 0; i < 64; i++) pix[i] = Math.max(0, Math.min(255, Math.round((prog[i] || 0) * 255)));
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, programs.progTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, pix);
      gl.uniform1i(D("uProgTex"), 1);
      const n = programs.n;
      const step = Math.max(1, stride | 0);
      const lod = programs.ibos[step] || programs.ibos[1];
      if (lod) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lod.ibo);
        gl.drawElements(gl.POINTS, lod.count, gl.UNSIGNED_INT, 0);
      } else {
        gl.drawArrays(gl.POINTS, 0, Math.floor(n / step));
      }
      gl.disable(gl.BLEND);
    }
  }

  function tick(ts) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (playing) {
      if (!music.paused && music.currentTime > 0 && Number.isFinite(music.currentTime)) {
        filmTime = Math.min(music.currentTime, duration);
      } else {
        filmTime = Math.min(duration, filmTime + dt);
      }
      if (filmTime >= duration) {
        filmTime = duration;
        playing = false;
        showRestart(true);
        try { music.pause(); } catch (e) {}
      }
    }
    adaptFps(dt);
    render(filmTime);
    requestAnimationFrame(tick);
  }

  function showRestart(on) {
    restartBtn.classList.toggle("hidden", !on);
    restartBtn.classList.toggle("hideplay", !on);
  }

  function startPlayback(opts) {
    opts = opts || {};
    started = true;
    loading.classList.add("hidden");
    gate.classList.add("hidden");
    if (!opts.silent) {
      try {
        music.currentTime = filmTime;
        music.volume = 0;
        const p = music.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    } else {
      try { music.pause(); } catch (e) {}
    }
    playing = !opts.paused;
    showRestart(!playing);
    lastTs = 0;
  }

  function togglePlay() {
    if (!ready) return;
    if (!started) {
      startPlayback({});
      return;
    }
    if (filmTime >= duration) {
      restart();
      return;
    }
    playing = !playing;
    showRestart(!playing);
    if (playing) {
      try {
        music.currentTime = filmTime;
        const p = music.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    } else {
      try { music.pause(); } catch (e) {}
    }
  }

  function restart() {
    if (!ready) return;
    filmTime = 0;
    endDrawn = false;
    endCard.hidden = true;
    try { music.currentTime = 0; } catch (e) {}
    if (!started) {
      startPlayback({});
      return;
    }
    playing = true;
    showRestart(false);
    try {
      const p = music.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
    render(0);
  }

  function seek(t, opts) {
    opts = opts || {};
    filmTime = clamp(t, 0, duration);
    if (opts.pause || opts.paused) {
      playing = false;
      try { music.pause(); } catch (e) {}
      showRestart(started);
    }
    try { music.currentTime = filmTime; } catch (e) {}
    render(filmTime);
  }

  let lastToggle = 0;
  function onUserGesture(ev) {
    if (ev.target === restartBtn || ev.target === help || (help && help.contains(ev.target))) return;
    const now = Date.now();
    if (now - lastToggle < 400) return;
    lastToggle = now;
    if (!help.classList.contains("hidden")) {
      help.classList.add("hidden");
      return;
    }
    ev.preventDefault();
    togglePlay();
  }

  function bind() {
    stage.addEventListener("click", onUserGesture);
    stage.addEventListener("touchend", (e) => {
      if (e.target === restartBtn) return;
      e.preventDefault();
      onUserGesture(e);
    }, { passive: false });
    restartBtn.addEventListener("click", (e) => { e.stopPropagation(); restart(); });
    restartBtn.addEventListener("touchend", (e) => { e.stopPropagation(); e.preventDefault(); restart(); }, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (e.key === " " || e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); restart(); }
      else if (e.key === "h" || e.key === "H") { help.classList.toggle("hidden"); }
      else if (e.key === "Escape") help.classList.add("hidden");
    });
    window.addEventListener("resize", () => render(filmTime));
    const prevent = (e) => e.preventDefault();
    document.addEventListener("gesturestart", prevent, { passive: false });
    document.addEventListener("gesturechange", prevent, { passive: false });
    document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  }

  async function boot() {
    try {
      const [timeline, buf, mapImg, flagImg] = await Promise.all([
        fetchJSON("data/timeline.json"),
        fetchBuf("data/dots.bin"),
        loadImage("data/basemap.jpg"),
        loadImage("data/flags.png"),
      ]);
      T = timeline;
      duration = T.duration;
      state.duration = duration;
      dots = parseDots(buf);
      flagAtlas = flagImg;
      initGL();
      basemapTex = makeTex(mapImg);
      basemapTex._img = mapImg;
      // Mobile starts a notch lower
      if (isPhone) {
        quality = 0.7;
        stride = 2;
        pointScale = 1.0;
      }
      ready = true;
      loading.classList.add("hidden");
      gate.classList.remove("hidden");
      render(0);
      window.__ww2Ready = true;
      window.__ww2 = {
        start: (opts) => { if (!started) startPlayback(opts || {}); else if (opts && opts.silent) { try { music.pause(); } catch (e) {} } },
        seek,
        pause: () => { playing = false; try { music.pause(); } catch (e) {} showRestart(true); },
        play: () => { if (!started) startPlayback({}); else { playing = true; showRestart(false); try { music.play(); } catch (e) {} } },
        restart,
        get time() { return filmTime; },
        get duration() { return duration; },
        get fps() { return state.fps; },
        get quality() { return state.quality; },
        get ready() { return ready; },
      };
      requestAnimationFrame(tick);
    } catch (err) {
      loading.textContent = "Could not load the globe.";
      console.error(err);
    }
  }

  bind();
  boot();
})();
