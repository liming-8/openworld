/**
 * 二分定位"天空里那个小白方块"是哪个对象画的。
 *
 * 之前的做法都不够硬：
 *   - 射线检测：画面上的点必须能被几何体命中才能定位，
 *     但拿不到"这个像素是被谁画上去的"（尤其 Points / 低透明度 / depthTest=false 的东西）。
 *   - drawImage 读 canvas：preserveDrawingBuffer=false，读出来全是 0。
 *
 * 正确做法：自己开一个 WebGLRenderTarget，用同一个相机渲染一次，
 * 再用 readRenderTargetPixels 精确读像素。这样就能稳定地二分。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const SX = Number(process.argv[2] || 639);
const SY = Number(process.argv[3] || 359);

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

const setup = await page.evaluate(async ([x, z, sx, sy]) => {
  const T = await import('/libs/three.module.js');
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

  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const rt = new T.WebGLRenderTarget(w, h);
  window.__rt = rt;
  window.__T = T;
  // readRenderTargetPixels 原点在左下角
  const px = Math.round(sx * (w / window.innerWidth));
  const py = h - 1 - Math.round(sy * (h / window.innerHeight));
  window.__px = [px, py];
  window.__buf = new Uint8Array(4);

  window.__read = () => {
    const g2 = window.__game;
    const old = g2.renderer.getRenderTarget();
    g2.renderer.setRenderTarget(rt);
    g2.renderer.clear();
    g2.renderer.render(g2.scene, g2.camera);
    const b = window.__buf;
    g2.renderer.readRenderTargetPixels(rt, px, py, 1, 1, b);
    g2.renderer.setRenderTarget(old);
    return [b[0], b[1], b[2]];
  };
  window.__kids = g.scene.children.slice();
  window.__vis = window.__kids.map((o) => o.visible);
  return { w, h, px, py, n: window.__kids.length };
}, [1261, -136, SX, SY]);

console.log('画布', setup.w + 'x' + setup.h, ' 取样点(左下原点)', setup.px + ',' + setup.py, ' 顶层对象', setup.n);

const read = () => page.evaluate(() => window.__read());
const setVisible = (idxs, v) => page.evaluate(([idxs, v]) => {
  idxs.forEach((i) => { window.__kids[i].visible = v; });
}, [idxs, v]);
const restore = () => page.evaluate(() => {
  window.__kids.forEach((o, i) => { o.visible = window.__vis[i]; });
});

const base = await read();
console.log('基准像素 rgb', JSON.stringify(base), ' 亮度', base[0] + base[1] + base[2]);
if (base[0] + base[1] + base[2] < 540) {
  console.log('⚠ 该点本来就不亮，取样位置可能不对');
}

// ── 二分 ──
let pool = setup.n_ ? [] : [];
let candidates = Array.from({ length: setup.n }, (_, i) => i);
let step = 0;
while (candidates.length > 1 && step < 12) {
  step++;
  const half = candidates.slice(0, Math.ceil(candidates.length / 2));
  const rest = candidates.slice(Math.ceil(candidates.length / 2));
  // 先隐藏前一半
  await restore();
  await setVisible(half, false);
  const a = await read();
  const lumA = a[0] + a[1] + a[2];
  await restore();
  await setVisible(rest, false);
  const b = await read();
  const lumB = b[0] + b[1] + b[2];
  await restore();
  const gone = Math.min(lumA, lumB) < 540;
  console.log(`第${step}轮：候选 ${candidates.length} →  hidesetA 亮度 ${lumA} / hidesetB 亮度 ${lumB}`,
    gone ? '→ 白点被消掉了' : '→ 两边都没消掉（说明不是单个顶层对象，或需要组合）');
  if (!gone) break;
  candidates = lumA < lumB ? half : rest;
}

if (candidates.length <= 3) {
  await restore();
  for (const i of candidates) {
    await restore();
    await setVisible([i], false);
    const v = await read();
    const o = await page.evaluate((i) => {
      const o = window.__kids[i];
      let n = 0; o.traverse(() => n++);
      return { type: o.type, name: o.name, children: o.children.length, sub: n };
    }, i);
    console.log('  单独隐藏 #' + i, JSON.stringify(o), '→ 亮度', v[0] + v[1] + v[2],
      v[0] + v[1] + v[2] < 540 ? '✅ 就是它' : '— 不是它');
  }
}
await restore();
await browser.close();
