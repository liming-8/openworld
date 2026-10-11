/**
 * 第六轮反馈的验证：世界地图分辨率 + 地图页面尺寸。
 *
 *  1) 128 → 512 的采样分辨率提升，地图是不是真的更清晰（用相邻像素差异量化）
 *  2) 生成耗时随分辨率的增长（在浏览器里实测，不是离线估算）
 *  3) canvas 内部分辨率是否跟着"显示尺寸 × DPR"走（_sizeBigmap）
 *  4) ⚠️ 提高 canvas 分辨率之后，标记/文字在屏幕上的大小是否**保持不变**
 *     —— 这是最容易翻车的地方：所有尺寸都得乘 U = canvas宽/css宽
 *  5) 地图卡片是否真的变大了（对比旧版 min(66vh,600px) 的钳制）
 *
 * ⚠️ 自带临时静态服务（127.0.0.1 随机空闲端口），随进程退出关闭。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld';
const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = path.join(ROOT, '_test', 'verify');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
console.log('临时静态服务', BASE, '（随本脚本退出而关闭）');

let fails = 0;
const check = (ok, label, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  ' + detail : ''}`);
};

const VIEW = { width: 1440, height: 900 };
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2600);

/* ============ 1) 地图卡片尺寸 ============ */
console.log('\n=== 1) 地图页面尺寸（M 键打开后） ===');
await page.evaluate(() => { window.__game.toggleMap(true); });
await page.waitForTimeout(1500);

const layout = await page.evaluate(() => {
  const cv = document.getElementById('bigmap');
  const card = document.querySelector('.map-card');
  const r = cv.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  return {
    cssW: r.width, cssH: r.height,
    canvasW: cv.width, canvasH: cv.height,
    cardW: cr.width, cardH: cr.height,
    dpr: window.devicePixelRatio || 1,
    vw: innerWidth, vh: innerHeight,
    oldCap: Math.min(0.66 * innerHeight, 600),   // 旧版 CSS：#bigmap { width: min(66vh,600px) }
  };
});
console.log(`  视口 ${layout.vw}×${layout.vh}  DPR ${layout.dpr}`);
console.log(`  #bigmap  CSS ${layout.cssW.toFixed(0)}×${layout.cssH.toFixed(0)}  画布 ${layout.canvasW}×${layout.canvasH}`);
console.log(`  地图卡片 ${layout.cardW.toFixed(0)}×${layout.cardH.toFixed(0)}`);
check(layout.cssW > layout.oldCap + 60,
  '地图显示尺寸明显大于旧版（min(66vh,600px)）',
  `${layout.cssW.toFixed(0)}px vs 旧上限 ${layout.oldCap.toFixed(0)}px`);
check(layout.cardH > layout.vh * 0.9,
  '地图卡片高度接近撑满视口',
  `卡片高 ${layout.cardH.toFixed(0)} / 视口 ${layout.vh}`);
check(layout.canvasW >= Math.round(layout.cssW * Math.min(layout.dpr, 2)) - 1,
  'canvas 内部分辨率 ≥ 显示尺寸 × DPR（不再固定 1024）',
  `画布 ${layout.canvasW} ≥ ${Math.round(layout.cssW * Math.min(layout.dpr, 2))}`);
check(layout.canvasW !== 1024 || Math.round(layout.cssW) === 1024,
  'canvas 尺寸由代码动态设置，不是写死的 1024', `实际 ${layout.canvasW}`);

/* ============ 2) 生成耗时随分辨率的增长 ============ */
console.log('\n=== 2) renderBigMap() 实测耗时 ===');
const times = await page.evaluate(() => {
  const ui = window.__game.ui;
  const out = [];
  for (const n of [128, 192, 256, 320, 384, 512]) {
    ui.setResolution(n);
    // 预热一次，避免把首次 JIT 的开销算进去
    ui.renderBigMap();
    const t = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      ui.renderBigMap();
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    out.push({ n, ms: +t[1].toFixed(1) });
  }
  ui.setResolution(512);
  return out;
});
console.log('  分辨率      耗时(中位数)');
for (const r of times) console.log(`  ${String(r.n).padStart(4)}×${r.n}   ${String(r.ms).padStart(7)} ms`);
const t512 = times.find((r) => r.n === 512).ms;
const t128 = times.find((r) => r.n === 128).ms;
check(t512 > t128, '分辨率越高耗时越长（符合预期）', `128: ${t128}ms → 512: ${t512}ms`);
check(t512 < 900, '512 分辨率下一次生成仍在一秒内（可接受）', `${t512} ms`);

