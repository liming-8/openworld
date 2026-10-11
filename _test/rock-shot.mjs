/* 对照截图：在用户复现点 (715,288) 用完全相同的机位重拍，
 * 并用"隐藏一类物体"做隔离，确认那些深色大平面到底是岩石还是地形。 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact';
fs.mkdirSync(OUT, { recursive: true });

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

await page.evaluate(() => {
  const g = window.__game;
  g.player.position.set(715, g.terrain.height(715, 288) + 1.0, 288);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
});
await page.waitForTimeout(1500);

/** 摆机位并等相机停稳 */
const setCam = (yaw, pitch, dist) => page.evaluate(([yaw, pitch, dist]) => {
  const g = window.__game;
  g.cameraRig.yaw = yaw;
  g.cameraRig.pitch = pitch;
  g.cameraRig.distance = dist; g.cameraRig.targetDistance = dist;
  // 平滑要跟上去，否则截到的是过渡中的镜头
  for (let i = 0; i < 40; i++) g.cameraRig.update(g.player, 0.05, false);
}, [yaw, pitch, dist]);

/* ---------- 1) 复刻修复前的两个机位 ---------- */
await setCam(0.628, 0.25, 6);          // 对应修复前的 probe.png
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/after-A.png` });

await setCam(Math.PI * 0.5, -0.15, 6); // 对应修复前的 repro.png
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/after-B.png` });

/* ---------- 2) 隔离测试：只隐藏植被实例（岩石属于这一类） ---------- */
// 注意：InstancedMesh 并不直接挂在 scene 下，而是嵌在 Group 里，必须递归遍历
const hide = (which) => page.evaluate((which) => {
  const g = window.__game;
  let n = 0;
  g.scene.traverse((o) => {
    if (which === 'inst' && o.isInstancedMesh) { o.visible = false; n++; }
    if (which === 'terrain' && o.material === g.world.terrainMaterial) { o.visible = false; n++; }
  });
  return n;
}, which);

await hide('inst').then((n) => console.log('隐藏植被实例批次:', n));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/after-B-noProps.png` });

/* ---------- 3) 只保留地形 ---------- */
await page.evaluate(() => {
  const g = window.__game;
  g.scene.traverse((o) => {
    if (o.isMesh && o.material !== g.world.terrainMaterial) o.visible = false;
  });
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/after-B-terrainOnly.png` });

/* ---------- 4) 恢复，列出所有 InstancedMesh 批次 ---------- */
const found = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  g.scene.traverse((o) => {
    o.visible = true;
    if (!o.isInstancedMesh) return;
    const bs = o.geometry && o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0;
    const verts = o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0;
    out.push({ count: o.count, verts, r: +bs.toFixed(2) });
  });
  return out;
});
console.log('\n场景中的 InstancedMesh 批次数:', found.length);
const largest = found.slice().sort((a, b) => b.r - a.r).slice(0, 12);
console.log('包围球最大的 12 个批次（数量 / 顶点 / 半径）:');
largest.forEach((f) => console.log('  ', String(f.count).padStart(4), '/', String(f.verts).padStart(5), '/ R=' + f.r));

await setCam(2.2, -0.05, 4.5);
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/after-C.png` });

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
