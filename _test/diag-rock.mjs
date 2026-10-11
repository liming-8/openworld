/* 诊断：岩石几何体是否"水密"——非索引几何中同一空间顶点被复制多份，
 * 若按下标给随机扰动，副本被推向不同方向 → 面片沿公共边撕开。
 * 用"边界边计数"量化：封闭流形的每条边都应恰好被 2 个三角面共用。 */
import * as THREE from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/libs/three.module.js';
import * as P from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/js/props.js';

const Q = 1e4;                                   // 位置量化精度
const qk = (x, y, z) => `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;

/** 统计边界边（只被 1 个面用到的边）和孔洞总面积 */
function seamReport(geo) {
  const pos = geo.attributes.position;
  const edges = new Map();
  let tris = 0;
  for (let t = 0; t < pos.count; t += 3) {
    tris++;
    const v = [];
    for (let k = 0; k < 3; k++) v.push([pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k)]);
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      const ka = qk(...a), kb = qk(...b);
      const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const e = edges.get(key);
      if (e) e.n++;
      else edges.set(key, { n: 1, a, b });
    }
  }
  let boundary = 0, lenSum = 0;
  for (const e of edges.values()) {
    if (e.n === 1) {
      boundary++;
      lenSum += Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]);
    }
  }
  let maxSpan = 0;
  for (const e of edges.values()) if (e.n === 1) maxSpan = Math.max(maxSpan, Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]));
  return { tris, edges: edges.size, boundary, seamLen: lenSum, maxSeam: maxSpan };
}

/** —— 旧实现（按下标播种，有 bug）—— */
function oldRockCluster({ size = 1.2, count = 4, detail = 0, seedish = 0 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const s = (Math.sin(i * 91.7 + seedish) * 0.5 + 0.5) * size + size * 0.4;
    const r = new THREE.IcosahedronGeometry(s, detail);
    const pos = r.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const k = 0.62 + ((Math.sin(v * 31.3 + i * 7.1) * 0.5 + 0.5)) * 0.7;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.7, pos.getZ(v) * k);
    }
    r.rotateY(i * 1.9 + seedish);
    const ang = i * 2.4 + seedish;
    r.translate(Math.cos(ang) * size * i * 0.62, size * 0.22 + i * 0.05, Math.sin(ang) * size * i * 0.62);
    parts.push(P.paint(r, i % 3 === 0 ? 0x928e86 : i % 3 === 1 ? 0x7d7a73 : 0x87837b, 0.16));
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.6 + 1.1 + seedish;
    const peb = new THREE.IcosahedronGeometry(size * 0.16, 0);
    peb.translate(Math.cos(a) * size * 1.5, size * 0.08, Math.sin(a) * size * 1.5);
    parts.push(P.paint(peb, 0x8a867e, 0.18));
  }
  const g = P.mergeGeoms(parts);
  g.computeBoundingSphere();
  return g;
}

function row(label, geo) {
  const r = seamReport(geo);
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  console.log(
    label.padEnd(30),
    '三角', String(r.tris).padStart(4),
    '| 边', String(r.edges).padStart(4),
    '| 开裂边', String(r.boundary).padStart(4),
    '| 裂缝总长', r.seamLen.toFixed(2).padStart(8),
    '| 最长裂缝', r.maxSeam.toFixed(3).padStart(7),
    '| 包围球R', geo.boundingSphere.radius.toFixed(2)
  );
}

console.log('=== 岩石几何体水密性（边界边 = 0 才算封闭）===\n');
console.log('【修复前 —— 按下标播种】');
row('rock   (size1.15,detail0)', oldRockCluster({ size: 1.15, count: 3, detail: 0 }));
row('boulder(size2.6 ,detail1)', oldRockCluster({ size: 2.6, count: 3, detail: 1, seedish: 1.7 }));

console.log('\n【修复后 —— 按空间方向播种】');
row('rock   (size1.15,detail0)', P.makeRockCluster({ size: 1.15, count: 3, detail: 0 }));
row('boulder(size2.6 ,detail1)', P.makeRockCluster({ size: 2.6, count: 3, detail: 1, seedish: 1.7 }));

console.log('\n【参照：未做扰动的原型几何】');
row('Icosahedron(1.4,0)', new THREE.IcosahedronGeometry(1.4, 0));
row('Icosahedron(2.6,1)', new THREE.IcosahedronGeometry(2.6, 1));
