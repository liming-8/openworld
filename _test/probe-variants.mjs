/* 在同一个点上比较三种台地写法造成的"网格中点插值误差" */
import { Terrain } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/js/terrain.js';            // 修复后（软阶梯）
import { Terrain_OLD as T_OLD } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/_terrain_old.js';     // 修复前（硬取整）
import { Terrain_NT as T_NT } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/_terrain_noterrace.js'; // 无台地

const S = 64 / 28;
const variants = [
  ['修复前 硬取整 round(h/8)*8', new T_OLD(20261010)],
  ['修复后 软阶梯 smoothstep', new Terrain(20261010)],
  ['无台地（对照）', new T_NT(20261010)],
];

function scan(T, x0, z0, half, step) {
  let maxDev = 0, maxAt = null, n = 0, over = 0;
  const dxs = [1, 0, 0.7071, -0.7071]; const dzs = [0, 1, 0.7071, 0.7071];
  for (let d = 0; d < 4; d++) {
    for (let x = x0 - half; x <= x0 + half; x += step) {
      for (let z = z0 - half; z <= z0 + half; z += step) {
        const a = T.height(x, z), b = T.height(x + dxs[d] * S, z + dzs[d] * S);
        const m = T.height(x + dxs[d] * S / 2, z + dzs[d] * S / 2);
        const dev = Math.abs(m - (a + b) / 2);
        n++;
        if (dev > 0.15) over++;
        if (dev > maxDev) { maxDev = dev; maxAt = [+x.toFixed(1), +z.toFixed(1)]; }
      }
    }
  }
  return { maxDev, maxAt, n, pct: over / n * 100 };
}

console.log('=== 云脊山脉边缘 (676, 251) 半径 25 米内的网格插值误差 ===');
console.log('（= 角色脚踩高度 与 画面上地面高度 的平均最大偏差）\n');
for (const [name, T] of variants) {
  const r = scan(T, 676, 251, 25, 1.6);
  console.log(name.padEnd(28), '最大偏差', r.maxDev.toFixed(2).padStart(6), '米  @(' +
    r.maxAt.join(', ') + ')   偏差>0.15m 的采样占', r.pct.toFixed(1) + '%');
}

console.log('\n=== 全世界抽样（40 条 400 米测线）===');
for (const [name, T] of variants) {
  let worst = 0, total = 0, over = 0;
  for (let k = 0; k < 40; k++) {
    const ang = (k / 40) * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
    for (let i = 0; i < 400; i++) {
      const x = 300 + dx * i * 1.0, z = -500 + dz * i * 1.0;
      const a = T.height(x, z), b = T.height(x + dx * S, z + dz * S);
      const m = T.height(x + dx * S / 2, z + dz * S / 2);
      const dev = Math.abs(m - (a + b) / 2);
      total++; if (dev > 0.15) over++;
      if (dev > worst) worst = dev;
    }
  }
  console.log(name.padEnd(28), '最大偏差', worst.toFixed(2).padStart(6), '米   偏差>0.15m 占', (over / total * 100).toFixed(2) + '%');
}
