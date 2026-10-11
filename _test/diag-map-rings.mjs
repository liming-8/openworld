/**
 * 世界地图上出现了大量同心圆状纹理，需要定位它来自哪一层：
 *   (a) 高度场本身   (b) 地表配色   (c) 山体阴影
 *
 * 做法：在同一个玩家位置、同一个 512 网格上，分别把三层单独渲染成图，
 * 再算一个"环状程度"的量化指标（沿同心圆采样时，半径方向的变化有多规律）。
 *
 * ⚠️ 自带临时静态服务，随进程退出关闭。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld';
const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const OUT = path.join(ROOT, '_test', 'verify', 'rings');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2600);

const stats = await page.evaluate(() => {
  const g = window.__game;
  const t = g.terrain;
  const N = 512, span = 2200;
  const ox = g.player.position.x - span / 2, oz = g.player.position.z - span / 2;
  const step = span / (N - 1);

  // ---- 采样高度 ----
  const hs = new Float32Array(N * N);
  let i = 0;
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) hs[i++] = t.height(ox + k * step, oz + j * step);

  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cH = mk(), cC = mk(), cS = mk();
  const xH = cH.getContext('2d'), xC = cC.getContext('2d'), xS = cS.getContext('2d');
  const iH = xH.createImageData(N, N), iC = xC.createImageData(N, N), iS = xS.createImageData(N, N);
  const rgb = [0, 0, 0];

  // 高度范围
  let hMin = 1e9, hMax = -1e9;
  for (let q = 0; q < hs.length; q++) { if (hs[q] < hMin) hMin = hs[q]; if (hs[q] > hMax) hMax = hs[q]; }

  const gx = 0.045 * 17.3 / step, gz = 0.03 * 17.3 / step;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  i = 0;
  let oceanPx = 0, shadeLo = 9e9, shadeHi = -9e9, shadeSum = 0;
  let hDiffSum = 0, hDiffMax = 0;
  for (let j = 0; j < N; j++) {
    const wz = oz + j * step;
    for (let k = 0; k < N; k++) {
      const h = hs[i];
      const wx = ox + k * step;
      // (a) 高度 → 灰度
      const hv = Math.round(clamp((h - hMin) / (hMax - hMin), 0, 1) * 255);
      iH.data[i * 4] = iH.data[i * 4 + 1] = iH.data[i * 4 + 2] = hv; iH.data[i * 4 + 3] = 255;

      // (b) 配色（无阴影）
      let r, gg, b;
      if (h < 0) {
        oceanPx++;
        const tt = clamp(-h / 12, 0, 1);
        r = 66 - tt * 36; gg = 140 - tt * 64; b = 172 - tt * 60;
      } else {
        const c = t.surfaceColor(wx, wz, h, 0.25, rgb);
        r = c[0] * 255; gg = c[1] * 255; b = c[2] * 255;
      }
      iC.data[i * 4] = r; iC.data[i * 4 + 1] = gg; iC.data[i * 4 + 2] = b; iC.data[i * 4 + 3] = 255;

      // (c) 阴影强度 → 灰度
      const hR = k < N - 1 ? hs[i + 1] : h;
      const hD = j < N - 1 ? hs[i + N] : h;
      const shade = clamp(1 + (h - hR) * gx + (h - hD) * gz, 0.66, 1.32);
      if (shade < shadeLo) shadeLo = shade;
      if (shade > shadeHi) shadeHi = shade;
      shadeSum += shade;
      const sv = Math.round(((shade - 0.66) / (1.32 - 0.66)) * 255);
      iS.data[i * 4] = iS.data[i * 4 + 1] = iS.data[i * 4 + 2] = sv; iS.data[i * 4 + 3] = 255;

      // 相邻像素高差统计
      if (k < N - 1) { const d = Math.abs(hs[i + 1] - h); hDiffSum += d; if (d > hDiffMax) hDiffMax = d; }
      i++;
    }
  }
  xH.putImageData(iH, 0, 0); xC.putImageData(iC, 0, 0); xS.putImageData(iS, 0, 0);

  // 阴影的"梯度"：相邻像素阴影差的中位数 → 判断是不是台阶状的硬边
  const sd = [];
  for (let j = 1; j < N - 1; j++) {
    for (let k = 1; k < N - 1; k++) {
      const a = iS.data[(j * N + k) * 4], bb = iS.data[(j * N + k + 1) * 4];
      sd.push(Math.abs(a - bb));
    }
  }
  sd.sort((a, b) => a - b);
  const medSd = sd[Math.floor(sd.length / 2)];
  const p99Sd = sd[Math.floor(sd.length * 0.99)];

  return {
    hMin: +hMin.toFixed(2), hMax: +hMax.toFixed(2),
    oceanRatio: +(oceanPx / (N * N)).toFixed(3),
    shadeMin: +shadeLo.toFixed(3), shadeMax: +shadeHi.toFixed(3),
    shadeMean: +(shadeSum / (N * N)).toFixed(3),
    meanNeighborH: +(hDiffSum / (N * N)).toFixed(4),
    maxNeighborH: +hDiffMax.toFixed(3),
    shadeGradMedian: medSd, shadeGradP99: p99Sd,
    png: { h: cH.toDataURL(), c: cC.toDataURL(), s: cS.toDataURL() },
  };
});

const save = (dataUrl, name) => {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, name), buf);
};
save(stats.png.h, 'layer-height.png');
save(stats.png.c, 'layer-color.png');
save(stats.png.s, 'layer-shade.png');

console.log('高度范围        ', stats.hMin, '→', stats.hMax, 'm');
console.log('海洋像素占比    ', (stats.oceanRatio * 100).toFixed(1), '%');
console.log('阴影范围        ', stats.shadeMin, '→', stats.shadeMax, '  均值', stats.shadeMean);
console.log('相邻像素高差    均值', stats.meanNeighborH, 'm   最大', stats.maxNeighborH, 'm');
console.log('阴影相邻差      中位', stats.shadeGradMedian, '/255   P99', stats.shadeGradP99, '/255');
console.log('→ 已导出 layer-height / layer-color / layer-shade');

await browser.close();
server.close();
