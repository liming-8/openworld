import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/verify';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2500);

/* ---------- 装载监控 ---------- */
const THREE = await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  window.__T = T;
  window.__rc = new T.Raycaster();
  window.__org = new T.Vector3();
  window.__dir = new T.Vector3();
  return true;
});
void THREE;

await page.evaluate(() => {
  const g = window.__game;
  window.__m = { camViol: 0, camWorst: 99, playerUnder: 0, playerFloat: 0, groundedGap: -99, frames: 0, camMinDist: 99, terrainBetween: 0 };
  // 逐帧位移统计（软件渲染帧率极低，按墙钟采样会误判，必须按帧算）
  window.__run = { frames: 0, dist: 0, blocked: 0, longest: 0, cur: 0, hasLast: false, lx: 0, lz: 0 };
  const T = window.__T;
  const oRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = (s, c) => {
    const m = window.__m, r = window.__run;
    m.frames++;
    // (a) 相机是否低于地形
    //     基准同样必须是"画出来的网格"—— camera.js 的地面硬约束用的就是 meshHeight，
    //     拿解析 height() 当基准会在起伏处把合规的镜头误报成"钻进地里"。
    const hc = g.terrain.meshHeight(c.position.x, c.position.z);
    const dc = c.position.y - hc;
    if (dc < m.camWorst) m.camWorst = dc;
    if (dc < 0.35) m.camViol++;
    // (b) 真实网格：角色头顶 → 相机 的连线上是否被地形挡住（穿模的真凭实据）
    if (T) {
      window.__org.set(g.player.position.x, g.player.position.y + 1.25, g.player.position.z);
      const dx = c.position.x - window.__org.x, dy = c.position.y - window.__org.y, dz = c.position.z - window.__org.z;
      const L = Math.hypot(dx, dy, dz);
      if (L > 0.8) {
        window.__dir.set(dx / L, dy / L, dz / L);
        window.__rc.set(window.__org, window.__dir);
        window.__rc.near = 0; window.__rc.far = L - 0.25;
        if (!window.__tmesh) {
          window.__tmesh = g.scene.children.filter((o) => o.isMesh && o.material === g.world.terrainMaterial);
        }
        if (window.__rc.intersectObjects(window.__tmesh, false).length) m.terrainBetween++;
      }
    }
    // (c) 角色是否陷进地面
    //     基准必须是"实际画出来的地形网格"——
    //     角色现在贴的就是 meshHeight，拿解析 height() 当基准会误报。
    const px0 = g.player.position.x, pz0 = g.player.position.z;
    const hp = g.terrain.meshHeight(px0, pz0);
    if (g.player.position.y - hp < -0.05) m.playerUnder++;
    // 交叉验证：直接从角色上方往下打射线，打到真实地形网格上
    if (T) {
      if (!window.__tmesh) {
        window.__tmesh = [];
        g.scene.traverse((o) => { if (o.isMesh && o.material === g.world.terrainMaterial) window.__tmesh.push(o); });
      }
      window.__rc.set(window.__org.set(px0, g.player.position.y + 60, pz0), window.__dir.set(0, -1, 0));
      window.__rc.near = 0; window.__rc.far = 120;
      const dh = window.__rc.intersectObjects(window.__tmesh, false)[0];
      if (dh) {
        const gap = g.player.position.y - dh.point.y;      // 负 = 陷进网格，正 = 浮在网格上方
        if (gap < -0.06) m.playerUnder++;
        // 只有"游戏自己认为已经踩在地上"时还浮着，才算真的悬空。
        // 下坡时会短暂腾空（和所有平台跳跃游戏一样），那不是 bug。
        else if (gap > 0.06 && g.player.grounded) m.playerFloat++;
        if (g.player.grounded && gap > m.groundedGap) m.groundedGap = gap;
      }
    }
    if (g.cameraRig.distance < m.camMinDist) m.camMinDist = g.cameraRig.distance;
    // 帧间水平位移
    const px = g.player.position.x, pz = g.player.position.z;
    if (r.hasLast) {
      const d = Math.hypot(px - r.lx, pz - r.lz);
      r.frames++; r.dist += d;
      if (d < 0.02) { r.blocked++; r.cur++; if (r.cur > r.longest) r.longest = r.cur; }
      else r.cur = 0;
    }
    r.hasLast = true; r.lx = px; r.lz = pz;
    oRender(s, c);
  };
});

console.log('=== 测试 1：W/S 方向 ===');
await page.evaluate(() => { window.__game.cameraRig.yaw = Math.PI; window.__game.cameraRig.pitch = -0.2; });
await page.waitForTimeout(300);

