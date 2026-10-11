/** 环绕 8 个机位拍脚部特写，挑一张"影子明显落在脚边"的 —— 只为了出图。 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact/sweep';
fs.mkdirSync(OUT, { recursive: true });

const X = Number(process.argv[2] || 1317);
const Z = Number(process.argv[3] || 121);
const TIME = Number(process.argv[4] || 0.62);

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

await page.evaluate(([x, z]) => {
  const g = window.__game;
  g.settings.shadows = true;
  g.renderer.shadowMap.enabled = true;
  g.world.shadows = true;
  g.sky.setShadows(true);
  const mh = g.terrain.meshHeight(x, z);
  g.player.position.set(x, mh, z);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
  // 隐藏 HUD，画面干净
  document.querySelectorAll('#hud > *').forEach((e) => { e.style.display = 'none'; });
  document.getElementById('minimap-wrap')?.style.setProperty('display', 'none');
  document.querySelectorAll('.panel').forEach((e) => { e.style.display = 'none'; });
}, [X, Z]);

const sunDir = await page.evaluate(() => {
  const g = window.__game;
  // 找太阳光方向
  let sun = null;
  g.scene.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; });
  if (!sun) return null;
  const p = sun.position;
  const L = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / L, y: p.y / L, z: p.z / L };
});
console.log('太阳方向', JSON.stringify(sunDir));

for (let i = 0; i < 8; i++) {
  const yaw = (i / 8) * Math.PI * 2;
  await page.evaluate(([t, yaw]) => {
    const g = window.__game;
    g.sky.setTime(t);
    g.cameraRig.yaw = yaw;
    g.cameraRig.pitch = -0.42;
    g.cameraRig.distance = 3.0; g.cameraRig.targetDistance = 3.0;
    for (let k = 0; k < 40; k++) g.cameraRig.update(g.player, 0.05, false);
  }, [TIME, yaw]);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/yaw-${i}.png` });
  process.stdout.write(i + ' ');
}
console.log('\n完成 →', OUT);
await browser.close();
