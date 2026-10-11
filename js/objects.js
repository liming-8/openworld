/* ============================================================
 *  objects.js — 可交互地标：宝箱 / 风之瞳 / 篝火 / 传送锚点
 *  优化：静态部件合并为单一网格 + 共享材质，显著降低 draw call
 * ============================================================ */
import * as THREE from '../libs/three.module.js';
import { clamp, lerp } from './noise.js';
import { paint, mergeGeoms, jitterRadial } from './props.js';

const C = {
  wood: 0x9a6238, woodDark: 0x5d3c22, gold: 0xe6b445, goldDark: 0xb0821f,
  stone: 0x9aa0a8, stoneDark: 0x6c747e,
  glow: 0x8ff5e8, teal: 0x2ec9ba,
  ember: 0xff8a3d, log: 0x54402c,
};

/* ---------- 共享材质 ---------- */
const MAT_VERT = new THREE.MeshLambertMaterial({ vertexColors: true });
const MAT_CACHE = new Map();
function flat(hex, opts = {}) {
  const key = hex + JSON.stringify(opts);
  if (!MAT_CACHE.has(key)) MAT_CACHE.set(key, new THREE.MeshLambertMaterial({ color: hex, ...opts }));
  return MAT_CACHE.get(key);
}
const MAT_ADD = new THREE.MeshBasicMaterial({
  color: C.glow, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
});

/* ---------- 共享几何（示例色在顶点里，几何可跨实例复用） ---------- */
const GEO = {};

function box(w, h, d, hex, x, y, z, rot) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.rotateX(rot.x || 0), g.rotateY(rot.y || 0), g.rotateZ(rot.z || 0);
  g.translate(x, y, z);
  return paint(g, hex, 0.06);
}

function buildChestGeo() {
  const parts = [];
  parts.push(box(0.86, 0.5, 0.6, C.wood, 0, 0.25, 0));
  parts.push(box(0.09, 0.53, 0.63, C.goldDark, -0.36, 0.25, 0));
  parts.push(box(0.09, 0.53, 0.63, C.goldDark, 0.36, 0.25, 0));
  parts.push(box(0.87, 0.09, 0.62, C.goldDark, 0, 0.49, 0));
  parts.push(box(0.15, 0.17, 0.09, C.gold, 0, 0.33, 0.32));
  const g = mergeGeoms(parts);
  g.computeBoundingSphere();
  return g;
}

function buildLidGeo() {
  const parts = [];
  parts.push(box(0.86, 0.22, 0.6, C.wood, 0, 0.11, 0.3));
  parts.push(box(0.9, 0.26, 0.11, C.gold, 0, 0.11, 0.3));
  const g = mergeGeoms(parts);
  g.computeBoundingSphere();
  return g;
}

function buildFireGeo() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = new THREE.IcosahedronGeometry(0.24, 0);
    // 种子只跟"这一块石头"有关（i），与顶点下标无关，否则面片会被撕开
    jitterRadial(s, 0.75, 1.25, 0.8, i * 7.3);
    s.translate(Math.cos(a) * 0.85, 0.09, Math.sin(a) * 0.85);
    parts.push(paint(s, i % 2 ? C.stone : C.stoneDark, 0.12));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const log = new THREE.CylinderGeometry(0.065, 0.085, 0.95, 5);
    log.rotateZ(Math.PI / 2 - 0.22);
    log.rotateY(a);
    log.translate(Math.cos(a) * 0.13, 0.2, Math.sin(a) * 0.13);
    parts.push(paint(log, C.log, 0.14));
  }
  const g = mergeGeoms(parts);
  g.computeBoundingSphere();
  return g;
}

function buildWaypointBaseGeo() {
  const parts = [];
  const a = new THREE.CylinderGeometry(1.5, 1.75, 0.34, 8);
  a.translate(0, 0.17, 0);
  parts.push(paint(a, C.stoneDark, 0.08));
  const b = new THREE.CylinderGeometry(1.05, 1.3, 0.3, 8);
  b.translate(0, 0.47, 0);
  parts.push(paint(b, C.stone, 0.08));
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = new THREE.BoxGeometry(0.16, 0.6, 0.16);
    p.translate(Math.cos(ang) * 1.15, 0.68, Math.sin(ang) * 1.15);
    parts.push(paint(p, C.stone, 0.08));
  }
  const g = mergeGeoms(parts);
  g.computeBoundingSphere();
  return g;
}

