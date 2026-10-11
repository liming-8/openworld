/* 诊断：各类道具在"世界空间"里的真实尺寸——判断岩石是不是被放得过大 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

// 在云脊山脉 (715,288) 蹲点，把周围资源区域全部加载出来
await page.evaluate(() => {
  const g = window.__game;
  g.player.position.set(715, g.terrain.height(715, 288) + 1.0, 288);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
});
await page.waitForTimeout(1500);

const stat = await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const cache = g.world.geoCache;

  // 几何体 → 道具名
  const geoName = new Map();
  for (const [k, v] of Object.entries(cache)) geoName.set(v, k);

  const box = new T.Box3();
  const m4 = new T.Matrix4();
  const byProp = {};

  g.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const name = geoName.get(o.geometry) || '(未知)';
    o.geometry.computeBoundingBox();
    const local = o.geometry.boundingBox;
    const rec = byProp[name] || (byProp[name] = { batches: 0, instances: 0, sizes: [], heights: [] });
    rec.batches++;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4);
      box.copy(local).applyMatrix4(m4);
      const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
      rec.sizes.push(Math.hypot(sx, sz));
      rec.heights.push(sy);
      rec.instances++;
    }
  });

  const out = [];
  for (const [name, r] of Object.entries(byProp)) {
    const s = r.sizes.slice().sort((a, b) => a - b);
    const h = r.heights.slice().sort((a, b) => a - b);
    const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
    out.push({
      name, batches: r.batches, instances: r.instances,
      spanMin: +q(s, 0).toFixed(2), spanMid: +q(s, 0.5).toFixed(2), spanMax: +q(s, 0.999).toFixed(2),
      hMid: +q(h, 0.5).toFixed(2), hMax: +q(h, 0.999).toFixed(2),
      verts: 0,
    });
  }
  out.sort((a, b) => b.instances - a.instances);
  return out;
});

console.log('=== 云脊山脉 (715,288) 周围，各类道具的世界空间尺寸（米）===');
console.log('道具'.padEnd(16), '批次数'.padStart(8), '实例数'.padStart(8), '水平跨度中位'.padStart(14), '水平跨度最大'.padStart(14), '高度中位'.padStart(10), '高度最大'.padStart(10));
for (const r of stat) {
  console.log(
    r.name.padEnd(16),
    String(r.batches).padStart(8),
    String(r.instances).padStart(8),
    String(r.spanMid).padStart(14),
    String(r.spanMax).padStart(14),
    String(r.hMid).padStart(10),
    String(r.hMax).padStart(10)
  );
}
console.log('\n参照：人物身高约 1.8 米。PROP_METRICS 里 boulder 声明为 高3.4 / 半径1.7（即跨度约3.4米）。');

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
