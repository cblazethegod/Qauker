import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------- config ----------
const CFG = {
  walkSpeed: 300,
  runSpeed: 460,
  accelGround: 14,
  accelAir: 6,
  frictionGround: 7.5,
  frictionAir: 0.4,
  gravity: 860,
  jumpVel: 290,
  mouseSens: 0.0022,
  touchSens: 0.0016,
  playerRadius: 18,
  playerHeight: 56,
  eyeHeight: 46,
  headBob: 0.12,
  hitFlashTime: 0.15,
  armorAbsorb: 0.66,
};

// ---------- state ----------
const state = {
  isMobile: false,
  locked: false,
  gameState: 'MENU', // MENU | PLAYING | GAMEOVER
  time: 0,
  dt: 0,

  keys: { w: false, a: false, s: false, d: false, jump: false, run: false },
  move: new THREE.Vector2(),
  _fire: false,

  player: {
    pos: new THREE.Vector3(0, 28, 0),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: false,
    health: 100,
    armor: 0,
    ammo: 60,
    reserve: 240,
    weapon: 0, // 0 mg, 1 railgun
    weaponNames: ['MACHINE GUN', 'RAILGUN'],
    damageFlash: 0,
    recoil: 0,
  },

  brushes: [],
  enemies: [],
  impacts: [],
  particles: [],
  pickups: [],

  lastShotTime: 0,
  jumpPad: null,

  score: 0,
  wave: 1,
  enemySpawnTimer: 0,
};

// ---------- audio (procedural, Web Audio) ----------
let audioCtx;
function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

function playSound(type) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  const rand = () => Math.random() * 2 - 1;

  if (type === 'shoot') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.06);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.start(t); osc.stop(t + 0.06);
  } else if (type === 'rail') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(60, t + 0.12);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.12);
    osc.start(t); osc.stop(t + 0.12);
  } else if (type === 'jump') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.linearRampToValueAtTime(220, t + 0.05);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.12);
    osc.start(t); osc.stop(t + 0.12);
  } else if (type === 'hit') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.linearRampToValueAtTime(40, t + 0.1);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.1);
    osc.start(t); osc.stop(t + 0.1);
  } else if (type === 'enemyShoot') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.linearRampToValueAtTime(60, t + 0.08);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.08);
    osc.start(t); osc.stop(t + 0.08);
  } else if (type === 'pickup') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.linearRampToValueAtTime(1320, t + 0.07);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.14);
    osc.start(t); osc.stop(t + 0.14);
  } else if (type === 'die') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(30, t + 0.5);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.5);
    osc.start(t); osc.stop(t + 0.5);
  }
}

// ---------- three setup ----------
const canvas = document.getElementById('glCanvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050a05, 0.0035);
scene.background = new THREE.Color(0x050a05);

const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.2, 4000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
dirLight.position.set(100, 200, 100);
scene.add(dirLight);

const controls = new PointerLockControls(camera, document.body);

const hud = {
  healthVal: document.getElementById('healthVal'),
  armorVal: document.getElementById('armorVal'),
  ammoVal: document.getElementById('ammoVal'),
  ammoReserve: document.getElementById('ammoReserve'),
  weapon: document.getElementById('weapon'),
  scoreVal: document.getElementById('scoreVal'),
  msg: document.getElementById('msg'),
};

const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const goScore = document.getElementById('goScore');
const btnStart = document.getElementById('btnStart');
const btnRestart = document.getElementById('btnRestart');

function setMsg(text, temp = 2000) {
  hud.msg.textContent = text;
  hud.msg.style.display = 'block';
  if (temp) setTimeout(() => { hud.msg.style.display = 'none'; }, temp);
}

function showStart() {
  state.gameState = 'MENU';
  startScreen.classList.remove('hidden');
  gameOverScreen.classList.add('hidden');
  controls.unlock();
  setMsg('');
}
function showGameOver() {
  state.gameState = 'GAMEOVER';
  goScore.textContent = 'FINAL SCORE: ' + state.score;
  gameOverScreen.classList.remove('hidden');
  controls.unlock();
}
function startGame() {
  state.gameState = 'PLAYING';
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  setMsg('');
  controls.lock();
}
function restartGame() {
  const p = state.player;
  p.health = 100; p.armor = 0; p.ammo = 60; p.reserve = 240; p.weapon = 0;
  p.pos.set(0, 28, 0); p.vel.set(0, 0, 0);
  state.score = 0; state.wave = 1; state.enemySpawnTimer = 0;
  // reset enemies
  for (const e of state.enemies) { if (e.mesh) scene.remove(e.mesh); }
  state.enemies = [];
  spawnEnemies(6);
  updateHUD();
  startGame();
}

// ---------- damage flash ----------
const flash = document.createElement('div');
flash.id = 'damageFlash';
Object.assign(flash.style, {
  position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 5,
  background: 'rgba(255,0,0,0)', transition: 'background 0.12s linear',
});
document.body.appendChild(flash);

// ---------- weapon model + muzzle flash ----------
const weapon = new THREE.Group();
const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(6, 10, 22),
  new THREE.MeshLambertMaterial({ color: 0x111111 })
);
const gunBarrel = new THREE.Mesh(
  new THREE.BoxGeometry(4, 6, 14),
  new THREE.MeshLambertMaterial({ color: 0x222222 })
);
gunBarrel.position.set(0, -2, -14);
weapon.add(gunBody);
weapon.add(gunBarrel);
weapon.position.set(0.45, -0.55, -0.9);
weapon.scale.setScalar(1.1);
camera.add(weapon);
scene.add(camera);

