/* ============================================================
 *  main.js — 万象原野 主程序
 *  渲染循环 / 世界流式加载 / 玩法逻辑 / 存档 / 菜单
 * ============================================================ */
import * as THREE from '../libs/three.module.js';
import { Terrain, SEA_LEVEL, BIOMES } from './terrain.js';
import { World, QUALITY, CHUNK_SIZE, REGION_SIZE } from './world.js';
import { Sky } from './sky.js';
import { Ocean } from './water.js';
import { Player, PLAYER } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { createObject } from './objects.js';
import { clamp, lerp } from './noise.js';

const SAVE_KEY = 'aether-wilds-save-v1';
const SETTINGS_KEY = 'aether-wilds-settings-v1';

class Game {
  constructor() {
    this.state = {
      level: 1, xp: 0, xpNeed: 100,
      orbs: 0, orbsTotal: 0,
      chests: 0, chestsTotal: 0,
      ways: 0, waysTotal: 0,
      gems: 0, mora: 0,          // 开宝箱累计的原石 / 摩拉
      distance: 0,
      staminaMax: PLAYER.staminaMax,
      collected: [],
      unlocked: [],
      playtime: 0,
      started: false,
    };
    this.collectedSet = new Set();
    this.unlockedSet = new Set();
    // 已点亮锚点的持久登记表：id → {x, z}
    // 区域流式卸载后 world.entities 里就没有它了，但玩家指望还能从地图上传送过去，
    // 所以坐标必须单独存一份（并写进存档）。
    this.waypointRegistry = new Map();
    this.objects = new Map();       // id → 实例
    this.regionObjects = new Map(); // regionKey → [实例]
    this.mapOpen = false;
    this.paused = true;
    this.settings = {
      quality: '中', sensitivity: 1, fov: 76, volume: 0.6, sfx: 0.8,
      ambient: 0.5, shadows: true, dayLength: 480, invertY: false,
    };
    this._loadSettings();
  }

  async boot() {
    const ui0 = (p, t) => { if (this.ui) this.ui.setLoading(p, t); };

    /* ---------- 渲染器 ---------- */
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.12, 2200);
    this.camera.position.set(0, 20, 0);
    this.scene.add(this.camera);

    /* ---------- UI / 输入 ---------- */
    this.ui = new UI(this);
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.ui.syncSettings(this.settings);
    this.ui.setLoading(0.06, '初始化渲染器…');
    await frame();

    /* ---------- 世界 ---------- */
    this.seed = 20261010;
    this.terrain = new Terrain(this.seed);
    this.sky = new Sky(this.scene);
    this.sky.dayLength = this.settings.dayLength;
    this.sky.setShadows(this.settings.shadows);
    this.ocean = new Ocean({ size: 1400, segments: 90 });
    this.scene.add(this.ocean.mesh);

    this.scene.fog = new THREE.Fog(this.sky.fogColor.clone(), 80, 500);

    ui0(0.12, '播撒山川与海洋…');
    await frame();

    this.world = new World(this.scene, this.terrain, { quality: this.settings.quality });
    this.world.onLandmarks = (list) => this.spawnLandmarks(list);
    this.world.onRegionUnload = (rx, rz) => this.despawnRegion(rx, rz);

    // 出生点
    const save = this.readSave();
    const sp = save ? { x: save.pos.x, y: save.pos.y, z: save.pos.z } : this.world.findSpawn(120, -80);
    this.spawnPoint = { x: sp.x, y: sp.y ?? this.terrain.meshHeight(sp.x, sp.z), z: sp.z };

    this.player = new Player(this.scene, this.terrain);
    this.player.reset(this.spawnPoint.x, this.spawnPoint.y + 1.2, this.spawnPoint.z);
    this.player.onEvent = (type, pos, val) => this.onPlayerEvent(type, pos, val);

    this.cameraRig = new CameraRig(this.camera, this.terrain, { fov: this.settings.fov });
    this.cameraRig.blockerProvider = (x, z) => this.world.blockersNear(x, z, 20);

    /* ---------- 开场加载：先铺满脚下区域 ---------- */
    const t0 = performance.now();
    let guard = 0;
    while (!this.world.isAreaReady(this.player.position) && guard++ < 400) {
      this.world.update(this.player.position, 26);
      if (guard % 2 === 0) {
        ui0(0.12 + Math.min(0.55, 0.55 * (guard / 40)), '地形生成中…');
        await frame();
      }
    }
    // 把可见范围内的资源也一次补齐
    for (let i = 0; i < 14; i++) {
      this.world.update(this.player.position, 24);
      ui0(0.68 + i * 0.018, '种植森林与山石…');
      await frame();
    }

