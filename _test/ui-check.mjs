/**
 * 三项 UI 反馈的验证：
 *   1) 地图上要能看到传送锚点（含未激活的）
 *   2) 原石 / 摩拉 要有累计计数并显示在 HUD 上
 *   3) 地图图例的形状要和 canvas 里实际画的形状一致
 *
 * ⚠️ 本脚本自带一个临时静态服务（监听 127.0.0.1 的随机空闲端口），
 *    随进程创建、随进程退出，不会留下任何后台进程。
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

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 120000, polling: 400 });
await page.click('#btn-new');
await page.waitForTimeout(2600);

/** 找第一个指定类型、且未完成/未激活的地标 */
const findEntity = (type) => page.evaluate((type) => {
  const g = window.__game;
  for (const list of g.world.entities.values()) {
    for (const d of list) {
      if (d.type !== type) continue;
      if (g.isCollected(d.id) || g.isUnlocked(d.id)) continue;
      return { id: d.id, x: d.x, y: d.y, z: d.z };
    }
  }
  return null;
}, type);

const standAt = (e, off = 0) => page.evaluate(([e, off]) => {
  const g = window.__game;
  const x = e.x + off, z = e.z + off;
  g.player.position.set(x, g.terrain.meshHeight(x, z), z);
  g.player.velocity.set(0, 0, 0);
}, [e, off]);

/* ================= 1) 原石 / 摩拉 ================= */
console.log('\n=== 1) 原石 / 摩拉的累计与显示 ===');

const before = await page.evaluate(() => {
  const g = window.__game;
  return {
    gems: g.state.gems, mora: g.state.mora,
    hudGem: document.getElementById('q-gem')?.textContent,
    hudMora: document.getElementById('q-mora')?.textContent,
  };
});
check(before.gems === 0 && before.mora === 0, '初始原石/摩拉为 0', JSON.stringify({ gems: before.gems, mora: before.mora }));
check(before.hudGem === '0' && before.hudMora === '0', 'HUD 上有原石/摩拉两个常驻条目', `原石 "${before.hudGem}" 摩拉 "${before.hudMora}"`);

const chest1 = await findEntity('chest');
check(!!chest1, '在已加载区域里找到宝箱', chest1 ? `@ ${chest1.x.toFixed(0)},${chest1.z.toFixed(0)}` : '没找到');

let firstGain = null;
if (chest1) {
  await standAt(chest1);
  await page.waitForTimeout(900);
  firstGain = await page.evaluate(() => {
    const g = window.__game;
    g.tryInteract();
    return { gems: g.state.gems, mora: g.state.mora, chests: g.state.chests };
  });
  await page.waitForTimeout(700);
  const hud = await page.evaluate(() => ({
    gem: document.getElementById('q-gem').textContent,
    mora: document.getElementById('q-mora').textContent,
  }));
  check(firstGain.gems > 0 && firstGain.mora > 0, '开箱后原石/摩拉累加进 state', `原石 ${firstGain.gems} 摩拉 ${firstGain.mora}`);
  check(hud.gem === String(firstGain.gems) && hud.mora === String(firstGain.mora),
    'HUD 数字实时同步', `HUD 原石 ${hud.gem} / 摩拉 ${hud.mora}`);

  const chest2 = await findEntity('chest');
  if (chest2) {
    await standAt(chest2);
    await page.waitForTimeout(800);
    const second = await page.evaluate(() => {
      const g = window.__game;
      g.tryInteract();
      return { gems: g.state.gems, mora: g.state.mora };
    });
    check(second.gems > firstGain.gems && second.mora > firstGain.mora,
      '开第二个箱子是累加而不是覆盖', `原石 ${firstGain.gems} → ${second.gems}，摩拉 ${firstGain.mora} → ${second.mora}`);
  } else {
    console.log('  ⚠ 附近只有一个宝箱，跳过累加检查');
  }

  const saved = await page.evaluate(() => {
    const g = window.__game;
    const d = g.writeSave();
    return d ? { gems: d.gems, mora: d.mora } : null;
  });
  check(!!saved && saved.gems > 0 && saved.mora > 0, '存档写入了 gems / mora',
    saved ? `save.gems=${saved.gems} save.mora=${saved.mora}` : 'writeSave 返回 null');
  await page.screenshot({ path: `${OUT}/ui-loot.png` });
}

/* ================= 2) 传送锚点（激活前） ================= */
console.log('\n=== 2) 地图上的传送锚点 ===');