const muzzleLight = new THREE.PointLight(0x00ff00, 2, 12);
muzzleLight.position.set(0, 0, -22);
gunBarrel.add(muzzleLight);
muzzleLight.visible = false;

const muzzleFlash = new THREE.Mesh(
  new THREE.SphereGeometry(2, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
muzzleFlash.position.set(0, 0, -23);
muzzleFlash.scale.setScalar(0);
gunBarrel.add(muzzleFlash);

let muzzleFlashLife = 0;

// ---------- map ----------
function addBrush(min, max, color) {
  const box = new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(box, mat);
  mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  scene.add(mesh);
  state.brushes.push({ min, max, mesh });
  return { min, max };
}

function buildMap() {
  const F = 520;
  addBrush({ x: -F, y: -24, z: -F }, { x: F, y: 0, z: F }, 0x1a221a);
  const H = 320;
  addBrush({ x: -F, y: 0, z: -F - 24 }, { x: F, y: H, z: -F }, 0x2a332a);
  addBrush({ x: -F, y: 0, z: F }, { x: F, y: H, z: F + 24 }, 0x2a332a);
  addBrush({ x: -F - 24, y: 0, z: -F }, { x: -F, y: H, z: F }, 0x2a332a);
  addBrush({ x: F, y: 0, z: -F }, { x: F + 24, y: H, z: F }, 0x2a332a);

  const pillars = [
    [-260, -260], [260, -260], [-260, 260], [260, 260],
    [-140, 0], [140, 0], [0, -180], [0, 180],
  ];
  for (const [x, z] of pillars) {
    addBrush({ x: x - 30, y: 0, z: z - 30 }, { x: x + 30, y: 200, z: z + 30 }, 0x243024);
  }

  addBrush({ x: -160, y: 96, z: -80 }, { x: -60, y: 120, z: 20 }, 0x2a3a2a);
  addBrush({ x: 60, y: 96, z: -80 }, { x: 160, y: 120, z: 20 }, 0x2a3a2a);
  addBrush({ x: -20, y: 160, z: -200 }, { x: 140, y: 184, z: -120 }, 0x2a3a2a);

  addBrush({ x: -28, y: 0, z: -28 }, { x: 28, y: 8, z: 28 }, 0x44aa44);
  state.jumpPad = { min: { x: -28, y: 0, z: -28 }, max: { x: 28, y: 8, z: 28 } };

  state.pickups = [
    { pos: new THREE.Vector3(0, 8, 0), type: 'health', val: 25, active: true },
    { pos: new THREE.Vector3(300, 30, 300), type: 'ammo', val: 30, active: true },
    { pos: new THREE.Vector3(-300, 30, -300), type: 'armor', val: 25, active: true },
  ];
  for (const p of state.pickups) {
    const g = new THREE.BoxGeometry(14, 14, 14);
    let color = 0xff4444;
    if (p.type === 'ammo') color = 0x44aaff;
    if (p.type === 'armor') color = 0xaaaa44;
    const m = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(p.pos);
    scene.add(mesh);
    p.mesh = mesh;
  }
}

// ---------- input ----------
const keys = state.keys;
window.addEventListener('keydown', (e) => {
  if (state.gameState !== 'PLAYING') return;
  const k = e.code;
  if (k === 'KeyW') keys.w = true;
  if (k === 'KeyS') keys.s = true;
  if (k === 'KeyA') keys.a = true;
  if (k === 'KeyD') keys.d = true;
  if (k === 'ShiftLeft' || k === 'ShiftRight') keys.run = true;
  if (k === 'Space') keys.jump = true;
  if (k === 'Digit1') { state.player.weapon = 0; setMsg(state.player.weaponNames[0]); playSound('pickup'); }
  if (k === 'Digit2') { state.player.weapon = 1; setMsg(state.player.weaponNames[1]); playSound('pickup'); }
});
window.addEventListener('keyup', (e) => {
  const k = e.code;
  if (k === 'KeyW') keys.w = false;
  if (k === 'KeyS') keys.s = false;
  if (k === 'KeyA') keys.a = false;
  if (k === 'KeyD') keys.d = false;
  if (k === 'ShiftLeft' || k === 'ShiftRight') keys.run = false;
  if (k === 'Space') keys.jump = false;
});

// pointer lock desktop
document.body.addEventListener('click', () => {
  if (state.gameState === 'MENU') { startGame(); return; }
  if (state.gameState === 'GAMEOVER') { restartGame(); return; }
  if (!controls.isLocked && !state.isMobile) controls.lock();
});
controls.addEventListener('lock', () => { state.locked = true; });
controls.addEventListener('unlock', () => { state.locked = false; });
document.addEventListener('mousemove', (e) => {
  if (!state.locked || state.gameState !== 'PLAYING') return;
  state.player.yaw -= e.movementX * CFG.mouseSens;
  state.player.pitch -= e.movementY * CFG.mouseSens;
  state.player.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, state.player.pitch));
});

