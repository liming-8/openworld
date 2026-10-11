/* ============================================================
 *  props.js — 低多边形植被 / 岩石 / 装饰物的几何体工厂
 *  全部为程序化生成，不依赖任何贴图资源
 * ============================================================ */
import * as THREE from '../libs/three.module.js';

/** 给几何体上色（顶点色） */
export function paint(geo, hex, variation = 0) {
  const base = new THREE.Color(hex);
  const p = geo.attributes.position;
  const n = p.count;
  const arr = new Float32Array(n * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (variation > 0) {
      // 用位置做稳定的“色斑”，避免闪色
      const s = Math.sin(p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719) * 43758.5453;
      k = 1 + ((s - Math.floor(s)) - 0.5) * 2 * variation;
    }
    tmp.copy(base).multiplyScalar(k);
    arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** 合并多个几何体（要求均含 position/normal/color） */
export function mergeGeoms(geoms) {
  let total = 0;
  const prepped = geoms.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.normal) ng.computeVertexNormals();
    total += ng.attributes.position.count;
    return ng;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of prepped) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    const ca = g.attributes.color;
    if (ca) col.set(ca.array, o * 3);
    else col.fill(1, o * 3, (o + g.attributes.position.count) * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/**
 * 以"空间方向"为种子做径向扰动，把球状几何揉成不规则的岩石。
 *
 * ⚠️ 这里必须用**方向**而不是**顶点下标**当随机种子。
 * three.js 的多面体几何（IcosahedronGeometry / PolyhedronGeometry）是
 * **非索引**的：同一个空间顶点会被复制 5~6 份（每个相邻三角面一份）。
 * 如果按下标取随机数，同一个点的几份副本会被推向不同方向，公共边被撕开——
 * 岩石就碎成一堆互相分离、飘在空中的大三角板。
 * 用方向做种子后，同一位置的所有副本得到完全相同的位移，几何体保持水密。
 *
 * @param {THREE.BufferGeometry} geo 以原点为中心的球状几何
 * @param {number} kMin  径向缩放下限
 * @param {number} kMax  径向缩放上限
 * @param {number} squashY 竖向压扁系数（岩石多是扁的）
 * @param {number} seed  实例种子；同一实例内必须恒定，否则又会撕开
 */
export function jitterRadial(geo, kMin = 0.7, kMax = 1.2, squashY = 1, seed = 0) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1e-6;
    const nx = x / len, ny = y / len, nz = z / len;
    // 稳定哈希：只与"方向 + 实例种子"有关，与顶点下标无关
    const s = Math.sin(nx * 127.1 + ny * 311.7 + nz * 74.7 + seed) * 43758.5453;
    const k = kMin + (s - Math.floor(s)) * (kMax - kMin);
    pos.setXYZ(i, nx * len * k, ny * len * k * squashY, nz * len * k);
  }
  pos.needsUpdate = true;
  // 非索引几何 → 逐面法线，正好得到低多边形岩石的硬朗块面
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** 把法线统一朝上：让十字面片式的草/花看起来与地面受光一致（避免背光发黑） */
export function upNormals(geo) {
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return geo;
}

const M = () => new THREE.Matrix4();

/* ---------------- 针叶树（松/杉） ---------------- */
export function makePine({ height = 8.2, radial = 7, snowy = false } = {}) {
  const parts = [];
  const trunkH = height * 0.36;
  // 树干：下粗上细，略带锥度，根部微外扩
  const trunk = new THREE.CylinderGeometry(height * 0.034, height * 0.075, trunkH, radial, 2);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, 0x5c4630, 0.14));
  const root = new THREE.CylinderGeometry(height * 0.075, height * 0.115, height * 0.05, radial, 1);
  root.translate(0, height * 0.025, 0);
  parts.push(paint(root, 0x4a3a28, 0.14));

  // 树冠：4 层错落，越往上越小；底层略微下垂
  const layers = 4;
  const span = height * 0.62;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = height * (0.29 - t * 0.185);
    const hh = height * (0.36 - t * 0.085);
    const cone = new THREE.ConeGeometry(r, hh, radial, 1);
    if (i === 0) cone.scale(1.06, 1, 1.06);           // 底层展开
    cone.rotateY(i * 0.42);
    cone.translate(0, trunkH * 0.72 + t * span + hh * 0.42, 0);
    const green = snowy
      ? (t > 0.6 ? 0xd7e6ee : 0x3d6650)
      : (t > 0.6 ? 0x4f8659 : 0x2f5d3c);
    parts.push(paint(cone, green, 0.15));
  }
  // 顶部尖芽
  const tip = new THREE.ConeGeometry(height * 0.045, height * 0.14, radial, 1);
  tip.translate(0, trunkH * 0.72 + span + height * 0.10, 0);
  parts.push(paint(tip, snowy ? 0xe6f0f6 : 0x578d5f, 0.12));
  return mergeGeoms(parts);
}

