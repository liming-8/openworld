import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({
  executablePath: 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1080, height: 594 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
const t0 = Date.now();
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
console.log('加载完成，用时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
await page.click('#btn-new');
await page.waitForTimeout(3000);
const st = await page.evaluate(() => {
  const g = window.__game;
  return {
    paused: g.paused, fps: Math.round(g.fpsAvg || 0),
    pos: [+g.player.position.x.toFixed(1), +g.player.position.y.toFixed(1), +g.player.position.z.toFixed(1)],
    biome: g.terrain.biome(g.player.position.x, g.player.position.z).name,
    chunks: g.scene.children.filter((o) => o.name && o.name.startsWith('chunk_')).length,
    drawCalls: g.renderer.info.render.calls,
    tris: g.renderer.info.render.triangles,
  };
});
console.log('运行状态:', JSON.stringify(st));
console.log('错误数:', errs.length);
errs.slice(0, 8).forEach((e) => console.log('  ', e));
await browser.close();
