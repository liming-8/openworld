import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(3000);

// 装入帧内计时器
await page.evaluate(() => {
  const g = window.__game;
  window.__prof = { update: 0, render: 0, ui: 0, world: 0, n: 0, t: performance.now() };
  const oUpdate = g.update.bind(g);
  g.update = (dt, now) => {
    const t0 = performance.now();
    oUpdate(dt, now);
    window.__prof.update += performance.now() - t0;
    window.__prof.n++;
  };
  const oUi = g.ui.update.bind(g.ui);
  g.ui.update = (dt) => { const t0 = performance.now(); oUi(dt); window.__prof.ui += performance.now() - t0; };
  const oWorld = g.world.update.bind(g.world);
  g.world.update = (a, b) => { const t0 = performance.now(); oWorld(a, b); window.__prof.world += performance.now() - t0; };
  const oRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = (s, c) => { const t0 = performance.now(); oRender(s, c); window.__prof.render += performance.now() - t0; };
});

const snap = () => page.evaluate(() => {
  const g = window.__game;
  const p = window.__prof;
  const dt = performance.now() - p.t;
  const n = Math.max(p.n, 1);
  const r = { fps: Math.round(g.fpsAvg), frames: n, update: +(p.update / n).toFixed(2), ui: +(p.ui / n).toFixed(2), world: +(p.world / n).toFixed(2), render: +(p.render / n).toFixed(2) };
  p.update = p.render = p.ui = p.world = p.n = 0; p.t = performance.now();
  return r;
});

console.log('=== 静止 ===');
for (let i = 0; i < 5; i++) { await page.waitForTimeout(1000); console.log(JSON.stringify(await snap())); }
console.log('=== 奔跑 ===');
await page.keyboard.down('KeyW');
for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); console.log(JSON.stringify(await snap())); }
await page.keyboard.up('KeyW');
console.log('=== 停下 ===');
for (let i = 0; i < 5; i++) { await page.waitForTimeout(1000); console.log(JSON.stringify(await snap())); }

await browser.close();
