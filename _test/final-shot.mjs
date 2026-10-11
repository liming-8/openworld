/** 最终展示图：同一地点，修复前（悬空）vs 修复后（踩实），再配一张带影子的实机照。 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact';
fs.mkdirSync(OUT, { recursive: true });

const X = 1261, Z = -136, TIME = 0.62;

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

const prep = async (yaw, dist, pitch) => {
  return page.evaluate(([x, z, t, yaw, dist, pitch]) => {
    const g = window.__game;
    g.settings.shadows = true;
    g.renderer.shadowMap.enabled = true;
    g.world.shadows = true;
    g.sky.setShadows(true);
    g.sky.setTime(t);
    const mh = g.terrain.meshHeight(x, z);
    g.player.position.set(x, mh, z);
    g.player.velocity.set(0, 0, 0);
    for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
    g.cameraRig.yaw = yaw; g.cameraRig.pitch = pitch;
    g.cameraRig.distance = dist; g.cameraRig.targetDistance = dist;
    for (let i = 0; i < 60; i++) g.cameraRig.update(g.player, 0.05, false);
    return { mesh: +mh.toFixed(3), ana: +g.terrain.height(x, z).toFixed(3) };
  }, [X, Z, TIME, yaw, dist, pitch]);
};

// ── 修复前 / 修复后：同机位，只改角色 Y ──
const info = await prep(Math.PI * 0.5, 6.5, -0.22);
console.log('该点 解析高度', info.ana, 'm   网格高度', info.mesh, 'm   差', (info.ana - info.mesh).toFixed(2), 'm');

await page.evaluate(([x, z]) => {
  const g = window.__game;
  g.player.position.y = g.terrain.height(x, z);      // 旧逻辑
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 50; i++) g.cameraRig.update(g.player, 0.05, false);
}, [X, Z]);
await page.waitForTimeout(1500);
const cam = await page.evaluate(() => {
  const c = window.__game.camera;
  return { p: [c.position.x, c.position.y, c.position.z], q: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w] };
});
await page.screenshot({ path: `${OUT}/fin-before.png` });

await page.evaluate(([x, z, cam]) => {
  const g = window.__game;
  g.paused = true;
  g.player.position.y = g.terrain.meshHeight(x, z);    // 新逻辑
  const c = g.camera;
  c.position.set(cam.p[0], cam.p[1], cam.p[2]);
  c.quaternion.set(cam.q[0], cam.q[1], cam.q[2], cam.q[3]);
  g.player.group.position.copy(g.player.position);
}, [X, Z, cam]);
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/fin-after.png` });
console.log('→ fin-before.png / fin-after.png（同机位，唯一差别是角色贴哪个高度）');

// ── 实机照：换个机位，让长影子落在脚边 ──
await page.evaluate(() => { window.__game.paused = false; });
await prep(Math.PI * 0.5, 3.2, -0.40);
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/fin-shadow.png` });
console.log('→ fin-shadow.png');

const gap = await page.evaluate(() => {
  const g = window.__game, p = g.player.position;
  return +(p.y - g.terrain.meshHeight(p.x, p.z)).toFixed(4);
});
console.log('实机照 脚底间隙', gap, 'm');

console.log('错误', errors.length);
await browser.close();