/* ============ 3) 清晰度：相邻像素梯度 ============ */
console.log('\n=== 3) 清晰度量化（相邻像素平均差异，越大地图越"有细节"） ===');
const sharp = await page.evaluate(() => {
  const ui = window.__game.ui;
  const ctx = document.getElementById('bigmap').getContext('2d');
  const measure = () => {
    const S = document.getElementById('bigmap').width;
    // 只测中间 1/3 区域，避开边缘的标记和文字
    const a = Math.floor(S / 3), b = Math.floor((S * 2) / 3), step = Math.max(1, Math.floor(S / 300));
    let sum = 0, n = 0;
    for (let y = a; y < b; y += step) {
      const row = ctx.getImageData(a, y, b - a, 1).data;
      for (let i = 4; i < row.length; i += 4) {
        sum += Math.abs(row[i] - row[i - 4]) + Math.abs(row[i + 1] - row[i - 3]) + Math.abs(row[i + 2] - row[i - 2]);
        n++;
      }
    }
    return n ? sum / n : 0;
  };
  const res = [];
  for (const nn of [128, 256, 512]) {
    ui.setResolution(nn);
    ui.renderBigMap();
    res.push({ n: nn, grad: +measure().toFixed(2) });
  }
  ui.setResolution(512);
  ui.renderBigMap();
  return res;
});
for (const r of sharp) console.log(`  ${String(r.n).padStart(4)}×${r.n}   平均梯度 ${r.grad}`);
const g128 = sharp.find((r) => r.n === 128).grad;
const g512 = sharp.find((r) => r.n === 512).grad;
check(g512 > g128 * 1.1, '512 分辨率下地图细节明显多于 128（不是被放大糊上去的）',
  `梯度 ${g128} → ${g512}（+${(((g512 / g128) - 1) * 100).toFixed(0)}%）`);

/* ============ 4) 标记 / 文字在屏幕上保持同样大小 ============ */
console.log('\n=== 4) 标记的屏幕尺寸是否恒定（U 因子是否生效） ===');
console.log('    U = 画布宽 ÷ CSS 宽，正常情况下 U 恒等于 DPR；');
console.log('    所以真正能测出缩放的是 **DPR 变化**，不是 CSS 变化。');

/** 把玩家挪到地图正中，然后扫描过中心的水平行量红色三角的跨度 */
const markerProbeSrc = () => {
  const ui = window.__game.ui;
  const cv = document.getElementById('bigmap');
  const ctx = cv.getContext('2d');
  const g = window.__game;
  const span = ui.bmSpan;
  g.player.position.x = ui.bmOrigin.x + span / 2;
  g.player.position.z = ui.bmOrigin.z + span / 2;
  ui.renderBigMap();
  const S = cv.width;
  const y = Math.round(S / 2);
  const row = ctx.getImageData(0, y, S, 1).data;
  let first = -1, last = -1;
  for (let x = 0; x < S; x++) {
    const r = row[x * 4], gg = row[x * 4 + 1], b = row[x * 4 + 2];
    if (r > 150 && r - b > 45 && r - gg > 40) { if (first < 0) first = x; last = x; }
  }
  const canvasPx = first < 0 ? 0 : last - first + 1;
  const cssW = cv.getBoundingClientRect().width;
  return {
    dpr: window.devicePixelRatio || 1,
    cssW: +cssW.toFixed(0), canvasW: S, canvasPx,
    cssPx: +(canvasPx / (S / cssW)).toFixed(2),
  };
};

const dpr1 = await page.evaluate(markerProbeSrc);
console.log(`  DPR ${dpr1.dpr}  显示 ${dpr1.cssW}px  画布 ${dpr1.canvasW}px  三角 ${dpr1.canvasPx} 画布像素 ≈ ${dpr1.cssPx} CSS 像素`);

