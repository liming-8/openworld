/**
 * 修复后的实机展示图 —— 用来给用户确认"角色已经踩实了"。
 *
 * 出三张：
 *   1) 烫金流沙 · 第三人称正常视角（带 HUD）
 *   2) 同点 · 脚部特写（把镜头压低拉近，看投影是否就在脚边）
 *   3) 风起平原 · 带植被的正常视角
 *
 * 每张都会在打印里报出"角色脚底 Y 与网格高度之差"，越接近 0 说明踩得越实。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/artifact';
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

/** 落到指定点、摆好镜头、等世界加载完，返回脚底与网格高度之差 */
const setup = async (x, z, opt) => {
  const info = await page.evaluate(([x, z, o]) => {
    const g = window.__game;
    const mh = g.terrain.meshHeight(x, z);
    g.player.position.set(x, mh, z);
    g.player.velocity.set(0, 0, 0);
    g.player.state = o.state || 'idle';
    for (let i = 0; i < 40; i++) g.world.update(g.player.position, 800);
    g.cameraRig.yaw = o.yaw;
    g.cameraRig.pitch = o.pitch;
    g.cameraRig.distance = o.dist;
    g.cameraRig.targetDistance = o.dist;
    g.cameraRig.firstPerson = false;
    for (let i = 0; i < 60; i++) g.cameraRig.update(g.player, 0.05, false);
    // 时钟定在上午，阴影清晰
    g.sky.setTime(o.time ?? 0.34);
    return {
      biome: g.terrain.biome(x, z).name,
      slope: +g.terrain.slope(x, z).toFixed(3),
      footY: +g.player.position.y.toFixed(3),
      meshY: +mh.toFixed(3),
      anaY: +g.terrain.height(x, z).toFixed(3),
    };
  }, [x, z, opt]);
  await page.waitForTimeout(1600);
  const gap = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    return {
      footGap: +(p.y - g.terrain.meshHeight(p.x, p.z)).toFixed(4),
      grounded: !!g.player.grounded,
      hi: !!g.doubleJumpReady,
    };
  });
  return { ...info, ...gap };
};

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

console.log('=== 修复后实机展示 ===\n');

// 1) 烫金流沙 · 正常第三人称（太阳压低，影子拉长，能不能"脚边有影子"一眼可见）
let a = await setup(1317, 121, { yaw: Math.PI * 0.5, pitch: -0.30, dist: 5.0, time: 0.74 });
await shot('fixed-1-desert');
console.log('[1] 烫金流沙 · 正常视角（低日照，长影子）');
console.log('    群系', a.biome, ' 坡度', a.slope);
console.log('    网格高度', a.meshY, 'm   角色脚底', a.footY, 'm   差值', a.footGap, 'm',
  Math.abs(a.footGap) < 0.01 ? '✅ 踩实' : '⚠');
console.log('    （若仍用旧的解析高度', a.anaY, 'm，会浮', (a.anaY - a.meshY).toFixed(2), 'm）\n');

// 2) 脚部特写
let b = await setup(1317, 121, { yaw: Math.PI * 0.42, pitch: -0.50, dist: 2.3, time: 0.74 });
await shot('fixed-2-foot');
console.log('[2] 同点 · 脚部特写');
console.log('    角色脚底', b.footY, 'm   网格高度', b.meshY, 'm   差值', b.footGap, 'm',
  Math.abs(b.footGap) < 0.01 ? '✅ 踩实' : '⚠', '\n');

// 3) 风起平原 · 带植被（换一块更开阔的平地）
let c = await setup(82, -1075, { yaw: Math.PI * 0.3, pitch: -0.30, dist: 5.4 });
await shot('fixed-3-plain');
console.log('[3] 开阔平地 · 带植被');
console.log('    群系', c.biome, ' 坡度', c.slope);
console.log('    网格高度', c.meshY, 'm   角色脚底', c.footY, 'm   差值', c.footGap, 'm',
  Math.abs(c.footGap) < 0.01 ? '✅ 踩实' : '⚠', '\n');

// 4) 跑动中（动画状态）
await setup(1317, 121, { yaw: Math.PI * 0.5, pitch: -0.28, dist: 5.2, state: 'run' });
await page.keyboard.down('KeyW');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/fixed-4-run.png` });
await page.keyboard.up('KeyW');
const d = await page.evaluate(() => {
  const g = window.__game, p = g.player.position;
  return { gap: +(p.y - g.terrain.meshHeight(p.x, p.z)).toFixed(4), grounded: !!g.player.grounded };
});
console.log('[4] 跑动中');
console.log('    脚底间隙', d.gap, 'm   已着地:', d.grounded, Math.abs(d.gap) < 0.01 ? '✅ 踩着跑' : '⚠', '\n');

console.log('=== 错误 (' + errors.length + ') ===');
errors.slice(0, 8).forEach((e) => console.log(' ', e));
await browser.close();
