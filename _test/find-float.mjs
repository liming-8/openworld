/* 找一个"沙漠 + 沙丘平缓 + 但解析高度与网格高度差得明显"的点，用来做对照 */
import { Terrain } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/js/terrain.js';
const T = new Terrain(20261010);
const out = [];
for (let x = -1500; x <= 1500; x += 11) {
  for (let z = -1500; z <= 1500; z += 11) {
    if (T.biome(x, z).id !== 'DESERT') continue;
    const s = T.slope(x, z);
    if (s > 0.35) continue;                       // 只要平缓沙丘，排除陡坡
    const d = T.height(x, z) - T.meshHeight(x, z);
    if (d > 0.8) out.push({ x, z, d: +d.toFixed(2), slope: +s.toFixed(2), h: +T.height(x, z).toFixed(1) });
  }
}
out.sort((a, b) => b.d - a.d);
console.log('=== 平缓沙漠里 解析高度 高于 网格高度 的点（角色会悬空）===');
out.slice(0, 10).forEach((r) => console.log('  悬空', r.d, '米  @(' + r.x + ', ' + r.z + ')  坡度', r.slope, ' 海拔', r.h));
if (out.length) console.log('\n推荐对照点: X=' + out[0].x + ' Z=' + out[0].z + '  (悬空 ' + out[0].d + ' 米)');
console.log('\n（另外：全图平缓沙漠里共有 ' + out.length + ' 个"悬空 > 0.8 米"的点）');
