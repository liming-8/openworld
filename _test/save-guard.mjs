/**
 * 存档保护验证：点「开始新旅程」到底会不会把旧档弄丢。
 *
 * 背景：全作只有**一个**存档槽 `aether-wilds-save-v1`，而自动存档
 * （每 25 秒 / 暂停 / 关闭页面）会无条件覆盖它。所以"开始新旅程"并不是
 * "删除"旧档 —— 旧档是几秒内被新进度静默写没的。改之前连一句确认都没有。
 *
 * 本脚本验证：
 *   1) 有存档时点「开始新旅程」→ 弹确认框，且**点下去当场不写 localStorage**
 *   2) 「取消」→ 回主菜单，存档一字未动，「继续旅程」照常能进
 *   3) 「覆盖并开始」→ 旧档先复制到 .bak，新档是干净的
 *   4) 主菜单出现「恢复上一份存档」，点了能把进度捞回来
 *   5) ⚠️ 回归位：从暂停菜单返回主菜单再开新档，进度必须真的归零
 *      —— 旧版 `startGame(false)` 没清 state / 集合 / 群系列表，
 *      会把旧进度原封不动带进"新档"，再被当成新档写回存档。
 *
 * ⚠️ 本脚本自带临时静态服务（随机空闲端口），随进程创建、随进程退出。
 */
import { chromium } from 'file:///C:/Users/32286/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/32286/WorkBuddy/2026-10-10-12-59-02/openworld';
const EXE = 'C:/Users/32286/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const SAVE = 'aether-wilds-save-v1';
const BAK = 'aether-wilds-save-v1.bak';
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

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

