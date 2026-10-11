/**
 * 展示图拍摄：为 README 生成一套统一 1600×900 的截图。
 *
 * 与旧脚本的区别：
 *   1. 统一 1600×900，且**先搜点再拍**——按生物群系自动挑低坡度位置，
 *      不写死坐标（写死的坐标换个 seed 就拍到海里去了）；
 *   2. 角色落点用 meshHeight 并等物理收敛，避免截到"下落"状态文字；
 *   3. 每个群系多拍几个候选，方便人工挑最好看的那张。
 *
 * 用法：
 *   node _test/with-server.mjs _test/showcase.mjs
 * 产物：_test/shots/showcase/*.png
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld';
const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = path.join(ROOT, '_test', 'shots', 'showcase');
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
fs.mkdirSync(OUT, { recursive: true });

const W = 1600, H = 900;
// ONLY=glide,map 只重拍指定部分，避免为了调一个机位把 30 张全跑一遍
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const want_ = (k) => ONLY.length === 0 || ONLY.includes(k);

// 换用第 N 个候选点：`SPOT_INDEX=BEACH:1,FOREST:2`。
// 有些群系的首选点位本身合规，但镜头正好贴在一棵树上（树干占掉半张图），
// 换一个候选重拍就行 —— 不必去动搜点规则。
const SPOT_INDEX = (process.env.SPOT_INDEX || '').split(',')
  .map((s) => s.split(':'))
  .reduce((m, [k, v]) => { if (k && v) m[k.trim().toUpperCase()] = Number(v); return m; }, {});

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(3000);

// 早上 8 点多的斜射光，阴影最长、颜色最好看
await page.evaluate(() => window.__game.sky.setTime(0.345));

/* ---------------- 搜点 ---------------- */
console.log('=== 搜索各生物群系的取景点 ===');
const spots = await page.evaluate(() => {
  const g = window.__game, t = g.terrain;
  // 每个群系允许的坡度上限 / 高度上限不同：山地天生就是陡的，
  // 用同一套阈值会把 MOUNTAIN / HIGHLAND 全都筛掉（第一版就踩了这个坑）。
  const LIMIT = {
    GRASSLAND: [0.22, 72], FOREST: [0.24, 72], DESERT: [0.20, 72],
    SNOW: [0.26, 999], SWAMP: [0.16, 72], BEACH: [0.30, 72],
    HIGHLAND: [0.55, 999], MOUNTAIN: [0.95, 999], OCEAN: [9, 999],
  };
  const want = Object.keys(LIMIT).filter((k) => k !== 'OCEAN');
  // 每个群系"允许出现在取景点周围"的邻居。
  // 图鉴里踩过这个坑：沙滩那一格其实是站在滩涂边缘朝雪山拍的，
  // 整格几乎全是雪 —— 所以取景点必须落在"自己这个群系成片"的地方，
  // 而不是站在两种群系的交界线上。
  const OK_NEIGHBOURS = {
    GRASSLAND: ['GRASSLAND', 'FOREST', 'BEACH', 'SWAMP'],
    FOREST: ['FOREST', 'GRASSLAND', 'HIGHLAND', 'SWAMP'],
    DESERT: ['DESERT', 'BEACH', 'GRASSLAND'],
    SNOW: ['SNOW', 'MOUNTAIN', 'HIGHLAND'],
    SWAMP: ['SWAMP', 'GRASSLAND', 'FOREST', 'BEACH'],
    BEACH: ['BEACH', 'OCEAN', 'GRASSLAND', 'DESERT'],
    HIGHLAND: ['HIGHLAND', 'MOUNTAIN', 'GRASSLAND', 'FOREST', 'SNOW'],
    MOUNTAIN: ['MOUNTAIN', 'HIGHLAND', 'SNOW'],
  };
  const NS = 44;          // 邻居采样半径（米）
  const NEI = [[-NS, 0], [NS, 0], [0, -NS], [0, NS], [-NS, -NS], [NS, NS], [-NS, NS], [NS, -NS]];
  const found = {};
  for (let x = -900; x <= 900; x += 24) {
    for (let z = -900; z <= 900; z += 24) {
      const b = t.biome(x, z);
      if (!want.includes(b.id)) continue;
      const [sMax, hMax] = LIMIT[b.id];
      const s = t.slope(x, z);
      const h = t.height(x, z);
      if (s > sMax || h < 0.5 || h > hMax) continue;
      // 周围 8 个方向至少 6 个是自己的同类
      const okSet = OK_NEIGHBOURS[b.id];
      if (okSet) {
        let good = 0;
        for (const [dx, dz] of NEI) {
          if (okSet.includes(t.biome(x + dx, z + dz).id)) good++;
        }
        if (good < 6) continue;
      }
      const list = found[b.id] || (found[b.id] = []);
      if (list.length >= 48) continue;
      list.push({ x, z, s: +s.toFixed(3), h: +h.toFixed(1) });
    }
  }
  // 山地优先挑高的（要有视野），其余挑平坦的（要站得住）
  for (const k of Object.keys(found)) {
    const hi = (k === 'MOUNTAIN' || k === 'HIGHLAND' || k === 'SNOW');
    found[k].sort((a, b2) => hi ? b2.h - a.h : a.s - b2.s);
    found[k] = found[k].slice(0, 6);
  }
  return found;
});
for (const [k, v] of Object.entries(spots)) {
  console.log(`  ${k.padEnd(10)} ${String(v.length).padStart(2)} 个候选   最高/最平：${
    v[0] ? `${v[0].h}m 坡度${v[0].s}` : '-'}`);
}

