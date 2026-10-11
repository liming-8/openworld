/* 构造"镜头被地形顶到贴脸"的极端场景，确认角色是否会消失 */
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

// 找一处"身后 6m 内地形明显抬高"的点 —— 镜头必然会被土坡顶住
const spot = await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game, tr = g.terrain;
  let best = null, bestRise = -1e9;
  for (let i = 0; i < 3000; i++) {
    const x = (Math.random() - 0.5) * 4000, z = (Math.random() - 0.5) * 4000;
    const h = tr.height(x, z);
    if (h < 2 || h > 60) continue;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const rise = tr.height(x + Math.cos(a) * 5.5, z + Math.sin(a) * 5.5) - h;
      if (rise > bestRise) { bestRise = rise; best = { x, z, a }; }
    }
  }
  g.player.position.set(best.x, tr.height(best.x, best.z), best.z);
  g.player.velocity.set(0, 0, 0);
  // 把镜头放到"上坡那一侧"，让土坡正好挡在角色和镜头之间
  g.cameraRig.yaw = Math.atan2(Math.cos(best.a), Math.sin(best.a));
  window.__spot = best;
  window.__vis = { frames: 0, hidden: 0, minDist: 99, maxDist: 0, hist: {} };
  const v = new T.Vector3();
  const oRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = (s, c) => {
    const r = window.__vis;
    r.frames++;
    if (!g.player.group.visible) r.hidden++;
    const d = +g.cameraRig.distance.toFixed(2);
    if (d < r.minDist) r.minDist = d;
    if (d > r.maxDist) r.maxDist = d;
    const k = Math.round(d * 2) / 2;
    r.hist[k] = (r.hist[k] || 0) + 1;
    r.lastDist = d; r.lastVisible = g.player.group.visible;
    v.set(g.player.position.x, g.player.position.y + 0.9, g.player.position.z).project(c);
    r.lastNdcY = +v.y.toFixed(2); r.lastNdcX = +v.x.toFixed(2);
    oRender(s, c);
  };
  return { spot: best, rise: +bestRise.toFixed(1), biome: tr.biome(best.x, best.z).name, h: +tr.height(best.x, best.z).toFixed(1) };
});
console.log('构造点:', JSON.stringify(spot));
console.log('（rise = 沿某方向 5.5m 处地形抬高了多少米）');

await page.waitForTimeout(2000);
// 在每个方向都停一会，尽量触发贴脸
for (let i = 0; i < 10; i++) {
  await page.evaluate((i) => {
    const g = window.__game;
    g.cameraRig.yaw = window.__spot.a + (i / 10) * Math.PI * 2;
    g.cameraRig.pitch = -0.15;
  }, i);
  await page.waitForTimeout(700);
}

const vis = await page.evaluate(() => window.__vis);
const pct = vis.frames ? (vis.hidden / vis.frames * 100) : 0;
console.log('\n帧数:', vis.frames);
console.log('角色被隐藏的帧:', vis.hidden, '(' + pct.toFixed(0) + '%)', vis.hidden > 0 ? '❌ 角色会消失' : '✅ 一直可见');
console.log('镜头距离范围:', vis.minDist, '~', vis.maxDist, 'm');
console.log('镜头距离分布:', JSON.stringify(vis.hist));
console.log('最后一帧: distance=' + vis.lastDist, 'visible=' + vis.lastVisible, 'ndc=(' + vis.lastNdcX + ',' + vis.lastNdcY + ')');

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
