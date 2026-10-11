/** 点名：屏幕坐标 (sx, sy) 处到底是什么物体（父链 / 几何体 / 材质 / 距离）。 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const SX = Number(process.argv[2] || 549);
const SY = Number(process.argv[3] || 306);

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

await page.evaluate(async ([x, z, sx, sy]) => {
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
  g.player.position.y = g.terrain.meshHeight(x, z);

  // 屏幕坐标 → NDC → 射线
  const c = g.camera;
  const ndc = new T.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  const rc = new T.Raycaster();
  rc.setFromCamera(ndc, c);
  const hits = rc.intersectObjects(g.scene.children, true);
  window.__probe = hits.slice(0, 6).map((h) => {
    const chain = [];
    let o = h.object;
    while (o && chain.length < 6) { chain.push(o.type + (o.name ? '#' + o.name : '')); o = o.parent; }
    const m = h.object.material;
    const mp = Array.isArray(m) ? m[0] : m;
    return {
      dist: +h.distance.toFixed(2),
      chain: chain.join(' < '),
      geo: h.object.geometry?.type || '-',
      mat: mp ? (mp.type + (mp.color ? ' #' + mp.color.getHexString() : '') + (mp.visible === false ? ' [invisible]' : '')) : '-',
      inst: h.object.isInstancedMesh ? h.object.count : 0,
      pos: [+h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)],
    };
  });
  // 顺便列一下所有 Points / Sprite 对象
  window.__pts = [];
  g.scene.traverse((o) => {
    if (o.isPoints || o.isSprite) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      window.__pts.push({
        t: o.type, n: o.name || '-', ct: o.count || 0,
        size: m?.size ?? '-', mt: m?.type ?? '-',
        vis: o.visible, matVis: m?.visible,
        world: [+o.matrixWorld.elements[12].toFixed(1), +o.matrixWorld.elements[13].toFixed(1), +o.matrixWorld.elements[14].toFixed(1)],
      });
    }
  });
}, [1261, -136, SX, SY]);

const r = await page.evaluate(() => ({ probe: window.__probe, pts: window.__pts }));
console.log('=== 屏幕 (' + SX + ',' + SY + ') 射线命中 ===');
r.probe.forEach((h) => console.log(' ', h.dist + 'm', '|', h.geo, '|', h.mat, '| 实例', h.inst, '|', h.chain, '| 世界点', JSON.stringify(h.pos)));
if (!r.probe.length) console.log('  （无命中 —— 说明是天空盒/背景着色器画的）');
console.log('\n=== 场景里的 Points / Sprite ===');
r.pts.forEach((p) => console.log(' ', JSON.stringify(p)));
await browser.close();