    // 相机吸附
    this.cameraRig.update(this.player, 0.016, false);

    ui0(0.92, '编译着色器…');
    await frame();
    this.renderer.compile(this.scene, this.camera);

    ui0(1, '准备就绪');
    await frame(140);

    this.bindEvents();
    this.ui.hideLoading();
    this.ui.setHUD(false);
    this.prepareStartMenu(save);

    // 渲染循环
    this.clock = new THREE.Clock();
    this.lastSave = 0;
    this.fpsAvg = 60;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /* ==================== 存档 ==================== */
  readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  prepareStartMenu(save) {
    const info = this.ui.el.saveInfo;
    if (save) {
      const d = save.playtime ? `${Math.floor(save.playtime / 60)} 分钟` : '—';
      info.textContent = `已有存档 · Lv.${save.level || 1} · 风之瞳 ${save.orbs || 0} · 原石 ${save.gems || 0} · 摩拉 ${save.mora || 0} · 已探索 ${Math.round(save.distance || 0)} m · 游玩 ${d}`;
      const bc = document.getElementById('btn-continue');
      bc.disabled = false; bc.style.opacity = ''; bc.style.cursor = '';
    } else {
      info.textContent = '暂无存档，开始一段新的旅程吧';
      document.getElementById('btn-continue').disabled = true;
      document.getElementById('btn-continue').style.opacity = '.45';
      document.getElementById('btn-continue').style.cursor = 'not-allowed';
    }
    this.ui.showMenu('start');
  }

  applySave(save) {
    if (!save) return;
    const st = this.state;
    st.level = save.level || 1;
    st.xp = save.xp || 0;
    st.xpNeed = 100 + (st.level - 1) * 60;
    st.orbs = save.orbs || 0;
    st.chests = save.chests || 0;
    st.ways = save.ways || 0;
    st.gems = save.gems || 0;
    st.mora = save.mora || 0;
    st.distance = save.distance || 0;
    st.staminaMax = save.staminaMax || PLAYER.staminaMax;
    st.playtime = save.playtime || 0;
    this.collectedSet = new Set(save.collected || []);
    this.unlockedSet = new Set(save.unlocked || []);
    if (save.regions) save.regions.forEach((r) => this.ui.regions.add(r));

    // 锚点坐标：优先用存档里记的；老存档没有这一项，就从已激活的 id 反推
    // （地标生成是确定性的，同一个 seed 必然长出同一个坐标）
    this.waypointRegistry = new Map();
    if (Array.isArray(save.waypoints)) {
      for (const w of save.waypoints) {
        if (Array.isArray(w) && w.length >= 3) this.waypointRegistry.set(w[0], { x: w[1], z: w[2] });
      }
    }
    this._rebuildWaypointRegistry();

    this.player.reset(save.pos.x, save.pos.y, save.pos.z);
    this.player.stamina = st.staminaMax;
    this.player.health = 100;
    if (save.time !== undefined) this.sky.setTime(save.time);
    if (save.lantern) { this.player.lanternOn = true; }
    // 已经走过的区域需要重建状态
    this.world.rebuild();
  }

  /** 把 unlockedSet 里还没有登记的锚点补进 waypointRegistry */
  _rebuildWaypointRegistry() {
    if (!this.world) return;
    for (const id of this.unlockedSet) {
      if (typeof id !== 'string' || !id.startsWith('way:')) continue;
      if (this.waypointRegistry.has(id)) continue;
      const parts = id.split(':');
      if (parts.length < 4) continue;
      const rx = +parts[1], rz = +parts[2];
      if (!Number.isFinite(rx) || !Number.isFinite(rz)) continue;
      try {
        const lms = this.world._genLandmarks(rx, rz) || [];
        const d = lms.find((o) => o.id === id);
        if (d) this.waypointRegistry.set(id, { x: d.x, z: d.z });
      } catch (e) { /* 老存档里可能有对不上的 id，忽略即可 */ }
    }
  }