// 用 Playwright 真实按键
const measure = async (key, ms = 1800) => {
  const p0 = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.evaluate(() => { window.__game.player.velocity.set(0, 0, 0); window.__game.player.position.set(window.__game.player.position.x, window.__game.player.position.y, window.__game.player.position.z); });
  await page.waitForTimeout(500);
  const p1 = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z, yaw: window.__game.cameraRig.yaw }));
  const fx = -Math.sin(p1.yaw), fz = -Math.cos(p1.yaw);
  const rx = Math.cos(p1.yaw), rz = -Math.sin(p1.yaw);
  const dx = p1.x - p0.x, dz = p1.z - p0.z;
  const dist = Math.hypot(dx, dz);
  // 用“单位方向余弦”判定朝向：不受帧率 / 加速距离影响
  return {
    dx: +dx.toFixed(2), dz: +dz.toFixed(2),
    dist: +dist.toFixed(2),
    fcos: dist > 0.02 ? +((dx * fx + dz * fz) / dist).toFixed(2) : 0,
    rcos: dist > 0.02 ? +((dx * rx + dz * rz) / dist).toFixed(2) : 0,
  };
};
const dirOK = (r, axis) => r.dist > 0.05 && Math.abs(r[axis]) > 0.9;

const w = await measure('KeyW');
console.log('  按 W →', JSON.stringify(w), dirOK(w, 'fcos') && w.fcos > 0 ? '✅ 朝镜头前方' : '❌ 方向错误');
const s = await measure('KeyS');
console.log('  按 S →', JSON.stringify(s), dirOK(s, 'fcos') && s.fcos < 0 ? '✅ 朝镜头后方' : '❌ 方向错误');
const d = await measure('KeyD');
console.log('  按 D →', JSON.stringify(d), dirOK(d, 'rcos') && d.rcos > 0 ? '✅ 朝镜头右侧' : '❌ 方向错误');
const a = await measure('KeyA');
console.log('  按 A →', JSON.stringify(a), dirOK(a, 'rcos') && a.rcos < 0 ? '✅ 朝镜头左侧' : '❌ 方向错误');

console.log('\n=== 测试 2：把玩家丢到陡坡密集区，长距离跑图 ===');
await page.evaluate(() => {
  const g = window.__game;
  const T = g.terrain;
  // 找一块陡坡多的山地区域
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 400; i++) {
    const x = (Math.random() - 0.5) * 6000, z = (Math.random() - 0.5) * 6000;
    const h = T.height(x, z);
    if (h < 8 || h > 60) continue;
    let steep = 0;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 50;
      const s = T.slope(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (s > 0.55) steep++;
    }
    if (steep > bestScore) { bestScore = steep; best = { x, z }; }
  }
  g.player.position.set(best.x, T.height(best.x, best.z) + 1.5, best.z);
  g.player.velocity.set(0, 0, 0);
  g.cameraRig.update(g.player, 0.016, false);
  window.__m.camViol = 0; window.__m.camWorst = 99; window.__m.frames = 0; window.__m.playerUnder = 0; window.__m.camMinDist = 99;
  return best;
});
await page.waitForTimeout(1200);

const spot = await page.evaluate(() => {
  const g = window.__game;
  window.__run = { frames: 0, dist: 0, blocked: 0, longest: 0, cur: 0, hasLast: false, lx: 0, lz: 0 };
  const p = g.player.position;
  return {
    biome: g.terrain.biome(p.x, p.z).name,
    slope: +g.terrain.slope(p.x, p.z).toFixed(2),
    y: +p.y.toFixed(1),
  };
});
console.log('  落点:', JSON.stringify(spot), '（坡度 0~1，越大越陡）');

await page.keyboard.down('KeyW');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  // 每秒把镜头对准“上坡方向”，持续朝陡坡推进 —— 这正是当初会把人卡死的场景
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player.position;
    const n = g.terrain.normal(p.x, p.z, 1.5);
    const ux = -n[0], uz = -n[2];
    const L = Math.hypot(ux, uz);
    if (L > 1e-4) g.cameraRig.yaw = Math.atan2(-ux / L, -uz / L);
  });
}
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);

