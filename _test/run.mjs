import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:8080/index.html';
const OUT = process.env.OUT || 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld/_test/shots';
fs.mkdirSync(OUT, { recursive: true });

const logs = [];
const errors = [];

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

page.on('console', (m) => {
  const t = `${m.type()}: ${m.text()}`;
  logs.push(t);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

console.log('→ 打开页面');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// 等待加载完成（加载页隐藏 或 超时）
console.log('→ 等待世界生成…');
const t0 = Date.now();
try {
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && l.classList.contains('hidden');
  }, { timeout: 120000, polling: 400 });
  console.log(`   完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.log('   ⚠ 加载页未隐藏（可能出错），继续检查');
}

await page.screenshot({ path: `${OUT}/01-loading.png` });

// 读取加载文本
const loadText = await page.textContent('#load-text').catch(() => '');
console.log('   加载状态文本:', loadText);

// 点开始新旅程
const booted = await page.evaluate(() => !!(window.__game && window.__game.state));
console.log('   game 实例存在:', booted);

if (await page.isVisible('#btn-new')) {
  await page.click('#btn-new');
  console.log('→ 已点击「开始新旅程」');
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/02-spawn.png` });

// 模拟跑图：按住 W + 转视角
await page.mouse.move(700, 400);
for (let i = 0; i < 3; i++) {
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(1200);
  await page.mouse.move(700 + (i % 2 ? 200 : -200), 400, { steps: 12 });
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.mouse.move(700, 400, { steps: 4 });
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}/03-run.png` });

// 跳跃
await page.keyboard.press('Space');
await page.waitForTimeout(200);
await page.keyboard.down('Space');
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/04-air.png` });
await page.keyboard.up('Space');
await page.waitForTimeout(1500);

// 读取运行时状态
const stats = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return { error: 'no game' };
  return {
    fps: Math.round(g.fpsAvg),
    chunks: g.world.stats.chunks,
    regions: g.world.stats.regions,
    pos: {
      x: +g.player.position.x.toFixed(1),
      y: +g.player.position.y.toFixed(1),
      z: +g.player.position.z.toFixed(1),
    },
    state: g.player.state,
    speed: +g.player.speed.toFixed(2),
    stamina: Math.round(g.player.stamina),
    distance: Math.round(g.state.distance),
    biome: g.terrain.biome(g.player.position.x, g.player.position.z).name,
    objects: g.objects.size,
    orbsTotal: g.state.orbsTotal,
    chestsTotal: g.state.chestsTotal,
    waysTotal: g.state.waysTotal,
    drawCalls: g.renderer.info.render.calls,
    triangles: g.renderer.info.render.triangles,
    programs: g.renderer.info.programs?.length,
    memory: g.renderer.info.memory,
    hasInteractable: !!g.findInteractable(),
  };
});
console.log('\n=== 运行时状态 ===');
console.log(JSON.stringify(stats, null, 2));

// 打开地图
await page.keyboard.press('KeyM');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/05-map.png` });
await page.keyboard.press('KeyM');
await page.waitForTimeout(600);

// 第一人称 & 夜晚
await page.keyboard.press('KeyC');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-fpv.png` });
await page.keyboard.press('KeyC');
await page.keyboard.press('KeyT');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/07-night.png` });

// 长时间跑动采样 FPS
await page.keyboard.press('KeyT');
await page.keyboard.down('KeyW');
const fpsSamples = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(400);
  fpsSamples.push(await page.evaluate(() => Math.round(window.__game.fpsAvg)));
}
await page.keyboard.up('KeyW');
console.log('\nFPS 采样:', fpsSamples.join(', '));

const final = await page.evaluate(() => {
  const g = window.__game;
  return { fps: Math.round(g.fpsAvg), chunks: g.world.stats.chunks, distance: Math.round(g.state.distance), pos: g.player.position.toArray().map(v => +v.toFixed(0)) };
});
console.log('最终:', JSON.stringify(final));

await page.screenshot({ path: `${OUT}/08-final.png` });

console.log('\n=== 错误 (' + errors.length + ') ===');
errors.slice(0, 30).forEach((e) => console.log(e));
console.log('\n=== 警告/日志 (最后 20 条) ===');
logs.slice(-20).forEach((l) => console.log(l));

await browser.close();