  writeSave() {
    try {
      const st = this.state;
      const data = {
        version: 1, seed: this.seed,
        pos: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
        level: st.level, xp: st.xp, orbs: st.orbs, chests: st.chests, ways: st.ways,
        gems: st.gems, mora: st.mora,
        waypoints: [...this.waypointRegistry].map(([id, w]) => [id, +w.x.toFixed(2), +w.z.toFixed(2)]),
        distance: Math.round(st.distance), staminaMax: st.staminaMax,
        playtime: Math.round(st.playtime),
        collected: [...this.collectedSet], unlocked: [...this.unlockedSet],
        regions: [...this.ui.regions],
        time: this.sky.time,
        lantern: this.player.lanternOn,
        at: Date.now(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return data;
    } catch (e) { return null; }
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(this.settings, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }
  _saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }

  /* ==================== 事件绑定 ==================== */
  bindEvents() {
    const $ = (id) => document.getElementById(id);
    const click = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { this.audio.play('ui'); fn(); }); };

    // 主菜单
    click('btn-new', () => this.startGame(false));
    click('btn-continue', () => this.startGame(true));
    click('btn-settings', () => this.ui.showMenu('settings'));
    click('btn-help', () => this.ui.showMenu('help'));
    click('btn-resume', () => this.resume());
    click('btn-map', () => this.toggleMap(true));
    click('btn-pause-settings', () => this.ui.showMenu('settings'));
    click('btn-pause-help', () => this.ui.showMenu('help'));
    click('btn-save', () => { this.writeSave(); this.ui.toast('进度已保存', ''); });
    click('btn-quit', () => this.quitToMenu());
    click('btn-settings-close', () => {
      const back = this.state.started ? (this.paused ? 'pause' : null) : 'start';
      this.ui.showMenu(back);
      if (this.state.started && !this.paused) this.requestLock();
    });
    click('btn-help-close', () => this.ui.showMenu(this.state.started ? (this.paused ? 'pause' : null) : 'start'));
    click('btn-map-close', () => this.toggleMap(false));

    // 设置回调
    this.ui.onSetting = (k, v) => this.applySetting(k, v);
    this.ui.onTeleport = (wp) => this.teleportTo(wp);

    // 世界地图点击后需要重新聚焦
    this.ui.el.bigmap.addEventListener('click', () => { this.audio.play('ui'); });

    // 键盘
    window.addEventListener('keydown', (e) => {
      if (!this.state.started) return;
      const settingsOpen = !this.ui.el.menuSettings.classList.contains('hidden');
      const helpOpen = !this.ui.el.menuHelp.classList.contains('hidden');
      if (e.code === 'Escape') {
        if (settingsOpen) { this.ui.showMenu(this.paused ? 'pause' : null); return; }
        if (helpOpen) { this.ui.showMenu(this.paused ? 'pause' : null); return; }
      }
      switch (e.code) {
        case 'Escape': this.togglePause(); break;
        case 'KeyM': this.toggleMap(!this.mapOpen); break;
        case 'KeyN': this.ui.cycleZoom(); break;
        case 'KeyC':
          this.cameraRig.toggleFirstPerson();
          this.ui.hint(this.cameraRig.firstPerson ? '第一人称视角' : '第三人称视角');
          this.audio.play('ui');
          break;
        case 'KeyF':
          this.player.lanternOn = !this.player.lanternOn;
          this.ui.hint(this.player.lanternOn ? '提灯已点亮' : '提灯已熄灭');
          this.audio.play('ui');
          break;
        case 'KeyT':
          this.sky.setTime(this.sky.time > 0.28 && this.sky.time < 0.76 ? 0.02 : 0.5);
          this.ui.hint(this.sky.time > 0.28 && this.sky.time < 0.76 ? '正午' : '深夜');
          break;
        case 'KeyH': this.ui.toggleHUD(); break;
        case 'KeyE': this.tryInteract(); break;
        default: break;
      }
    });

    // 画布点击 → 重新锁定指针
    this.canvas.addEventListener('click', () => {
      if (this.state.started && !this.paused && !this.mapOpen) this.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state.started && !this.paused && !this.mapOpen) this.pause();
    };

    // 触摸
    this.canvas.addEventListener('touchstart', () => this.audio.start(), { passive: true, once: true });
    this.bindTouchControls();

    // 窗口
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', () => { if (this.state.started) this.writeSave(); });

    // 触摸设备提示
    if (this.input.hasTouch) {
      this.ui.el.touch.classList.remove('hidden');
      this.ui.el.crosshair.style.opacity = '.3';
    }
  }

