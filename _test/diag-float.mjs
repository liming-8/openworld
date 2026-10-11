/* 量化"角色站的解析高度" 与 "实际画出来的地形网格高度" 的差
 * 正值 = 角色悬空，负值 = 角色陷进地面 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact';
fs.mkdirSync(OUT, { recursive: true });

const X0 = Number(process.argv[2] || 676);
const Z0 = Number(process.argv[3] || 251);
const SPAN = Number(process.argv[4] || 12);

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1080, height: 594 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

await page.evaluate(([x, z]) => {
  const g = window.__game;
  g.player.position.set(x, g.terrain.height(x, z) + 1.0, z);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
}, [X0, Z0]);
await page.waitForTimeout(1500);

const res = await page.evaluate(async ([X0, Z0, SPAN]) => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const rc = new T.Raycaster();
  const down = new T.Vector3(0, -1, 0);
  const meshes = [];
  g.scene.traverse((o) => { if (o.isMesh && o.material === g.world.terrainMaterial) meshes.push(o); });

  const rows = [];
  let maxFloat = -1e9, maxSink = 1e9, maxAt = null;
  let mhMax = -1e9, mhMin = 1e9;                    // meshHeight 与网格的差（应≈0）
  for (let i = 0; i <= 240; i++) {
    const x = X0 - SPAN + (2 * SPAN) * i / 240;
    const z = Z0;
    const ah = g.terrain.height(x, z);
    rc.set(new T.Vector3(x, ah + 80, z), down);
    rc.near = 0; rc.far = 400;
    const hit = rc.intersectObjects(meshes, false)[0];
    if (!hit) continue;
    const d = ah - hit.point.y;                     // >0 悬空
    // 角色现在实际使用的贴地高度
    const mh = g.terrain.meshHeight(x, z) - hit.point.y;
    if (mh > mhMax) mhMax = mh;
    if (mh < mhMin) mhMin = mh;
    rows.push({ x: +x.toFixed(2), ah: +ah.toFixed(2), mesh: +hit.point.y.toFixed(2), d: +d.toFixed(2) });
    if (d > maxFloat) { maxFloat = d; maxAt = +x.toFixed(2); }
    if (d < maxSink) maxSink = d;
  }
  const abs = rows.map((r) => Math.abs(r.d)).sort((a, b) => b - a);
  return {
    maxFloat: +maxFloat.toFixed(2), maxSink: +maxSink.toFixed(2), maxAt,
    absMax: +abs[0].toFixed(2), absMid: +abs[Math.floor(abs.length / 2)].toFixed(2),
    mhMax: +mhMax.toFixed(4), mhMin: +mhMin.toFixed(4),
    worst: rows.slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8),
  };
}, [X0, Z0, SPAN]);

console.log(`=== Z=${Z0} 沿 X 从 ${X0 - SPAN} 到 ${X0 + SPAN} 扫描（241 个采样）===`);
console.log('\n【旧】直接用解析高度 height() 贴地：');
console.log('   悬空最大', res.maxFloat, '米   入地最大', res.maxSink, '米   中位偏差', res.absMid, '米');
console.log('\n【新】用与网格一致的 meshHeight() 贴地：');
console.log('   与画面网格的最大偏差 :', res.mhMax, '米');
console.log('   与画面网格的最小偏差 :', res.mhMin, '米');
if (Math.abs(res.mhMax) < 0.01 && Math.abs(res.mhMin) < 0.01) {
  console.log('   ✅ 完全吻合（< 1 厘米）—— 角色脚下就是画出来的地面');
} else {
  console.log('   ⚠️ 仍有偏差，需要检查 meshStep 或三角剖分');
}
console.log('\n（解析高度偏差最大的 8 个点，仅用于说明地形本身的细度）');
console.log('   X        解析高度   网格高度   偏差(正=悬空)');
res.worst.forEach((r) => console.log('  ', String(r.x).padStart(8), String(r.ah).padStart(9), String(r.mesh).padStart(10), String(r.d).padStart(12)));

// 把角色放到偏差最大的位置拍一张
await page.evaluate(([x, z]) => {
  const g = window.__game;
  g.player.position.set(x, g.terrain.height(x, z), z);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
  g.cameraRig.yaw = Math.PI * 1.5; g.cameraRig.pitch = -0.06;
  g.cameraRig.distance = 7; g.cameraRig.targetDistance = 7;
  for (let i = 0; i < 40; i++) g.cameraRig.update(g.player, 0.05, false);
}, [X0, Z0]);
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/float-${X0}_${Z0}.png` });

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