const visible = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden');
}, sel);
const rawSave = () => page.evaluate((k) => localStorage.getItem(k), SAVE);
const rawBak = () => page.evaluate((k) => localStorage.getItem(k), BAK);
const menuOpen = () => page.evaluate(() => {
  const open = [...document.querySelectorAll('.overlay.menu')]
    .filter((e) => !e.classList.contains('hidden')).map((e) => e.id);
  return open;
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'),
  { timeout: 120000, polling: 400 });

/* ---------------- 1) 全新开局不应弹确认框 ---------------- */
console.log('\n=== 1) 没有存档时：直接开始，不打扰 ===');
check((await rawSave()) === null, '开局前 localStorage 里没有存档');
await page.click('#btn-new');
await page.waitForTimeout(2600);
check(!(await visible('#menu-confirm')), '无存档时点「开始新旅程」不弹确认框');
check(await page.evaluate(() => window.__game.state.started), '直接进入游戏');

/* ---------------- 2) 造一份"有内容"的存档 ---------------- */
console.log('\n=== 2) 造一份有内容的存档 ===');
// 直接改内存 + writeSave，比真去跑图开箱快得多，也不依赖具体玩法逻辑；
// 这里要验的是"覆盖 / 备份"这一层，不是宝箱结算。
await page.evaluate(() => {
  const g = window.__game;
  g.state.level = 7; g.state.orbs = 13; g.state.chests = 5; g.state.ways = 2;
  g.state.gems = 111; g.state.mora = 222; g.state.distance = 3333;
  g.state.playtime = 3600;
  g.collectedSet.add('chest:0:0:0');
  g.unlockedSet.add('way:0:0:0');
  // ⚠️ 特意挑一个**不是出生点群系**的群系：出生点在低语林地，
  //    而"路过一个群系就登记一次"本来就会把出生地写进去，
  //    拿低语林地当探针根本分不清"清干净了"和"旧的带过来了"。
  g.ui.regions.add('烫金流沙');
  g.writeSave();
});
const before = JSON.parse(await rawSave());
check(before.level === 7 && before.gems === 111 && before.mora === 222,
  '存档已写入内容', `Lv.${before.level} 原石 ${before.gems} 摩拉 ${before.mora}`);

// 回到主菜单（quitToMenu 会 writeSave + 刷新主菜单）
await page.evaluate(() => window.__game.quitToMenu());
await page.waitForTimeout(500);
check((await visible('#menu-start')), '已回到主菜单');
check((await page.textContent('#save-info')).includes('Lv.7'), '主菜单底部显示的是这份存档');

/* ---------------- 3) 点「开始新旅程」必须弹确认框，且不立刻动存档 ---------------- */
console.log('\n=== 3) 有存档时点「开始新旅程」 ===');
await page.click('#btn-new');
await page.waitForTimeout(400);
check(await visible('#menu-confirm'), '弹出覆盖确认框');
const ctext = await page.textContent('#confirm-text');
check(ctext.includes('111') && ctext.includes('222') && ctext.includes('3333'),
  '确认框把即将丢失的数字列了出来', ctext.replace(/\s+/g, ' ').slice(0, 58) + '…');
check(ctext.includes('一个存档槽') || ctext.includes('覆盖'), '确认框说明了"只有一个存档槽、会被覆盖"');
check(JSON.parse(await rawSave()).gems === 111, '★ 点下去当场并没有覆盖存档（还没确认）');
check((await rawBak()) === null, '此时也还没有产生备份');
// 截图前等卡片淡入动画跑完：headless + SwiftShader 是软件光栅化，帧很长，
// 固定 400ms 往往截到 cardIn 动画中间态，画面糊成一片半透明，看不出 UI 对不对。
await page.waitForFunction(() => {
  const c = document.querySelector('#menu-confirm .menu-card');
  return c && getComputedStyle(c).opacity === '1';
}, { timeout: 5000 });
await page.screenshot({ path: path.join(OUT, 'save-confirm.png') });
console.log('  （已存确认框截图 _test/verify/save-confirm.png）');

/* ---------------- 4) 取消 ---------------- */
console.log('\n=== 4) 点「取消」 ===');
await page.click('#btn-confirm-no');
await page.waitForTimeout(400);
check(await visible('#menu-start'), '回到主菜单');
check(!(await visible('#menu-confirm')), '确认框已收起');
const afterCancel = JSON.parse(await rawSave());
check(afterCancel.gems === 111 && afterCancel.level === 7 && afterCancel.distance === 3333,
  '★ 取消后存档一字未动', `Lv.${afterCancel.level} 原石 ${afterCancel.gems} 已探索 ${afterCancel.distance}m`);

/* ---------------- 5) Esc 也能取消 ---------------- */
console.log('\n=== 5) Esc 关掉确认框 ===');
await page.click('#btn-new');
await page.waitForTimeout(300);
check(await visible('#menu-confirm'), '确认框再次弹出');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check(!(await visible('#menu-confirm')), 'Esc 可以关掉确认框');
check(await visible('#menu-start'), '并且回到主菜单');

/* ---------------- 6) 确认覆盖：旧档进备份，新档干净 ---------------- */
console.log('\n=== 6) 点「覆盖并开始新旅程」 ===');
await page.click('#btn-new');
await page.waitForTimeout(300);
await page.click('#btn-confirm-yes');
await page.waitForTimeout(2600);
check(await page.evaluate(() => window.__game.state.started), '进入游戏');
const bak = JSON.parse(await rawBak());
check(bak && bak.gems === 111 && bak.level === 7 && bak.distance === 3333,
  '★ 旧档被完整备份到 .bak', bak ? `Lv.${bak.level} 原石 ${bak.gems} 已探索 ${bak.distance}m` : '无备份');
const fresh = await page.evaluate(() => {
  const g = window.__game;
  return {
    level: g.state.level, gems: g.state.gems, mora: g.state.mora, orbs: g.state.orbs,
    distance: g.state.distance, playtime: g.state.playtime,
    collected: g.collectedSet.size, unlocked: g.unlockedSet.size,
    regions: [...g.ui.regions],
  };
});
check(fresh.level === 1 && fresh.gems === 0 && fresh.mora === 0 && fresh.distance === 0,
  '★ 新档数值全部归零', JSON.stringify(fresh));
check(fresh.collected === 0 && fresh.unlocked === 0,
  '★ 已收集 / 已点亮锚点的集合清零（旧版会带过来）', JSON.stringify(fresh));
// 出生点所在的群系会被重新登记，所以这里要测的是"旧的没跟过来"
check(!fresh.regions.includes('烫金流沙'),
  '★ 旧存档的群系列表没有跟到新档（旧的会带过来）', `regions=${JSON.stringify(fresh.regions)}`);
await page.evaluate(() => window.__game.writeSave());
const freshSaved = JSON.parse(await rawSave());
check(freshSaved.gems === 0 && freshSaved.level === 1, '新档写回 localStorage 的也是干净数据');

/* ---------------- 7) 恢复备份 ---------------- */
console.log('\n=== 7) 用「恢复上一份存档」把进度捞回来 ===');
await page.evaluate(() => window.__game.quitToMenu());
await page.waitForTimeout(500);
check(await visible('#btn-restore'), '主菜单出现「恢复上一份存档」');
const rlabel = await page.textContent('#btn-restore');
check(rlabel.includes('Lv.7') && rlabel.includes('13') && rlabel.includes('60 分钟'),
  '按钮上写明了备份档的进度（等级 / 风之瞳 / 游玩时长）', rlabel.replace(/\s+/g, ' '));

await page.click('#btn-restore');
await page.waitForTimeout(2600);
const restored = await page.evaluate(() => {
  const g = window.__game;
  return { level: g.state.level, gems: g.state.gems, mora: g.state.mora, distance: g.state.distance };
});
check(restored.level === 7 && restored.gems === 111 && restored.mora === 222 && restored.distance === 3333,
  '★ 进度完整恢复', JSON.stringify(restored));

/* ---------------- 8) 没备份时不显示恢复入口 ---------------- */
console.log('\n=== 8) 清掉备份后入口自动消失 ===');
await page.evaluate(() => window.__game.quitToMenu());
await page.evaluate((k) => localStorage.removeItem(k), BAK);
await page.evaluate(() => window.__game.prepareStartMenu(window.__game.readSave()));
await page.waitForTimeout(300);
check(!(await visible('#btn-restore')), '没有备份档时不显示「恢复上一份存档」');

/* ---------------- 9) 确认框是独占的 ---------------- */
console.log('\n=== 9) 菜单互斥 ===');
await page.click('#btn-new');
await page.waitForTimeout(300);
const open = await menuOpen();
check(open.length === 1 && open[0] === 'menu-confirm',
  '确认框弹出时主菜单已收起（不会两块面板叠在一起）', JSON.stringify(open));

console.log('\n=== 运行时报错 (' + errors.length + ') ===');
if (errors.length) console.log('  ' + errors.slice(0, 6).join('\n  '));
console.log(fails === 0 ? '\n全部通过 ✅' : `\n${fails} 项失败 ❌`);

await browser.close();
server.close();
process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
