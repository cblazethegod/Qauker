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
  maxSlope: 0.7,
  mouseSens: 0.0022,
  touchSens: 0.0016,
  playerRadius: 18,
  playerHeight: 56,
  eyeHeight: 46,
  headBob: 0.12,
  hitFlashTime: 0.15,
};

// ---------- state ----------
const state = {
  isMobile: false,
  locked: false,
  started: false,
  time: 0,
  dt: 0,

  keys: { w: false, a: false, s: false, d: false, jump: false, run: false },
  move: new THREE.Vector2(), // joystick dir
  look: new THREE.Vector2(), // touch look delta

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
  },

  brushes: [], // {min, max, color, mat}
  enemies: [],
  impacts: [], // {from,to,color,life}
  particles: [],

  shootCooldown: 0,
  lastShotTime: 0,

  score: 0,
};

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
  msg: document.getElementById('msg'),
};

function setMsg(text, temp = 2000) {
  hud.msg.textContent = text;
  hud.msg.style.display = 'block';
  if (temp) setTimeout(() => { hud.msg.style.display = 'none'; }, temp);
}

// ---------- damage flash overlay ----------
const flash = document.createElement('div');
flash.id = 'damageFlash';
Object.assign(flash.style, {
  position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 5,
  background: 'rgba(255,0,0,0)', transition: 'background 0.12s linear',
});
document.body.appendChild(flash);

function applyDamageFlash() {
  state.player.damageFlash = CFG.hitFlashTime;
  flash.style.background = 'rgba(255,40,40,0.55)';
}

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
  // floor
  addBrush({ x: -F, y: -24, z: -F }, { x: F, y: 0, z: F }, 0x1a221a);
  // outer walls
  const H = 320;
  addBrush({ x: -F, y: 0, z: -F - 24 }, { x: F, y: H, z: -F }, 0x2a332a);   // back
  addBrush({ x: -F, y: 0, z: F }, { x: F, y: H, z: F + 24 }, 0x2a332a);      // front
  addBrush({ x: -F - 24, y: 0, z: -F }, { x: -F, y: H, z: F }, 0x2a332a);    // left
  addBrush({ x: F, y: 0, z: -F }, { x: F + 24, y: H, z: F }, 0x2a332a);      // right

  // pillars
  const pillars = [
    [-260, -260], [260, -260], [-260, 260], [260, 260],
    [-140, 0], [140, 0], [0, -180], [0, 180],
  ];
  for (const [x, z] of pillars) {
    addBrush({ x: x - 30, y: 0, z: z - 30 }, { x: x + 30, y: 200, z: z + 30 }, 0x243024);
  }

  // platforms
  addBrush({ x: -160, y: 96, z: -80 }, { x: -60, y: 120, z: 20 }, 0x2a3a2a);
  addBrush({ x: 60, y: 96, z: -80 }, { x: 160, y: 120, z: 20 }, 0x2a3a2a);
  addBrush({ x: -20, y: 160, z: -200 }, { x: 140, y: 184, z: -120 }, 0x2a3a2a);

  // jump pad center
  addBrush({ x: -28, y: 0, z: -28 }, { x: 28, y: 8, z: 28 }, 0x44aa44);
  state.jumpPad = { min: { x: -28, y: 0, z: -28 }, max: { x: 28, y: 8, z: 28 } };

  // weapon/health pickups visual (simple floating boxes)
  state.pickups = [
    { pos: new THREE.Vector3(0, 8, 0), type: 'health', val: 25, active: true },
    { pos: new THREE.Vector3(300, 30, 300), type: 'ammo', val: 30, active: true },
  ];
  for (const p of state.pickups) {
    const g = new THREE.BoxGeometry(14, 14, 14);
    const m = new THREE.MeshLambertMaterial({ color: p.type === 'health' ? 0xff4444 : 0x44aaff });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(p.pos);
    scene.add(mesh);
    p.mesh = mesh;
  }
}

// ---------- input ----------
const keys = state.keys;
window.addEventListener('keydown', (e) => {
  const k = e.code;
  if (k === 'KeyW') keys.w = true;
  if (k === 'KeyS') keys.s = true;
  if (k === 'KeyA') keys.a = true;
  if (k === 'KeyD') keys.d = true;
  if (k === 'ShiftLeft' || k === 'ShiftRight') keys.run = true;
  if (k === 'Space') keys.jump = true;
  if (k === 'Digit1') { state.player.weapon = 0; setMsg(state.player.weaponNames[0]); }
  if (k === 'Digit2') { state.player.weapon = 1; setMsg(state.player.weaponNames[1]); }
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
  if (!state.started) {
    state.started = true;
    controls.lock();
    hud.msg.style.display = 'none';
    document.getElementById('mobileHint').classList.add('hidden');
  } else if (!controls.isLocked && !state.isMobile) {
    controls.lock();
  }
});
controls.addEventListener('lock', () => { state.locked = true; });
controls.addEventListener('unlock', () => { state.locked = false; });
document.addEventListener('mousemove', (e) => {
  if (!state.locked) return;
  state.player.yaw -= e.movementX * CFG.mouseSens;
  state.player.pitch -= e.movementY * CFG.mouseSens;
  state.player.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, state.player.pitch));
});

