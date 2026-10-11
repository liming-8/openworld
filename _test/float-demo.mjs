/* 同一机位对照：角色"踩解析高度"（修复前）vs "踩网格高度"（修复后）
 * 用冻结相机的方式保证两张图机位完全一致。 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact';
fs.mkdirSync(OUT, { recursive: true });

const X = Number(process.argv[2] || 1261);
const Z = Number(process.argv[3] || -136);

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

// 让角色静止站好（不要走来走去的动画）
const ground = await page.evaluate(([x, z]) => {
  const g = window.__game;
  g.player.position.set(x, g.terrain.meshHeight(x, z), z);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
  g.cameraRig.yaw = Math.PI * 0.5;
  g.cameraRig.pitch = -0.22;
  g.cameraRig.distance = 6.5; g.cameraRig.targetDistance = 6.5;
  for (let i = 0; i < 40; i++) g.cameraRig.update(g.player, 0.05, false);
  return { analytic: +g.terrain.height(x, z).toFixed(2), mesh: +g.terrain.meshHeight(x, z).toFixed(2) };
}, [X, Z]);
await page.waitForTimeout(1200);

console.log('该点  解析高度', ground.analytic, '米   网格高度', ground.mesh,
  '米   差值', (ground.analytic - ground.mesh).toFixed(2), '米');

/* ---------- 1) 修复前：角色 Y = 解析高度 ---------- */
await page.evaluate(([x, z]) => {
  const g = window.__game;
  g.player.position.y = g.terrain.height(x, z);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 40; i++) g.cameraRig.update(g.player, 0.05, false);
}, [X, Z]);
await page.waitForTimeout(1300);
// 记录相机位姿，稍后原样恢复
const cam = await page.evaluate(() => {
  const c = window.__game.camera;
  return {
    p: [c.position.x, c.position.y, c.position.z],
    q: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w],
  };
});
await page.screenshot({ path: `${OUT}/float-before.png` });

/* ---------- 2) 修复后：角色 Y = 网格高度，相机冻结回原位 ---------- */
const after = await page.evaluate(([x, z, cam]) => {
  const g = window.__game;
  g.paused = true;                                  // 主循环不再动相机
  g.player.position.y = g.terrain.meshHeight(x, z);
  g.player.velocity.set(0, 0, 0);
  const c = g.camera;
  c.position.set(cam.p[0], cam.p[1], cam.p[2]);
  c.quaternion.set(cam.q[0], cam.q[1], cam.q[2], cam.q[3]);
  g.player.group.position.copy(g.player.position);
  return {
    y: +g.player.position.y.toFixed(2),
    meshY: +g.terrain.meshHeight(x, z).toFixed(2),
  };
}, [X, Z, cam]);
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/float-after.png` });

console.log('修复后角色 Y', after.y, ' 网格高度', after.meshY);
console.log('（两张图使用完全相同的相机位姿，唯一差别是角色贴的是哪个高度）');
console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
