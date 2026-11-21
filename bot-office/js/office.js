import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const COLORS = {
  working: 0x3ee08a,
  idle: 0xe8c35a,
  stuck: 0xff5a5a,
  stuckq: 0xff5a5a,
  unknown: 0x6b7394,
};
const HEX = {
  working: '#3ee08a',
  idle: '#e8c35a',
  stuck: '#ff5a5a',
  stuckq: '#ff5a5a',
  unknown: '#6b7394',
};
const BODY = [
  0xe8c35a, 0x6ea8ff, 0xc9b8ff, 0x7ad0c6, 0xff8a5b,
  0x8ec8ff, 0xf0a6ca, 0x9ad06a, 0xffc56e, 0x7aa7ff,
  0xd4a574, 0xe07a7a, 0x8ab4f8, 0x5ecf9a,
];
const REFRESH_MS = 30000;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('view');
const labelLayer = document.getElementById('labels');
const loading = document.getElementById('loading');
const errBox = document.getElementById('err');
const hint = document.getElementById('hint');
const countsEl = document.getElementById('counts');
const cardEl = document.getElementById('card');
const listPanel = document.getElementById('listPanel');
const listBody = document.getElementById('listBody');
const listBtn = document.getElementById('listBtn');

let data = { bots: [], stuckAfterMinutes: 120 };
let selectedId = null;
let stations = [];
let lookTarget = null;
let lookCam = null;

const clock = new THREE.Clock();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setClearColor(0x070b18, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer({ element: labelLayer });
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x070b18, 28, 55);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 90);
camera.position.set(0, 12, -13);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.5, 1.4);
controls.minDistance = 6;
controls.maxDistance = 30;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI / 2.15;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.35;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hits = [];
const tmp = new THREE.Vector3();

let userMoved = false;
controls.addEventListener('start', () => { userMoved = true; controls.autoRotate = false; });

function frameOffice() {
  const w = appWidth();
  const h = appHeight();
  const portrait = h > w * 1.05;
  if (portrait) {
    // Look in from the side so the long axis of the office uses the tall screen.
    camera.position.set(-19.4, 16.6, -4.4);
    controls.target.set(-0.2, 0.2, 0.15);
    camera.fov = 62;
  } else {
    camera.position.set(0, 12.4, -14.2);
    controls.target.set(0, 0.2, 0.6);
    camera.fov = 42;
  }
  camera.updateProjectionMatrix();
}

function resize() {
  const w = appWidth();
  const h = appHeight();
  camera.aspect = w / Math.max(1, h);
  if (!userMoved) frameOffice();
  else camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
}
function appWidth() { return Math.max(1, canvas.clientWidth || innerWidth); }
function appHeight() { return Math.max(1, canvas.clientHeight || innerHeight); }

function cityTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#152048');
  g.addColorStop(0.5, '#1c2748');
  g.addColorStop(1, '#241a38');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // faint moon
  ctx.fillStyle = '#e8d9a8';
  ctx.beginPath();
  ctx.arc(820, 70, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#141c38';
  ctx.beginPath();
  ctx.arc(828, 66, 14, 0, Math.PI * 2);
  ctx.fill();
  const rng = (s) => { let x = s; return () => (x = (x * 16807) % 2147483647) / 2147483647; };
  const r = rng(42);
  for (let i = 0; i < 18; i++) {
    const x = 20 + r() * 980;
    const w = 40 + r() * 90;
    const h = 80 + r() * 260;
    const y = 512 - h;
    ctx.fillStyle = r() > 0.5 ? '#0b1020' : '#121a32';
    ctx.fillRect(x, y, w, h);
    const cols = Math.max(2, Math.floor(w / 12));
    const rows = Math.max(3, Math.floor(h / 14));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (r() > 0.42) continue;
        const lit = r();
        ctx.fillStyle = lit > 0.8 ? '#ffe9a8' : lit > 0.45 ? '#e8c35a' : '#8eb6ff';
        ctx.fillRect(x + 4 + col * 12, y + 8 + row * 14, 6, 8);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function signTexture(title, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = '#e8c35a';
  ctx.font = '700 64px "Playfair Display", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 512, 110);
  ctx.font = '600 28px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9aa3c4';
  ctx.letterSpacing = '6px';
  ctx.fillText(sub, 512, 175);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function mat(color, rest = {}) {
  const { roughness, metalness, ...other } = rest;
  return new THREE.MeshLambertMaterial({ color, ...other });
}

function box(g, w, h, d, material, x, y, z, parent) {
  const m = new THREE.Mesh(g || new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

function buildRoom() {
  const room = new THREE.Group();
  scene.add(room);

  const floorMat = mat(0x1c2442);
  box(null, 24, 0.12, 18, floorMat, 0, -0.06, 0, room);

  const runner = box(null, 2.4, 0.02, 14.5, mat(0x2a2414, { emissive: 0xe8c35a, emissiveIntensity: 0.07, roughness: 0.55 }), 0, 0.01, 0.2, room);

  const wall = mat(0x222a48);
  const trim = mat(0x0e1426);
  // side walls
  box(null, 0.16, 5, 18, wall, -11.08, 2.4, 0, room);
  box(null, 0.16, 5, 18, wall, 11.08, 2.4, 0, room);
  // open entrance: low rail and posts so the camera can see every desk
  box(null, 24, 0.7, 0.16, wall, 0, 0.35, -8.08, room);
  box(null, 0.28, 5, 0.28, wall, -11.0, 2.4, -8.08, room);
  box(null, 0.28, 5, 0.28, wall, 11.0, 2.4, -8.08, room);
  // back wall pieces around windows
  box(null, 24, 1.15, 0.16, wall, 0, 0.5, 8.08, room);
  box(null, 24, 1.1, 0.16, wall, 0, 4.45, 8.08, room);
  box(null, 2.4, 3.0, 0.16, wall, -10.8, 2.4, 8.08, room);
  box(null, 2.4, 3.0, 0.16, wall, 10.8, 2.4, 8.08, room);
  box(null, 1.1, 3.0, 0.16, wall, -3.7, 2.4, 8.08, room);
  box(null, 1.1, 3.0, 0.16, wall, 3.7, 2.4, 8.08, room);
  box(null, 1.1, 3.0, 0.16, wall, 0, 2.4, 8.08, room);

  // window frames + glass
  const glass = mat(0x8eb4ff, { roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.12, emissive: 0x6ea8ff, emissiveIntensity: 0.08 });
  const windows = [-7.4, -1.85, 1.85, 7.4];
  for (const x of windows) {
    box(null, 5.2, 3.05, 0.08, trim, x, 2.4, 8.02, room);
    box(null, 4.9, 2.75, 0.04, glass, x, 2.4, 8.0, room);
  }

  const city = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 10),
    new THREE.MeshBasicMaterial({ map: cityTexture() })
  );
  city.position.set(0, 2.6, 9.4);
  room.add(city);

  // open top (camera looks in from above) with hanging light panels and a cornice
  box(null, 24, 0.1, 0.14, wall, 0, 4.95, 8.08, room);
  box(null, 24, 0.1, 0.14, wall, 0, 4.95, -8.08, room);
  box(null, 0.14, 0.1, 18, wall, -11.08, 4.95, 0, room);
  box(null, 0.14, 0.1, 18, wall, 11.08, 4.95, 0, room);

  // sign on the window lintel, facing into the room
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.15),
    new THREE.MeshBasicMaterial({ map: signTexture('TUAN MUDA', 'BOT  OFFICE'), transparent: true })
  );
  sign.position.set(0, 4.35, 7.98);
  sign.rotation.y = Math.PI;
  room.add(sign);

  // corner plants
  for (const [x, z] of [[-10.1, 6.8], [10.1, 6.8], [-10.1, -6.8], [10.1, -6.8]]) {
    plant(x, z, room);
  }

  // low meeting table in the aisle
  box(null, 1.6, 0.08, 1.6, mat(0x2a2418, { roughness: 0.45, metalness: 0.15 }), 0, 0.42, 1.0, room);
  box(null, 0.12, 0.42, 0.12, mat(0x1a1610), 0, 0.21, 1.0, room);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), mat(0xe8c35a, { emissive: 0xe8c35a, emissiveIntensity: 0.25, roughness: 0.4 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 0.47, 1.0);
  room.add(disc);

  scene.add(new THREE.HemisphereLight(0xc5d2f0, 0x2a2438, 1.15));
  const sun = new THREE.DirectionalLight(0xe8eeff, 1.35);
  sun.position.set(-4, 12, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xe8c35a, 0.55);
  fill.position.set(4, 8, -10);
  scene.add(fill);
  const warm = new THREE.PointLight(0xffe3a0, 2.2, 28, 1.6);
  warm.position.set(0, 4.4, 0.5);
  scene.add(warm);
  scene.add(new THREE.AmbientLight(0x6a7394, 0.55));
}

function plant(x, z, parent) {
  const pot = box(null, 0.38, 0.28, 0.38, mat(0x2a2438, { roughness: 0.6 }), x, 0.14, z, parent);
  const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), mat(0x2f6a4a, { roughness: 0.85 }));
  foliage.position.set(x, 0.55, z);
  foliage.scale.set(1, 1.15, 1);
  parent.add(foliage);
  const foliage2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat(0x3e8a5c, { roughness: 0.85 }));
  foliage2.position.set(x + 0.12, 0.7, z - 0.05);
  parent.add(foliage2);
}

