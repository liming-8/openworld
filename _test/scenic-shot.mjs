/* 景点截图 + 屏幕命中表：确认画面里每一大块到底是谁 */
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

// 把几何体跟道具名对上，命中表才能报出"这是哪一类"
await page.evaluate(() => {
  const g = window.__game;
  g.__geoName = new Map();
  for (const [k, v] of Object.entries(g.world.geoCache)) g.__geoName.set(v, k);
});

const goto = async (x, z, yaw, pitch, dist) => {
  await page.evaluate(([x, z, yaw, pitch, dist]) => {
    const g = window.__game;
    g.player.position.set(x, g.terrain.height(x, z) + 1.0, z);
    g.player.velocity.set(0, 0, 0);
    for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
    g.cameraRig.yaw = yaw; g.cameraRig.pitch = pitch;
    g.cameraRig.distance = dist; g.cameraRig.targetDistance = dist;
    for (let i = 0; i < 40; i++) g.cameraRig.update(g.player, 0.05, false);
  }, [x, z, yaw, pitch, dist]);
  await page.waitForTimeout(1400);
};

const hitTable = () => page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const rc = new T.Raycaster(); const ndc = new T.Vector2();
  const tally = {};
  const COLS = 12, ROWS = 8;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const sx = (c + 0.5) / COLS, sy = (r + 0.5) / ROWS;
    ndc.set(sx * 2 - 1, -(sy * 2 - 1));
    rc.setFromCamera(ndc, g.camera); rc.near = 0.1; rc.far = 5000;
    const all = rc.intersectObjects(g.scene.children, true)
      .filter((h) => h.object.visible && h.object.type !== 'Points');
    let key = '(天空)';
    if (all.length) {
      const o = all[0].object;
      if (o.material === g.world.terrainMaterial) key = '地形';
      else if (o.isInstancedMesh) key = '植被:' + (g.__geoName.get(o.geometry) || '?');
      else key = o.name || o.type;
    }
    tally[key] = (tally[key] || 0) + 1;
  }
  return tally;
});

const spots = [
  ['scene-1-summit', 715, 288, Math.PI * 0.5, -0.15, 6],
  ['scene-2-summit-wide', 715, 288, 0.6, -0.55, 14],
  ['scene-3-forest', -60, 520, 1.2, -0.25, 8],
  ['scene-4-desert', 260, -700, 2.4, -0.3, 8],
];

for (const [name, x, z, yaw, pitch, dist] of spots) {
  await goto(x, z, yaw, pitch, dist);
  const biome = await page.evaluate(([x, z]) => window.__game.terrain.biome(x, z).name, [x, z]);
  const t = await hitTable();
  console.log('\n---', name, `(${x},${z})  [${biome}]`);
  Object.entries(t).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log('   ', String(v).padStart(3), '/ 96  ', k));
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
