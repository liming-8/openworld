/* 检查 (715,288) 附近到底放了些什么，以及每个实例脚下的群系/海拔对不对 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const g = window.__game;
  g.player.position.set(715, g.terrain.height(715, 288) + 1.0, 288);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
  g.__geoName = new Map();
  for (const [k, v] of Object.entries(g.world.geoCache)) g.__geoName.set(v, k);
});
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const m4 = new T.Matrix4(); const v = new T.Vector3();
  const near = [];        // 60 米内的实例
  const bad = [];         // 群系和道具不匹配的实例

  // 各群系"允许"的道具（照抄 world.js 的 switch）
  const ALLOW = {
    碧蓝之海: [],
    珊瑚浅滩: ['palm', 'rock', 'grass'],
    风起平原: ['broadleaf', 'pine', 'bush', 'bushSmall', 'rock', 'grass', 'grassTall'],
    低语林地: ['pine', 'broadleaf', 'broadleafTall', 'bush', 'bushSmall', 'rock', 'grass', 'grassTall'],
    烫金流沙: ['cactus', 'rock', 'dead', 'grassTall'],
    苍岩高地: ['pine', 'rock', 'grassTall'],
    云脊山脉: ['pine', 'boulder', 'rock'],
    极寒雪原: ['pineSnow', 'pine', 'rock'],
    苔沼湿地: ['dead', 'reed'],
  };
  // 摆放时用的"近似坡度"（world.js：3.5 ≤ h ≤ 22 时用 0.16 代替真实坡度）
  const biomeAtPlacement = (x, z, h) => {
    const s = (h > 22 || h < 3.5) ? g.terrain.slope(x, z) : 0.16;
    return g.terrain.biome(x, z, h, s).name;
  };

  g.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const name = g.__geoName.get(o.geometry) || '?';
    if (name === 'grass' || name === 'grassTall' || name.startsWith('flower') || name === 'reed') return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4);
      v.setFromMatrixPosition(m4);
      const d = Math.hypot(v.x - 715, v.z - 288);
      if (d > 60) continue;
      const h = g.terrain.height(v.x, v.z);
      const b = g.terrain.biome(v.x, v.z).name;
      const bPlace = biomeAtPlacement(v.x, v.z, h);
      const rec = { name, d: +d.toFixed(1), x: +v.x.toFixed(1), z: +v.z.toFixed(1),
        h: +h.toFixed(1), slope: +g.terrain.slope(v.x, v.z).toFixed(2), b, bPlace };
      if (near.length < 400) near.push(rec);
      const allow = ALLOW[b] || [];
      if (!allow.includes(name)) bad.push(rec);
    }
  });

  const byName = {};
  near.forEach((r) => { byName[r.name] = (byName[r.name] || 0) + 1; });
  const badByKey = {};
  bad.forEach((r) => { const k = r.name + ' @ ' + r.b; badByKey[k] = (badByKey[k] || 0) + 1; });
  return { total: near.length, byName, bad: bad.length, badByKey, badSamples: bad.slice(0, 12) };
});

console.log('=== (715,288) 半径 60 米内的道具 ===');
console.log('实例总数', out.total);
Object.entries(out.byName).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ', String(v).padStart(4), k));

console.log('\n=== 群系与道具不匹配的实例：' + out.bad + ' / ' + out.total + ' ===');
Object.entries(out.badByKey).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ', String(v).padStart(4), k));
console.log('\n样例：');
out.badSamples.forEach((r) => console.log('   ', r.name, `(${r.x}, ${r.z})`, '距玩家', r.d + 'm',
  '海拔', r.h, '坡度', r.slope, '| 精确群系', r.b, '| 摆放时群系', r.bPlace));

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
