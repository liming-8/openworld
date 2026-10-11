/* 诊断：复现 (715,288) 处的深色大平面，用射线检测查明它们属于哪个物体 */
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

// 1) 地形高度统计：该点附近有没有异常尖刺
const terrainStat = await page.evaluate(() => {
  const T = window.__game.terrain;
  let mn = 1e9, mx = -1e9, sum = 0, n = 0, worst = null;
  for (let dx = -120; dx <= 120; dx += 4) {
    for (let dz = -120; dz <= 120; dz += 4) {
      const h = T.height(715 + dx, 288 + dz);
      if (!isFinite(h)) return { nan: [715 + dx, 288 + dz] };
      if (h < mn) mn = h;
      if (h > mx) { mx = h; worst = [715 + dx, 288 + dz]; }
      sum += h; n++;
    }
  }
  return { min: +mn.toFixed(1), max: +mx.toFixed(1), avg: +(sum / n).toFixed(1), highestAt: worst,
    here: +T.height(715, 288).toFixed(1), biome: T.biome(715, 288).name };
});
console.log('=== 地形高度统计（±120m）===');
console.log(' ', JSON.stringify(terrainStat));

// 2) 传送到该点，强制加载区块，摆机位
await page.evaluate(() => {
  const g = window.__game;
  g.player.position.set(715, g.terrain.height(715, 288) + 1.0, 288);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
  g.cameraRig.yaw = Math.PI * 0.5;
  g.cameraRig.pitch = -0.15;
  g.cameraRig.distance = 6; g.cameraRig.targetDistance = 6;
  g.cameraRig.update(g.player, 0.016, false);
});
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/repro.png` });

// 3) 全屏网格射线检测：每个采样点打到的第一个物体是谁
const hits = await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const rc = new T.Raycaster();
  const ndc = new T.Vector2();
  const cam = g.camera;
  const camPos = cam.position.clone();
  const rows = [];
  const tally = {};
  const samples = [];
  for (let iy = 0; iy < 7; iy++) {
    for (let ix = 0; ix < 9; ix++) {
      const sx = (ix + 0.5) / 9, sy = (iy + 0.5) / 7;
      const px = Math.round(sx * 1080), py = Math.round(sy * 594);
      ndc.set(sx * 2 - 1, -(sy * 2 - 1));
      rc.setFromCamera(ndc, cam);
      rc.near = 0.1; rc.far = 4000;
      const all = rc.intersectObjects(g.scene.children, true)
        .filter((h) => h.object.visible && h.object.type !== 'Points');
      if (!all.length) { tally['(无)'] = (tally['(无)'] || 0) + 1; continue; }
      const o = all[0].object;
      let kind = o.isInstancedMesh ? 'InstancedMesh' : o.type;
      if (o.material === g.world.terrainMaterial) kind = '地形块';
      const key = kind + ' | ' + (o.name || '(无名)') + ' | 材质色=' +
        (o.material && o.material.color ? '#' + o.material.color.getHexString() : (o.material && o.material.vertexColors ? 'vertexColors' : '-'));
      tally[key] = (tally[key] || 0) + 1;
      samples.push({ px, py, dist: +all[0].distance.toFixed(1), kind: key,
        inst: all[0].instanceId !== undefined ? all[0].instanceId : null,
        verts: o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0 });
    }
  }
  return { tally, samples, camPos: [+camPos.x.toFixed(1), +camPos.y.toFixed(1), +camPos.z.toFixed(1)] };
});
console.log('\n=== 屏幕网格射线检测（63 个采样点）===');
console.log('相机位置:', JSON.stringify(hits.camPos));
console.log('物件统计:');
Object.entries(hits.tally).sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log('  ' + v + ' 次  ' + k));

// 4) 逐个"隐藏一类物体"再截图，做对照
const classes = await page.evaluate(() => {
  const g = window.__game;
  const list = [];
  g.scene.children.forEach((o, i) => {
    if (!o.visible) return;
    let kind = o.type;
    if (o.material === g.world.terrainMaterial) kind = '地形块';
    if (o.isInstancedMesh) kind = '植被实例';
    list.push({ i, kind, name: o.name || '', count: o.isInstancedMesh ? o.count : undefined,
      verts: o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0 });
  });
  return list;
});
const byKind = {};
classes.forEach((c) => { byKind[c.kind] = (byKind[c.kind] || 0) + 1; });
console.log('\n场景可见物体分类:', JSON.stringify(byKind));
console.log('（InstancedMesh 数量 / 顶点数）:',
  JSON.stringify(classes.filter((c) => c.kind === '植被实例').map((c) => c.count + '/' + c.verts).slice(0, 40)));

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
console.log('截图: _test/artifact/repro.png');
await browser.close();
