/* 找一个"沙漠 + 高度跳变大"的点，用来复现角色悬空 */
import { Terrain } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/js/terrain.js';
const T = new Terrain(20261010);
const S = 64 / 28;
const best = [];
const fine = 0.1;
for (let x = -1500; x <= 1500; x += 17) {
  for (let z = -1500; z <= 1500; z += 17) {
    const b = T.biome(x, z);
    if (b.id !== 'DESERT') continue;
    let prev = T.height(x, z), mx = 0, at = null;
    for (let i = 1; i <= 60; i++) {
      const h = T.height(x + i * fine, z);
      const d = Math.abs(h - prev);
      if (d > mx) { mx = d; at = x + i * fine; }
      prev = h;
    }
    if (mx > 3) best.push({ x, z, jump: +mx.toFixed(2), at: +at.toFixed(1) });
  }
}
best.sort((a, b) => b.jump - a.jump);
console.log('=== 沙漠里跳变最大的点 ===');
best.slice(0, 8).forEach((r) => console.log('  跳变', r.jump, '米  @ (' + r.x + ', ' + r.z + ')  突变在 x=' + r.at));
if (best.length) console.log('\n建议复现点: X=' + best[0].x + ' Z=' + best[0].z);
