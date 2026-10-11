/**
 * 天空里那个白点到底是谁画的？
 * 做法：固定同一个机位，逐个隐藏候选对象，读 (640,359) 这个像素的亮度，
 *       谁的消失能让白点消失，谁就是元凶。
 * 只靠射线检测是不够的 —— Points 的射线检测需要 threshold，远处点根本打不中。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact/dot';
fs.mkdirSync(OUT, { recursive: true });
const PX = 640, PY = 359;

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

await page.evaluate(async ([x, z]) => {
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
  window.__sk = g.sky;
  // 记录候选对象的当前可见性
  const allPoints = [];
  g.scene.traverse((o) => { if (o.isPoints) allPoints.push(o); });
  window.__cand = {
    stars: g.sky.stars,
    clouds: g.sky.clouds,
    sunDisc: g.sky.sunDisc,
    moonDisc: g.sky.moonDisc,
    dome: g.sky.dome,
    allPoints: { visible: true, __multi: allPoints },
  };
}, [1261, -136]);
await page.waitForTimeout(1200);

/** 读该像素及其周围最亮值（用 canvas 采样） */
const sample = () => page.evaluate(([px, py]) => {
  const cv = document.querySelector('canvas');
  const g = window.__game;
  // WebGL canvas 用 drawImage 到 2D canvas 取像素
  const tmp = document.createElement('canvas');
  tmp.width = cv.width; tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  const sx = Math.round(px * (cv.width / window.innerWidth));
  const sy = Math.round(py * (cv.height / window.innerHeight));
  let best = 0, bestPx = null;
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const d = ctx.getImageData(sx + dx, sy + dy, 1, 1).data;
      const lum = d[0] + d[1] + d[2];
      if (lum > best) { best = lum; bestPx = [d[0], d[1], d[2]]; }
    }
  }
  // 也读一下背景（远处）作为参考
  const bg = ctx.getImageData(sx + 40, sy + 40, 1, 1).data;
  return { bestLum: best, bestPx, bgLum: bg[0] + bg[1] + bg[2], canvas: [cv.width, cv.height], sx, sy };
}, [PX, PY]);

const base = await sample();
console.log('基准：最亮', base.bestLum, 'rgb', JSON.stringify(base.bestPx), ' 背景亮度', base.bgLum);

const names = ['stars', 'clouds', 'sunDisc', 'moonDisc', 'dome', 'allPoints'];
for (const n of names) {
  await page.evaluate((n) => {
    const c = window.__cand[n];
    if (!c) return;
    if (c.__multi) { c.__multi.forEach((o) => { o.visible = false; }); return; }
    if (c.visible === undefined) c.visible = true;
    c.visible = false;
  }, n);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/hide-${n}.png` });
  await page.evaluate((n) => { const c = window.__cand[n]; if (c) c.visible = true; }, n);
  await page.waitForTimeout(400);
}
console.log('已保存 hide-*.png，请用 PIL 分析 (639,359)');

// 还原 + 顺便看星空材质状态
const st = await page.evaluate(() => {
  const k = window.__sk;
  return {
    starOpacity: k.stars.material.opacity,
    starCount: k.stars.geometry.attributes.position.count,
    sunDirY: +k.sunDir.y.toFixed(3),
    starPos0: [0, 1, 2].map((i) => +k.stars.geometry.attributes.position.array[i].toFixed(1)),
    camPos: [+window.__game.camera.position.x.toFixed(1), +window.__game.camera.position.y.toFixed(1), +window.__game.camera.position.z.toFixed(1)],
  };
});
console.log('\n星空状态:', JSON.stringify(st));
await browser.close();