const wayInfo = await page.evaluate(() => {
  const g = window.__game;
  let loaded = 0, unlocked = 0;
  for (const list of g.world.entities.values()) {
    for (const d of list) if (d.type === 'waypoint') { loaded++; if (g.isUnlocked(d.id)) unlocked++; }
  }
  const ents = g.ui._collectEntities();
  return {
    loaded, loadedUnlocked: unlocked,
    uiWays: ents.ways.length,
    uiLocked: ents.ways.filter((o) => !o.unlocked).length,
    registry: g.waypointRegistry.size,
  };
});
console.log('  已加载锚点', wayInfo.loaded, '（其中已激活', wayInfo.loadedUnlocked, '）',
  '→ UI 收集到', wayInfo.uiWays, '（未激活', wayInfo.uiLocked, '）');
check(wayInfo.uiWays >= wayInfo.loaded, '未激活的锚点也会被收集（不再被 isUnlocked 过滤掉）',
  `UI ${wayInfo.uiWays} ≥ 已加载 ${wayInfo.loaded}`);

// 打开世界地图，先看"全是未激活"的状态
await page.evaluate(() => { window.__game.toggleMap(true); });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/ui-map-locked.png` });

const legend = await page.evaluate(() => {
  const pick = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const cs = getComputedStyle(e);
    return { clip: cs.clipPath, r: cs.borderRadius };
  };
  return {
    you: pick('.lg.you'), way: pick('.lg.way'), wayOff: pick('.lg.way-off'),
    orb: pick('.lg.orb'), chest: pick('.lg.chest'),
    hint: document.getElementById('map-hint')?.textContent,
  };
});

/**
 * 在锚点中心附近扫一个 19×19 的窗口，取"最蓝"和"最暗"的像素。
 * 不能直接取中心点 —— 玩家三角是最后画的，站在锚点上就会把它盖住。
 */
const sampleWays = () => page.evaluate(() => {
  const g = window.__game;
  const cv = document.getElementById('bigmap');
  const ctx = cv.getContext('2d');
  const ents = g.ui._collectEntities();
  const N = cv.width, span = g.ui.bmSpan;
  const ox = g.ui.bmOrigin.x, oz = g.ui.bmOrigin.z;
  const inView = (o) => {
    const mx = ((o.x - ox) / span) * N, my = ((o.z - oz) / span) * N;
    return mx > 14 && my > 14 && mx < N - 14 && my < N - 14;
  };
  const sample = (o) => {
    const mx = Math.round(((o.x - ox) / span) * N), my = Math.round(((o.z - oz) / span) * N);
    let bluest = -999, bestBlue = null, dark = 999, darkest = null;
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const d = ctx.getImageData(mx + dx, my + dy, 1, 1).data;
        const b = d[2] - d[0];
        if (b > bluest) { bluest = b; bestBlue = [d[0], d[1], d[2]]; }
        const s = d[0] + d[1] + d[2];
        if (s < dark) { dark = s; darkest = [d[0], d[1], d[2]]; }
      }
    }
    return { bluest, bestBlue, dark, darkest };
  };
  const inb = ents.ways.filter(inView);
  return {
    nLockedInView: inb.filter((o) => !o.unlocked).length,
    nUnlockedInView: inb.filter((o) => o.unlocked).length,
    locked: inb.filter((o) => !o.unlocked).map(sample),
    unlocked: inb.filter((o) => o.unlocked).map(sample),
  };
});

const s1 = await sampleWays();
console.log('  视野内：未激活', s1.nLockedInView, '个，已激活', s1.nUnlockedInView, '个');
s1.locked.slice(0, 5).forEach((s) => console.log('     未激活 → 最暗像素', JSON.stringify(s.darkest), '最蓝', JSON.stringify(s.bestBlue)));
if (s1.locked.length) {
  const darkOK = s1.locked.filter((s) => s.dark < 340).length;
  check(darkOK >= 1, '未激活锚点在地图上被画出来（暗色空心菱形，不再是"消失"）',
    `${darkOK}/${s1.locked.length} 个锚点周围存在深色像素`);
} else {
  console.log('  ⚠ 视野内没有未激活的锚点');
}

/* ================= 3) 图例形状 ================= */
console.log('\n=== 3) 图例形状与地图绘制形状是否一致 ===');
console.log('    当前位置 .lg.you     clip-path:', legend.you?.clip);
console.log('    传送锚点 .lg.way     clip-path:', legend.way?.clip);
console.log('    未激活   .lg.way-off clip-path:', legend.wayOff?.clip);
// renderBigMap 里：玩家 = 三角、锚点 = 菱形、风之瞳 = 圆、宝箱 = 方
check(!!legend.you && /polygon/.test(legend.you.clip), '「当前位置」图例是三角形（地图画的是三角）', legend.you?.clip);
check(!!legend.way && /polygon/.test(legend.way.clip), '「传送锚点」图例是菱形（地图画的是菱形）', legend.way?.clip);
check(!!legend.wayOff && /polygon/.test(legend.wayOff.clip), '「未激活锚点」图例也是菱形', legend.wayOff?.clip);
check(!!legend.orb && (legend.orb.r.includes('50%') || parseFloat(legend.orb.r) > 40), '「风之瞳」图例是圆形', legend.orb?.r);
check(!!legend.chest, '「宝箱」图例存在', legend.chest?.r);
check(!!legend.hint && /未激活/.test(legend.hint), '地图顶部提示解释了空心锚点的含义', legend.hint);

/* ================= 4) 点击未激活锚点的反馈（必须在任何 rebuild 之前做） ================= */
console.log('\n=== 4) 点击未激活锚点的提示 ===');
{
  const hint = await page.evaluate(() => {
    const g = window.__game;
    const cv = document.getElementById('bigmap');
    const N = cv.width, span = g.ui.bmSpan;
    const ox = g.ui.bmOrigin.x, oz = g.ui.bmOrigin.z;
    const target = (g.ui._wayPoints || []).find((w) => {
      if (w.unlocked) return false;
      const mx = ((w.x - ox) / span) * N, my = ((w.z - oz) / span) * N;
      return mx > 20 && my > 20 && mx < N - 20 && my < N - 20;
    });
    if (!target) return { skipped: '视野内没有未激活的锚点' };
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new MouseEvent('click', {
      clientX: r.left + (target.mx / N) * r.width,
      clientY: r.top + (target.my / N) * r.height,
      bubbles: true,
    }));
    const bar = document.getElementById('hint-bar');
    return { skipped: false, text: bar?.textContent, on: bar?.classList.contains('on') };
  });
  if (hint.skipped) console.log('  ⚠ ' + hint.skipped + '，跳过');
  else check(!!hint.on && /未激活|点亮/.test(hint.text || ''), '点击未激活锚点会提示需要先走过去点亮', `"${hint.text}"`);
}

/* ================= 5) 激活一个锚点：两种状态同框 + 持久化 ================= */
console.log('\n=== 5) 激活锚点 ===');
await page.evaluate(() => { window.__game.toggleMap(false); });
await page.waitForTimeout(600);

const wp = await findEntity('waypoint');
if (wp) {
  await standAt(wp);
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.tryInteract();
    return { ways: g.state.ways, reg: g.waypointRegistry.size, ids: [...g.waypointRegistry.keys()] };
  });
  check(r.ways >= 1 && r.reg >= 1, '激活锚点后写进持久登记表', `已激活 ${r.ways} 个，登记表 ${r.reg} 条 → ${r.ids.join(',')}`);

  // ⚠️ 这里还没调用过 world.rebuild()，所以另一枚未激活锚点仍在 entities 里。
  //    站到两者中间再开地图，就能在一张图上同时看到"蓝色实心"和"暗色空心"。
  const placed = await page.evaluate(() => {
    const g = window.__game;
    const uw = [...g.waypointRegistry.values()][0];
    let locked = null, bd = 1e9;
    for (const list of g.world.entities.values()) {
      for (const d of list) {
        if (d.type !== 'waypoint' || g.isUnlocked(d.id)) continue;
        const dd = Math.hypot(d.x - uw.x, d.z - uw.z);
        if (dd < bd) { bd = dd; locked = d; }
      }
    }
    const mid = locked
      ? { x: (uw.x + locked.x) / 2 + 30, z: (uw.z + locked.z) / 2 + 30 }
      : { x: uw.x + 60, z: uw.z + 60 };
    g.player.position.set(mid.x, g.terrain.meshHeight(mid.x, mid.z), mid.z);
    g.player.velocity.set(0, 0, 0);
    return { hasLocked: !!locked, dist: locked ? +bd.toFixed(0) : null };
  });
  console.log('  站位：' + (placed.hasLocked ? `两枚锚点相距 ${placed.dist} m，站在中间` : '附近没有未激活锚点'));
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.__game.toggleMap(true); });
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${OUT}/ui-map.png` });

  const s2 = await sampleWays();
  console.log('  视野内：未激活', s2.nLockedInView, '个，已激活', s2.nUnlockedInView, '个');
  s2.unlocked.slice(0, 5).forEach((s) => console.log('     已激活 → 最蓝像素', JSON.stringify(s.bestBlue), '(b−r =', s.bluest + ')'));
  if (s2.unlocked.length) {
    const blueOK = s2.unlocked.filter((s) => s.bluest > 30).length;
    check(blueOK >= 1, '已激活锚点画成了蓝色实心菱形', `${blueOK}/${s2.unlocked.length} 个锚点周围有显著蓝色像素`);
  } else {
    console.log('  ⚠ 已激活锚点不在当前视野内');
  }
  if (s2.locked.length) {
    const darkOK2 = s2.locked.filter((s) => s.dark < 340).length;
    check(darkOK2 >= 1, '同一张地图上未激活锚点仍是暗色（两种状态可区分）', `${darkOK2}/${s2.locked.length}`);
  } else {
    console.log('  ⚠ 未激活锚点不在当前视野内');
  }
} else {
  console.log('  ⚠ 当前已加载区域里没有未激活的锚点，跳过激活检查');
}