/* ---------------- 阔叶树 ---------------- */
export function makeBroadleaf({ height = 7.4, radial = 7 } = {}) {
  const parts = [];
  const trunkH = height * 0.46;
  const trunk = new THREE.CylinderGeometry(height * 0.042, height * 0.085, trunkH, radial, 2);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, 0x6b5038, 0.14));
  // 岔枝
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.5;
    const br = new THREE.CylinderGeometry(height * 0.016, height * 0.032, trunkH * 0.6, 5, 1);
    br.rotateZ(Math.PI * 0.30);
    br.rotateY(a);
    br.translate(Math.cos(a) * height * 0.09, trunkH * 0.92, Math.sin(a) * height * 0.09);
    parts.push(paint(br, 0x5e4630, 0.1));
  }
  // 冠层：多个不规则球块拼出蓬松感
  const r = height * 0.335;
  const blobs = [
    [0, trunkH + r * 0.72, 0, 1.0],
    [r * 0.62, trunkH + r * 0.42, r * 0.22, 0.68],
    [-r * 0.58, trunkH + r * 0.55, -r * 0.28, 0.72],
    [r * 0.18, trunkH + r * 1.22, -r * 0.24, 0.62],
    [-r * 0.24, trunkH + r * 1.05, r * 0.42, 0.55],
    [r * 0.48, trunkH + r * 0.95, -r * 0.44, 0.5],
  ];
  for (let i = 0; i < blobs.length; i++) {
    const [x, y, z, s] = blobs[i];
    const g = new THREE.IcosahedronGeometry(r * s, 0);
    // 轻微压扁 + 随机旋转，避免明显的球感
    g.scale(1, 0.86 + (i % 3) * 0.07, 1);
    g.rotateY(i * 1.3);
    g.translate(x, y, z);
    parts.push(paint(g, i % 3 === 0 ? 0x4f8a3d : i % 3 === 1 ? 0x447a35 : 0x5c9646, 0.2));
  }
  return mergeGeoms(parts);
}

/* ---------------- 棕榈树（沙滩） ---------------- */
export function makePalm({ height = 9, radial = 6 } = {}) {
  const parts = [];
  // 弯曲的树干：逐段堆叠小圆柱，并带环状节
  const segs = 8;
  let y = 0;
  const segH = height / segs;
  const bendX = height * 0.17;
  let x = 0;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const dx = Math.sin(t * Math.PI * 0.5) * bendX * t;
    const g = new THREE.CylinderGeometry(height * 0.032, height * 0.045, segH * 1.05, radial, 1);
    g.translate(dx, y + segH / 2, 0);
    parts.push(paint(g, i % 2 ? 0x8a6b45 : 0x7d5f3d, 0.1));
    y += segH;
    x = dx;
  }
  // 叶冠
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const len = height * (0.40 + (i % 3) * 0.05);
    const f = new THREE.PlaneGeometry(len, height * 0.115, 4, 1);
    const pos = f.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v);
      // 中脉 + 下垂
      pos.setZ(v, -Math.pow(px / len + 0.5, 2) * height * 0.14 + Math.sin(px * 2) * 0.03);
      pos.setY(v, pos.getY(v) * (1 - Math.abs(px / len + 0.5) * 0.45));
    }
    f.rotateX(-Math.PI / 2.35);
    f.rotateY(a);
    f.translate(x + Math.cos(a) * len * 0.44, y + height * 0.015, Math.sin(a) * len * 0.44);
    parts.push(paint(f, i % 2 ? 0x3f8b4a : 0x357a41, 0.18));
  }
  // 椰子
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    const nut = new THREE.IcosahedronGeometry(height * 0.032, 0);
    nut.translate(x + Math.cos(a) * height * 0.05, y - height * 0.035, Math.sin(a) * height * 0.05);
    parts.push(paint(nut, 0x6f5a34, 0.12));
  }
  const crown = new THREE.IcosahedronGeometry(height * 0.07, 0);
  crown.translate(x, y, 0);
  parts.push(paint(crown, 0x6f6a3a, 0.15));
  return mergeGeoms(parts);
}

