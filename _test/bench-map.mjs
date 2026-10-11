/** 基准：世界地图不同采样分辨率下的生成耗时 */
import { Terrain } from '../js/terrain.js';

const t = new Terrain();
for (let i = 0; i < 20000; i++) t.height(i * 7, i * 3);   // 预热

const SPAN = 2200;
console.log('分辨率      只采样高度      含地表配色');
for (const n of [128, 192, 256, 320, 384, 512, 640]) {
  const st = SPAN / (n - 1);
  let t0 = performance.now(), acc = 0;
  for (let j = 0; j < n; j++) {
    const z = -1100 + j * st;
    for (let k = 0; k < n; k++) acc += t.height(-1100 + k * st, z);
  }
  const dt1 = performance.now() - t0;

  const c = [0, 0, 0];
  t0 = performance.now();
  for (let j = 0; j < n; j++) {
    const z = -1100 + j * st;
    for (let k = 0; k < n; k++) {
      const x = -1100 + k * st;
      const h = t.height(x, z);
      if (h >= 0) t.surfaceColor(x, z, h, 0.25, c);
    }
  }
  const dt2 = performance.now() - t0;
  console.log(
    String(n).padStart(4) + '×' + String(n).padEnd(5),
    (dt1.toFixed(1) + ' ms').padStart(12),
    (dt2.toFixed(1) + ' ms').padStart(14),
    '(acc=' + acc.toFixed(0) + ')');
}