btnStart.addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
btnRestart.addEventListener('click', (e) => { e.stopPropagation(); restartGame(); });

// ---------- mobile controls ----------
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
state.isMobile = isMobile;
const mobileUI = document.getElementById('mobile');
if (isMobile) mobileUI.classList.remove('hidden');

let joyTouchId = null;
let joyStart = { x: 0, y: 0 };
let lookTouchId = null;
let lookStart = { x: 0, y: 0 };
const joyKnob = document.getElementById('joystickKnob');

function setKnob(dx, dy) {
  const r = 44;
  const d = Math.hypot(dx, dy);
  const scale = Math.min(1, d / r);
  const nx = (dx / Math.max(d, 0.001)) * r * scale;
  const ny = (dy / Math.max(d, 0.001)) * r * scale;
  joyKnob.style.transform = `translate(${nx}px, ${ny}px) translate(-50%, -50%)`;
  return new THREE.Vector2(dx / r, dy / r);
}

function touchStart(e) {
  if (state.gameState === 'MENU') { startGame(); }
  if (state.gameState === 'GAMEOVER') { restartGame(); }
  if (!state.started) { state.started = true; }
  for (const t of e.changedTouches) {
    const cx = t.clientX, cy = t.clientY;
    if (cx < window.innerWidth * 0.45 && cy > window.innerHeight * 0.5) {
      joyTouchId = t.identifier; joyStart = { x: cx, y: cy };
      state.move.set(0, 0); setKnob(0, 0);
    } else if (cx > window.innerWidth * 0.45) {
      lookTouchId = t.identifier; lookStart = { x: cx, y: cy };
    }
  }
}
function touchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      state.move.copy(setKnob(t.clientX - joyStart.x, t.clientY - joyStart.y));
    }
    if (t.identifier === lookTouchId) {
      const dx = (t.clientX - lookStart.x) * CFG.touchSens;
      const dy = (t.clientY - lookStart.y) * CFG.touchSens;
      state.player.yaw -= dx;
      state.player.pitch -= dy;
      state.player.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, state.player.pitch));
      lookStart = { x: t.clientX, y: t.clientY };
    }
  }
}
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) { joyTouchId = null; state.move.set(0, 0); setKnob(0, 0); }
    if (t.identifier === lookTouchId) { lookTouchId = null; }
  }
}