  bindTouchControls() {
    const hold = (id, code) => {
      const el = document.getElementById(id);
      if (!el) return;
      const add = (e) => { e.preventDefault(); this.input.keys.add(code); };
      const del = (e) => { e.preventDefault(); this.input.keys.delete(code); };
      el.addEventListener('touchstart', add, { passive: false });
      el.addEventListener('touchend', del, { passive: false });
      el.addEventListener('touchcancel', del, { passive: false });
      el.addEventListener('mousedown', add);
      el.addEventListener('mouseup', del);
    };
    hold('tb-jump', 'Space');
    hold('tb-glide', 'Space');
    hold('tb-sprint', 'ShiftLeft');
    const inter = document.getElementById('tb-interact');
    if (inter) inter.addEventListener('touchstart', (e) => { e.preventDefault(); this.tryInteract(); }, { passive: false });
    // 摇杆视觉
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    if (base && knob) {
      const update = () => {
        const t = this.input.touch;
        if (t.active) {
          const dx = clamp((t.x - t.ox) / 1.2, -46, 46);
          const dy = clamp((t.y - t.oy) / 1.2, -46, 46);
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else knob.style.transform = 'none';
      };
      this._stickUpdate = update;
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /* ==================== 设置 ==================== */
  applySetting(k, v) {
    this.settings[k] = v;
    switch (k) {
      case 'quality': {
        const changed = this.world.setQuality(v);
        this.renderer.shadowMap.enabled = this.settings.shadows;
        if (changed) this.ui.hint(`画质已切换为「${v}」`);
        this.renderer.setPixelRatio(v === '低' ? 1 : Math.min(window.devicePixelRatio, 2));
        break;
      }
      case 'sensitivity': this.input.sensitivity = 0.0022 * v; break;
      case 'fov': this.cameraRig.fov = v; break;
      case 'volume': case 'sfx': case 'ambient':
        this.audio.setVolumes({ master: this.settings.volume, sfx: this.settings.sfx, ambient: this.settings.ambient });
        break;
      case 'shadows':
        this.sky.setShadows(v);
        this.renderer.shadowMap.enabled = v;
        this.world.shadows = v;
        this.world.rebuild();
        break;
      case 'dayLength': this.sky.dayLength = v; break;
      case 'invertY': this.input.invertY = v; break;
      default: break;
    }
    this.audio.setVolumes({
      master: this.settings.volume, sfx: this.settings.sfx, ambient: this.settings.ambient,
    });
    this._saveSettings();
  }

  /* ==================== 开始 / 暂停 ==================== */
  startGame(continueSave) {
    this.audio.start();
    const save = continueSave ? this.readSave() : null;
    if (save) this.applySave(save);
    else {
      this.world.rebuild();
      this.player.reset(this.spawnPoint.x, this.spawnPoint.y + 1.2, this.spawnPoint.z);
      this.sky.setTime(0.34);
    }
    this.state.started = true;
    this.paused = false;
    this.ui.showMenu(null);
    this.ui.setHUD(true);
    this.ui.toast('欢迎来到 <b>万象原野</b>', 'gold', 3400);
    setTimeout(() => this.ui.hint('WASD 奔跑 · 空格跳跃 · 长按空格滑翔 · E 交互', 4200), 600);
    this.cameraRig.update(this.player, 0.016, false);
    this.requestLock();
  }

  requestLock() {
    if (!this.input.hasTouch) this.input.requestLock();
    this.audio.resume();
  }

  pause() {
    if (this.paused || !this.state.started) return;
    this.paused = true;
    this.input.exitLock();
    this.ui.showMenu('pause');
    this.writeSave();
  }

  resume() {
    this.paused = false;
    this.ui.showMenu(null);
    this.requestLock();
  }

  togglePause() {
    if (!this.state.started) return;
    if (this.mapOpen) { this.toggleMap(false); return; }
    if (this.paused) this.resume(); else this.pause();
  }

  quitToMenu() {
    this.writeSave();
    this.state.started = false;
    this.paused = true;
    this.input.exitLock();
    this.ui.setHUD(false);
    this.ui.showMenu('start');
    this.prepareStartMenu(this.readSave());
  }

  toggleMap(open) {
    this.mapOpen = open;
    if (open) {
      this.input.exitLock();
      this.ui.showMenu('map');
      // 512 分辨率的采样要 ~400ms，同步渲染会把这次点击卡住一整帧，
      // 玩家会觉得"按了 M 要愣一下"。先画占位让面板上屏，下一帧再生成。
      this.ui.placeholderBigMap();
      requestAnimationFrame(() => { if (this.mapOpen) this.ui.renderBigMap(); });
    } else {
      this.ui.showMenu(this.paused ? 'pause' : null);
      if (!this.paused) this.requestLock();
    }
  }

  teleportTo(wp) {
    // 传送落点用 meshHeight，直接踩在画出来的地面上
    this.player.position.set(wp.x, this.terrain.meshHeight(wp.x, wp.z) + 1.0, wp.z);
    this.player.velocity.set(0, 0, 0);
    this.cameraRig.update(this.player, 0.016, false);
    this.toggleMap(false);
    this.audio.play('unlock');
    this.ui.toast('传送至 <b>传送锚点</b>', 'amber');
    this.world.rebuild();
  }

  /* ==================== 地标实例 ==================== */
  spawnLandmarks(list) {
    for (const desc of list) {
      if (this.objects.has(desc.id)) continue;
      const obj = createObject(desc);
      if (!obj) continue;
      if (desc.type === 'orb') this.state.orbsTotal++;
      if (desc.type === 'chest') this.state.chestsTotal++;
      if (desc.type === 'waypoint') {
        this.state.waysTotal++;
        if (this.isUnlocked(desc.id)) obj.setOpened(true);
      }
      if (this.isCollected(desc.id)) obj.setOpened(true);
      this.scene.add(obj.group);
      this.objects.set(desc.id, obj);
      const rk = `${Math.floor(desc.x / REGION_SIZE)},${Math.floor(desc.z / REGION_SIZE)}`;
      obj._regionKey = rk;
      if (!this.regionObjects.has(rk)) this.regionObjects.set(rk, []);
      this.regionObjects.get(rk).push(obj);
    }
  }

  despawnRegion(rx, rz) {
    const rk = `${rx},${rz}`;
    const arr = this.regionObjects.get(rk);
    if (!arr) return;
    for (const obj of arr) {
      this.scene.remove(obj.group);
      this.objects.delete(obj.id);
      if (obj.type === 'orb') this.state.orbsTotal--;
      if (obj.type === 'chest') this.state.chestsTotal--;
      if (obj.type === 'waypoint') this.state.waysTotal--;
    }
    this.regionObjects.delete(rk);
  }

  isCollected(id) { return this.collectedSet.has(id); }
  isUnlocked(id) { return this.unlockedSet.has(id); }

  /* ==================== 交互 ==================== */
  findInteractable() {
    const p = this.player.position;
    let best = null, bd = 1e9;
    for (const obj of this.objects.values()) {
      if (obj.type === 'orb' && obj.collected) continue;
      if (obj.type === 'chest' && obj.opened) continue;
      if (obj.type === 'waypoint' && obj.unlocked) continue;
      const d = Math.hypot(obj.position.x - p.x, obj.position.z - p.z);
      const dy = Math.abs(obj.position.y - p.y);
      if (d < obj.interactRadius && dy < 4.2 && d < bd) { bd = d; best = obj; }
    }
    return best;
  }

  tryInteract() {
    const obj = this.findInteractable();
    if (!obj) return;
    switch (obj.type) {
      case 'chest': {
        if (!obj.open()) return;
        this.collectedSet.add(obj.id);
        this.state.chests++;
        this.gainXp(18);
        const gems = 12 + Math.floor(Math.random() * 18);
        const mora = 300 + Math.floor(Math.random() * 700);
        // ⚠️ 这两个值必须累加进 state（并写进存档），
        //   否则只弹一条 toast 就没了 —— 玩家永远不知道自己攒了多少。
        this.state.gems += gems;
        this.state.mora += mora;
        this.ui.toast(
          `宝箱开启 · <b>原石 ×${gems}</b> · 摩拉 ×${mora}` +
          `<span class="toast-sub">累计 原石 ${this.state.gems} · 摩拉 ${this.state.mora}</span>`,
          'gold', 3200);
        this.audio.play('chest');
        break;
      }
      case 'orb': {
        if (!obj.collect()) return;
        this.collectedSet.add(obj.id);
        this.state.orbs++;
        this.gainXp(26);
        this.ui.toast(`收集到 <b>风之瞳</b> · 共 ${this.state.orbs} 枚`, 'amber', 3000);
        this.audio.play('pickup');
        this.flashOrb(obj.position);
        break;
      }
      case 'camp': {
        this.player.stamina = this.state.staminaMax;
        this.player.health = Math.min(100, this.player.health + 40);
        this.ui.toast('在篝火旁休整 · 体力与生命已恢复', '', 2400);
        this.audio.play('levelup');
        break;
      }
      case 'waypoint': {
        obj.unlock();
        this.unlockedSet.add(obj.id);
        this.state.ways++;
        // 登记坐标，区域卸载后地图上依然能找到它
        this.waypointRegistry.set(obj.id, { x: obj.position.x, z: obj.position.z });
        this.gainXp(22);
        this.ui.toast('已激活 <b>传送锚点</b> · 打开地图(M)可传送', 'amber', 3600);
        this.audio.play('unlock');
        break;
      }
      default: break;
    }
    this.ui.showInteract(null);
  }

  /** 收集时的粒子爆发 */
  flashOrb(pos) {
    const geo = new THREE.BufferGeometry();
    const n = 26;
    const arr = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y; arr[i * 3 + 2] = pos.z;
      vel.push(new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1.5,
        (Math.random() - 0.5) * 5
      ));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color: 0x7ef0e0, size: 0.34, transparent: true, opacity: 1, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > 1.1) {
        this.scene.remove(pts); geo.dispose(); mat.dispose();
        return;
      }
      const p = geo.attributes.position;
      for (let i = 0; i < n; i++) {
        vel[i].y -= 6 * 0.016;
        p.setXYZ(i, p.getX(i) + vel[i].x * 0.016, p.getY(i) + vel[i].y * 0.016, p.getZ(i) + vel[i].z * 0.016);
      }
      p.needsUpdate = true;
      mat.opacity = 1 - t / 1.1;
      requestAnimationFrame(tick);
    };
    tick();
  }