function deskLayout(count) {
  // 4 at the windows facing the aisle, 5 along each side wall facing in
  const spots = [];
  for (const x of [-4.8, -1.6, 1.6, 4.8]) spots.push({ x, z: 6.15, rot: Math.PI });
  const zs = [3.35, 1.0, -1.3, -3.55, -5.75];
  for (const z of zs) spots.push({ x: -7.35, z, rot: -Math.PI / 2 });
  for (const z of zs) spots.push({ x: 7.35, z, rot: Math.PI / 2 });
  return spots.slice(0, count);
}

function makeDesk(bot, index, spot) {
  const group = new THREE.Group();
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.rot;
  scene.add(group);

  const wood = mat(0x5a3d28);
  const dark = mat(0x1c1814);
  const gold = mat(0xe8c35a, { emissive: 0xe8c35a, emissiveIntensity: 0.18 });

  box(null, 1.7, 0.07, 0.85, wood, 0, 0.74, 0, group);
  box(null, 1.72, 0.015, 0.87, gold, 0, 0.78, 0, group);
  for (const [lx, lz] of [[-0.74, 0.32], [0.74, 0.32], [-0.74, -0.32], [0.74, -0.32]]) {
    box(null, 0.07, 0.71, 0.07, dark, lx, 0.355, lz, group);
  }

  // monitor
  const bezel = box(null, 0.72, 0.46, 0.05, dark, 0, 1.18, -0.28, group);
  const screenMat = mat(0x0a1020, { emissive: 0x6b7394, emissiveIntensity: 0.4, roughness: 0.2 });
  const screen = box(null, 0.64, 0.38, 0.02, screenMat, 0, 1.18, -0.25, group);
  box(null, 0.08, 0.16, 0.06, dark, 0, 0.9, -0.28, group);

  // chair
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.55);
  group.add(chair);
  box(null, 0.42, 0.06, 0.42, dark, 0, 0.46, 0, chair);
  box(null, 0.42, 0.48, 0.06, dark, 0, 0.72, 0.18, chair);
  box(null, 0.08, 0.46, 0.08, dark, 0, 0.23, 0, chair);

  // avatar
  const bodyCol = BODY[index % BODY.length];
  const avatar = new THREE.Group();
  avatar.position.set(0, 0.49, 0.52);
  group.add(avatar);
  const bodyMat = mat(bodyCol, { roughness: 0.45, metalness: 0.12 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.26, 3, 8), bodyMat);
  body.position.y = 0.32;
  avatar.add(body);
  const headMat = mat(0xf0e6d4, { roughness: 0.5 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), headMat);
  head.position.y = 0.58;
  avatar.add(head);
  const visor = box(null, 0.16, 0.045, 0.04, mat(0x111833, { emissive: 0x6ea8ff, emissiveIntensity: 0.5 }), 0, 0.58, 0.1, avatar);
  const chestMat = mat(0x111833, { emissive: 0x6b7394, emissiveIntensity: 0.8 });
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), chestMat);
  chest.position.set(0, 0.34, 0.12);
  avatar.add(chest);

  // floor glow
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x6b7394, transparent: true, opacity: 0.7, depthWrite: false, depthTest: true });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.04, 0.1);
  group.add(glow);

  // name label
  const lab = document.createElement('div');
  lab.className = 'label';
  lab.innerHTML = '<span class="dot"></span><span class="nm"></span>';
  lab.querySelector('.nm').textContent = bot.name;
  const label = new CSS2DObject(lab);
  label.position.set(0, 1.55, 0.15);
  group.add(label);

  // invisible hit volume
  const hit = box(null, 1.8, 2.0, 1.5, new THREE.MeshBasicMaterial({ visible: false }), 0, 1.0, 0.15, group);
  hit.userData.botId = bot.id;

  const station = {
    id: bot.id,
    group,
    screenMat,
    chestMat,
    visorMat: visor.material,
    glow,
    glowMat,
    avatar,
    avatarBaseY: 0.49,
    label: lab,
    hit,
    lookAt: new THREE.Vector3(spot.x, 0.9, spot.z),
  };
  stations.push(station);
  return station;
}