// ---------- mobile controls ----------
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
state.isMobile = isMobile;
const mobileUI = document.getElementById('mobile');
if (isMobile) mobileUI.classList.remove('hidden');

let joyTouchId = null;
let joyStart = { x: 0, y: 0 };
let lookTouchId = null;
let lookStart = { x: 0, y: 0 };

const joyEl = document.getElementById('joystick');
const joyKnob = document.getElementById('joystickKnob');
const lookZone = document.getElementById('lookZone');

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
  if (!state.started) {
    state.started = true;
    hud.msg.style.display = 'none';
    document.getElementById('mobileHint').classList.add('hidden');
  }
  for (const t of e.changedTouches) {
    const cx = t.clientX;
    const cy = t.clientY;
    if (cx < window.innerWidth * 0.45 && cy > window.innerHeight * 0.5) {
      joyTouchId = t.identifier;
      joyStart = { x: cx, y: cy };
      state.move.set(0, 0);
      setKnob(0, 0);
    } else if (cx > window.innerWidth * 0.45) {
      lookTouchId = t.identifier;
      lookStart = { x: cx, y: cy };
    }
  }
}
function touchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      const dx = t.clientX - joyStart.x;
      const dy = t.clientY - joyStart.y;
      state.move.copy(setKnob(dx, dy));
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
  document.getElementById('btnWeapon').addEventListener('touchstart', (e) => { e.preventDefault(); state.player.weapon ^= 1; setMsg(state.player.weaponNames[state.player.weapon]); });
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

  // X
  const nx = pos.x + vel.x * dt;
  const xmin = new THREE.Vector3(nx - radius, pmin.y, pmin.z);
  const xmax = new THREE.Vector3(nx + radius, pmax.y, pmax.z);
  let hitX = false;
  for (const b of state.brushes) if (brushOverlap(xmin, xmax, b)) { hitX = true; break; }
  if (!hitX) pos.x = nx; else vel.x = 0;

  // Z
  const nz = pos.z + vel.z * dt;
  const zmin = new THREE.Vector3(pmin.x, pmin.y, nz - radius);
  const zmax = new THREE.Vector3(pmax.x, pmax.y, nz + radius);
  let hitZ = false;
  for (const b of state.brushes) if (brushOverlap(zmin, zmax, b)) { hitZ = true; break; }
  if (!hitZ) pos.z = nz; else vel.z = 0;

  // Y (gravity applied before call)
  const ny = pos.y + vel.y * dt;
  const ymin = new THREE.Vector3(pos.x - radius, ny - half, pos.z - radius);
  const ymax = new THREE.Vector3(pos.x + radius, ny + half, pos.z + radius);
  let onGround = false;
  let hitFloor = false;
  let floorY = -1e6;
  let hitCeil = false;
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

// find the floor brush max y that we're sitting on (used for snap)
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
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 40
    );
    state.particles.push({
      pos: pos.clone(),
      vel: dir.clone().multiplyScalar(180).add(spread),
      life: 0.4,
      maxLife: 0.4,
      color,
    });
  }
}

function raycastWorld(from, dir, maxDist = 2000) {
  let closest = null;
  let closestD = maxDist;
  for (const b of state.brushes) {
    const hit = intersectRayBox(from, dir, b.min, b.max);
    if (hit && hit.d < closestD) { closestD = hit.d; closest = b; }
  }
  return closest ? { hit: true, d: closestD, brush: closest } : null;
}