  gainXp(v) {
    const st = this.state;
    st.xp += v;
    let leveled = false;
    while (st.xp >= st.xpNeed) {
      st.xp -= st.xpNeed;
      st.level++;
      st.xpNeed = 100 + (st.level - 1) * 60;
      st.staminaMax += 4;
      this.player.health = 100;
      leveled = true;
    }
    if (leveled) {
      this.player.stamina = st.staminaMax;
      this.ui.toast(`等级提升 · <b>Lv.${st.level}</b> · 体力上限 +4`, 'gold', 3200);
      this.audio.play('levelup');
    }
  }

  /* ==================== 玩家事件 ==================== */
  onPlayerEvent(type, pos, val) {
    const p = this.player;
    switch (type) {
      case 'step': {
        const biome = this.terrain.biome(this.player.position.x, this.player.position.z);
        let surface = 'grass';
        switch (biome.id) {
          case 'DESERT': case 'BEACH': surface = 'sand'; break;
          case 'SNOW': surface = 'snow'; break;
          case 'MOUNTAIN': case 'HIGHLAND': surface = 'rock'; break;
          case 'SWAMP': surface = 'water'; break;
          case 'FOREST': surface = 'dirt'; break;
          default: surface = 'grass';
        }
        const vol = clamp(0.35 + val / 12, 0.35, 1);
        this.audio.play('step', { surface, vol });
        break;
      }
      case 'jump': this.audio.play('jump'); break;
      case 'land':
        this.audio.play('land', { vol: clamp(val / 14, 0.2, 1) });
        if (val > 13) this.cameraRig.addShake(clamp(val / 34, 0.12, 0.5));
        break;
      case 'splash': this.audio.play('splash'); break;
      case 'state':
        if (val === 'glide') { this.audio.play('glide_open'); }
        break;
      default: break;
    }
  }