if (isMobile) {
  document.addEventListener('touchstart', touchStart, { passive: false });
  document.addEventListener('touchmove', touchMove, { passive: false });
  document.addEventListener('touchend', touchEnd);
  document.addEventListener('touchcancel', touchEnd);

  document.getElementById('btnJump').addEventListener('touchstart', (e) => { e.preventDefault(); keys.jump = true; });
  document.getElementById('btnJump').addEventListener('touchend', (e) => { e.preventDefault(); keys.jump = false; });
  document.getElementById('btnFire').addEventListener('touchstart', (e) => { e.preventDefault(); state._fire = true; });
  document.getElementById('btnFire').addEventListener('touchend', (e) => { e.preventDefault(); state._fire = false; });
  document.getElementById('btnWeapon').addEventListener('touchstart', (e) => { e.preventDefault(); state.player.weapon ^= 1; setMsg(state.player.weaponNames[state.player.weapon]); playSound('pickup'); });
}

// ---------- collision ----------
function brushOverlap(pmin, pmax, b) {
  return pmin.x < b.max.x && pmax.x > b.min.x &&
         pmin.y < b.max.y && pmax.y > b.min.y &&
         pmin.z < b.max.z && pmax.z > b.min.z;
}

function collideSlide(pos, vel, dt, radius, height) {
  const half = height / 2;
  const pmin = new THREE.Vector3(pos.x - radius, pos.y - half, pos.z - radius);
  const pmax = new THREE.Vector3(pos.x + radius, pos.y + half, pos.z + radius);

  let onGround = false;

  const nx = pos.x + vel.x * dt;
  const xmin = new THREE.Vector3(nx - radius, pmin.y, pmin.z);
  const xmax = new THREE.Vector3(nx + radius, pmax.y, pmax.z);
  let hitX = false;
  for (const b of state.brushes) if (brushOverlap(xmin, xmax, b)) { hitX = true; break; }
  if (!hitX) pos.x = nx; else vel.x = 0;

  const nz = pos.z + vel.z * dt;
  const zmin = new THREE.Vector3(pmin.x, pmin.y, nz - radius);
  const zmax = new THREE.Vector3(pmax.x, pmax.y, nz + radius);
  let hitZ = false;
  for (const b of state.brushes) if (brushOverlap(zmin, zmax, b)) { hitZ = true; break; }
  if (!hitZ) pos.z = nz; else vel.z = 0;

  const ny = pos.y + vel.y * dt;
  const ymin = new THREE.Vector3(pos.x - radius, ny - half, pos.z - radius);
  const ymax = new THREE.Vector3(pos.x + radius, ny + half, pmax.z);
  let hitFloor = false, floorY = -1e6, hitCeil = false;
  for (const b of state.brushes) {
    if (!brushOverlap(ymin, ymax, b)) continue;
    if (vel.y < 0 && b.max.y <= pos.y - half + 0.1) { hitFloor = true; floorY = Math.max(floorY, b.max.y); }
    else if (vel.y > 0 && b.min.y >= pos.y + half - 0.1) { hitCeil = true; pos.y = Math.min(pos.y, b.min.y - half); }
  }
  if (hitCeil) vel.y = 0;
  else if (hitFloor) { pos.y = floorY + half; vel.y = 0; onGround = true; }
  else pos.y = ny;

  return onGround;
}

function floorYAt(x, z) {
  let top = -1e6;
  const r = state.playerRadius;
  for (const b of state.brushes) {
    if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) {
      top = Math.max(top, b.max.y);
    }
  }
  return top;
}

