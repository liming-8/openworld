/* 诊断：1) 角色为何不显示  2) 迷你地图视野锥方向偏差 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

/* ---------- A. 视野锥方向偏差 ---------- */
const cone = await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const out = [];
  for (let i = 0; i < 8; i++) {
    g.cameraRig.yaw = (i / 8) * Math.PI * 2;
    g.cameraRig.update(g.player, 0.016, false);
    g.ui.renderMinimap(true);          // 强制重绘一次小地图，读出实际绘制的方向
    // 相机真实朝向（世界向量，投影到 XZ）
    const v = new T.Vector3();
    g.camera.getWorldDirection(v);
    const camAng = Math.atan2(v.z, v.x);
    // 迷你地图实际画出的视野锥方向
    const mapAng = Math.atan2(g.ui.viewDirZ, g.ui.viewDirX);
    let d = (camAng - mapAng) * 180 / Math.PI;
    while (d > 180) d -= 360; while (d < -180) d += 360;
    out.push({ yaw: +g.cameraRig.yaw.toFixed(2), diffDeg: +d.toFixed(1) });
  }
  return out;
});
console.log('=== A. 迷你地图视野锥 vs 相机真实朝向 ===');
cone.forEach((r) => console.log('  yaw', r.yaw, '→ 偏差', r.diffDeg, '°'));
const avg = cone.reduce((s, r) => s + Math.abs(r.diffDeg), 0) / cone.length;
console.log('  平均偏差:', avg.toFixed(1), '°', avg > 170 ? '❌ 视野锥反了 180°' : avg < 15 ? '✅ 一致' : '⚠ 偏差异常');

/* ---------- B. 角色可见性 ---------- */
const spot = await page.evaluate(() => {
  const g = window.__game;
  const x = 515, z = 106;
  g.player.position.set(x, g.terrain.height(x, z), z);
  g.player.velocity.set(0, 0, 0);
  g.player.facing = 0; g.player.targetFacing = 0;
  return { biome: g.terrain.biome(x, z).name, h: +g.terrain.height(x, z).toFixed(1) };
});
console.log('\n=== B. 角色可见性（复现用户截图坐标 515,106）===');
console.log('  落点生物群系:', spot.biome, ' 地面高度:', spot.h);
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const v = new T.Vector3();
  window.__vis = { frames: 0, hidden: 0, minDist: 99, maxDist: 0, offScreen: 0,
    minCamAboveGround: 99, minPlayerAboveGround: 99, samples: [] };
  const oRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = (s, c) => {
    const r = window.__vis;
    r.frames++;
    if (!g.player.group.visible) r.hidden++;
    const d = g.cameraRig.distance;
    if (d < r.minDist) r.minDist = d;
    if (d > r.maxDist) r.maxDist = d;
    const ca = c.position.y - g.terrain.height(c.position.x, c.position.z);
    if (ca < r.minCamAboveGround) r.minCamAboveGround = ca;
    const pa = g.player.position.y - g.terrain.height(g.player.position.x, g.player.position.z);
    if (pa < r.minPlayerAboveGround) r.minPlayerAboveGround = pa;
    // 角色头顶是否在画面内
    v.set(g.player.position.x, g.player.position.y + 0.9, g.player.position.z).project(c);
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || v.z < -1 || v.z > 1) r.offScreen++;
    oRender(s, c);
  };
});

// 沿沙丘行走 + 不停转动镜头，模拟真实操作
await page.keyboard.down('KeyW');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(800);
  await page.evaluate((i) => {
    const g = window.__game;
    g.cameraRig.yaw = g.cameraRig.yaw + (i % 2 ? 1.1 : -0.55);
    g.cameraRig.pitch = -0.5 + (i % 3) * 0.25;
  }, i);
}
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);

const vis = await page.evaluate(() => window.__vis);
const pct = vis.frames ? (vis.hidden / vis.frames * 100) : 0;
console.log('  帧数:', vis.frames);
console.log('  角色被隐藏的帧:', vis.hidden, '(' + pct.toFixed(0) + '%)', vis.hidden > 0 ? '❌ 会消失' : '✅ 一直可见');
console.log('  镜头距离范围:', vis.minDist.toFixed(2), '~', vis.maxDist.toFixed(2), 'm',
  vis.minDist < 1.8 ? '← 低于 1.8 就会隐藏角色' : '');
console.log('  角色头顶不在画面内的帧:', vis.offScreen);
console.log('  相机离地最低:', vis.minCamAboveGround.toFixed(2), 'm   角色离地最低:', vis.minPlayerAboveGround.toFixed(2), 'm');

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
