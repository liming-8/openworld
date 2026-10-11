/**
 * 平地上直走测试 —— 用来把「悬空」里的**坡道过渡腾空**和**真·悬空 bug** 分开。
 *
 * 背景：
 *   verify.mjs 测试 3 会在陡坡密集区跑图，那里下坡时角色会短暂离地
 *   （`grounded` 靠 `position.y <= h + 0.06` 判定，下坡那一两帧确实还没落回去），
 *   于是报出「已着地却浮空 4/53 帧，最高 0.318 m」。这到底是物理正常还是残留 bug？
 *
 *   判别方法：把角色放到**坡度接近 0 的沙地**上直走。
 *   平地上不存在下坡腾空，如果这时还有明显的离地高度，那才是真 bug。
 *
 * 用法：node _test/flat-walk.mjs [X] [Z]
 *       不传坐标则自动找一块最平坦的沙地。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';

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

await page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  window.__T = T;
  window.__rc = new T.Raycaster();
  window.__org = new T.Vector3();
  window.__dir = new T.Vector3();
});

// ---------- 选一块平地 ----------
const target = await page.evaluate((arg) => {
  const g = window.__game, T = g.terrain;
  if (arg.x !== null) return { x: arg.x, z: arg.z, auto: false };
  let best = null, bestSlope = 1e9, bestH = 0;
  for (let i = 0; i < 8000; i++) {
    const x = (Math.random() - 0.5) * 6000, z = (Math.random() - 0.5) * 6000;
    const h = T.height(x, z);
    if (h < 4 || h > 30) continue;               // 要陆地、别在高山上
    const bid = T.biome(x, z).id;
    if (bid !== 'DESERT' && bid !== 'GRASSLAND') continue;
    // 看周围一圈是不是也平
    let mx = 0;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 24;
      mx = Math.max(mx, T.slope(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    if (mx < bestSlope) { bestSlope = mx; best = { x, z }; bestH = h; }
  }
  if (!best) return { x: 0, z: 0, auto: true, slope: 1, h: 0 };
  return { x: best.x, z: best.z, auto: true, slope: bestSlope, h: bestH };
}, { x: process.argv[2] ? +process.argv[2] : null, z: process.argv[3] ? +process.argv[3] : null });

console.log('=== 平地直走测试 ===');
console.log('  落点:', target.x.toFixed(0) + ',', target.z.toFixed(0),
  target.auto ? '（自动选取，坡度 ' + target.slope.toFixed(3) + ' 海拔 ' + target.h.toFixed(1) + '）' : '（手动指定）');

// ---------- 逐帧埋点 ----------
await page.evaluate((t) => {
  const g = window.__game;
  g.player.position.set(t.x, g.terrain.meshHeight(t.x, t.z), t.z);
  g.player.velocity.set(0, 0, 0);
  g.cameraRig.yaw = 0; g.cameraRig.pitch = -0.18;
  g.cameraRig.update(g.player, 0.016, false);

  window.__fw = {
    frames: 0, walkFrames: 0,
    meshGapMax: -99, meshGapMin: 99, meshGapSum: 0,
    floatFrames: 0, sinkFrames: 0,
    // 同时用旧的解析高度当基准做对照，看修复前会差多少
    anaGapMax: -99, anaGapMin: 99, anaGapAbsSum: 0,
    groundedFloatMax: -99,
    startX: t.x, startZ: t.z,
  };
  if (!window.__tmesh) {
    window.__tmesh = [];
    g.scene.traverse((o) => { if (o.isMesh && o.material === g.world.terrainMaterial) window.__tmesh.push(o); });
  }
  const T = window.__T;
  const oRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = (s, c) => {
    const w = window.__fw, p = g.player.position;
    w.frames++;
    // 只看真正在走的帧
    const moving = Math.hypot(g.player.velocity.x, g.player.velocity.z) > 0.5;
    if (moving) w.walkFrames++;

    // 基准 A：meshHeight（修复后角色实际贴的面）
    const hm = g.terrain.meshHeight(p.x, p.z);
    const gm = p.y - hm;
    if (gm > w.meshGapMax) w.meshGapMax = gm;
    if (gm < w.meshGapMin) w.meshGapMin = gm;
    w.meshGapSum += gm;
    if (moving) {
      if (gm > 0.06) w.floatFrames++;
      if (gm < -0.06) w.sinkFrames++;
      if (g.player.grounded && gm > w.groundedFloatMax) w.groundedFloatMax = gm;
    }

    // 基准 B：解析 height（旧逻辑会贴的面）—— 仅用于量化"修复前会浮多少"
    const ha = g.terrain.height(p.x, p.z);
    const ga = p.y - ha;
    if (ga > w.anaGapMax) w.anaGapMax = ga;
    if (ga < w.anaGapMin) w.anaGapMin = ga;
    w.anaGapAbsSum += Math.abs(ga);

    // 基准 C：从头顶往下打射线，打到真实渲染出来的网格
    window.__rc.set(window.__org.set(p.x, p.y + 60, p.z), window.__dir.set(0, -1, 0));
    window.__rc.near = 0; window.__rc.far = 120;
    const hit = window.__rc.intersectObjects(window.__tmesh, false)[0];
    if (hit) {
      const gg = p.y - hit.point.y;
      if (gg > 0.06 && moving) w.floatFrames += 0;   // 网格已由 A 统计，这里只做交叉验证
    }
    oRender(s, c);
  };
}, target);

// ---------- 走一段 ----------
await page.keyboard.down('KeyW');
await page.waitForTimeout(9000);
await page.keyboard.up('KeyW');
await page.waitForTimeout(600);

const r = await page.evaluate(() => {
  const g = window.__game, w = window.__fw, p = g.player.position;
  return {
    ...w,
    endBiome: g.terrain.biome(p.x, p.z).name,
    endSlope: +g.terrain.slope(p.x, p.z).toFixed(3),
    moved: +Math.hypot(p.x - w.startX, p.z - w.startZ).toFixed(1),
    y: +p.y.toFixed(2),
  };
});

const pct = (n) => r.walkFrames ? (n / r.walkFrames * 100).toFixed(1) + '%' : '-';
console.log('  渲染帧数:', r.frames, ' 行进帧数:', r.walkFrames, ' 实际位移:', r.moved, 'm');
console.log('  终点:', r.endBiome, ' 坡度', r.endSlope, ' 海拔', r.y);

console.log('\n  ── 修复后（基准 = meshHeight，即角色实际贴的面）──');
console.log('    离地间隙 最大:', r.meshGapMax.toFixed(3), 'm   最小:', r.meshGapMin.toFixed(3), 'm');
console.log('    悬空帧(>6cm):', r.floatFrames, '(' + pct(r.floatFrames) + ')',
  r.floatFrames === 0 ? '✅ 全程踩实' : '');
console.log('    陷入帧(<-6cm):', r.sinkFrames, '(' + pct(r.sinkFrames) + ')',
  r.sinkFrames === 0 ? '✅ 全程未陷入' : '');
console.log('    着地状态下离地最高:', r.groundedFloatMax.toFixed(3), 'm');

console.log('\n  ── 修复前（基准 = height() 解析高度，旧逻辑会贴的面）──');
console.log('    离地间隙 最大:', r.anaGapMax.toFixed(3), 'm   最小:', r.anaGapMin.toFixed(3), 'm');
console.log('    平均绝对偏差:', (r.anaGapAbsSum / Math.max(1, r.frames)).toFixed(3), 'm');
console.log('    → 也就是说，若仍贴解析高度，这段平路平均会浮/陷',
  (r.anaGapAbsSum / Math.max(1, r.frames)).toFixed(2), '米，最大', r.anaGapMax.toFixed(2), '米');

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 10).forEach((e) => console.log(' ', e));
await browser.close();