// ---------- weapons / hitscan ----------
function addImpact(from, to, color = 0x00ff00) {
  state.impacts.push({ from: from.clone(), to: to.clone(), color, life: 0.18 });
}
function addSpark(pos, dir, color = 0xffff00, count = 4) {
  for (let i = 0; i < count; i++) {
    const spread = new THREE.Vector3(
      (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40
    );
    state.particles.push({ pos: pos.clone(), vel: dir.clone().multiplyScalar(180).add(spread), life: 0.4, maxLife: 0.4, color });
  }
}

function intersectRayBox(origin, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = origin.getComponent(i), d = dir.getComponent(i);
    const mn = min.getComponent(i), mx = max.getComponent(i);
    if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) return null; }
    else {
      const t1 = (mn - o) / d, t2 = (mx - o) / d;
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      tmin = Math.max(tmin, lo); tmax = Math.min(tmax, hi);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return { d: tmin < 0 ? tmax : tmin };
}

function raycastWorld(from, dir, maxDist = 2000) {
  let closest = null, closestD = maxDist;
  for (const b of state.brushes) {
    const hit = intersectRayBox(from, dir, b.min, b.max);
    if (hit && hit.d < closestD) { closestD = hit.d; closest = b; }
  }
  return closest ? { hit: true, d: closestD } : null;
}

function raycastEnemies(origin, dir) {
  let closest = null, closestD = 1800;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const c = new THREE.Vector3().subVectors(e.pos, origin);
    const t = c.dot(dir);
    if (t < 0 || t > 1800) continue;
    const cp = origin.clone().addScaledVector(dir, t);
    if (cp.distanceTo(e.pos) < 34 && t < closestD) { closestD = t; closest = e; }
  }
  return closest;
}

function applyDamage(amount) {
  const p = state.player;
  let dmg = amount;
  if (p.armor > 0) {
    const absorb = Math.min(p.armor, dmg * CFG.armorAbsorb);
    p.armor -= absorb;
    dmg -= absorb;
  }
  p.health = Math.max(0, p.health - dmg);
  p.damageFlash = CFG.hitFlashTime;
  flash.style.background = 'rgba(255,40,40,0.55)';
  updateHUD();
}

function shoot() {
  const p = state.player;
  if (p.ammo <= 0 && p.reserve <= 0) return;
  const now = performance.now() / 1000;
  const cadence = p.weapon === 1 ? 0.75 : 0.09;
  if (now - state.lastShotTime < cadence) return;
  state.lastShotTime = now;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const start = new THREE.Vector3().copy(camera.position);

  p.ammo--;
  if (p.ammo < 0) p.ammo = 0;
  p.recoil = 0.18;
  updateHUD();

  if (p.weapon === 1) playSound('rail'); else playSound('shoot');
  muzzleFlashLife = 0.08;

  const enemyHit = raycastEnemies(start, dir);
  if (enemyHit) {
    enemyHit.health -= (p.weapon === 1 ? 100 : 12);
    addSpark(enemyHit.pos.clone(), dir, 0xff4444, 6);
    if (enemyHit.health <= 0) {
      enemyHit.active = false;
      state.score += 100;
      p.armor = Math.min(150, p.armor + 25);
      setMsg('+100  (' + state.score + ')');
      playSound('die');
    }
  } else {
    const world = raycastWorld(start, dir);
    let hitPos;
    if (world) {
      hitPos = start.clone().addScaledVector(dir, world.d);
      addSpark(hitPos, dir, 0x88ff88, 4);
      addImpact(start, hitPos, 0x00ff00);
    } else {
      hitPos = start.clone().addScaledVector(dir, 2000);
      addImpact(start, hitPos, 0x00ff00);
    }
  }
}

