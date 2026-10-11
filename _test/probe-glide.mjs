/**
 * 定位"滑翔截图里看不到角色"。
 * 复现滑翔状态后，逐项检查：
 *   1. player.group.visible / 是否在场景里 / 世界坐标
 *   2. 从镜头中心打一条射线，看命中清单里有没有角色
 *   3. 把角色包围盒的 8 个角投影到屏幕，量出它占多少像素
 *
 * 用法：ONLY 无关，直接 node _test/probe-glide.mjs
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(3000);

/* 先拍一张"正常站在地面"的对照，确认地面站立时角色是画出来的 */
const probe = async (label) => {
  const r = await page.evaluate(async () => {
    const T = await import('/libs/three.module.js');
    const g = window.__game;
    const p = g.player;
    const grp = p.group;

    grp.updateMatrixWorld(true);
    g.camera.updateMatrixWorld(true);

    const wp = new T.Vector3();
    grp.getWorldPosition(wp);

    // 包围盒
    const box = new T.Box3().setFromObject(grp);
    const size = box.getSize(new T.Vector3());
    // 8 个角投到屏幕
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const v = new T.Vector3(x, y, z).project(g.camera);
          corners.push([v.x, v.y, v.z]);
        }
      }
    }
    const sxs = corners.map((c) => (c[0] + 1) / 2);
    const sys = corners.map((c) => (1 - c[1]) / 2);
    const pxW = (Math.max(...sxs) - Math.min(...sxs));
    const pxH = (Math.max(...sys) - Math.min(...sys));

    // 从镜头中心打射线
    const rc = new T.Raycaster();
    rc.setFromCamera(new T.Vector2(0, 0), g.camera);
    rc.near = 0.05; rc.far = 6000;
    const hits = rc.intersectObjects(g.scene.children, true)
      .filter((h) => h.object.visible)
      .slice(0, 5)
      .map((h) => {
        // 往上找，看这一支是否属于角色
        let o = h.object, inPlayer = false;
        while (o) { if (o === grp) { inPlayer = true; break; } o = o.parent; }
        return { name: h.object.name || h.object.type, d: +h.distance.toFixed(2), inPlayer };
      });

    // 逐个子网格看：角色本体的零件在屏幕上的哪里、可不可见
    // （不能只看 group 的包围盒 —— 阴影贴片按设计留在地面上，
    //   离地 60 m 时会把包围盒撑到 60 m 高，屏幕指标全是垃圾值）
    const kids = [];
    grp.traverse((o) => {
      if (!o.isMesh) return;
      const wp2 = new T.Vector3();
      o.getWorldPosition(wp2);
      const off = wp2.distanceTo(p.position);
      const v = wp2.clone().project(g.camera);
      kids.push({
        name: o.name || (o.geometry && o.geometry.type) || 'Mesh',
        vis: o.visible,
        off: +off.toFixed(2),
        vy: +wp2.y.toFixed(2),
        sx: +((v.x + 1) / 2).toFixed(3),
        sy: +((1 - v.y) / 2).toFixed(3),
      });
    });
    const body = kids.filter((k) => k.off < 4);          // 角色本体
    const far = kids.filter((k) => k.off >= 4);          // 阴影贴片之类

    return {
      groupVisible: grp.visible,
      inScene: !!grp.parent,
      parentName: grp.parent ? (grp.parent.name || grp.parent.type) : null,
      worldPos: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
      playerPos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)],
      gap: +(p.position.y - g.terrain.meshHeight(p.position.x, p.position.z)).toFixed(2),
      state: p.state, gliding: p.gliding, grounded: p.grounded,
      nBody: body.length, nFar: far.length,
      bodyOnScreen: body.filter((k) => k.vis && k.sx > 0 && k.sx < 1 && k.sy > 0 && k.sy < 1).length,
      bodyHidden: body.filter((k) => !k.vis).length,
      bodyOffScreen: body.filter((k) => k.vis && (k.sx < 0 || k.sx > 1 || k.sy < 0 || k.sy > 1)).length,
      sampleBody: body.slice(0, 6),
      sampleFar: far.slice(0, 4),
      camPos: [+g.camera.position.x.toFixed(2), +g.camera.position.y.toFixed(2), +g.camera.position.z.toFixed(2)],
      camDist: +g.camera.position.distanceTo(p.position).toFixed(2),
      camTarget: g.cameraRig && g.cameraRig.target
        ? [+g.cameraRig.target.x.toFixed(2), +g.cameraRig.target.y.toFixed(2), +g.cameraRig.target.z.toFixed(2)]
        : null,
      hits,
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log('  group.visible   ', r.groupVisible, ' 在场景中:', r.inScene, '父级:', r.parentName);
  console.log('  group 世界坐标  ', JSON.stringify(r.worldPos));
  console.log('  player.position ', JSON.stringify(r.playerPos), ' 离地', r.gap, 'm');
  console.log('  状态            ', r.state, 'gliding=', r.gliding, 'grounded=', r.grounded);
  console.log('  角色本体网格    ', r.nBody, '个：在屏幕内', r.bodyOnScreen,
    ' 隐藏', r.bodyHidden, ' 出界', r.bodyOffScreen, ' 其它零件', r.nFar);
  console.log('  本体零件采样:');
  r.sampleBody.forEach((k) => console.log(
    `     ${k.vis ? '可见' : '隐藏'} ${String(k.name).padEnd(14)} 离角色 ${String(k.off).padStart(5)}m  屏幕(${(k.sx * 100).toFixed(0)}%,${(k.sy * 100).toFixed(0)}%)`));
  if (r.sampleFar.length) {
    console.log('  远处的零件（阴影贴片）:');
    r.sampleFar.forEach((k) => console.log(
      `     ${k.vis ? '可见' : '隐藏'} ${String(k.name).padEnd(14)} 离角色 ${String(k.off).padStart(5)}m  y=${k.vy}`));
  }
  console.log('  相机位置        ', JSON.stringify(r.camPos), ' 到角色距离', r.camDist);
  console.log('  相机注视点      ', JSON.stringify(r.camTarget));
  console.log('  镜头中心射线命中:');
  r.hits.forEach((h) => console.log(`     ${h.inPlayer ? '[角色]' : '      '} ${String(h.name).padEnd(22)} ${h.d}m`));
  if (!r.hits.length) console.log('     （什么都没命中）');
  return r;
};