/* ==================== 宝箱 ==================== */
export class Chest {
  constructor(desc) {
    this.desc = desc;
    this.type = 'chest';
    this.id = desc.id;
    this.opened = false;
    this.group = new THREE.Group();
    this.group.position.set(desc.x, desc.y, desc.z);
    this.group.rotation.y = (hashStr(desc.id) % 628) / 100;

    GEO.chest = GEO.chest || buildChestGeo();
    GEO.lid = GEO.lid || buildLidGeo();

    const body = new THREE.Mesh(GEO.chest, MAT_VERT);
    this.group.add(body);

    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.5, -0.3);
    this.lid.add(new THREE.Mesh(GEO.lid, MAT_VERT));
    this.group.add(this.lid);

    this.aura = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 18), MAT_ADD.clone());
    this.aura.material.color.setHex(C.gold);
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.04;
    this.group.add(this.aura);

    this.interactRadius = 3.2;
    this.hint = '打开宝箱';
  }

  get position() { return this.group.position; }

  open() {
    if (this.opened) return false;
    this.opened = true;
    this.aura.visible = false;
    return true;
  }

  update(dt, t) {
    if (!this.opened) {
      this.aura.material.opacity = 0.26 + Math.sin(t * 2.4) * 0.16;
      this.aura.scale.setScalar(1 + Math.sin(t * 2.0) * 0.06);
    } else if (this.lid.rotation.x > -1.32) {
      this.lid.rotation.x = lerp(this.lid.rotation.x, -1.35, 1 - Math.pow(0.004, dt));
    }
  }

  setOpened(v) { if (v) { this.opened = true; this.aura.visible = false; this.lid.rotation.x = -1.35; } }
}

/* ==================== 风之瞳 ==================== */
const ORB_GEO = {};
export class WindOrb {
  constructor(desc) {
    this.desc = desc;
    this.type = 'orb';
    this.id = desc.id;
    this.collected = false;
    this.group = new THREE.Group();
    this.group.position.set(desc.x, desc.y, desc.z);
    this.baseY = desc.y;

    ORB_GEO.core = ORB_GEO.core || new THREE.OctahedronGeometry(0.28, 0);
    ORB_GEO.shell = ORB_GEO.shell || new THREE.OctahedronGeometry(0.46, 1);
    ORB_GEO.halo = ORB_GEO.halo || new THREE.RingGeometry(0.55, 0.75, 20);

    this.core = new THREE.Mesh(ORB_GEO.core, flat(C.glow));
    this.group.add(this.core);

    this.shell = new THREE.Mesh(ORB_GEO.shell, new THREE.MeshBasicMaterial({
      color: C.teal, transparent: true, opacity: 0.3, wireframe: true,
    }));
    this.group.add(this.shell);

    this.halo = new THREE.Mesh(ORB_GEO.halo, new THREE.MeshBasicMaterial({
      color: C.glow, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = -2.0;
    this.group.add(this.halo);

    // 上升气流粒子：用单个 Points 代替 7 个 mesh
    const N = 9;
    this.moteCount = N;
    const arr = new Float32Array(N * 3);
    this.moteSeed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      this.moteSeed[i * 2] = Math.random();
      this.moteSeed[i * 2 + 1] = 0.4 + Math.random() * 0.5;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    mg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({
      color: C.glow, size: 0.18, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    this.light = new THREE.PointLight(C.teal, 1.6, 9, 2);
    this.group.add(this.light);

    this.interactRadius = 2.8;
    this.hint = '收集 风之瞳';
  }

  get position() { return this.group.position; }

  collect() {
    if (this.collected) return false;
    this.collected = true;
    return true;
  }

  update(dt, t) {
    if (this.collected) { this.group.visible = false; return; }
    this.group.position.y = this.baseY + Math.sin(t * 1.6) * 0.28;
    this.core.rotation.y += dt * 1.4;
    this.core.rotation.x += dt * 0.6;
    this.shell.rotation.y -= dt * 0.9;
    this.shell.rotation.z += dt * 0.5;
    this.shell.scale.setScalar(1 + Math.sin(t * 3) * 0.05);
    this.light.intensity = 1.3 + Math.sin(t * 4) * 0.4;

    const p = this.motes.geometry.attributes.position;
    for (let i = 0; i < this.moteCount; i++) {
      const ph = this.moteSeed[i * 2];
      const rad = this.moteSeed[i * 2 + 1];
      const k = (ph + t * 0.45) % 1;
      const a = k * Math.PI * 4 + ph * 6;
      p.setXYZ(i,
        Math.cos(a) * rad * (1 - k),
        -2.2 + k * 2.4,
        Math.sin(a) * rad * (1 - k));
    }
    p.needsUpdate = true;
    this.motes.material.opacity = 0.75 + Math.sin(t * 5) * 0.2;
  }

  setOpened(v) { if (v) { this.collected = true; this.group.visible = false; } }
}

/* ==================== 篝火 ==================== */
export class Campfire {
  constructor(desc) {
    this.desc = desc;
    this.type = 'camp';
    this.id = desc.id;
    this.group = new THREE.Group();
    this.group.position.set(desc.x, desc.y, desc.z);

    GEO.fire = GEO.fire || buildFireGeo();
    this.group.add(new THREE.Mesh(GEO.fire, MAT_VERT));

    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.92 })
    );
    this.flame.position.y = 0.6;
    this.group.add(this.flame);

    this.light = new THREE.PointLight(0xff9a4d, 4.2, 20, 2);
    this.light.position.y = 0.9;
    this.group.add(this.light);

    this.interactRadius = 3.0;
    this.hint = '在篝火旁休息（恢复体力）';
  }

  get position() { return this.group.position; }

  update(dt, t) {
    const s = 1 + Math.sin(t * 9) * 0.12 + Math.sin(t * 17.3) * 0.06;
    this.flame.scale.set(1 + Math.sin(t * 7) * 0.08, s, 1 + Math.cos(t * 6.2) * 0.08);
    this.flame.rotation.y += dt * 2.2;
    this.light.intensity = 3.4 + Math.sin(t * 11) * 0.9;
  }
  setOpened() { }
}

/* ==================== 传送锚点 ==================== */
export class Waypoint {
  constructor(desc) {
    this.desc = desc;
    this.type = 'waypoint';
    this.id = desc.id;
    this.unlocked = false;
    this.group = new THREE.Group();
    this.group.position.set(desc.x, desc.y, desc.z);

    GEO.way = GEO.way || buildWaypointBaseGeo();
    this.group.add(new THREE.Mesh(GEO.way, MAT_VERT));

    this.pillar = new THREE.Group();
    this.pillar.position.y = 0.6;
    this.group.add(this.pillar);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.06, 6, 20),
      new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.85 })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.9;
    this.pillar.add(this.ring);