// ---------- enemies ----------
function spawnEnemies(n) {
  const spots = [
    [300, 0, 300], [-300, 0, -300], [300, 0, -300], [-300, 0, 300],
    [0, 0, 400], [400, 0, 0], [-400, 0, 0], [0, 0, -400],
    [200, 0, -200], [-200, 0, 200],
  ];
  for (let i = 0; i < n; i++) {
    const s = spots[i % spots.length];
    const e = {
      pos: new THREE.Vector3(s[0], s[1] + 28, s[2]),
      vel: new THREE.Vector3(), yaw: 0, health: 100, active: true,
      shootTimer: 1 + Math.random() * 1.5, mesh: null,
    };
    const g = new THREE.BoxGeometry(28, 56, 28);
    const m = new THREE.MeshLambertMaterial({ color: 0xaa2222, emissive: 0x220000 });
    e.mesh = new THREE.Mesh(g, m);
    e.mesh.position.copy(e.pos);
    scene.add(e.mesh);
    state.enemies.push(e);
  }
}

function updateEnemies(dt) {
  const p = state.player;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const dirTo = new THREE.Vector3().subVectors(p.pos, e.pos);
    const dist = dirTo.length();
    if (dist < 1e-3) continue;
    const flatDir = new THREE.Vector3(dirTo.x, 0, dirTo.z).normalize();
    e.yaw = Math.atan2(flatDir.x, flatDir.z);

    e.vel.x += (flatDir.x * 170 - e.vel.x) * 4 * dt;
    e.vel.z += (flatDir.z * 170 - e.vel.z) * 4 * dt;
    e.vel.y -= CFG.gravity * dt;

    const radius = 14, half = 28;
    const nx = e.pos.x + e.vel.x * dt;
    const nz = e.pos.z + e.vel.z * dt;
    let hitX = false, hitZ = false;
    const pmin = new THREE.Vector3(e.pos.x - radius, e.pos.y - half, e.pos.z - radius);
    const pmax = new THREE.Vector3(e.pos.x + radius, e.pos.y + half, e.pos.z + radius);
    const xmin = new THREE.Vector3(nx - radius, pmin.y, pmin.z);
    const xmax = new THREE.Vector3(nx + radius, pmax.y, pmax.z);
    for (const b of state.brushes) if (brushOverlap(xmin, xmax, b)) { hitX = true; break; }
    if (!hitX) e.pos.x = nx; else e.vel.x *= -0.3;
    const zmin = new THREE.Vector3(pmin.x, pmin.y, nz - radius);
    const zmax = new THREE.Vector3(pmax.x, pmax.y, nz + radius);
    for (const b of state.brushes) if (brushOverlap(zmin, zmax, b)) { hitZ = true; break; }
    if (!hitZ) e.pos.z = nz; else e.vel.z *= -0.3;

    const floor = floorYAt(e.pos.x, e.pos.z);
    if (e.pos.y - half < floor) { e.pos.y = floor + half; e.vel.y = 0; }
    else e.pos.y += e.vel.y * dt;

    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = e.yaw;
    e.mesh.rotation.z = Math.sin(state.time * 6) * 0.05;

    e.shootTimer -= dt;
    if (e.shootTimer <= 0 && dist < 700) {
      e.shootTimer = 1.6 + Math.random() * 1.2;
      const edir = new THREE.Vector3().subVectors(p.pos, e.pos).normalize();
      const estart = e.pos.clone().add(new THREE.Vector3(0, 30, 0));
      playSound('enemyShoot');
      const c = new THREE.Vector3().subVectors(p.pos, estart);
      const t = c.dot(edir);
      const cp = estart.clone().addScaledVector(edir, t);
      if (t > 0 && t < 700 && cp.distanceTo(p.pos) < 24) {
        applyDamage(14);
        addSpark(p.pos.clone().add(new THREE.Vector3(0, 24, 0)), edir, 0xff4444, 4);
      }
    }
  }
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    if (!e.active && e.mesh) { scene.remove(e.mesh); state.enemies.splice(i, 1); }
  }
  // respawn to keep wave populated
  if (state.enemies.length < 4 + state.wave) {
    state.enemySpawnTimer -= dt;
    if (state.enemySpawnTimer <= 0) {
      state.enemySpawnTimer = 3;
      spawnEnemies(1);
    }
  }
}