// 另开一个 DPR=2 的页面，看画布像素跨度是否同比放大、CSS 尺寸是否不变
let dpr2 = null;
try {
  const page2 = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  await page2.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
  await page2.click('#btn-new');
  await page2.waitForTimeout(2600);
  await page2.evaluate(() => { window.__game.toggleMap(true); });
  await page2.waitForTimeout(1500);
  dpr2 = await page2.evaluate(markerProbeSrc);
  console.log(`  DPR ${dpr2.dpr}  显示 ${dpr2.cssW}px  画布 ${dpr2.canvasW}px  三角 ${dpr2.canvasPx} 画布像素 ≈ ${dpr2.cssPx} CSS 像素`);
  await page2.screenshot({ path: `${OUT}/map-dpr2.png` });
  await page2.close();
} catch (e) {
  console.log('  ⚠ DPR=2 页面失败：' + e.message);
}

check(dpr1.cssPx > 0, '能在地图上量到玩家标记', `DPR1 = ${dpr1.cssPx} CSS 像素`);
if (dpr2) {
  const r = dpr2.canvasPx / dpr1.canvasPx;
  console.log(`  画布像素跨度比 = ${r.toFixed(2)}（DPR 比 = ${(dpr2.dpr / dpr1.dpr).toFixed(2)}）`);
  check(r > 1.5, '⚠️ DPR 翻倍后画布像素跨度同比放大（标记按 U 缩放生效）',
    `${dpr1.canvasPx} → ${dpr2.canvasPx} 画布像素`);
  const cssDiff = Math.abs(dpr2.cssPx - dpr1.cssPx);
  check(cssDiff <= Math.max(2, dpr1.cssPx * 0.2),
    '⚠️ 同一时间 CSS 尺寸不变（高清屏上标记不会变小/变大）',
    `${dpr1.cssPx} vs ${dpr2.cssPx} CSS 像素，差 ${cssDiff.toFixed(2)}`);
}

// 顺带确认：在同一个 DPR 下改变地图显示尺寸，标记的 CSS 尺寸也恒定
const acrossSizes = await page.evaluate(async () => {
  const ui = window.__game.ui;
  const cv = document.getElementById('bigmap');
  const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const g = window.__game;
  const out = [];
  for (const css of [600, 774, 960]) {
    cv.style.width = css + 'px'; cv.style.height = css + 'px';
    await wait();
    const span = ui.bmSpan;
    g.player.position.x = ui.bmOrigin.x + span / 2;
    g.player.position.z = ui.bmOrigin.z + span / 2;
    ui.renderBigMap();
    const ctx = cv.getContext('2d');
    const S = cv.width, y = Math.round(S / 2);
    const row = ctx.getImageData(0, y, S, 1).data;
    let first = -1, last = -1;
    for (let x = 0; x < S; x++) {
      const r = row[x * 4], gg = row[x * 4 + 1], b = row[x * 4 + 2];
      if (r > 150 && r - b > 45 && r - gg > 40) { if (first < 0) first = x; last = x; }
    }
    const cw = cv.getBoundingClientRect().width;
    out.push({ css: +cw.toFixed(0), canvasW: S, canvasPx: first < 0 ? 0 : last - first + 1 });
  }
  cv.style.width = ''; cv.style.height = '';
  await wait();
  return out;
});
console.log('  同一 DPR 下改地图尺寸：');
for (const m of acrossSizes) {
  console.log(`    显示 ${String(m.css).padStart(4)}px → 画布 ${String(m.canvasW).padStart(4)}px，三角 ${m.canvasPx} 画布像素`);
}
const spansSame = new Set(acrossSizes.map((m) => m.canvasPx)).size === 1;
check(spansSame, '地图放大后标记不跟着膨胀（css 固定尺寸 × U 的必然结果）',
  acrossSizes.map((m) => `${m.canvasPx}px`).join(' / '));

/* ============ 5) 截图对比：旧版(128 + 小卡片) vs 新版(512 + 满屏卡片) ============ */
console.log('\n=== 5) 生成前后对比截图 ===');