/** 找一个"一览众山小"的制高点：周围 300 米内高差越大越好 */
const vista = await page.evaluate(() => {
  const t = window.__game.terrain;
  let best = null, bestScore = -1;
  for (let x = -800; x <= 800; x += 40) {
    for (let z = -800; z <= 800; z += 40) {
      const h = t.height(x, z);
      if (h < 30) continue;
      // 采样四周，算"能看到的落差"
      let lo = h, hi = h;
      for (const [dx, dz] of [[-260, 0], [260, 0], [0, -260], [0, 260], [-180, -180], [180, 180]]) {
        const hh = t.height(x + dx, z + dz);
        if (hh < lo) lo = hh;
        if (hh > hi) hi = hh;
      }
      const score = (h - lo) + (hi - h) * 0.4;
      if (score > bestScore) { bestScore = score; best = { x, z, h: +h.toFixed(1), drop: +(h - lo).toFixed(1) }; }
    }
  }
  return best;
});
console.log(`  制高点      (${vista.x}, ${vista.z})  h=${vista.h}m  最大落差 ${vista.drop}m`);

/* ---------------- 取景 ---------------- */
/**
 * 把角色放到 (x,z) 并让镜头站到指定位置。
 * ⚠️ 落点必须是 meshHeight（画出来的地面），不是 height（解析面），
 *    否则会高一点点、物理判定为空中，HUD 就挂上"下落"两个字。
 */
const frame = async (x, z, yaw, pitch, dist, setRig = true) => {
  await page.evaluate(([x, z, yaw, pitch, dist, setRig]) => {
    const g = window.__game;
    const y = g.terrain.meshHeight(x, z);
    g.player.position.set(x, y, z);
    g.player.velocity.set(0, 0, 0);
    g.player.grounded = true;
    for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
    if (setRig) {
      g.cameraRig.yaw = yaw;
      g.cameraRig.pitch = pitch;
      g.cameraRig.distance = dist;
      g.cameraRig.targetDistance = dist;
    }
    for (let i = 0; i < 60; i++) g.cameraRig.update(g.player, 0.033, false);
  }, [x, z, yaw, pitch, dist, setRig]);
  await page.waitForTimeout(1500);
};

const stateTag = () => page.evaluate(() => document.getElementById('state-tag')?.textContent || '');

