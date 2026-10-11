/* 点名：画面里那些"无名 Mesh"到底是谁 —— 打印父链 / 几何体 / 材质 / 距离 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
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

await page.evaluate(() => {
  const g = window.__game;
  g.player.position.set(715, g.terrain.height(715, 288) + 1.0, 288);
  g.player.velocity.set(0, 0, 0);
  for (let i = 0; i < 30; i++) g.world.update(g.player.position, 800);
  g.cameraRig.yaw = Math.PI * 0.5; g.cameraRig.pitch = -0.15;
  g.cameraRig.distance = 6; g.cameraRig.targetDistance = 6;
  for (let i = 0; i < 40; i++) g.cameraRig.update(g.player, 0.05, false);
});
await page.waitForTimeout(1400);

const info = await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const rc = new T.Raycaster(); const ndc = new T.Vector2();
  const seen = new Map();
  const COLS = 12, ROWS = 8;
  const samples = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const sx = (c + 0.5) / COLS, sy = (r + 0.5) / ROWS;
    ndc.set(sx * 2 - 1, -(sy * 2 - 1));
    rc.setFromCamera(ndc, g.camera); rc.near = 0.1; rc.far = 5000;
    const all = rc.intersectObjects(g.scene.children, true)
      .filter((h) => h.object.visible && h.object.type !== 'Points');
    if (!all.length) continue;
    const o = all[0].object;
    if (o.material === g.world.terrainMaterial || o.isInstancedMesh) continue;
    // 父链
    const chain = [];
    let p = o;
    while (p) { chain.push(p.name || p.type); p = p.parent; }
    const key = chain.join(' < ');
    const rec = seen.get(key) || (seen.set(key, {
      n: 0, chain, type: o.type, geo: o.geometry.type,
      verts: o.geometry.attributes.position ? o.geometry.attributes.position.count : 0,
      tris: o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0),
      matColor: o.material.color ? '#' + o.material.color.getHexString() : '-',
      matType: o.material.type, vertexColors: !!o.material.vertexColors,
      dists: [], worldPos: o.getWorldPosition(new T.Vector3()).toArray().map((v) => +v.toFixed(1)),
    }), seen.get(key));
    rec.n++;
    rec.dists.push(+all[0].distance.toFixed(1));
  }
  return [...seen.values()].map((v) => ({ ...v, distMin: Math.min(...v.dists), distMax: Math.max(...v.dists) }));
});

console.log('=== 非地形 / 非实例化的"无名 Mesh"分类（屏幕 12×8 采样）===\n');
for (const i of info.sort((a, b) => b.n - a.n)) {
  console.log('命中', String(i.n).padStart(3), '格  距离', i.distMin + '~' + i.distMax, 'm');
  console.log('   父链 :', i.chain);
  console.log('   类型 :', i.type, '| 几何', i.geo, i.tris, '三角', '| 材质', i.matType,
    'color=' + i.matColor, i.vertexColors ? 'vertexColors' : '');
  console.log('   世界坐标:', JSON.stringify(i.worldPos));
  console.log('');
}
console.log('玩家位置:', await page.evaluate(() => {
  const p = window.__game.player.position;
  return [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)];
}));
console.log('相机位置:', await page.evaluate(() => {
  const p = window.__game.camera.position;
  return [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)];
}));

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 6).forEach((e) => console.log(' ', e));
await browser.close();