    this.ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.045, 6, 16),
      new THREE.MeshBasicMaterial({ color: C.glow, transparent: true, opacity: 0.8 })
    );
    this.ring2.rotation.x = Math.PI / 2;
    this.ring2.position.y = 1.7;
    this.pillar.add(this.ring2);

    this.crystal = new THREE.Mesh(ORB_GEO.core || new THREE.OctahedronGeometry(0.3, 0), flat(C.glow));
    this.crystal.position.y = 1.3;
    this.crystal.scale.setScalar(1.2);
    this.pillar.add(this.crystal);

    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.3, 14, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    this.beam.position.y = 7.5;
    this.pillar.add(this.beam);

    this.light = new THREE.PointLight(C.teal, 0, 16, 2);
    this.light.position.y = 1.4;
    this.group.add(this.light);

    this.interactRadius = 3.4;
    this.hint = '激活传送锚点';
  }

  get position() { return this.group.position; }

  update(dt, t) {
    this.ring.rotation.z += dt * 0.9;
    this.ring2.rotation.z -= dt * 1.4;
    this.crystal.rotation.y += dt * 1.1;
    this.crystal.position.y = 1.3 + Math.sin(t * 1.8) * 0.12;
    const target = this.unlocked ? 2.4 : 0.5;
    this.light.intensity = lerp(this.light.intensity, target + Math.sin(t * 3) * 0.3, 0.08);
    const op = this.unlocked ? 0.85 : 0.32;
    this.ring.material.opacity = op;
    this.ring2.material.opacity = op * 0.9;
    this.crystal.material.color.setHex(this.unlocked ? 0x8ff5e8 : 0x7d9d9a);
    this.beam.material.opacity = this.unlocked ? 0.2 + Math.sin(t * 1.5) * 0.05 : 0.05;
  }

  unlock() { this.unlocked = true; return true; }
  setOpened(v) { if (v) this.unlock(); }
}

/* ==================== 工厂 ==================== */
export function createObject(desc) {
  switch (desc.type) {
    case 'chest': return new Chest(desc);
    case 'orb': return new WindOrb(desc);
    case 'camp': return new Campfire(desc);
    case 'waypoint': return new Waypoint(desc);
    default: return null;
  }
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