/* ---------------- 仙人掌（沙漠） ---------------- */
export function makeCactus({ height = 3.4 } = {}) {
  const parts = [];
  const body = new THREE.CylinderGeometry(height * 0.15, height * 0.19, height, 9, 2);
  body.translate(0, height / 2, 0);
  parts.push(paint(body, 0x4e8a4b, 0.12));
  // 棱纹
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const rib = new THREE.BoxGeometry(0.035, height * 0.92, 0.05);
    rib.translate(Math.cos(a) * height * 0.15, height * 0.5, Math.sin(a) * height * 0.15);
    parts.push(paint(rib, 0x437541, 0.1));
  }
  // 侧臂
  const armDefs = [[1, 0.62, 0.5], [-1, 0.5, 0.42], [1, 0.42, 0.34]];
  for (const [dir, at, len] of armDefs) {
    const arm = new THREE.CylinderGeometry(height * 0.085, height * 0.105, height * len, 7, 1);
    arm.rotateZ(Math.PI * 0.5 * dir);
    arm.translate(dir * height * (0.22 + len * 0.28), height * at, 0);
    parts.push(paint(arm, 0x4e8a4b, 0.12));
    const up = new THREE.CylinderGeometry(height * 0.075, height * 0.09, height * 0.3, 7, 1);
    up.translate(dir * height * (0.22 + len * 0.55), height * (at + 0.16), 0);
    parts.push(paint(up, 0x4e8a4b, 0.12));
  }
  // 顶部花
  const flower = new THREE.IcosahedronGeometry(height * 0.075, 0);
  flower.translate(0, height * 1.02, 0);
  parts.push(paint(flower, 0xe8698a, 0.12));
  return mergeGeoms(parts);
}

/* ---------------- 枯树（沼泽 / 荒原） ---------------- */
export function makeDeadTree({ height = 5.0 } = {}) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(height * 0.042, height * 0.095, height, 6, 2);
  trunk.translate(0, height / 2, 0);
  parts.push(paint(trunk, 0x6a5a48, 0.16));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.6;
    const len = height * (0.28 + (i % 3) * 0.10);
    const br = new THREE.CylinderGeometry(height * 0.012, height * 0.030, len, 4, 1);
    br.rotateZ(Math.PI * (0.34 + (i % 2) * 0.12));
    br.rotateY(a);
    br.translate(Math.cos(a) * height * 0.13, height * (0.52 + i * 0.075), Math.sin(a) * height * 0.13);
    parts.push(paint(br, 0x6a5a48, 0.16));
  }
  return mergeGeoms(parts);
}

/* ---------------- 灌木（增加林下层次） ---------------- */
export function makeBush({ size = 1.0 } = {}) {
  const parts = [];
  const blobs = [
    [0, size * 0.42, 0, 1.0],
    [size * 0.42, size * 0.32, size * 0.18, 0.7],
    [-size * 0.38, size * 0.34, -size * 0.22, 0.66],
    [size * 0.1, size * 0.62, -size * 0.28, 0.58],
  ];
  for (let i = 0; i < blobs.length; i++) {
    const [x, y, z, s] = blobs[i];
    const g = new THREE.IcosahedronGeometry(size * 0.5 * s, 0);
    g.scale(1, 0.78, 1);
    g.rotateY(i * 1.7);
    g.translate(x, y, z);
    parts.push(paint(g, i % 2 ? 0x4a7d38 : 0x578a41, 0.2));
  }
  return mergeGeoms(parts);
}

