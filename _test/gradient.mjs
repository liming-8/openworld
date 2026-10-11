import { Terrain, SEA_LEVEL } from '../js/terrain.js';

const T = new Terrain();
// 真实梯度分布（不是归一化后的 slope）
const grads = [];
let max = 0, over15 = 0, over2 = 0, over3 = 0, over5 = 0;
for (let i = 0; i < 60000; i++) {
  const x = (Math.random() - 0.5) * 12000;
  const z = (Math.random() - 0.5) * 12000;
  const e = 0.9;
  const hL = T.height(x - e, z), hR = T.height(x + e, z);
  const hD = T.height(x, z - e), hU = T.height(x, z + e);
  const dx = (hR - hL) / (2 * e);
  const dz = (hU - hD) / (2 * e);
  const g = Math.hypot(dx, dz);
  max = Math.max(max, g);
  if (g > 1.5) over15++;
  if (g > 2) over2++;
  if (g > 3) over3++;
  if (g > 5) over5++;
  grads.push(g);
}
grads.sort((a, b) => a - b);
const q = (p) => grads[Math.floor(p * grads.length)].toFixed(2);
console.log('陆地梯度分位 p50/p90/p99/p999:', q(0.5), q(0.9), q(0.99), q(0.999));
console.log('最大梯度:', max.toFixed(2));
console.log('梯度 >1.5 占比:', (over15 / 60000 * 100).toFixed(2) + '%');
console.log('梯度 >2.0 占比:', (over2 / 60000 * 100).toFixed(2) + '%');
console.log('梯度 >3.0 占比:', (over3 / 60000 * 100).toFixed(2) + '%');
console.log('梯度 >5.0 占比:', (over5 / 60000 * 100).toFixed(2) + '%');

// 沿一条直线走，看是否有"上不去"的地方
let blocked = 0, total = 0;
for (let dir = 0; dir < 40; dir++) {
  const a = (dir / 40) * Math.PI * 2;
  let x = 0, z = 0, y = T.height(0, 0);
  const step = 0.16;                      // ≈ 每帧位移
  for (let s = 0; s < 4000; s++) {
    const nx = x + Math.cos(a) * step, nz = z + Math.sin(a) * step;
    const nh = T.height(nx, nz);
    const dh = nh - y;
    const maxStep = 0.55 + step * 1.25;   // 当前代码的阈值
    total++;
    if (dh > maxStep) blocked++;
    else { x = nx; z = nz; y = nh; }
  }
}
console.log('直线行走中被"卡住"的比例:', (blocked / total * 100).toFixed(2) + '%');
