/* ============================================================
 *  ui.js — HUD / 小地图 / 世界地图 / 菜单 / 提示
 * ============================================================ */
import { clamp } from './noise.js';
import { SEA_LEVEL, BIOMES } from './terrain.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.$ = (id) => document.getElementById(id);

    this.el = {
      hud: this.$('hud'),
      barHp: this.$('bar-hp'), hpText: this.$('hp-text'),
      barSp: this.$('bar-sp'), spText: this.$('sp-text'),
      barXp: this.$('bar-xp'), xpText: this.$('xp-text'),
      lvText: this.$('lv-text'),
      biome: this.$('biome-name'), clock: this.$('clock'), coord: this.$('coord'),
      mapZoom: this.$('map-zoom'),
      qOrb: this.$('q-orb'), qChest: this.$('q-chest'), qWay: this.$('q-way'), qDist: this.$('q-dist'),
      qGem: this.$('q-gem'), qMora: this.$('q-mora'),
      regionList: this.$('region-list'),
      interact: this.$('interact'), interactText: this.$('interact-text'),
      stateTag: this.$('state-tag'),
      toasts: this.$('toasts'),
      hintBar: this.$('hint-bar'),
      minimap: this.$('minimap'),
      bigmap: this.$('bigmap'),
      loading: this.$('loading'), loadFill: this.$('load-fill'), loadText: this.$('load-text'),
      menuStart: this.$('menu-start'), menuPause: this.$('menu-pause'),
      menuSettings: this.$('menu-settings'), menuHelp: this.$('menu-help'),
      menuMap: this.$('menu-map'), menuConfirm: this.$('menu-confirm'),
      saveInfo: this.$('save-info'),
      confirmText: this.$('confirm-text'),
      touch: this.$('touch-controls'),
      compass: this.$('compass'),
      crosshair: this.$('crosshair'),
    };

    this.mmCtx = this.el.minimap.getContext('2d');
    this.bmCtx = this.el.bigmap.getContext('2d');

    // 小地图中间缓冲
    this.mmSize = 220;
    this.mmSamples = 44;
    this.mmSpan = 300;            // 世界跨度（米）
    this.zoomLevels = [210, 320, 480];
    this.zoomIndex = 1;
    this.mmBuffer = document.createElement('canvas');
    this.mmBuffer.width = this.mmBuffer.height = this.mmSamples;
    this.mmBufferCtx = this.mmBuffer.getContext('2d');
    this.mmImage = this.mmBufferCtx.createImageData(this.mmSamples, this.mmSamples);
    this.mmHeights = new Float32Array(this.mmSamples * this.mmSamples);
    this.mmDirtyAt = new THREE_V3();
    this.mmTimer = 99;

    this.bmSamples = 512;         // 世界地图的地形采样分辨率（128 太糊，见 README 第十三节）
    this.bmSpan = 2200;
    this.bmBuffer = document.createElement('canvas');
    this.bmBuffer.width = this.bmBuffer.height = this.bmSamples;
    this.bmBufferCtx = this.bmBuffer.getContext('2d');
    this.bmImage = this.bmBufferCtx.createImageData(this.bmSamples, this.bmSamples);
    this.bmHeights = new Float32Array(this.bmSamples * this.bmSamples);
    this.bmDirtyAt = new THREE_V3();
    this.bmOrigin = { x: 0, z: 0 };
    this.bmRect = { x: 0, y: 0, w: 0, h: 0 };

    this._toastQueue = [];
    this._hintTimer = 0;
    this._lastUpdate = 0;
    this.hudVisible = true;
    this.regions = new Set();

    this._bindMapClick();
    this._bindSettings();
  }

  /**
   * 改世界地图的地形采样分辨率（16…1024）。
   * 之所以留一个 setter 而不是直接改 bmSamples，是因为所有相关缓冲
   * （buffer / imageData / heights）都得跟着一起重建，
   * 顺手也给 A/B 对比测量提供了入口，见 _test/bench-map.mjs。
   */
  setResolution(n) {
    const v = Math.max(16, Math.min(1024, Math.round(n)));
    if (v === this.bmSamples) return v;
    this.bmSamples = v;
    this.bmBuffer.width = this.bmBuffer.height = v;
    this.bmImage = this.bmBufferCtx.createImageData(v, v);
    this.bmHeights = new Float32Array(v * v);
    return v;
  }

  /* ==================== 加载页 ==================== */
  setLoading(p, text) {
    this.el.loadFill.style.width = `${clamp(p * 100, 0, 100)}%`;
    if (text) this.el.loadText.textContent = text;
  }
  hideLoading() {
    this.el.loading.classList.add('hidden');
  }

  /* ==================== 菜单显隐 ==================== */
  showMenu(name) {
    const map = {
      start: this.el.menuStart, pause: this.el.menuPause,
      settings: this.el.menuSettings, help: this.el.menuHelp, map: this.el.menuMap,
      confirm: this.el.menuConfirm,
    };
    for (const [k, el] of Object.entries(map)) {
      if (!el) continue;
      el.classList.toggle('hidden', k !== name || !name);
    }
    if (!name) for (const el of Object.values(map)) el && el.classList.add('hidden');
  }
  setHUD(show) {
    this.hudVisible = show;
    this.el.hud.classList.toggle('hidden', !show);
  }
  toggleHUD() { this.setHUD(!this.hudVisible); }

  /* ==================== 提示 ==================== */
  toast(html, kind = '', dur = 2600) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.innerHTML = html;
    this.el.toasts.appendChild(d);
    setTimeout(() => {
      d.classList.add('out');
      setTimeout(() => d.remove(), 400);
    }, dur);
    // 最多保留 5 条
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
  }

  hint(text, dur = 2200) {
    this.el.hintBar.textContent = text;
    this.el.hintBar.classList.add('on');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.el.hintBar.classList.remove('on'), dur);
  }

  showInteract(text) {
    if (text) {
      this.el.interactText.textContent = text;
      this.el.interact.classList.remove('hidden');
    } else {
      this.el.interact.classList.add('hidden');
    }
  }

  /* ==================== 每帧更新 ==================== */
  update(dt) {
    const g = this.game;
    const p = g.player;
    const st = g.state;

    // 条
    const hpP = clamp(p.health / 100, 0, 1);
    this.el.barHp.style.width = `${hpP * 100}%`;
    this.el.hpText.textContent = `${Math.round(p.health)} / 100`;

    const spMax = st.staminaMax;
    const spP = clamp(p.stamina / spMax, 0, 1);
    this.el.barSp.style.width = `${spP * 100}%`;
    this.el.spText.textContent = `${Math.max(0, Math.round(p.stamina))} / ${spMax}`;
    this.el.barSp.style.filter = p.stamina < 3 ? 'saturate(.4) brightness(.9)' : 'none';

    const xpNeed = st.xpNeed;
    this.el.barXp.style.width = `${clamp(st.xp / xpNeed, 0, 1) * 100}%`;
    this.el.xpText.textContent = `${st.xp} / ${xpNeed}`;
    this.el.lvText.textContent = `Lv.${st.level}`;

    // 坐标 / 时间 / 群系
    const pos = p.position;
    this.el.coord.textContent = `X ${pos.x.toFixed(0)}　Y ${pos.y.toFixed(0)}　Z ${pos.z.toFixed(0)}`;
    this.el.clock.textContent = g.sky.clockText;

    const biome = g.terrain.biome(pos.x, pos.z);
    this.el.biome.textContent = biome.name;
    if (!this.regions.has(biome.id)) {
      this.regions.add(biome.id);
      this._renderRegions();
      if (g.started) {
        this.toast(`发现新区域 · <b>${biome.name}</b>`, 'gold');
        g.audio.play('levelup');
      }
    }

    // 目标
    this.el.qOrb.textContent = st.orbs;
    this.el.qChest.textContent = st.chests;
    this.el.qWay.textContent = st.ways;
    // 开宝箱得到的原石 / 摩拉（常驻显示，开箱后实时累加）
    if (this.el.qGem) this.el.qGem.textContent = formatNum(st.gems || 0);
    if (this.el.qMora) this.el.qMora.textContent = formatNum(st.mora || 0);
    this.el.qDist.textContent = st.distance > 1000
      ? `${(st.distance / 1000).toFixed(2)} km`
      : `${st.distance.toFixed(0)} m`;

    // 状态标签
    const tagMap = {
      idle: '', run: '', sprint: '冲刺', jump: '跃起', fall: '下落',
      glide: '滑翔中', swim: '游泳中', slide: '坡面滑落',
    };
    const tag = tagMap[p.state] || '';
    this.el.stateTag.textContent = p.stamina < 3 && !p.grounded ? '体力耗尽' : tag;
    this.el.stateTag.classList.toggle('on', !!this.el.stateTag.textContent);

    // 稳定节流更新地图
    this._mapTimer = (this._mapTimer || 0) + dt;
    if (this._mapTimer > 0.07) {
      this.mmTimer += this._mapTimer;
      this._mapTimer = 0;
      this.renderMinimap();
    }
    if (g.mapOpen) {
      // 地图打开时世界是暂停的，地形与标记都不会变化，无需重复绘制
      // （仅在玩家移动较远后重新打开时由 renderBigMap 重新采样）
    }
  }

  _renderRegions() {
    this.el.regionList.innerHTML = [...this.regions]
      .map((id) => `<span>${(BIOMES[id] || { name: id }).name}</span>`).join('');
  }

  /* ==================== 小地图 ==================== */
  cycleZoom() {
    this.zoomIndex = (this.zoomIndex + 1) % this.zoomLevels.length;
    this.mmSpan = this.zoomLevels[this.zoomIndex];
    this.el.mapZoom.textContent = `缩放 ${this.zoomIndex + 1}×`;
    this.mmDirtyAt.set(1e9, 0, 0);
    this.renderMinimap(true);
  }

  renderMinimap(force = false) {
    const g = this.game;
    const p = g.player;
    const px = p.position.x, pz = p.position.z;
    const N = this.mmSamples;
    const span = this.mmSpan;

    // 地形底色：基于移动距离 + 时间节流，避免每帧重算高度场
    const moved = Math.hypot(px - this.mmDirtyAt.x, pz - this.mmDirtyAt.z);
    if (force || moved > 5 || this.mmTimer > 0.42) {
      this.mmDirtyAt.set(px, 0, pz);
      this.mmTimer = 0;
      const d = this.mmImage.data;
      const hs = this.mmHeights;
      const half = span / 2;
      const step = span / (N - 1);
      const terrain = g.terrain;
      // 先采样高度（每像素仅 1 次噪声求值）
      let i = 0;
      for (let j = 0; j < N; j++) {
        const wz = pz - half + j * step;
        for (let k = 0; k < N; k++) {
          hs[i++] = terrain.height(px - half + k * step, wz);
        }
      }
      // 着色：坡度阴影用相邻高度差估算（不再重复采样噪声）
      i = 0;
      for (let j = 0; j < N; j++) {
        const wz = pz - half + j * step;
        for (let k = 0; k < N; k++) {
          const h = hs[i];
          const wx = px - half + k * step;
          let r, gg, b;
          if (h < SEA_LEVEL) {
            const t = clamp(-h / 12, 0, 1);
            r = 62 - t * 34; gg = 134 - t * 62; b = 168 - t * 60;
          } else {
            const c = terrain.surfaceColor(wx, wz, h, 0.25, _rgb);
            r = c[0] * 255; gg = c[1] * 255; b = c[2] * 255;
          }
          const hR = k < N - 1 ? hs[i + 1] : h;
          const hD = j < N - 1 ? hs[i + N] : h;
          const shade = clamp(1 + (h - hR) * 0.05 + (h - hD) * 0.03, 0.7, 1.3);
          d[i * 4] = clamp(r * shade, 0, 255);
          d[i * 4 + 1] = clamp(gg * shade, 0, 255);
          d[i * 4 + 2] = clamp(b * shade, 0, 255);
          d[i * 4 + 3] = 255;
          i++;
        }
      }
      this.mmBufferCtx.putImageData(this.mmImage, 0, 0);
    }

    const ctx = this.mmCtx;
    const S = this.mmSize;
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mmBuffer, 0, 0, S, S);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const q = (S / 4) * i;
      ctx.beginPath(); ctx.moveTo(q, 0); ctx.lineTo(q, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, q); ctx.lineTo(S, q); ctx.stroke();
    }

    const toMap = (wx, wz) => [
      S / 2 + ((wx - px) / span) * S,
      S / 2 + ((wz - pz) / span) * S,
    ];

    // 地标
    const drawMarkers = (list, color, shape, hollow = false) => {
      for (const o of list) {
        const [mx, my] = toMap(o.x, o.z);
        if (mx < -8 || my < -8 || mx > S + 8 || my > S + 8) continue;
        ctx.beginPath();
        if (shape === 'circle') ctx.arc(mx, my, 3.4, 0, Math.PI * 2);
        else if (shape === 'diamond') {
          ctx.moveTo(mx, my - 4); ctx.lineTo(mx + 4, my);
          ctx.lineTo(mx, my + 4); ctx.lineTo(mx - 4, my); ctx.closePath();
        } else ctx.rect(mx - 3, my - 3, 6, 6);
        if (hollow) {
          ctx.fillStyle = 'rgba(20,26,32,.55)';   // 未激活：深底 + 浅色描边
          ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    };

    const ents = this._collectEntities();
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,.9)';
    drawMarkers(ents.orbs.filter((o) => !o.done), '#16a99b', 'circle');
    drawMarkers(ents.chests.filter((o) => !o.done), '#d9862b', 'square');
    // 未激活的锚点也要画出来（暗色空心），否则玩家会以为地图上没有传送点
    drawMarkers(ents.ways.filter((o) => !o.unlocked), '#9fb3c2', 'diamond', true);
    drawMarkers(ents.ways.filter((o) => o.unlocked), '#3f8fd0', 'diamond');

    // 视野锥
    // 注意：cameraRig.yaw 描述的是"角色 → 相机"的方向，
    // 镜头真正的朝向是它的反方向（和移动方向同一个坑）
    ctx.save();
    ctx.translate(S / 2, S / 2);
    const f = g.cameraRig.yaw;
    const dirx = -Math.sin(f), dirz = -Math.cos(f);
    const a = Math.atan2(dirz, dirx);
    // 供自动化测试比对"画出来的方向"与"相机真实朝向"
    this.viewDirX = dirx; this.viewDirZ = dirz;
    const grad = ctx.createLinearGradient(0, 0, dirx * 34, dirz * 34);
    grad.addColorStop(0, 'rgba(255,255,255,.42)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 36, a - 0.55, a + 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 玩家箭头（世界方向 → 画布方向：x→x, z→y）
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.fillStyle = '#e2493c';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(fx * 8, fz * 8);
    ctx.lineTo(-fz * 5.5 - fx * 4, fx * 5.5 - fz * 4);
    ctx.lineTo(fz * 5.5 - fx * 4, -fx * 5.5 - fz * 4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // 边框
    ctx.strokeStyle = 'rgba(32,68,84,.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }

  /**
   * 收集当前已加载区域内的地标。
   *
   * ⚠️ 传送锚点必须**全部**返回，不能只返回已激活的。
   * 锚点生成很稀疏（每个区域 5.5% 的概率），玩家还没激活任何一个时，
   * 如果这里按 isUnlocked 过滤，地图上就一个锚点都不显示 ——
   * 玩家会以为"这游戏没有传送点"。未激活的锚点要画成暗色，让玩家知道
   * 那里有东西、需要跑过去点亮，而不是让它凭空消失。
   */
  _collectEntities() {
    const orbs = [], chests = [], ways = [];
    const seenWay = new Set();
    for (const list of this.game.world.entities.values()) {
      for (const d of list) {
        const done = this.game.isCollected(d.id);
        if (d.type === 'orb') orbs.push({ x: d.x, z: d.z, done, id: d.id, y: d.y });
        else if (d.type === 'chest') chests.push({ x: d.x, z: d.z, done, id: d.id, y: d.y });
        else if (d.type === 'waypoint') {
          seenWay.add(d.id);
          ways.push({ x: d.x, z: d.z, id: d.id, y: d.y, unlocked: this.game.isUnlocked(d.id) });
        }
      }
    }
    // 已激活的锚点要**永久保留**在地图上：区域流式卸载后 entities 里就没有它了，
    // 但玩家明明点亮过、也指望能从地图上传送过去。所以再合并一份持久登记表。
    const reg = this.game.waypointRegistry;
    if (reg) {
      for (const [id, w] of reg) {
        if (seenWay.has(id)) continue;
        // 视野外的锚点没有高度信息，用 0 占位（地图只用到 x/z）
        ways.push({ x: w.x, z: w.z, id, y: w.y || 0, unlocked: true, far: true });
      }
    }
    // 已激活的排在前面（小地图上不会被未激活的盖住）
    ways.sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0));
    return { orbs, chests, ways };
  }

  /* ==================== 世界地图 ==================== */

  /**
   * 按**显示尺寸 × 屏幕像素比**来定 canvas 的内部分辨率。
   *
   * 以前 canvas 固定 1024、CSS 宽度却由 `min(66vh,600px)` 决定，
   * 两者没关系：窗口一小就浪费像素、窗口一大就发虚。
   * 现在每次都重算，`U = canvas 宽 ÷ CSS 宽` 正好等于 DPR，
   * 于是所有绘制尺寸都能直接用"CSS 像素"写，见 renderBigMap。
   */
  _sizeBigmap() {
    const el = this.el.bigmap;
    const r = el.getBoundingClientRect();
    const cssW = r.width > 10 ? r.width : 560;      // 刚 show 出来量不到宽度时的兜底
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const target = Math.max(512, Math.min(1600, Math.round(cssW * dpr)));
    if (el.width !== target) { el.width = target; el.height = target; }
    return target;
  }

  /**
   * 打开地图时先画一个轻量占位，让面板尽快上屏。
   *
   * 512 分辨率采样一次要 ~400 ms（纯 JS 噪声求值，GPU 帮不上忙），
   * 如果直接在点击回调里同步跑，玩家会感觉"按了 M 卡住半秒才弹出来"。
   * 所以先占位、下一帧再生成真正的地图，见 Game.toggleMap。
   */
  placeholderBigMap() {
    const ctx = this.bmCtx;
    const S = this._sizeBigmap();
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0e141b';
    ctx.fillRect(0, 0, S, S);
    const U = S / (this.el.bigmap.getBoundingClientRect().width || S);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = `600 ${Math.round(13 * U)}px ` + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    ctx.fillText('正在生成地图…', S / 2, S / 2);
    ctx.textAlign = 'start';
  }

  renderBigMap() {
    const g = this.game;
    const p = g.player;
    const N = this.bmSamples;
    const span = this.bmSpan;
    const ox = p.position.x - span / 2;
    const oz = p.position.z - span / 2;
    this.bmOrigin = { x: ox, z: oz };
    this.bmDirtyAt.set(p.position.x, 0, p.position.z);

    const terrain = g.terrain;
    const hs = this.bmHeights;
    const step = span / (N - 1);

    // 高度采样（每像素 1 次噪声求值）
    let i = 0;
    for (let j = 0; j < N; j++) {
      const wz = oz + j * step;
      for (let k = 0; k < N; k++) hs[i++] = terrain.height(ox + k * step, wz);
    }

    // 山体阴影的求坡基线必须**按世界距离固定**，不能是"相邻一个像素"。
    //
    // 地形是分形的：采样越密，相邻像素的高差虽然变小，但换算成坡度反而更陡，
    // 于是同一套系数在 512 分辨率下会把细节噪声放大成满屏"砂纸"（实测相邻
    // 像素阴影差的中位数占到整个值域的 20%）。这里固定用约 17.3 米的间隔求坡，
    // 等于沿用 128 分辨率时代的观感，而海岸线 / 地表配色仍然享受 512 的细节。
    const kShade = Math.max(1, Math.round(17.3 / step));
    // 实际求坡跨度就是 kShade*step 米，系数按它归一到"17.3 米基准"下的 0.045 / 0.03
    const gx = 0.045 * 17.3 / (kShade * step);
    const gz = 0.03 * 17.3 / (kShade * step);

    const d = this.bmImage.data;
    i = 0;
    for (let j = 0; j < N; j++) {
      const wz = oz + j * step;
      for (let k = 0; k < N; k++) {
        const h = hs[i];
        const wx = ox + k * step;
        let r, gg, b;
        if (h < SEA_LEVEL) {
          const t = clamp(-h / 12, 0, 1);
          r = 66 - t * 36; gg = 140 - t * 64; b = 172 - t * 60;
        } else {
          const c = terrain.surfaceColor(wx, wz, h, 0.25, _rgb);
          r = c[0] * 255; gg = c[1] * 255; b = c[2] * 255;
        }
        const hR = k < N - kShade ? hs[i + kShade] : h;
        const hD = j < N - kShade ? hs[i + kShade * N] : h;
        const shade = clamp(1 + (h - hR) * gx + (h - hD) * gz, 0.66, 1.32);
        d[i * 4] = clamp(r * shade, 0, 255);
        d[i * 4 + 1] = clamp(gg * shade, 0, 255);
        d[i * 4 + 2] = clamp(b * shade, 0, 255);
        d[i * 4 + 3] = 255;
        i++;
      }
    }
    this.bmBufferCtx.putImageData(this.bmImage, 0, 0);

    const ctx = this.bmCtx;
    const S = this._sizeBigmap();
    // ⚠️ 1 CSS 像素 = U 个画布像素。
    //    下面所有尺寸都写成"CSS 像素 × U"，这样换分辨率 / 换窗口大小 / 换 DPR，
    //    标记和文字在屏幕上看起来都一样大 —— 否则把 canvas 调清晰之后，
    //    标记和比例尺会同比缩成看不见的小点。
    const U = S / (this.el.bigmap.getBoundingClientRect().width || S);

    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.bmBuffer, 0, 0, S, S);

    const toMap = (wx, wz) => [((wx - ox) / span) * S, ((wz - oz) / span) * S];

    // 地标
    const ents = this._collectEntities();
    const dot = (x, z, color, shape = 'circle', css = 4, ring = false, hollow = false) => {
      const [mx, my] = toMap(x, z);
      const size = css * U;
      const pad = size * 3;
      if (mx < -pad || my < -pad || mx > S + pad || my > S + pad) return [mx, my];
      ctx.beginPath();
      if (shape === 'circle') ctx.arc(mx, my, size, 0, Math.PI * 2);
      else if (shape === 'diamond') {
        ctx.moveTo(mx, my - size); ctx.lineTo(mx + size, my);
        ctx.lineTo(mx, my + size); ctx.lineTo(mx - size, my); ctx.closePath();
      } else ctx.rect(mx - size * 0.85, my - size * 0.85, size * 1.7, size * 1.7);
      if (hollow) {
        ctx.fillStyle = 'rgba(24,30,38,.62)';       // 未激活：深色底
        ctx.fill();
        ctx.lineWidth = 1.6 * U; ctx.strokeStyle = color; ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.3 * U; ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.stroke();
      }
      if (ring) {
        ctx.beginPath(); ctx.arc(mx, my, size + 3.6 * U, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = 1.3 * U;
        ctx.setLineDash([2.8 * U, 2.8 * U]); ctx.stroke(); ctx.setLineDash([]);
      }
      return [mx, my];
    };

    ents.orbs.forEach((o) => { if (!o.done) dot(o.x, o.z, '#16a99b', 'circle', 3.6); });
    ents.chests.forEach((o) => { if (!o.done) dot(o.x, o.z, '#d9862b', 'square', 3.6); });
    // 传送锚点：**全部**画出来。已激活 = 蓝色实心 + 虚线圈（可点击传送）；
    // 未激活 = 暗色空心（提示"这里有个锚点，去点亮它"）。
    const wayPts = [];
    ents.ways.forEach((o) => {
      const pt = dot(o.x, o.z, o.unlocked ? '#3f8fd0' : '#8ea6b6', 'diamond', 5.2, o.unlocked, !o.unlocked);
      wayPts.push({ ...o, mx: pt[0], my: pt[1] });
    });
    this._wayPoints = wayPts;
    // 点击命中半径也按 CSS 像素算（原来是画布像素，缩放到大屏上会变得难点中）
    this._wayHitR = 20 * U;
    this._wayBias = 4 * U;      // 已激活锚点在重叠时的命中优先偏置

    // 玩家
    const [pxm, pym] = toMap(p.position.x, p.position.z);
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    ctx.save();
    ctx.translate(pxm, pym);
    ctx.beginPath();
    ctx.moveTo(fx * 8 * U, fz * 8 * U);
    ctx.lineTo(-fz * 5.4 * U - fx * 3.8 * U, fx * 5.4 * U - fz * 3.8 * U);
    ctx.lineTo(fz * 5.4 * U - fx * 3.8 * U, -fx * 5.4 * U - fz * 3.8 * U);
    ctx.closePath();
    ctx.fillStyle = '#e2493c'; ctx.fill();
    ctx.lineWidth = 1.3 * U; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.restore();

    // 比例尺 / 坐标
    ctx.font = `600 ${Math.round(11.5 * U)}px ` + getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.strokeStyle = 'rgba(0,0,0,.38)';
    ctx.lineWidth = 0.9 * U;
    const label = `${(span / 1000).toFixed(1)} km 视野`;
    ctx.strokeText(label, 12 * U, S - 11 * U);
    ctx.fillText(label, 12 * U, S - 11 * U);
    const coords = `X ${p.position.x.toFixed(0)}  Z ${p.position.z.toFixed(0)}`;
    ctx.strokeText(coords, 12 * U, 18 * U);
    ctx.fillText(coords, 12 * U, 18 * U);
  }

  _bindMapClick() {
    this.el.bigmap.addEventListener('click', (e) => {
      if (!this._wayPoints || !this._wayPoints.length) return;
      const r = this.el.bigmap.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.el.bigmap.width;
      const y = ((e.clientY - r.top) / r.height) * this.el.bigmap.height;
      let best = null, bd = this._wayHitR || 34;   // 命中半径（画布像素，由 renderBigMap 按 CSS 像素换算）
      for (const w of this._wayPoints) {
        const d = Math.hypot(w.mx - x, w.my - y);
        // 已激活的优先命中（两者重叠时选已激活的那个）
        const dd = d - (w.unlocked ? (this._wayBias || 4) : 0);
        if (dd < bd) { bd = dd; best = w; }
      }
      if (!best) { this.hint('点击地图上的传送锚点即可查看'); return; }
      if (!best.unlocked) {
        this.hint('该锚点尚未激活 —— 需要走到它旁边按下 E 点亮');
        return;
      }
      if (this.onTeleport) this.onTeleport(best);
    });
  }

  /* ==================== 设置面板绑定 ==================== */
  _bindSettings() {
    const $ = this.$;
    const bindRange = (id, vid, fn, fmt = (v) => v) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = +el.value;
        $(vid).textContent = fmt(v);
        fn(v);
      });
    };
    // 这些回调由 main 注入（this.onSetting）
    const emit = (k, v) => this.onSetting && this.onSetting(k, v);

    bindRange('set-sens', 'set-sens-v', (v) => emit('sensitivity', v / 100), (v) => `${v}%`);
    bindRange('set-fov', 'set-fov-v', (v) => emit('fov', v));
    bindRange('set-vol', 'set-vol-v', (v) => emit('volume', v / 100), (v) => `${v}`);
    bindRange('set-sfx', 'set-sfx-v', (v) => emit('sfx', v / 100), (v) => `${v}`);
    bindRange('set-amb', 'set-amb-v', (v) => emit('ambient', v / 100), (v) => `${v}`);
    bindRange('set-daylen', 'set-daylen-v', (v) => emit('dayLength', v), (v) => `${v}s`);

    const shadow = $('set-shadow');
    if (shadow) shadow.addEventListener('change', () => emit('shadows', shadow.checked));
    const invert = $('set-invert');
    if (invert) invert.addEventListener('change', () => emit('invertY', invert.checked));

    const seg = $('seg-quality');
    if (seg) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-q]');
        if (!b) return;
        [...seg.children].forEach((c) => c.classList.toggle('on', c === b));
        emit('quality', b.dataset.q);
      });
    }
  }

  /** 同步设置控件到当前值 */
  syncSettings(s) {
    const $ = this.$;
    const setR = (id, vid, v, fmt = (x) => x) => {
      const el = $(id); if (!el) return;
      el.value = v; const t = $(vid); if (t) t.textContent = fmt(v);
    };
    setR('set-sens', 'set-sens-v', Math.round(s.sensitivity * 100), (v) => `${v}%`);
    setR('set-fov', 'set-fov-v', Math.round(s.fov));
    setR('set-vol', 'set-vol-v', Math.round(s.volume * 100));
    setR('set-sfx', 'set-sfx-v', Math.round(s.sfx * 100));
    setR('set-amb', 'set-amb-v', Math.round(s.ambient * 100));
    setR('set-daylen', 'set-daylen-v', Math.round(s.dayLength), (v) => `${v}s`);
    const seg = $('seg-quality');
    if (seg) [...seg.children].forEach((c) => c.classList.toggle('on', c.dataset.q === s.quality));
    const sh = $('set-shadow'); if (sh) sh.checked = !!s.shadows;
    const iv = $('set-invert'); if (iv) iv.checked = !!s.invertY;
  }
}

/* 轻量向量占位（避免额外 import 循环） */
class THREE_V3 {
  constructor() { this.x = 1e9; this.y = 0; this.z = 1e9; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; }
}

/** 大数字加千分位，避免摩拉堆到 6 位数后难读 */
function formatNum(n) {
  return n >= 10000 ? n.toLocaleString('en-US') : String(n);
}

/** 复用的颜色缓冲区（避免每像素分配数组） */
const _rgb = [0, 0, 0];