/* ================= 6) 持久化：区域卸载 / 存档往返 ================= */
console.log('\n=== 6) 锚点与资源的持久化 ===');
if (wp) {
  // 模拟"跑远导致区域卸载"：清空 entities 后地图数据里仍应保留已激活锚点
  const far = await page.evaluate(() => {
    const g = window.__game;
    const saved = new Map(g.world.entities);
    g.world.entities.clear();
    const ents = g.ui._collectEntities();
    const hit = ents.ways.filter((o) => o.far);
    g.world.entities = saved;
    return { total: ents.ways.length, farCount: hit.length, ids: hit.map((o) => o.id) };
  });
  check(far.farCount >= 1, '区域卸载后，已激活的锚点依然出现在地图数据里',
    `远处锚点 ${far.farCount} 个：${far.ids.join(',')}`);

  const sv = await page.evaluate(() => {
    const g = window.__game;
    const d = g.writeSave();
    return d ? { n: (d.waypoints || []).length, sample: (d.waypoints || [])[0] } : null;
  });
  check(!!sv && sv.n >= 1, '存档写入了 waypoints 坐标', sv ? `${sv.n} 条，例：${JSON.stringify(sv.sample)}` : 'writeSave 返回 null');

  // 存档 → 读档 往返
  const round = await page.evaluate(() => {
    const g = window.__game;
    const d = g.writeSave();
    const gems = g.state.gems, mora = g.state.mora, ways = g.state.ways;
    g.applySave(d);
    return { gems, mora, ways, afterGems: g.state.gems, afterMora: g.state.mora, afterWays: g.state.ways, reg: g.waypointRegistry.size };
  });
  check(round.afterGems === round.gems && round.afterMora === round.mora && round.afterWays === round.ways,
    '读档后原石/摩拉/锚点数量一致',
    `原石 ${round.gems}→${round.afterGems}，摩拉 ${round.mora}→${round.afterMora}，锚点 ${round.ways}→${round.afterWays}`);
  check(round.reg >= 1, '读档后锚点坐标登记表恢复', `${round.reg} 条`);

  // 老存档（没有 waypoints 字段）也要能反推出坐标
  const legacy = await page.evaluate(() => {
    const g = window.__game;
    const d = g.writeSave();
    delete d.waypoints;                       // 模拟老版本存档
    g.applySave(d);
    return { reg: g.waypointRegistry.size, ids: [...g.waypointRegistry.keys()] };
  });
  check(legacy.reg >= 1, '老存档（无 waypoints 字段）也能从 id 反推出锚点坐标',
    `${legacy.reg} 条：${legacy.ids.join(',')}`);
} else {
  console.log('  ⚠ 没有激活过锚点，跳过持久化检查');
}

console.log('\n=== 运行时报错 (' + errors.length + ') ===');
errors.slice(0, 10).forEach((e) => console.log(' ', e));
if (errors.length) fails++;

console.log('\n' + (fails === 0 ? '全部通过 ✅' : `有 ${fails} 项未通过 ❌`));

await browser.close();
server.close();