// ---------- player physics ----------
function updatePlayer(dt) {
  const p = state.player;
  const wishspeedBase = keys.run ? CFG.runSpeed : CFG.walkSpeed;

  const forward = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  let wish = new THREE.Vector3();
  if (!state.isMobile) {
    if (keys.w) wish.add(forward);
    if (keys.s) wish.sub(forward);
    if (keys.a) wish.sub(right);
    if (keys.d) wish.add(right);
  } else {
    wish.add(forward.clone().multiplyScalar(state.move.y));
    wish.add(right.clone().multiplyScalar(state.move.x));
  }
  const wishLen = wish.length();
  let wishspeed = wishspeedBase;
  if (wishLen > 0) { wish.normalize(); wishspeed *= wishLen; }

  const accel = p.onGround ? CFG.accelGround : CFG.accelAir;
  const currentspeed = p.vel.clone().dot(wish);
  let addspeed = wishspeed - currentspeed;
  if (addspeed > 0) {
    let accelspeed = accel * wishspeed * dt;
    if (accelspeed > addspeed) accelspeed = addspeed;
    p.vel.addScaledVector(wish, accelspeed);
  }

  if (p.onGround) {
    const speed = p.vel.length();
    if (speed > 0.1) {
      const drop = speed * CFG.frictionGround * dt;
      let newspeed = speed - drop;
      if (newspeed < 0) newspeed = 0;
      p.vel.multiplyScalar(newspeed / speed);
    }
  } else {
    p.vel.multiplyScalar(1 - CFG.frictionAir * dt);
  }

  const jumped = keys.jump;
  keys.jump = false;
  if (p.onGround && jumped) {
    p.vel.y = CFG.jumpVel;
    p.onGround = false;
    playSound('jump');
  }

  p.vel.y -= CFG.gravity * dt;

  const jp = state.jumpPad;
  if (p.pos.x > jp.min.x && p.pos.x < jp.max.x && p.pos.z > jp.min.z && p.pos.z < jp.max.z && p.pos.y < 12) {
    p.vel.y = 520;
    p.onGround = false;
    playSound('jump');
  }

  const onGround = collideSlide(p.pos, p.vel, dt, CFG.playerRadius, CFG.playerHeight);

  const floor = floorYAt(p.pos.x, p.pos.z);
  if (p.pos.y - CFG.playerHeight / 2 < floor + 0.5) {
    p.pos.y = floor + CFG.playerHeight / 2;
    if (p.vel.y <= 0) { p.vel.y = 0; p.onGround = true; }
  }
  if (onGround) p.onGround = true;

  const bob = p.onGround && p.vel.length() > 40
    ? Math.sin(state.time * 14) * CFG.headBob * (p.vel.length() / CFG.walkSpeed)
    : 0;
  camera.position.set(p.pos.x, p.pos.y + CFG.eyeHeight + bob, p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

  // weapon bob/recoil
  if (p.recoil > 0) {
    p.recoil = Math.max(0, p.recoil - dt * 8);
    weapon.position.y = -0.55 + p.recoil * 0.4;
    weapon.rotation.x = p.recoil * 1.2;
  } else {
    weapon.position.y = -0.55 + Math.sin(state.time * 12) * 0.02;
    weapon.rotation.x = Math.sin(state.time * 12) * 0.01;
  }
  weapon.position.z = -0.9 - p.recoil * 0.3;

  // pickups
  for (const pk of state.pickups) {
    if (!pk.active) continue;
    if (p.pos.distanceTo(pk.pos) < 40) {
      pk.active = false;
      scene.remove(pk.mesh);
      playSound('pickup');
      if (pk.type === 'health') { p.health = Math.min(100, p.health + pk.val); setMsg('+HEALTH'); }
      else if (pk.type === 'armor') { p.armor = Math.min(150, p.armor + pk.val); setMsg('+ARMOR'); }
      else { p.ammo = Math.min(999, p.ammo + pk.val); setMsg('+AMMO'); }
      updateHUD();
    }
  }

  state.time += dt;
  if (Math.floor(state.time) % 8 === 0 && state.time - dt < Math.floor(state.time)) {
    for (const pk of state.pickups) if (!pk.active && Math.random() < 0.3) { pk.active = true; scene.add(pk.mesh); }
  }

  if (p.health <= 0) {
    p.health = 0;
    playSound('die');
    updateHUD();
    showGameOver();
  }
}

// ---------- render helpers ----------
function renderImpacts() {
  const live = state.impacts.filter(i => (i.life -= state.dt) > 0);
  state.impacts = live;
  if (!live.length) return;
  const pts = [], cols = [];
  for (const i of live) {
    pts.push(i.from.x, i.from.y, i.from.z, i.to.x, i.to.y, i.to.z);
    const c = new THREE.Color(i.color);
    cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  if (!state.impactLine) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
    state.impactLine = new THREE.LineSegments(g, mat);
    scene.add(state.impactLine);
  }
  state.impactLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  state.impactLine.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
  state.impactLine.geometry.attributes.position.needsUpdate = true;
  state.impactLine.geometry.attributes.color.needsUpdate = true;
  state.impactLine.visible = true;
}

function renderParticles() {
  const live = state.particles.filter(pr => (pr.life -= state.dt) > 0);
  state.particles = live;
  if (!live.length) { if (state.particlePts) state.particlePts.visible = false; return; }
  const pos = [], col = [], sizes = [];
  for (const pr of live) {
    const t = pr.life / pr.maxLife;
    pos.push(pr.pos.x, pr.pos.y, pr.pos.z);
    const c = new THREE.Color(pr.color);
    col.push(c.r, c.g, c.b);
    sizes.push(3 * t);
  }
  if (!state.particlePts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(sizes), 1));
    const mat = new THREE.PointsMaterial({ vertexColors: true, sizeAttenuation: false });
    state.particlePts = new THREE.Points(g, mat);
    scene.add(state.particlePts);
  }
  state.particlePts.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  state.particlePts.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  state.particlePts.geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(sizes), 1));
  state.particlePts.geometry.attributes.position.needsUpdate = true;
  state.particlePts.geometry.attributes.color.needsUpdate = true;
  state.particlePts.geometry.attributes.size.needsUpdate = true;
  state.particlePts.visible = true;
  for (const pr of live) {
    pr.pos.addScaledVector(pr.vel, state.dt);
    pr.vel.y -= CFG.gravity * 0.6 * state.dt;
    pr.vel.multiplyScalar(1 - 4 * state.dt);
  }
}