await probe('A. 站在地面（对照）');

// 复现滑翔
await page.evaluate(() => {
  const g = window.__game;
  g.player.position.y += 62;
  g.player.velocity.set(0, -4, 0);
  g.player.airTime = 1.2;
  g.player.grounded = false;
  g.player.stamina = 100;
  g.player.coyote = 0;
  g.player.jumpBuffer = 0;
});
await page.keyboard.down('Space');
await page.waitForTimeout(1200);
await probe('B. 滑翔中（复现问题）');
await page.screenshot({ path: 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact/glide-probe.png' });
await page.keyboard.up('Space');

/* ------------------------------------------------------------------
   C. 真实滑翔：不碰 cameraRig，从山顶自然跳下并按住空格，
      看默认的滑翔机位会不会把角色顶出画面。
   ------------------------------------------------------------------ */
console.log('\n\n########## C. 自然滑翔（默认机位，不手工设 pitch）##########');
await page.evaluate(() => {
  const g = window.__game, t = g.terrain;
  // 找一个相对高、周围落差大的着陆点
  let best = null, bs = -1;
  for (let x = -800; x <= 800; x += 40) {
    for (let z = -800; z <= 800; z += 40) {
      const h = t.height(x, z);
      if (h < 30) continue;
      let lo = h;
      for (const [dx, dz] of [[-260, 0], [260, 0], [0, -260], [0, 260]]) lo = Math.min(lo, t.height(x + dx, z + dz));
      if (h - lo > bs) { bs = h - lo; best = { x, z }; }
    }
  }
  const y = t.meshHeight(best.x, best.z);
  g.player.position.set(best.x, y, best.z);
  g.player.velocity.set(0, 0, 0);
  g.player.grounded = true;
  g.player.facing = Math.PI * 0.3;
  for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
});

// 站到山顶，然后抬升 25 m —— 全程**不碰 cameraRig**，看默认滑翔机位怎么表现
await page.keyboard.down('KeyW');
await page.waitForTimeout(600);
await page.evaluate(() => {
  const g = window.__game;
  g.player.position.y += 25;
  g.player.velocity.set(0, -3, 0);
  g.player.airTime = 1.2;
  g.player.grounded = false;
  g.player.coyote = 0;
  g.player.jumpBuffer = 0;
  g.player.stamina = 100;
});
await page.keyboard.down('Space');

const bodyScreenY = async () => page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  g.camera.updateMatrixWorld(true);
  const pts = [];
  g.player.group.traverse((o) => {
    if (!o.isMesh) return;
    const wp = new T.Vector3();
    o.getWorldPosition(wp);
    if (wp.distanceTo(g.player.position) >= 4) return;
    const v = wp.clone().project(g.camera);
    pts.push([(v.x + 1) / 2, (1 - v.y) / 2]);
  });
  if (!pts.length) return null;
  const sy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return {
    sy: +sy.toFixed(3),
    gliding: g.player.gliding,
    state: g.player.state,
    gap: +(g.player.position.y - g.terrain.meshHeight(g.player.position.x, g.player.position.z)).toFixed(1),
    camPitch: +g.cameraRig.pitch.toFixed(3),
    camDist: +g.cameraRig.distance.toFixed(2),
  };
});

console.log('  时间   状态     gliding  离地m  镜头pitch  镜头距离  角色屏幕 y');
let worstUp = 1, worstDown = 0, nSample = 0;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(250);
  const s = await bodyScreenY();
  if (!s) continue;
  nSample++;
  worstUp = Math.min(worstUp, s.sy);
  worstDown = Math.max(worstDown, s.sy);
  console.log(`  ${((i + 1) * 0.25).toFixed(2)}s  ${String(s.state).padEnd(7)} ${String(s.gliding).padEnd(8)} ${String(s.gap).padStart(6)}  ${String(s.camPitch).padStart(8)}  ${String(s.camDist).padStart(8)}  ${(s.sy * 100).toFixed(1)}%`);
}
await page.screenshot({ path: 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact/glide-natural.png' });
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
console.log(`\n  角色屏幕 y 范围：${(worstUp * 100).toFixed(1)}% ~ ${(worstDown * 100).toFixed(1)}%（${nSample} 次采样）`);
if (worstUp < 0.02 || worstDown > 0.98) {
  console.log('  ⚠ 有帧角色几乎/完全贴边 —— 默认滑翔机位可能把角色顶出画面');
} else {
  console.log('  ✅ 默认机位下角色始终在画面内');
}

console.log('\n运行时报错:', errors.length, errors.slice(0, 5).join(' | '));
await browser.close();
