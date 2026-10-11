/**
 * 对着**正在运行的 8080 服务**截一张最终效果图（1600×1000 视口）。
 * 用法：node _test/map-final-shot.mjs
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld';
const OUT = path.join(ROOT, '_test', 'verify');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://127.0.0.1:8080';

const browser = await chromium.launch({
  executablePath: 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2800);

// 走两步，让地图上有更多已加载地标
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
await page.waitForTimeout(400);

const t0 = Date.now();
await page.evaluate(() => { window.__game.toggleMap(true); });
await page.waitForTimeout(1400);
const info = await page.evaluate(() => {
  const cv = document.getElementById('bigmap');
  const r = cv.getBoundingClientRect();
  return { cssW: +r.width.toFixed(0), canvasW: cv.width, canvasH: cv.height, dpr: devicePixelRatio };
});
await page.screenshot({ path: `${OUT}/map-final-8080.png` });
console.log(`${BASE}  视口 1600×1000`);
console.log(`#bigmap  CSS ${info.cssW}px  画布 ${info.canvasW}×${info.canvasH}  DPR ${info.dpr}`);
console.log(`打开地图后等待 ${Date.now() - t0} ms 后才截图`);
console.log('运行时报错:', errors.length, errors.slice(0, 5).join(' | '));
console.log('已保存', path.join(OUT, 'map-final-8080.png'));
await browser.close();