const shoot = async (name) => {
  const tag = await stateTag();
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name.padEnd(26)} 状态栏="${tag || '空'}"`);
  return tag;
};

/* 每个群系拍 3 个方向（顺光 / 侧光 / 俯一点） */
const ANGLES = [
  ['a', Math.PI * 0.0, -0.10, 7.0],
  ['b', Math.PI * 0.6, -0.18, 9.0],
  ['c', Math.PI * 1.3, -0.32, 13.0],
];

let badState = 0;
if (want_('biomes')) {
// SET_HUD=0 拍"无 HUD"版图鉴：图鉴里嵌着三块 HUD 面板太杂，纯风景更耐看。
// 注意文件名加 -clean 后缀，不要覆盖带 HUD 的版本（两种用途都留着）。
const CLEAN = process.env.SET_HUD === '0';
if (CLEAN) await page.evaluate(() => window.__game.ui.setHUD(false));
for (const [biome, list] of Object.entries(spots)) {
  console.log(`\n--- ${biome} ---`);
  const best = list[Math.min(SPOT_INDEX[biome] || 0, list.length - 1)];
  for (const [suffix, yaw, pitch, dist] of ANGLES) {
    await frame(best.x, best.z, yaw, pitch, dist);
    const tag = await shoot(`${biome.toLowerCase()}-${suffix}${CLEAN ? '-clean' : ''}`);
    if (tag) badState++;
  }
  console.log(`      (${best.x}, ${best.z})  h=${best.h}m  坡度=${best.s}`);
}
if (CLEAN) await page.evaluate(() => window.__game.ui.setHUD(true));
}

/* ---------------- 主图：把镜头拉近，角色要看得清 ---------------- */
if (want_('hero')) {
console.log('\n--- 主图（近景第三人称）---');
{
  const pick = (spots.FOREST && spots.FOREST[0]) || null;
  const alt = spots.GRASSLAND && spots.GRASSLAND[0];
  // 林地有树、画面更饱满；没有就退到草原
  for (const [src, p] of [['forest', pick], ['grassland', alt]]) {
    if (!p) continue;
    for (const [suffix, yaw, pitch, dist] of [
      ['near', Math.PI * 0.85, -0.14, 4.4],
      ['mid', Math.PI * 0.35, -0.20, 6.2],
    ]) {
      await frame(p.x, p.z, yaw, pitch, dist);
      const tag = await shoot(`hero-${src}-${suffix}`);
      if (tag) badState++;
    }
  }
}
}

/* ---------------- 制高点远景 ---------------- */
if (want_('vista')) {
console.log('\n--- 制高点远景 ---');
for (const [suffix, yaw, pitch, dist] of [
  ['a', Math.PI * 0.25, -0.30, 16],
  ['b', Math.PI * 1.15, -0.42, 22],
  ['c', Math.PI * 1.15, -0.26, 10],
  ['d', Math.PI * 1.32, -0.20, 6.5],
  ['e', Math.PI * 0.62, -0.24, 9],
]) {
  await frame(vista.x, vista.z, yaw, pitch, dist);
  const tag = await shoot(`vista-${suffix}`);
  if (tag) badState++;
}
}

/* ---------------- 滑翔 ---------------- */
if (want_('glide')) {
console.log('\n--- 滑翔 ---');
/**
 * 量"角色本体在屏幕上的位置"。
 *
 * ⚠️ 不能用 player.position.project(camera) —— 滑翔时相机是俯视机位，
 *    角色被顶到画面上沿甚至画外，但把 player.position 投影出来却看着像在中间，
 *    照着它调参只会一直拍到空镜。必须逐个网格投影求平均。
 */
const bodyScreen = () => page.evaluate(async () => {
  const T = await import('/libs/three.module.js');
  const g = window.__game;
  const grp = g.player.group;
  g.camera.updateMatrixWorld(true);
  let n = 0, sx = 0, sy = 0, off = 0;
  grp.traverse((o) => {
    if (!o.isMesh) return;
    const wp = new T.Vector3();
    o.getWorldPosition(wp);
    if (wp.distanceTo(g.player.position) >= 4) return;   // 排除留在地面的阴影贴片
    const v = wp.clone().project(g.camera);
    sx += (v.x + 1) / 2; sy += (1 - v.y) / 2; n++;
  });
  return n ? { n, sx: +(sx / n).toFixed(3), sy: +(sy / n).toFixed(3) } : null;
});

const PITCHES = (process.env.GLIDE_PITCHES || '-0.34').split(',').map(Number);
const RISES = (process.env.GLIDE_RISES || '62').split(',').map(Number);
// GLIDE_AUTO_RIG=1：完全不动 cameraRig，用游戏自己的滑翔机位。
// 实测默认机位会把角色稳定保持在画面 41%~53%，比手工调 pitch 更真实也更居中。
const AUTO_RIG = process.env.GLIDE_AUTO_RIG === '1';
for (const RISE of RISES) {
for (const PITCH of PITCHES) {
  const DIST = Number(process.env.GLIDE_DIST ?? 6.2);
  await frame(vista.x, vista.z, Math.PI * 0.2, PITCH, DIST, !AUTO_RIG);
  const before = await page.evaluate(([pitch, dist, rise, auto]) => {
    const g = window.__game;
    g.player.position.y += rise;
    g.player.velocity.set(0, -4.0, 0);
    g.player.airTime = 1.2;
    g.player.grounded = false;
    g.player.swimming = false;
    g.player.stamina = 100;
    g.player.facing = Math.PI * 0.2;
    // ⚠️ 必须清掉"土狼时间"和跳跃缓冲，否则下一帧会走 player.js:358
    //    `jumpBuffer>0 && coyote>0` 起跳，velocity.y 直接变成 jumpSpeed(9.4)，
    //    滑翔条件里的 `velocity.y < 1.5` 立刻不成立 → 拍到的是跳跃不是滑翔。
    g.player.coyote = 0;
    g.player.jumpBuffer = 0;
    if (!auto) {
      g.cameraRig.yaw = Math.PI * 0.2;
      g.cameraRig.pitch = pitch;
      g.cameraRig.distance = dist;
      g.cameraRig.targetDistance = dist;
    }
    return { y: +g.player.position.y.toFixed(1), vy: +g.player.velocity.y.toFixed(2) };
  }, [PITCH, DIST, RISE, AUTO_RIG]);
  await page.keyboard.down('Space');
  let gl = null, scr = null;
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(250);
    gl = await page.evaluate(() => ({
      gliding: window.__game.player.gliding,
      state: window.__game.player.state,
      vy: +window.__game.player.velocity.y.toFixed(2),
      gap: +(window.__game.player.position.y
        - window.__game.terrain.meshHeight(window.__game.player.position.x, window.__game.player.position.z)).toFixed(1),
    }));
    scr = await bodyScreen();
    // 要"已经切成滑翔、正在下沉、且角色在画面中段"的那一帧
    if (gl.gliding && gl.vy < 0 && scr && scr.sy > 0.25 && scr.sy < 0.82) break;
  }
  const tag = (PITCHES.length > 1 || RISES.length > 1);
  const file = tag ? `glide-r${RISE}-p${PITCH}${AUTO_RIG ? "-auto" : ""}.png` : "glide.png";
  await page.screenshot({ path: `${OUT}/${file}` });
  await page.keyboard.up('Space');
  const ok = gl.gliding && gl.vy < 0 && scr && scr.sy > 0.15 && scr.sy < 0.9;
  console.log(`  rise=${String(RISE).padStart(3)} pitch=${String(PITCH).padStart(5)} dist=${DIST}  → ${file.padEnd(24)
    } gliding=${gl.gliding} vy=${gl.vy} 离地=${gl.gap}m  角色屏幕位置=(${(scr.sx * 100).toFixed(0)}%, ${(scr.sy * 100).toFixed(0)}%) ${ok ? '' : '⚠ 不在画面中段'}`);
  if (!tag) {
    console.log(`  起跳 y=${before.y} vy=${before.vy}`);
    if (!ok) badState++;
  }
  await page.waitForTimeout(300);
}
}
}

/* ---------------- 世界地图 ---------------- */
if (want_('map')) {
console.log('\n--- 世界地图 ---');
await page.evaluate(() => { window.__game.toggleMap(true); });
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/worldmap.png` });
// 顺带把卡片的屏幕矩形记下来：截图里两侧是空的背景，
// 交给 make-showcase.py 裁到卡片范围，README 里才不会被大白边占掉一半。
const mapInfo = await page.evaluate(() => {
  const cv = document.getElementById('bigmap');
  const card = document.querySelector('.map-card');
  const r = cv.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  return {
    css: +r.width.toFixed(0), canvas: cv.width,
    card: [+cr.left.toFixed(1), +cr.top.toFixed(1), +cr.right.toFixed(1), +cr.bottom.toFixed(1)],
    view: [innerWidth, innerHeight],
  };
});
fs.writeFileSync(path.join(OUT, 'worldmap-rect.json'), JSON.stringify(mapInfo, null, 2));
console.log(`  worldmap.png  画布 ${mapInfo.canvas}  显示 ${mapInfo.css}px  卡片 ${JSON.stringify(mapInfo.card)}`);
await page.evaluate(() => { window.__game.toggleMap(false); });
await page.waitForTimeout(400);
}

console.log('\n=== 汇总 ===');
console.log('产物目录:', OUT);
console.log('非"落地"状态的截图数:', badState, '（应尽量为 0）');
console.log('运行时报错:', errors.length, errors.slice(0, 5).join(' | '));

await browser.close();
