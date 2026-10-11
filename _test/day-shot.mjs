/** 一张白天实机照：角色踩在沙地上、影子在脚边（用于交付展示）。 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact';

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

const r = await page.evaluate(async () => {
  const g = window.__game;
  g.sky.setTime(0.34);                       // 清晨，和开局默认一致
  // 找一块开阔平坦的沙地
  const T = g.terrain;
  let best = null, bs = 1e9;
  for (let i = 0; i < 6000; i++) {
    const x = (Math.random() - 0.5) * 5000, z = (Math.random() - 0.5) * 5000;
    const h = T.height(x, z);
    if (h < 4 || h > 24) continue;
    if (T.biome(x, z).id !== 'DESERT') continue;
    let mx = 0;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, rr = 8 + Math.random() * 30;
      mx = Math.max(mx, T.slope(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
    }
    if (mx < bs) { bs = mx; best = { x, z }; }
  }
  const mh = T.meshHeight(best.x, best.z);
  g.player.position.set(best.x, mh, best.z);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
  // 让影子落在画面里：镜头绕到太阳侧面
  let sun = null; g.scene.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; });
  const sd = sun ? Math.atan2(sun.position.z, sun.position.x) : 0;
  g.cameraRig.yaw = sd + Math.PI * 0.5;
  g.cameraRig.pitch = -0.34;
  g.cameraRig.distance = 5.2; g.cameraRig.targetDistance = 5.2;
  for (let i = 0; i < 60; i++) g.cameraRig.update(g.player, 0.05, false);
  return { x: +best.x.toFixed(0), z: +best.z.toFixed(0), slope: +bs.toFixed(3), mesh: +mh.toFixed(2) };
});
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/fixed-0-day.png` });
const gap = await page.evaluate(() => {
  const g = window.__game, p = g.player.position;
  return +(p.y - g.terrain.meshHeight(p.x, p.z)).toFixed(4);
});
console.log('落点', r.x, r.z, ' 坡度', r.slope, ' 网格高度', r.mesh, ' 脚底间隙', gap, 'm');
await browser.close();