function displayStatus(bot) {
  const raw = (bot.status || 'unknown').toLowerCase();
  if (!bot.updated) return raw === 'stuck' ? 'stuck' : (raw || 'unknown');
  const ageMin = (Date.now() - Date.parse(bot.updated)) / 60000;
  const limit = Number(data.stuckAfterMinutes) || 120;
  if (Number.isFinite(ageMin) && ageMin > limit) {
    return raw === 'stuck' ? 'stuck' : 'stuckq';
  }
  return raw === 'working' || raw === 'idle' || raw === 'stuck' || raw === 'unknown' ? raw : 'unknown';
}

function statusLabel(code) {
  return code === 'stuckq' ? 'stuck?' : code;
}

function timeAgo(iso) {
  if (!iso) return 'not reported yet';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'not reported yet';
  const sec = Math.round(ms / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return min + ' min ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + ' hour' + (hr === 1 ? '' : 's') + ' ago';
  const day = Math.round(hr / 24);
  return day + ' day' + (day === 1 ? '' : 's') + ' ago';
}

function formatWhen(iso) {
  if (!iso) return 'not reported yet';
  try {
    const d = new Date(iso);
    const clock = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(d);
    return timeAgo(iso) + ' · ' + clock + ' ET';
  } catch {
    return timeAgo(iso);
  }
}

function applyStatus() {
  const counts = { working: 0, idle: 0, stuck: 0, unknown: 0 };
  for (const st of stations) {
    const bot = data.bots.find((b) => b.id === st.id);
    if (!bot) continue;
    const code = displayStatus(bot);
    const bucket = code === 'stuckq' ? 'stuck' : code;
    if (counts[bucket] !== undefined) counts[bucket] += 1;
    const hex = COLORS[code] || COLORS.unknown;
    const css = HEX[code] || HEX.unknown;
    st.screenMat.emissive.setHex(hex);
    st.screenMat.emissiveIntensity = code === 'working' ? 0.85 : code === 'unknown' ? 0.22 : 0.55;
    st.chestMat.emissive.setHex(hex);
    st.chestMat.emissiveIntensity = code === 'unknown' ? 0.35 : 1.1;
    st.glowMat.color.setHex(hex);
    st.glowMat.opacity = code === 'unknown' ? 0.35 : 0.8;
    st.visorMat.emissive.setHex(code === 'unknown' ? 0x334066 : hex);
    const dot = st.label.querySelector('.dot');
    if (dot) { dot.style.background = css; dot.style.color = css; }
    st.label.querySelector('.nm').textContent = bot.name;
    st.code = code;
  }
  countsEl.innerHTML =
    `<span class="c-working"><b>${counts.working}</b> working</span>` +
    `<span class="c-idle"><b>${counts.idle}</b> idle</span>` +
    `<span class="c-stuck"><b>${counts.stuck}</b> stuck</span>` +
    `<span class="c-unknown"><b>${counts.unknown}</b> unknown</span>`;
  renderList();
  if (selectedId) showCard(selectedId);
}

function renderList() {
  listBody.replaceChildren();
  for (const bot of data.bots) {
    const code = displayStatus(bot);
    const css = HEX[code] || HEX.unknown;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row';
    btn.innerHTML =
      `<span class="dot" style="background:${css};color:${css}"></span>` +
      `<div><span class="nm"></span><span class="rl"></span></div>` +
      `<span class="st"></span>` +
      `<p class="tk"></p>` +
      `<p class="ago"></p>`;
    btn.querySelector('.nm').textContent = bot.name;
    btn.querySelector('.rl').textContent = bot.role;
    btn.querySelector('.st').textContent = statusLabel(code);
    btn.querySelector('.st').style.color = css;
    const task = bot.task || '—';
    const when = formatWhen(bot.updated);
    const dup = !bot.updated && task.toLowerCase() === 'not reported yet';
    btn.querySelector('.tk').textContent = dup ? '' : task;
    btn.querySelector('.ago').textContent = when;
    btn.addEventListener('click', () => {
      selectBot(bot.id, true);
      closeList();
    });
    listBody.appendChild(btn);
  }
}

function showCard(id) {
  const bot = data.bots.find((b) => b.id === id);
  if (!bot) { cardEl.hidden = true; return; }
  const code = displayStatus(bot);
  const badge = document.getElementById('cardStatus');
  badge.textContent = statusLabel(code);
  badge.className = 'badge ' + code;
  document.getElementById('cardName').textContent = bot.name;
  document.getElementById('cardRole').textContent = bot.role;
  document.getElementById('cardTask').textContent = bot.task || '—';
  document.getElementById('cardWhen').textContent = formatWhen(bot.updated);
  cardEl.hidden = false;
  hint.classList.add('gone');
}

function selectBot(id, moveCam) {
  selectedId = id;
  const st = stations.find((s) => s.id === id);
  showCard(id);
  if (st) {
    st.glow.scale.set(1.25, 1.25, 1.25);
    for (const other of stations) if (other !== st) other.glow.scale.set(1, 1, 1);
  }
  if (moveCam && st) {
    // Stay inside the room: stand toward the aisle / center and look at the desk.
    const inward = new THREE.Vector3(-st.group.position.x, 0, 1 - st.group.position.z).normalize();
    lookCam = st.lookAt.clone().addScaledVector(inward, 5.4);
    lookCam.y = 4.4;
    lookTarget = st.lookAt.clone();
    controls.autoRotate = false;
  }
}

function clearSelect() {
  selectedId = null;
  cardEl.hidden = true;
  for (const st of stations) st.glow.scale.set(1, 1, 1);
}

function openList() {
  listPanel.hidden = false;
  listBtn.setAttribute('aria-expanded', 'true');
  listBtn.textContent = 'Office';
  controls.enabled = false;
}
function closeList() {
  listPanel.hidden = true;
  listBtn.setAttribute('aria-expanded', 'false');
  listBtn.textContent = 'List';
  controls.enabled = true;
}

listBtn.addEventListener('click', () => {
  if (listPanel.hidden) openList(); else closeList();
});
document.getElementById('listClose').addEventListener('click', closeList);
document.getElementById('cardClose').addEventListener('click', (e) => { e.stopPropagation(); clearSelect(); });

let downX = 0, downY = 0;
canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  hits.length = 0;
  raycaster.intersectObjects(stations.map((s) => s.hit), false, hits);
  if (hits.length) {
    selectBot(hits[0].object.userData.botId, true);
  } else {
    clearSelect();
  }
});

