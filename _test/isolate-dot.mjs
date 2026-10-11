/**
 * 一次性把各类对象分别隐藏后截图，再离线比对"白点那个像素"。
 * 用截图（sRGB、最终画面）而不是 WebGLRenderTarget —— RT 读出来的颜色空间不同、
 * 而且重新渲染一帧会让粒子类对象移动位置，读数不可信。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact/iso';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

const meta = await page.evaluate(async ([x, z]) => {
  const g = window.__game;
  g.sky.setTime(0.62);
  const mh = g.terrain.meshHeight(x, z);
  g.player.position.set(x, mh, z);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
  g.cameraRig.yaw = Math.PI * 0.5; g.cameraRig.pitch = -0.22;
  g.cameraRig.distance = 6.5; g.cameraRig.targetDistance = 6.5;
  for (let i = 0; i < 60; i++) g.cameraRig.update(g.player, 0.05, false);
  g.paused = true;
  g.camera.updateMatrixWorld(true);

  const cats = {};
  const push = (k, o) => { if (!o) return; (cats[k] = cats[k] || []).push(o); };
  g.scene.children.forEach((o) => {
    if (o === g.sky.dome) return push('dome', o);
    if (o === g.sky.stars) return push('stars', o);
    if (o === g.sky.clouds) return push('clouds', o);
    if (o === g.sky.sunDisc) return push('sunDisc', o);
    if (o === g.sky.moonDisc) return push('moonDisc', o);
    push('top', o);
  });
  // 按类型归类
  const terrain = [], water = [], landmark = [], player = [], points = [], other = [];
  g.scene.traverse((o) => {
    if (o.isPoints) points.push(o);
    if (o.isMesh && o.material === g.world.terrainMaterial) terrain.push(o);
  });
  const wm = g.water && (g.water.mesh || g.water.material);
  if (g.water && g.water.mesh) water.push(g.water.mesh);
  for (const obj of g.objects.values()) { if (obj.group) landmark.push(obj.group); else landmark.push(obj); }
  // 玩家
  if (g.player.group) player.push(g.player.group);

  window.__cats = { ...cats, terrain, water, landmark, player, points, other };
  window.__all = [];
  Object.values(window.__cats).forEach((arr) => arr.forEach((o) => { if (!window.__all.includes(o)) window.__all.push(o); }));
  window.__saved = window.__all.map((o) => o.visible);
  window.__skip = {};
  return {
    sizes: Object.fromEntries(Object.entries(window.__cats).map(([k, v]) => [k, v.length])),
    n: window.__all.length,
  };
}, [1261, -136]);
console.log('分类数量', JSON.stringify(meta.sizes));

const shoot = async (name, mode) => {
  await page.evaluate((mode) => {
    window.__all.forEach((o, i) => { o.visible = window.__saved[i]; });
    if (mode === 'all') window.__all.forEach((o) => { o.visible = false; });
    else if (mode !== 'base') (window.__cats[mode] || []).forEach((o) => { o.visible = false; });
  }, mode);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

await shoot('base', 'base');
console.log('已拍 base');
for (const k of ['terrain', 'water', 'landmark', 'player', 'points', 'top', 'all']) {
  if (!meta.sizes[k] && k !== 'all') { console.log('  跳过', k, '(0 个)'); continue; }
  await shoot('hide-' + k, k);
  console.log('  已拍 hide-' + k);
}
await browser.close();