function intersectRayBox(origin, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = origin.getComponent(i), d = dir.getComponent(i);
    const mn = min.getComponent(i), mx = max.getComponent(i);
    if (Math.abs(d) < 1e-6) {
      if (o < mn || o > mx) return null;
    } else {
      const t1 = (mn - o) / d, t2 = (mx - o) / d;
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      tmin = Math.max(tmin, lo); tmax = Math.min(tmax, hi);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  const d = tmin < 0 ? tmax : tmin;
  return { d };
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
  updateHUD();

  // hitscan vs enemies first, then world
  const enemyHit = raycastEnemies(start, dir);
  let hitPos = null;
  let hitNormal = null;
  let hitEnemy = null;
  if (enemyHit) {
    hitPos = enemyHit.pos;
    hitEnemy = enemyHit.enemy;
    const dmg = p.weapon === 1 ? 100 : 12;
    hitEnemy.health -= dmg;
    addSpark(hitPos, dir, 0xff4444, 6);
    if (hitEnemy.health <= 0) {
      hitEnemy.active = false;
      state.score += 100;
      p.armor = Math.min(150, p.armor + 25);
      setMsg(`+100  (${state.score})`);
    }
  } else {
    const world = raycastWorld(start, dir);
    if (world) {
      hitPos = start.clone().addScaledVector(dir, world.d);
      hitNormal = new THREE.Vector3(); // approximate
      addSpark(hitPos, dir, 0x88ff88, 4);
      addImpact(start, hitPos, 0x00ff00);
    } else {
      hitPos = start.clone().addScaledVector(dir, 2000);
      addImpact(start, hitPos, 0x00ff00);
    }
  }
}

function raycastEnemies(origin, dir) {
  let closest = null, closestD = 1800;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const c = new THREE.Vector3().subVectors(e.pos, origin);
    const t = c.dot(dir);
    if (t < 0 || t > 1800) continue;
    const closestPoint = origin.clone().addScaledVector(dir, t);
    const dist = closestPoint.distanceTo(e.pos);
    if (dist < 34) {
      if (t < closestD) { closestD = t; closest = { enemy: e, pos: closestPoint }; }
    }
  }
  return closest;
}

// ---------- enemies ----------
function spawnEnemies(n) {
  const spots = [
    [300, 0, 300], [-300, 0, -300], [300, 0, -300], [-300, 0, 300],
    [0, 0, 400], [400, 0, 0], [-400, 0, 0], [0, 0, -400],
  ];
  for (let i = 0; i < n; i++) {
    const s = spots[i % spots.length];
    const e = {
      pos: new THREE.Vector3(s[0], s[1] + 28, s[2]),
      vel: new THREE.Vector3(),
      yaw: 0,
      health: 100,
      active: true,
      shootTimer: 0,
      mesh: null,
    };
    const g = new THREE.BoxGeometry(28, 56, 28);
    const m = new THREE.MeshLambertMaterial({ color: 0xaa2222 });
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

    // move toward player (with collision)
    const wish = flatDir.clone().multiplyScalar(170);
    // simple accel toward target
    e.vel.x += (wish.x - e.vel.x) * 4 * dt;
    e.vel.z += (wish.z - e.vel.z) * 4 * dt;
    e.vel.y -= CFG.gravity * dt;

    // enemy collision vs brushes (simple)
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

    // shoot at player
    e.shootTimer -= dt;
    if (e.shootTimer <= 0 && dist < 700) {
      e.shootTimer = 1.6 + Math.random() * 1.2;
      const edir = new THREE.Vector3().subVectors(p.pos, e.pos).normalize();
      const estart = e.pos.clone().add(new THREE.Vector3(0, 30, 0));
      // check if player hit
      const c = new THREE.Vector3().subVectors(p.pos, estart);
      const t = c.dot(edir);
      const cp = estart.clone().addScaledVector(edir, t);
      if (t > 0 && t < 700 && cp.distanceTo(p.pos) < 24) {
        p.health -= 14;
        p.damageFlash = CFG.hitFlashTime;
        flash.style.background = 'rgba(255,40,40,0.5)';
        addSpark(p.pos.clone().add(new THREE.Vector3(0, 24, 0)), edir, 0xff4444, 4);
      }
    }
  }
  // clean dead enemy meshes
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    if (!e.active && e.mesh) { scene.remove(e.mesh); state.enemies.splice(i, 1); }
  }
}

