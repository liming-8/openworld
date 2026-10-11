/* 诊断：在出生点原样复现 run.mjs 的跑图动作，抓取遮挡瞬间的画面 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/occl';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const rc = new T.Raycaster();
  const org = new T.Vector3(), dir = new T.Vector3();
  window.__occ = { frames: 0, blocked: 0, kinds: {}, marks: [] };
  const oRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = (s, c) => {
    const o = window.__occ;
    o.frames++;
    if (!o.terr) {
      o.terr = g.scene.children.filter((x) => x.isMesh && x.material === g.world.terrainMaterial);
      o.veg = g.scene.children.filter((x) => x.isInstancedMesh);
    }
    org.set(c.position.x, c.position.y, c.position.z);
    const p = g.player.position;
    dir.set(p.x - org.x, (p.y + 1.0) - org.y, p.z - org.z);
    const L = dir.length(); dir.normalize();
    rc.set(org, dir); rc.near = 0.1; rc.far = Math.max(0.2, L - 0.3);
    const ht = rc.intersectObjects(o.terr, false);
    const hv = rc.intersectObjects(o.veg, false);
    if (ht.length || hv.length) {
      o.blocked++;
      const useT = ht.length && (!hv.length || ht[0].distance <= hv[0].distance);
      const kind = useT ? '地形' : '植被';
      const d = useT ? ht[0].distance : hv[0].distance;
      o.kinds[kind] = (o.kinds[kind] || 0) + 1;
      o.last = { kind, d: +d.toFixed(2), camDist: +g.cameraRig.distance.toFixed(2),
        cam: [+c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1)],
        ply: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
        camAboveGround: +(c.position.y - g.terrain.height(c.position.x, c.position.z)).toFixed(2) };
      if (!o.marked) { o.marked = true; o.firstMark = o.last; }
    }
    oRender(s, c);
  };
});

// 完全照搬 run.mjs 的跑图动作
await page.mouse.move(700, 400);
for (let i = 0; i < 3; i++) {
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(1200);
  await page.mouse.move(700 + (i % 2 ? 200 : -200), 400, { steps: 12 });
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.mouse.move(700, 400, { steps: 4 });
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}/repro-03-run.png` });

const o = await page.evaluate(() => window.__occ);
console.log('帧数:', o.frames, ' 被挡的帧:', o.blocked, '(' + (o.frames ? (o.blocked / o.frames * 100).toFixed(0) : 0) + '%)');
console.log('按遮挡物分类:', JSON.stringify(o.kinds));
console.log('首次遮挡:', JSON.stringify(o.firstMark));
console.log('最后一次遮挡:', JSON.stringify(o.last));

// 顺便输出当前相机到角色的距离与角色是否可见
const extra = await page.evaluate(() => {
  const g = window.__game;
  return {
    distance: +g.cameraRig.distance.toFixed(2),
    targetDistance: +g.cameraRig.targetDistance.toFixed(2),
    playerVisible: g.player.group.visible,
    camAboveGround: +(g.camera.position.y - g.terrain.height(g.camera.position.x, g.camera.position.z)).toFixed(2),
  };
});
console.log('当前状态:', JSON.stringify(extra));
console.log('截图: _test/occl/repro-03-run.png');

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
