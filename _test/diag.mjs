import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2000);

const sample = () => page.evaluate(() => {
  const g = window.__game;
  const i = g.renderer.info;
  return {
    fps: Math.round(g.fpsAvg),
    calls: i.render.calls,
    tris: i.render.triangles,
    geo: i.memory.geometries,
    tex: i.memory.textures,
    prog: i.programs ? i.programs.length : -1,
    chunks: g.world.stats.chunks,
    regions: g.world.stats.regions,
    objects: g.objects.size,
    sunCast: g.sky.sun.castShadow,
    shadowsOn: g.renderer.shadowMap.enabled,
  };
});

console.log('=== 静止 8 秒 ===');
for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); console.log(JSON.stringify(await sample())); }

console.log('=== 持续奔跑 10 秒 ===');
await page.keyboard.down('KeyW');
for (let i = 0; i < 10; i++) { await page.waitForTimeout(1000); console.log(JSON.stringify(await sample())); }
await page.keyboard.up('KeyW');

console.log('=== 关闭阴影后静止 5 秒 ===');
await page.evaluate(() => { window.__game.applySetting('shadows', false); });
for (let i = 0; i < 5; i++) { await page.waitForTimeout(1000); console.log(JSON.stringify(await sample())); }

await browser.close();