// ---------- player physics ----------
function updatePlayer(dt) {
  const p = state.player;
  const wishspeedBase = keys.run ? CFG.runSpeed : CFG.walkSpeed;

  // build wish direction
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
  if (wishLen > 0) {
    wish.normalize();
    wishspeed *= wishLen;
  }

  // acceleration
  const accel = p.onGround ? CFG.accelGround : CFG.accelAir;
  const currentspeed = p.vel.clone().dot(wish);
  let addspeed = wishspeed - currentspeed;
  if (addspeed > 0) {
    let accelspeed = accel * wishspeed * dt;
    if (accelspeed > addspeed) accelspeed = addspeed;
    p.vel.addScaledVector(wish, accelspeed);
  }

  // friction
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

  // jump
  const jumped = keys.jump;
  keys.jump = false; // consume
  if (p.onGround && jumped) {
    p.vel.y = CFG.jumpVel;
    p.onGround = false;
  }

  // gravity
  p.vel.y -= CFG.gravity * dt;

  // jump pad
  const jp = state.jumpPad;
  if (p.pos.x > jp.min.x && p.pos.x < jp.max.x && p.pos.z > jp.min.z && p.pos.z < jp.max.z && p.pos.y < 12) {
    p.vel.y = 520;
    p.onGround = false;
  }

  // move + collide
  const onGround = collideSlide(p.pos, p.vel, dt, CFG.playerRadius, CFG.playerHeight);

  // floor snap correction if slightly below
  const floor = floorYAt(p.pos.x, p.pos.z);
  if (p.pos.y - CFG.playerHeight / 2 < floor + 0.5) {
    p.pos.y = floor + CFG.playerHeight / 2;
    if (p.vel.y <= 0) { p.vel.y = 0; p.onGround = true; }
  }
  if (onGround) p.onGround = true;

  // camera position
  const eye = p.onGround ? CFG.eyeHeight : CFG.eyeHeight;
  const bob = p.onGround && p.vel.length() > 40
    ? Math.sin(state.time * 14) * CFG.headBob * (p.vel.length() / CFG.walkSpeed)
    : 0;
  camera.position.set(p.pos.x, p.pos.y + eye + bob, p.pos.z);

  // camera orientation
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

  // pickups
  for (const pk of state.pickups) {
    if (!pk.active) continue;
    if (p.pos.distanceTo(pk.pos) < 40) {
      pk.active = false;
      scene.remove(pk.mesh);
      if (pk.type === 'health') { p.health = Math.min(100, p.health + pk.val); }
      else { p.ammo = Math.min(999, p.ammo + pk.val); }
      setMsg(pk.type === 'health' ? '+HEALTH' : '+AMMO');
      updateHUD();
    }
  }

  // respawn pickups
  state.time += dt;
  if (Math.floor(state.time) % 8 === 0 && state.time - dt < Math.floor(state.time)) {
    for (const pk of state.pickups) if (!pk.active && Math.random() < 0.35) { pk.active = true; scene.add(pk.mesh); }
  }

  // clamp health
  if (p.health <= 0) {
    p.health = 0;
    setMsg('GAME OVER - click to respawn', 0);
    // respawn after moment
    setTimeout(() => {
      p.health = 100; p.armor = 0; p.ammo = 60; p.reserve = 240;
      p.pos.set(0, 28, 0); p.vel.set(0, 0, 0);
      updateHUD();
      hud.msg.style.display = 'none';
    }, 1200);
  }
}

// ---------- render helpers ----------
function renderImpacts() {
  const live = state.impacts.filter(i => (i.life -= state.dt) > 0);
  state.impacts = live;
  if (!live.length) return;
  const pts = [];
  const cols = [];
  for (const i of live) {
    pts.push(i.from.x, i.from.y, i.from.z, i.to.x, i.to.y, i.to.z);
    const c = new THREE.Color(i.color);
    cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  if (!state.impactLine) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
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
  if (!live.length) {
    if (state.particlePts) state.particlePts.visible = false;
    return;
  }
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

  // integrate particles
  for (const pr of live) {
    pr.pos.addScaledVector(pr.vel, state.dt);
    pr.vel.y -= CFG.gravity * 0.6 * state.dt;
    pr.vel.multiplyScalar(1 - 4 * state.dt);
  }
}

function updateHUD() {
  const p = state.player;
  hud.healthVal.textContent = p.health;
  hud.armorVal.textContent = p.armor;
  hud.ammoVal.textContent = p.ammo;
  hud.ammoReserve.textContent = p.reserve;
  hud.weapon.textContent = p.weaponNames[p.weapon];
  hud.healthVal.style.color = p.health > 40 ? '#0f0' : p.health > 15 ? '#ff0' : '#f00';
}

// ---------- fire trigger for mobile ----------
function maybeFire() {
  if (state._fire) { shoot(); state._fire = false; }
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

  if (state.started) {
    maybeFire();
    updatePlayer(dt);
    updateEnemies(dt);
    updateHUD();
  }

  renderImpacts();
  renderParticles();

  // damage flash decay
  if (state.player.damageFlash > 0) {
    state.player.damageFlash -= dt;
    const a = Math.max(0, state.player.damageFlash / CFG.hitFlashTime) * 0.55;
    flash.style.background = `rgba(255,40,40,${a})`;
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
setMsg(isMobile ? 'Tap screen to start' : 'Click to start');
loop();