function updateWeaponFlash(dt) {
  if (muzzleFlashLife > 0) {
    muzzleFlashLife -= dt;
    const s = muzzleFlashLife / 0.08;
    muzzleFlash.scale.setScalar(s * 2.5);
    muzzleLight.visible = s > 0;
    if (muzzleFlashLife <= 0) muzzleFlash.scale.setScalar(0);
  } else {
    muzzleLight.visible = false;
  }
}

function updateHUD() {
  const p = state.player;
  hud.healthVal.textContent = p.health;
  hud.armorVal.textContent = p.armor;
  hud.ammoVal.textContent = p.ammo;
  hud.ammoReserve.textContent = p.reserve;
  hud.weapon.textContent = p.weaponNames[p.weapon];
  hud.scoreVal.textContent = state.score;
  hud.healthVal.style.color = p.health > 40 ? '#0f0' : p.health > 15 ? '#ff0' : '#f00';
}

// ---------- fire trigger ----------
function maybeFire() {
  if (state._fire && state.gameState === 'PLAYING') { shoot(); state._fire = false; }
}

// ---------- main loop ----------
let lastTime = performance.now() / 1000;
function loop() {
  const now = performance.now() / 1000;
  let dt = now - lastTime;
  lastTime = now;
  if (dt > 0.05) dt = 0.05;
  state.dt = dt;
  state.time += dt;

  if (state.gameState === 'PLAYING') {
    maybeFire();
    updatePlayer(dt);
    updateEnemies(dt);
    updateHUD();
  }

  renderImpacts();
  renderParticles();
  updateWeaponFlash(dt);

  if (state.player.damageFlash > 0) {
    state.player.damageFlash -= dt;
    const a = Math.max(0, state.player.damageFlash / CFG.hitFlashTime) * 0.55;
    flash.style.background = `rgba(255,40,40,${a})`;
  } else {
    flash.style.background = 'rgba(255,0,0,0)';
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- init ----------
buildMap();
spawnEnemies(6);
updateHUD();
showStart();
loop();