/* ---------------- 岩石 ---------------- */
export function makeRock({ size = 1.4, detail = 0 } = {}) {
  const g = new THREE.IcosahedronGeometry(size, detail);
  jitterRadial(g, 0.65, 1.25, 0.72);
  g.translate(0, size * 0.28, 0);
  return paint(g, 0x8c8880, 0.18);
}

/**
 * 岩石簇（一块主石 + 若干次石 + 碎石，减少实例数）
 *
 * `size` 的语义 = **主石半径**。整簇的尺寸大致为：
 *   水平跨度 ≈ 3.6 × size ，露出地面高度 ≈ 1.4 × size
 * 之前这里把石头铺得太开（次石偏移到 2×size、碎石到 1.5×size），
 * 一整簇会摊成十几米宽、只露出两米高的"薄饼"，在山顶非常难看。
 */
export function makeRockCluster({ size = 1.2, count = 3, detail = 0, seedish = 0 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    // 主石最大，其余依次阶梯缩小 → 簇的形状更紧凑立体
    const f = i === 0 ? 1 : Math.max(0.46, 0.70 - i * 0.12);
    const s = size * f;
    const r = new THREE.IcosahedronGeometry(s, detail);
    // 每块石头用不同的实例种子 → 形状各异；但同一块石头内部种子恒定 → 不撕开
    jitterRadial(r, 0.80, 1.16, 0.94, i * 13.7 + seedish * 41.3);
    r.rotateY(i * 1.9 + seedish);
    const ang = i * 2.4 + seedish;
    const off = i === 0 ? 0 : size * 0.62;          // 次石紧贴主石，不再向外摊开
    const lift = size * (i === 0 ? 0.34 : 0.24);    // 次石略低，形成搭接
    r.translate(Math.cos(ang) * off, lift, Math.sin(ang) * off);
    parts.push(paint(r, i % 3 === 0 ? 0x928e86 : i % 3 === 1 ? 0x7d7a73 : 0x87837b, 0.16));
  }
  // 碎石点缀：贴着主石根部
  for (let i = 0; i < 3; i++) {
    const a = i * 2.6 + 1.1 + seedish;
    const peb = new THREE.IcosahedronGeometry(size * 0.20, 0);
    peb.translate(Math.cos(a) * size * 0.98, size * 0.11, Math.sin(a) * size * 0.98);
    parts.push(paint(peb, 0x8a867e, 0.18));
  }
  const g = mergeGeoms(parts);
  g.computeBoundingSphere();
  return g;
}

/* ---------------- 草簇（交叉面片） ---------------- */
export function makeGrassTuft({ height = 0.5, blades = 4, color = 0x74a04a } = {}) {
  const parts = [];
  for (let i = 0; i < blades; i++) {
    const w = 0.17 + (i % 2) * 0.07;
    const g = new THREE.PlaneGeometry(w, height * (0.75 + (i % 3) * 0.14), 1, 2);
    const pos = g.attributes.position;
    const hh = height * (0.75 + (i % 3) * 0.14);
    for (let v = 0; v < pos.count; v++) {
      const py = pos.getY(v) + hh / 2;
      pos.setX(v, pos.getX(v) * (1 - py / hh * 0.6));
      pos.setZ(v, Math.sin(py * 3.4) * 0.05);
    }
    g.rotateY((i / blades) * Math.PI);
    g.translate((i - blades / 2) * 0.12, hh / 2, 0);
    parts.push(paint(g, color, 0.16));
  }
  const merged = mergeGeoms(parts);
  return upNormals(merged);
}

/* ---------------- 花（草簇 + 花点） ---------------- */
export function makeFlower({ color = 0xff7fa8 } = {}) {
  const stem = new THREE.PlaneGeometry(0.16, 0.7, 1, 1);
  stem.translate(0, 0.35, 0);
  const head = new THREE.IcosahedronGeometry(0.14, 0);
  head.translate(0, 0.74, 0);
  return upNormals(mergeGeoms([paint(stem, 0x5f8f47, 0.1), paint(head, color, 0.15)]));
}

/** 芦苇（沼泽） */
export function makeReed({ height = 1.3 } = {}) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(0.09, height * (0.7 + i * 0.1));
    g.translate((i - 1.5) * 0.13, height * 0.4, 0);
    parts.push(paint(g, 0x7d9354, 0.2));
  }
  return upNormals(mergeGeoms(parts));
}