const run = await page.evaluate(() => {
  const g = window.__game;
  const r = window.__run;
  const p = g.player.position;
  return {
    ...r,
    endBiome: g.terrain.biome(p.x, p.z).name,
    endSlope: +g.terrain.slope(p.x, p.z).toFixed(2),
    endY: +p.y.toFixed(1),
    sliding: !!g.player.sliding,
  };
});
const blockPct = run.frames ? (run.blocked / run.frames * 100) : 0;
console.log('  渲染帧数:', run.frames, ' 累计位移:', run.dist.toFixed(1), 'm');
console.log('  位移停滞帧:', run.blocked, '(' + blockPct.toFixed(1) + '%)',
  run.blocked === 0 ? '✅ 每一帧都在移动' : '');
console.log('  最长连续停滞:', run.longest, '帧',
  run.longest <= 2 ? '✅ 不存在“陷进山里动不了”' : '⚠ 存在连续卡死');
console.log('  终点:', run.endBiome, '坡度', run.endSlope, '海拔', run.endY);

console.log('\n=== 测试 3：相机穿模 / 角色陷入地形 ===');
const mon = await page.evaluate(() => {
  const m = window.__m;
  m.frames = 0; m.camViol = 0; m.camWorst = 99; m.playerUnder = 0; m.playerFloat = 0; m.groundedGap = -99; m.camMinDist = 99; m.terrainBetween = 0;
  window.__tmesh = null;
  window.__tmesh = null;
  return m;
});
// 先把角色放到山地，再绕圈变换视角，尽可能覆盖极端镜头
await page.evaluate(() => {
  const g = window.__game, T = g.terrain;
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 1200; i++) {
    const x = (Math.random() - 0.5) * 5000, z = (Math.random() - 0.5) * 5000;
    const h = T.height(x, z);
    if (h < 12 || h > 75) continue;
    let steep = 0;
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2, r2 = 6 + Math.random() * 40;
      if (T.slope(x + Math.cos(a) * r2, z + Math.sin(a) * r2) > 0.5) steep++;
    }
    if (steep > bestScore) { bestScore = steep; best = { x, z }; }
  }
  g.player.position.set(best.x, T.height(best.x, best.z) + 1.2, best.z);
  g.player.velocity.set(0, 0, 0);
});
await page.waitForTimeout(1500);
for (let r = 0; r < 6; r++) {
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = Math.random() * Math.PI * 2; g.cameraRig.pitch = -0.7 + Math.random() * 1.2; });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
}
const monFinal = await page.evaluate(() => window.__m);
console.log('  总帧数:', monFinal.frames);
console.log('  角色陷入地形网格的帧:', monFinal.playerUnder, monFinal.playerUnder === 0 ? '✅ 未陷入' : '⚠ 有陷入');
console.log('  已着地却浮在地形网格上方的帧:', monFinal.playerFloat,
  monFinal.playerFloat === 0 ? '✅ 没有悬空' : '⚠ 有悬空（下坡腾空不计）',
  '  着地时离地最高:', monFinal.groundedGap.toFixed(3), 'm');
console.log('  【网格射线】角色→相机 之间被地形挡住的帧:', monFinal.terrainBetween,
  monFinal.terrainBetween === 0 ? '✅ 无穿模（角色始终可见）' : '⚠ 存在遮挡');
console.log('  相机低于地形网格的帧:', monFinal.camViol, ' 相机离地最低值:', monFinal.camWorst.toFixed(2), 'm');
console.log('  镜头最近距离:', monFinal.camMinDist.toFixed(2), 'm（<1.8 会自动隐藏角色）');

console.log('\n=== 测试 4：角色模型特写 ===');
await page.evaluate(() => {
  const g = window.__game;
  g.player.position.y = g.terrain.height(g.player.position.x, g.player.position.z) + 0.2;
  g.player.state = 'idle';
  g.cameraRig.distance = 3.2; g.cameraRig.targetDistance = 3.2;
  g.cameraRig.yaw = Math.PI + 0.35; g.cameraRig.pitch = -0.12;
  g.sky.setTime(0.42);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/model-back.png` });
await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = Math.PI * 2 - 0.4; });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/model-front.png` });
// 跑动中的姿态
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/model-run.png` });
await page.keyboard.up('KeyW');
// 滑翔姿态
await page.evaluate(() => {
  const g = window.__game;
  g.player.position.y = g.terrain.height(g.player.position.x, g.player.position.z) + 26;
  g.player.velocity.set(6, -3, 0);
  g.player.gliding = true;
  g.player.state = 'glide';
  g.cameraRig.yaw = Math.PI + 1.2; g.cameraRig.pitch = -0.05; g.cameraRig.distance = 4.6;
});
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/model-glide.png` });

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 12).forEach((e) => console.log(' ', e));
await browser.close();
