import { Terrain, SEA_LEVEL } from '../js/terrain.js';

const T = new Terrain();
let land = 0, ocean = 0, n = 0, maxH = -1e9, minH = 1e9;
const hist = {};
const samples = [];
for (let i = 0; i < 400; i++) {
  for (let j = 0; j < 400; j++) {
    const x = (i - 200) * 17.3, z = (j - 200) * 17.3;
    const h = T.height(x, z);
    maxH = Math.max(maxH, h); minH = Math.min(minH, h);
    if (h > SEA_LEVEL) land++; else ocean++;
    n++;
    hist[T.biome(x, z, h).id] = (hist[T.biome(x, z, h).id] || 0) + 1;
    samples.push(h);
  }
}
console.log('样本', n);
console.log('陆地', (land / n * 100).toFixed(1) + '%', '| 海洋', (ocean / n * 100).toFixed(1) + '%');
console.log('高度范围', minH.toFixed(1), '~', maxH.toFixed(1));
samples.sort((a, b) => a - b);
const q = p => samples[Math.floor(p * samples.length)].toFixed(1);
console.log('高度分位 p10/p50/p90/p99:', q(0.1), q(0.5), q(0.9), q(0.99));
Object.entries(hist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('   ', k, (v / n * 100).toFixed(1) + '%'));

let steep = 0, tot = 0, water = 0;
for (let i = 0; i < 4000; i++) {
  const x = (Math.random() - 0.5) * 8000, z = (Math.random() - 0.5) * 8000;
  const h = T.height(x, z);
  if (h < SEA_LEVEL + 1) { water++; continue; }
  const s = T.slope(x, z); tot++; if (s > 0.62) steep++;
}
console.log('随机点水下比例:', (water / 4000 * 100).toFixed(1) + '%');
console.log('陆地陡坡占比(>0.62):', (steep / tot * 100).toFixed(1) + '%');

// 性能：1000 次高度采样耗时
const t0 = performance.now();
let acc = 0;
for (let i = 0; i < 1000; i++) acc += T.height(i * 3.1, i * 1.7);
const t1 = performance.now();
console.log('height() 单次耗时:', ((t1 - t0) / 1000 * 1000).toFixed(3) + ' µs', '| checksum', acc.toFixed(2));
