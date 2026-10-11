/* 高度场能不能被网格还原？
 *
 * 角色贴地用的是解析高度 h(x,z)，而眼睛看到的是地形网格 ——
 * 网格会把相邻两个网格顶点的高度做**线性插值**。
 * 所以真正要检查的量是「网格中点插值误差」：
 *
 *     dev = | h(中点) − (h(左端点) + h(右端点)) / 2 |
 *
 * dev 就是"脚踩的高度"与"看到的地面"之间的差。
 * 只要高度场是连续的，dev 会随网格变密而快速趋零；
 * 一旦存在断崖，dev 会稳定停在"落差的一半"，怎么加密网格都好不了。
 */
import { Terrain } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/js/terrain.js';
import { Terrain_OLD } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/_terrain_old.js';

const T = process.env.OLD ? new Terrain_OLD(20261010) : new Terrain(20261010);
const TAG = process.env.OLD ? '修复前' : '修复后';
const S = 64 / 28;                       // "中"画质网格步长 ≈ 2.286 米

/** 沿各方向扫描网格单元的"中点插值误差" */
function scan(step) {
  let maxDev = 0, maxAt = null, n = 0;
  const hist = {};
  const samples = [];
  const bucket = (d) => d < 0.05 ? '<0.05' : d < 0.15 ? '0.05~0.15' : d < 0.5 ? '0.15~0.5'
    : d < 1.0 ? '0.5~1.0' : d < 2.0 ? '1.0~2.0' : '>2.0';

  for (let k = 0; k < 60; k++) {
    const ang = (k / 60) * Math.PI * 2;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    for (let i = 0; i < 900; i++) {
      const x = 400 + dx * i * step, z = -600 + dz * i * step;
      const x2 = x + dx * step, z2 = z + dz * step;
      const a = T.height(x, z), b = T.height(x2, z2);
      const m = T.height((x + x2) / 2, (z + z2) / 2);
      const dev = Math.abs(m - (a + b) / 2);
      n++;
      hist[bucket(dev)] = (hist[bucket(dev)] || 0) + 1;
      if (dev > maxDev) { maxDev = dev; maxAt = [+x.toFixed(1), +z.toFixed(1)]; }
      if (dev > 0.5 && samples.length < 5) samples.push({ x: +x.toFixed(1), z: +z.toFixed(1), dev: +dev.toFixed(2) });
    }
  }
  return { n, maxDev, maxAt, hist, samples };
}

console.log('=== 网格中点插值误差 [' + TAG + '] ===');
console.log('（= 角色脚踩的解析高度 与 画面上网格高度 之间的偏差）\n');
console.log('若高度场连续，偏差应随网格加密迅速趋零；若有断崖，偏差会卡住不降。\n');

for (const step of [S, S / 2, S / 4, S / 8]) {
  const rr = scan(step);
  console.log('网格步长 ' + step.toFixed(3).padStart(6) + ' 米 :  最大偏差 ' +
    rr.maxDev.toFixed(3).padStart(7) + ' 米   @ (' + (rr.maxAt ? rr.maxAt.join(', ') : '-') + ')');
}

const r = scan(S);
console.log('\n当前画质（' + S.toFixed(2) + ' 米）下的误差分布 —— ' + TAG);
Object.entries(r.hist).forEach(([k, v]) => {
  console.log('   ' + k.padEnd(10), String(v).padStart(7), ' (' + (v / r.n * 100).toFixed(3) + '%)');
});
console.log('\n偏差 > 0.5 米的样例（这些点角色会明显悬空 / 陷入）：');
r.samples.forEach((s) => console.log('   (' + s.x + ', ' + s.z + ')  偏差 ' + s.dev + ' 米'));

const r4 = scan(S / 4);
console.log('\n=== 结论 ===');
console.log('网格加密到 1/4 后最大偏差: ' + r4.maxDev.toFixed(3) + ' 米');
if (r4.maxDev < 0.05) console.log('✅ 偏差随网格加密收敛到 0 —— 高度场连续，网格能忠实还原');
else console.log('❌ 偏差不随网格加密收敛（仍有 ' + r4.maxDev.toFixed(3) + ' 米）—— 存在网格表现不出的断崖');
