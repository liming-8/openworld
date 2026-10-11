/** 对屏幕某点做详尽射线检测（含 Points threshold），打印所有命中物。 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const SX = Number(process.argv[2] || 639);
const SY = Number(process.argv[3] || 360);

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

const r = await page.evaluate(async ([x, z, sx, sy]) => {
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

  const c = g.camera;
  // ⚠️ 暂停后渲染循环不再跑，camera.matrixWorld 是**上一次渲染时**的旧值。
  //    射线检测用的是 matrixWorld，不手动更新就会打到完全错误的方向上。
  c.updateMatrixWorld(true);
  const ndc = new T.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  const rc = new T.Raycaster();
  rc.params.Points.threshold = 8;          // 远处 Points 默认打不中
  rc.setFromCamera(ndc, c);
  const hits = rc.intersectObjects(g.scene.children, true);
  const out = hits.slice(0, 8).map((h) => {
    const chain = []; let o = h.object;
    while (o && chain.length < 6) { chain.push(o.type + (o.name ? '#' + o.name : '')); o = o.parent; }
    const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
    return {
      d: +h.distance.toFixed(1), geo: h.object.geometry?.type || '-',
      mat: m ? m.type : '-', vis: h.object.visible,
      chain: chain.join(' < '),
      pt: [+h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)],
    };
  });
  // 相机与朝向
  const fwd = new T.Vector3(); c.getWorldDirection(fwd);
  return {
    hits: out,
    cam: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
    fwd: [+fwd.x.toFixed(3), +fwd.y.toFixed(3), +fwd.z.toFixed(3)],
    terrainMatIs: !!g.world.terrainMaterial,
    nTerrain: (() => { let n = 0; g.scene.traverse((o) => { if (o.isMesh && o.material === g.world.terrainMaterial) n++; }); return n; })(),
  };
}, [1261, -136, SX, SY]);

console.log('相机', JSON.stringify(r.cam), ' 前方', JSON.stringify(r.fwd), ' 地形块', r.nTerrain);
console.log('=== 屏幕 (' + SX + ',' + SY + ') 命中 ===');
r.hits.forEach((h) => console.log(' ', String(h.d).padStart(8) + 'm |', h.geo.padEnd(18), '|', h.mat.padEnd(16), '| vis', h.vis, '|', h.chain, '| 点', JSON.stringify(h.pt)));
if (!r.hits.length) console.log('  （无命中）');
await browser.close();
