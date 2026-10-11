import { Terrain } from 'file:///C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/js/terrain.js';
const T = new Terrain(20261010);
const Z = 251, S = 64 / 28;
console.log('网格步长', S.toFixed(4), '米');
console.log('\n=== h(x, 251) 剖面（x 从 672 到 690，步长 0.25 米）===');
console.log('   x       解析h    相邻差   h/8小数部分   台地权重plateau');
let prev = T.height(672, Z);
for (let i = 0; i <= 72; i++) {
  const x = 672 + i * 0.25;
  const h = T.height(x, Z);
  const cell = h / 8, f = cell - Math.floor(cell);
  console.log('  ' + x.toFixed(2).padStart(7), h.toFixed(2).padStart(9),
    (h - prev).toFixed(2).padStart(8), f.toFixed(3).padStart(12));
  prev = h;
}

console.log('\n=== 网格顶点上的高度 vs 网格中点插值 ===');
const gx0 = Math.round(672 / S) * S;
for (let k = 0; k < 8; k++) {
  const a = gx0 + k * S, b = a + S, m = (a + b) / 2;
  const ha = T.height(a, Z), hb = T.height(b, Z), hm = T.height(m, Z);
  const meshMid = (ha + hb) / 2;
  console.log('  单元 [' + a.toFixed(2) + ', ' + b.toFixed(2) + ']  h(左)=' + ha.toFixed(2) +
    ' h(右)=' + hb.toFixed(2) + ' | 网格中点=' + meshMid.toFixed(2) +
    ' 解析中点=' + hm.toFixed(2) + ' 偏差=' + (hm - meshMid).toFixed(2));
}