// 旧版重现：128 采样 + 卡片钳制到 min(66vh,600px)
await page.evaluate(() => {
  const ui = window.__game.ui;
  ui.setResolution(128);
  const cv = document.getElementById('bigmap');
  cv.dataset.prevStyle = cv.getAttribute('style') || '';
  const cap = Math.min(innerHeight * 0.66, 600);
  cv.style.width = cap + 'px';
  cv.style.height = cap + 'px';
  ui.renderBigMap();
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/map-before-128-small.png` });
console.log('  已保存 map-before-128-small.png（128 采样 + 旧版 min(66vh,600px) 卡片）');

// 新版：512 采样 + 默认满屏卡片
await page.evaluate(() => {
  const ui = window.__game.ui;
  ui.setResolution(512);
  const cv = document.getElementById('bigmap');
  cv.style.width = '';
  cv.style.height = '';
  ui.renderBigMap();
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/map-after-512-full.png` });
console.log('  已保存 map-after-512-full.png（512 采样 + 满屏卡片）');

// 只截地图画布本身，便于并排看清晰度差异
await page.evaluate(() => { window.__game.ui.setResolution(128); window.__game.ui.renderBigMap(); });
await page.waitForTimeout(400);
await page.locator('#bigmap').screenshot({ path: `${OUT}/mapcanvas-128.png` });
await page.evaluate(() => { window.__game.ui.setResolution(512); window.__game.ui.renderBigMap(); });
await page.waitForTimeout(400);
await page.locator('#bigmap').screenshot({ path: `${OUT}/mapcanvas-512.png` });
console.log('  已保存 mapcanvas-128.png / mapcanvas-512.png（纯画布对比）');

/* ============ 6) 小视口下的退化 ============ */
console.log('\n=== 6) 小窗口（700×520） ===');
await page.setViewportSize({ width: 700, height: 520 });
await page.waitForTimeout(500);
const small = await page.evaluate(() => {
  const ui = window.__game.ui;
  ui.renderBigMap();
  const cv = document.getElementById('bigmap');
  const r = cv.getBoundingClientRect();
  const card = document.querySelector('.map-card').getBoundingClientRect();
  return { cssW: r.width, cssH: r.height, cardH: card.height, vh: innerHeight, canvasW: cv.width };
});
console.log(`  CSS ${small.cssW.toFixed(0)}×${small.cssH.toFixed(0)}  画布 ${small.canvasW}  卡片高 ${small.cardH.toFixed(0)} / 视口 ${small.vh}`);
check(small.cardH <= small.vh + 2, '小窗口下卡片不溢出视口', `${small.cardH.toFixed(0)} ≤ ${small.vh}`);
check(small.cssW >= 380, '小窗口下地图仍有可用尺寸', `${small.cssW.toFixed(0)}px`);
await page.screenshot({ path: `${OUT}/map-small-viewport.png` });

console.log('\n=== 运行时报错 (' + errors.length + ') ===');
errors.slice(0, 10).forEach((e) => console.log(' ', e));
if (errors.length) fails++;

/* ---- 把实测数字写出来，给 make-map-report.py 画报告用 ---- */
const smallStats = small;
fs.writeFileSync(path.join(OUT, 'map-stats.json'), JSON.stringify({
  resLine: '128 × 128  →  512 × 512',
  timeLine: `${t128} ms  →  ${t512} ms`,
  gradLine: `${g128}  →  ${g512}  (+${(((g512 / g128) - 1) * 100).toFixed(0)}%)`,
  sizeLine: `${layout.oldCap.toFixed(0)} px  →  ${layout.cssW.toFixed(0)} px`,
  canvasLine: `${Math.round(layout.oldCap)} → ${layout.canvasW}（跟随显示尺寸 × DPR）`,
  dprLine: dpr2 ? `${dpr1.canvasW} → ${dpr2.canvasW}，标记 CSS 尺寸不变` : '未测',
  markerLine: `${dpr1.cssPx} CSS 像素（DPR1） / ${dpr2 ? dpr2.cssPx : '-'}（DPR2）`,
  smallLine: `CSS ${small.cssW.toFixed(0)} / 卡片高 ${small.cardH.toFixed(0)} / 视口 ${small.vh}`,
}, null, 2), 'utf-8');
console.log('  已写出 map-stats.json');

console.log('\n' + (fails === 0 ? '全部通过 ✅' : `有 ${fails} 项未通过 ❌`));
await browser.close();
server.close();
