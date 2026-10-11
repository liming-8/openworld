/* 角色模型「摄影棚」渲染：隐藏场景里除角色外的一切，纯色背景，四标准视角 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/verify';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 760, height: 940 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const g = window.__game;
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  for (const id of ['toasts', 'hint-bar', 'interact']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }

  g.player.velocity.set(0, 0, 0);
  g.player.state = 'idle';
  g.player.facing = 0; g.player.targetFacing = 0;
  g.player.group.rotation.y = 0;
  g.sky.setTime(0.50);
  g.paused = true;

  // —— 摄影棚：只留角色 ——
  window.__hid = [];
  for (const o of g.scene.children) {
    if (o === g.player.group) continue;
    if (o.isLight || o.isCamera) continue;
    if (o.visible) { o.visible = false; window.__hid.push(o); }
  }
  g.scene.background = null;
  g.renderer.setClearColor(0x39414d, 1);
  if (g.scene.fog) { g.scene.fog.near = 6000; g.scene.fog.far = 7000; }
  if (g.player.blob) g.player.blob.visible = false;      // 去掉贴地阴影
  g.camera.fov = 30; g.camera.updateProjectionMatrix();

  let meshes = 0, tris = 0, verts = 0;
  g.player.group.traverse((o) => {
    if (o.isMesh && o.geometry) { meshes++; verts += o.geometry.attributes.position.count;
      tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; }
  });
  return { hidden: window.__hid.length, meshes, tris: Math.round(tris), verts };
});
console.log('隐藏场景物体', info.hidden, '个；角色模型：网格', info.meshes, '/ 三角面', info.tris, '/ 顶点', info.verts);

const shot = async (name, angDeg, dist = 2.9, height = 0.06, facingDeg = 0, extra = null) => {
  await page.evaluate(([a, d, hy, f, ex]) => {
    const g = window.__game;
    const V = g.camera.position.constructor;
    if (ex === 'run') { g.player.state = 'run'; g.player.speed = 7; g.player.animPhase = 1.55; g.player.velocity.set(0, 0, 0); }
    if (ex === 'glide') { g.player.state = 'glide'; g.player.gliding = true; g.player.velocity.set(6, -3, 0); }
    if (ex === 'sprint') { g.player.state = 'sprint'; g.player.speed = 10; g.player.animPhase = 1.2; }
    if (!ex || ex === 'idle') { g.player.state = 'idle'; g.player.speed = 0; }
    g.player.facing = f; g.player.targetFacing = f;
    g.player.group.rotation.y = f;
    const p = g.player.position;
    const a2 = a * Math.PI / 180;
    g.camera.position.set(p.x + Math.sin(a2) * d, p.y + 0.88 + hy * d, p.z + Math.cos(a2) * d);
    g.camera.lookAt(new V(p.x, p.y + 0.88, p.z));
  }, [angDeg, dist, height, facingDeg * Math.PI / 180, extra]);
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  →', name);
};

await shot('st-front', 0, 3.9, 0.03);
await shot('st-side', 90, 3.9, 0.03);
await shot('st-back', 180, 3.9, 0.03);
await shot('st-3q', 40, 3.9, 0.06);
await shot('st-run-side', 90, 4.1, 0.02, 0, 'run');
await shot('st-run-3q', 40, 4.1, 0.04, 0, 'run');
await shot('st-glide', 70, 4.6, 0.03, 0, 'glide');

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
