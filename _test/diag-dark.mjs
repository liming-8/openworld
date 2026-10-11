/* 诊断：回读帧缓冲找出"真正画成深色"的像素，再用射线检测查明它属于哪个物体 */
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

await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const rc = new T.Raycaster();
  const ndc = new T.Vector2();
  window.__px = { probe: false, result: null, frame: 0 };
  const oRender = g.renderer.render.bind(g.renderer);

  g.renderer.render = (s, c) => {
    oRender(s, c);
    const P = window.__px;
    P.frame++;
    if (!P.probe) return;
    P.probe = false;
    const gl = g.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);

    const tally = {};
    const darkSamples = [];
    let darkCount = 0, total = 0;
    const COLS = 36, ROWS = 20;
    for (let r = 0; r < ROWS; r++) {
      for (let cc = 0; cc < COLS; cc++) {
        const sx = (cc + 0.5) / COLS, sy = (r + 0.5) / ROWS;
        const px = Math.min(W - 1, Math.round(sx * W));
        const rowTop = Math.min(H - 1, Math.round(sy * H));
        const i = ((H - 1 - rowTop) * W + px) * 4;
        const lum = (buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114) / 255;
        total++;
        if (lum >= 0.20) continue;
        darkCount++;
        ndc.set(sx * 2 - 1, -(sy * 2 - 1));
        rc.setFromCamera(ndc, c);
        rc.near = 0.1; rc.far = 6000;
        const all = rc.intersectObjects(g.scene.children, true)
          .filter((h) => h.object.visible && h.object.type !== 'Points');
        let key = '(无命中=天空)';
        if (all.length) {
          const o = all[0].object;
          const m = o.material;
          const matKey = !m ? '无材质'
            : (m === g.world.terrainMaterial) ? '地形材质'
            : m.color ? '#' + m.color.getHexString()
            : m.vertexColors ? 'vertexColors' : (m.type || '未知');
          key = o.type + (o.isInstancedMesh ? '(' + o.count + ')' : '') +
            ' name=' + (o.name || '-') + ' mat=' + matKey + ' type=' + (m ? m.type : '-');
        }
        tally[key] = (tally[key] || 0) + 1;
        if (darkSamples.length < 6) {
          darkSamples.push({ px, py: rowTop, lum: +lum.toFixed(2),
            rgb: [buf[i], buf[i + 1], buf[i + 2]], hit: key,
            dist: all.length ? +all[0].distance.toFixed(1) : null });
        }
      }
    }
    P.result = { darkCount, total, tally, darkSamples, cam: [+c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1)] };
  };
});

// 传送到复现点，然后在多个机位下探测
await page.evaluate(() => {
  const g = window.__game;
  g.player.position.set(715, g.terrain.height(715, 288) + 1.0, 288);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
});
await page.waitForTimeout(1500);

const all = {};
for (let i = 0; i < 10; i++) {
  await page.evaluate((i) => {
    const g = window.__game;
    g.cameraRig.yaw = (i / 10) * Math.PI * 2;
    g.cameraRig.pitch = i % 2 ? 0.25 : -0.35;   // 一半抬头看天
    g.cameraRig.distance = 6; g.cameraRig.targetDistance = 6;
    window.__px.result = null;
    window.__px.probe = true;
  }, i);
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => window.__px.result);
  if (!r) { console.log('  机位', i, ': 未取到数据'); continue; }
  console.log('机位', i, ' 暗块像素', r.darkCount + '/' + r.total, ' 相机', JSON.stringify(r.cam));
  Object.entries(r.tally).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .forEach(([k, v]) => console.log('     ' + v + ' × ' + k));
  Object.entries(r.tally).forEach(([k, v]) => { all[k] = (all[k] || 0) + v; });
  if (i === 1) await page.screenshot({ path: `${OUT}/probe.png` });
}

console.log('\n=== 10 个机位合计：暗块归谁所有 ===');
Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([k, v]) => console.log('  ' + v + ' × ' + k));

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