  /* ==================== 主循环 ==================== */
  loop() {
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    const now = performance.now() / 1000;
    this.fpsAvg = lerp(this.fpsAvg, 1 / Math.max(raw, 0.0001), 0.06);

    if (this.state.started && !this.paused && !this.mapOpen) {
      this.update(dt, now);
    } else {
      // 菜单中：让世界继续缓慢“呼吸”，太阳照常走
      this.sky.paused = true;
      this.updateObjectsOnly(dt, now);
    }

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    if (this._stickUpdate) this._stickUpdate();
  }

  updateObjectsOnly(dt, now) {
    for (const obj of this.objects.values()) obj.update(dt, now);
    this.sky.update(dt, this.player.position);
    this.sky.updateShadow(this.player.position);
    this.ocean.follow(this.player.position.x, this.player.position.z);
    this._syncEnvironment();
  }

  update(dt, now) {
    const st = this.state;
    st.playtime += dt;

    /* 输入 → 相机 */
    const m = this.input.consumeMouse();
    if (!this.mapOpen) {
      this.cameraRig.handleMouse(m.dx, m.dy);
      this.cameraRig.handleWheel(m.wheel);
    }

    /* 玩家 */
    const prev = this.player.position.clone();
    this.player.update(dt, this.input, this.cameraRig.yaw);
    const moved = Math.hypot(this.player.position.x - prev.x, this.player.position.z - prev.z);
    if (moved > 0.001) st.distance += moved;

    /* 相机 */
    this.cameraRig.update(this.player, dt);
    // 第一人称才隐藏角色；第三人称即使镜头被地形顶得很近也要保留角色
    // （之前是 distance >= 1.8，而避障会把距离压到 1.5，导致角色直接消失）
    this.player.group.visible = !this.cameraRig.firstPerson && this.cameraRig.distance > 0.9;

    /* 世界流式加载（帧率越低，单帧预算越小，保证操作手感） */
    const budget = this.fpsAvg > 55 ? 7 : this.fpsAvg > 40 ? 4.5 : this.fpsAvg > 25 ? 3 : 2;
    this.world.update(this.player.position, budget);

    /* 地标 */
    for (const obj of this.objects.values()) obj.update(dt, now);

    /* 天空 / 水面 / 环境 */
    this.sky.update(dt, this.player.position);
    this.sky.updateShadow(this.player.position);
    this.scene.userData.nightFactor = this.sky.nightFactor;
    this.ocean.follow(this.player.position.x, this.player.position.z);
    this.ocean.update(dt, now);
    this._syncEnvironment();

    /* 环境音 */
    const wind = clamp(this.player.speed / 12, 0.1, 1) * 0.6
      + clamp(this.player.position.y / 80, 0, 0.4)
      + (this.player.gliding ? 0.4 : 0);
    this.audio.updateAmbience(dt, {
      wind, night: this.sky.nightFactor, underwater: this.player.swimming,
    });

    /* 交互提示 */
    const target = this.findInteractable();
    if (target) this.ui.showInteract(target.hint);
    else this.ui.showInteract(null);

    /* UI */
    this.ui.update(dt);

    /* 自动存档 */
    this.lastSave += dt;
    if (this.lastSave > 25) {
      this.lastSave = 0;
      this.writeSave();
    }

    /* 高空坠落保护（避免掉进世界缝隙） */
    if (this.player.position.y < -60) {
      this.player.reset(this.player.position.x, this.terrain.meshHeight(this.player.position.x, this.player.position.z) + 2, this.player.position.z);
      this.ui.toast('你被风送回了地面', '', 2000);
    }
  }

  _syncEnvironment() {
    const k = this.sky.current;
    const viewDist = this.world.viewChunks * CHUNK_SIZE;
    const far = clamp(viewDist * 0.95, 240, 900);
    const near = far * 0.32;
    this.scene.fog.color.copy(k.fog);
    this.scene.fog.near = near;
    this.scene.fog.far = far;
    this.renderer.setClearColor(k.fog);

    this.sky.updateShadow(this.player.position);
    this.ocean.setSky({
      sunDir: this.sky.lightDir,
      sunColor: k.sun,
      sunPower: k.si,
      fogColor: k.fog,
      fogNear: near * 0.6,
      fogFar: far,
      skyColor: k.hor,
      night: this.sky.nightFactor,
    });
  }
}

/* ---------- 工具 ---------- */
function frame(delay = 0) {
  return new Promise((res) => {
    if (delay > 0) setTimeout(res, delay);
    else requestAnimationFrame(() => res());
  });
}

/* ---------- 启动 ---------- */
const game = new Game();
window.__game = game;
game.boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('load-text');
  if (el) {
    el.innerHTML = `启动失败：${err.message}<br><span style="font-size:11px;color:#888">请使用本地服务器打开（见 README）</span>`;
  }
});