async function loadStatus() {
  const res = await fetch('status.json?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load status.json (' + res.status + ')');
  data = await res.json();
  if (!Array.isArray(data.bots)) data.bots = [];
}

function buildBots() {
  const spots = deskLayout(data.bots.length);
  data.bots.forEach((bot, i) => makeDesk(bot, i, spots[i] || { x: 0, z: 0, rot: 0 }));
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  if (lookCam && lookTarget) {
    camera.position.lerp(lookCam, 0.08);
    controls.target.lerp(lookTarget, 0.1);
    if (camera.position.distanceTo(lookCam) < 0.08) { lookCam = null; lookTarget = null; }
  }
  if (!reduceMotion) {
    for (const st of stations) {
      if (st.code === 'working') {
        st.avatar.position.y = st.avatarBaseY + Math.sin(t * 5 + st.group.position.x) * 0.012;
        st.screenMat.emissiveIntensity = 0.7 + Math.sin(t * 8 + st.group.position.z) * 0.18;
      } else if (st.code === 'stuck' || st.code === 'stuckq') {
        st.glowMat.opacity = 0.28 + Math.abs(Math.sin(t * 3)) * 0.4;
      }
    }
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function showError(msg) {
  errBox.hidden = false;
  errBox.textContent = msg;
}

async function start() {
  resize();
  buildRoom();
  try {
    await loadStatus();
  } catch (e) {
    showError(e.message || 'Could not load bot status.');
    data.bots = [];
  }
  await (document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve());
  buildBots();
  applyStatus();
  resize();
  controls.autoRotate = !reduceMotion;
  loading.classList.add('hide');
  setTimeout(() => loading.remove(), 500);
  animate();
  setInterval(() => {
    loadStatus().then(applyStatus).catch((e) => showError(e.message || 'Refresh failed.'));
  }, REFRESH_MS);
}

addEventListener('resize', resize);
start();
