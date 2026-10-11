/* ============================================================
 *  terrain.js — 世界地理：高度场、生物群系、地表配色
 *  所有采样都是解析式的（解析函数），因此可以精确碰撞、无限延展
 * ============================================================ */
import { Simplex2, clamp, lerp, smoothstep } from './noise.js';

/** 水面高度（世界单位） */
export const SEA_LEVEL = 0;

/** 地形网格默认步长（米）：64 米的地形块 ÷ "中"画质的 28 段。World 会按画质覆盖它 */
export const DEFAULT_MESH_STEP = 64 / 28;

/** 生物群系定义 */
export const BIOMES = {
  OCEAN:      { id: 'OCEAN',      name: '碧蓝之海', color: 0x2f6f8f, fog: 0x9fc4d8 },
  BEACH:      { id: 'BEACH',      name: '珊瑚浅滩', color: 0xe4d3a3, fog: 0xe9dcc0 },
  GRASSLAND:  { id: 'GRASSLAND',  name: '风起平原', color: 0x83b25a, fog: 0xbcd6ea },
  FOREST:     { id: 'FOREST',     name: '低语林地', color: 0x4e7f3c, fog: 0xa9c6b0 },
  DESERT:     { id: 'DESERT',     name: '烫金流沙', color: 0xdcc178, fog: 0xe8d9ab },
  HIGHLAND:   { id: 'HIGHLAND',   name: '苍岩高地', color: 0x8c8778, fog: 0xc3c8cf },
  MOUNTAIN:   { id: 'MOUNTAIN',   name: '云脊山脉', color: 0x9a958c, fog: 0xd6dbe4 },
  SNOW:       { id: 'SNOW',       name: '极寒雪原', color: 0xf3f6fa, fog: 0xdfe8f2 },
  SWAMP:      { id: 'SWAMP',      name: '苔沼湿地', color: 0x5f7a4a, fog: 0xaebfa4 },
};

export class Terrain {
  constructor(seed = 20261010) {
    this.seed = seed;
    this._meshStep = DEFAULT_MESH_STEP;
    this.nCont = new Simplex2(seed + 1);
    this.nHill = new Simplex2(seed + 2);
    this.nMount = new Simplex2(seed + 3);
    this.nMask = new Simplex2(seed + 4);
    this.nDetail = new Simplex2(seed + 5);
    this.nTemp = new Simplex2(seed + 6);
    this.nMoist = new Simplex2(seed + 7);
    this.nCave = new Simplex2(seed + 8);
  }

  /* ---------- 高度场 ---------- */
  height(x, z) {
    // 1. 大陆性：决定海陆 → 0 为深海，1 为内陆
    const cont0 = this.nCont.warped(x * 0.00085, z * 0.00085, 2.4, 3);
    const continent = smoothstep(-0.54, 0.08, cont0);

    // 2. 丘陵起伏
    const hills = this.nHill.warped(x * 0.0062, z * 0.0062, 3.0, 4) * 0.5 + 0.5;

    // 3. 山脉：山脊噪声 × 掩码 → 只在部分区域隆起
    const ridge = this.nMount.ridge(x * 0.0022, z * 0.0022, 5);
    const mMask = smoothstep(0.44, 0.90, this.nMask.warped(x * 0.0011, z * 0.0011, 2.0, 3) * 0.5 + 0.5);
    const mountain = Math.pow(ridge, 1.6) * mMask;

    // 4. 细节
    const detail = this.nDetail.fbm(x * 0.035, z * 0.035, 3) * 0.5 + 0.5;

    // 组合
    let h = 0;
    h += lerp(-15, 5.0, continent);            // 海底 / 海岸基础
    h += (hills - 0.5) * 8.5 * continent;       // 起伏
    h += mountain * 88 * continent;            // 山脉
    h += (detail - 0.5) * lerp(0.9, 2.4, smoothstep(0.2, 1.0, continent)) * (1 - mountain * 0.7);

    // 5. 高原台地（让某些区域更平坦开阔，适合跑图）
    //
    // ⚠️ 台地必须用**连续**的阶梯函数做。
    // 原来写的是 Math.round(h / 8) * 8 —— 它是阶跃的：h 一跨过 8k+4，
    // 取整结果就整体跳 8 米，按 0.6 的混合权重算就是**瞬间跳 4.8 米**。
    // 而地形网格的细分步长只有 64/28 ≈ 2.3 米，画不出这种垂直断崖：
    // 网格只能把它拉成一条 2.3 米宽的陡坡，于是"角色站在解析高度上、
    // 眼睛看到的是网格高度"，两者最多差 3~4 米 —— 角色就会悬空或陷进地里。
    //
    // 改用 smoothstep 过渡的软阶梯：台地感保留（约 2/3 的高度区间是平的），
    // 但高度场处处连续，网格能忠实还原，脚下永远踩得实。
    const plateau = smoothstep(0.52, 0.84, this.nCave.fbm(x * 0.0016 + 40, z * 0.0016 - 20, 3) * 0.5 + 0.5);
    const cell = h / 8;
    const base = Math.floor(cell);
    const terrace = (base + smoothstep(0.34, 0.66, cell - base)) * 8;
    h = lerp(h, terrace, plateau * 0.6 * continent);

    return h;
  }

  /** 网格步长（米）：地形块 64 米 ÷ 分段数。由 World 按画质写入 */
  set meshStep(v) { this._meshStep = v; }
  get meshStep() { return this._meshStep || DEFAULT_MESH_STEP; }

  /**
   * 与地形网格**完全一致**的高度 —— 顶点取解析高度，三角形内部线性插值。
   *
   * 为什么不能用 height() 直接贴地：
   * 网格步长只有 64/28 ≈ 2.3 米，而 height() 里含有 7~20 米波长的细节，
   * 网格根本采不出来。于是"角色脚下的解析高度"和"画面上网格的高度"
   * 在起伏剧烈处最多能差 2~3 米 —— 角色看起来就是悬空或者陷进地里。
   *
   * 所以凡是要**站在地面上**的东西（角色、植被、岩石）都必须用这个函数，
   * 这样"脚踩的"和"看到的"永远是同一个面。
   *
   * 三角剖分必须与 world.js 的 _buildChunk 保持一致：
   *   indices.push(a, c, b, b, c, d)   →  对角线是 fx + fz = 1
   */
  meshHeight(x, z, step = this.meshStep) {
    const i = Math.floor(x / step), j = Math.floor(z / step);
    const x0 = i * step, z0 = j * step;
    const fx = (x - x0) / step, fz = (z - z0) / step;
    const h00 = this.height(x0, z0);
    const h10 = this.height(x0 + step, z0);
    const h01 = this.height(x0, z0 + step);
    const h11 = this.height(x0 + step, z0 + step);
    if (fx + fz <= 1) {
      return h00 + fx * (h10 - h00) + fz * (h01 - h00);          // 三角 a-c-b
    }
    return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11); // 三角 b-c-d
  }

  /** 通过有限差分得到坡度（0 = 平坦, 1 = 垂直） */
  slope(x, z, eps = 1.4) {
    const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
    const dx = (hR - hL) / (2 * eps);
    const dz = (hU - hD) / (2 * eps);
    const g = Math.sqrt(dx * dx + dz * dz);
    return clamp(g / 2.2, 0, 1);
  }

  /** 法线（用于光照/着色） */
  normal(x, z, eps = 1.2) {
    const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
    let nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
  }

  /* ---------- 气候 ---------- */
  temperature(x, z) {
    // 纬度感：随着 z 增大变冷 + 噪声扰动 + 海拔降温
    const t = this.nTemp.fbm(x * 0.00042, z * 0.00042, 3);
    return t;
  }
  moisture(x, z) {
    return this.nMoist.fbm(x * 0.00055 + 120, z * 0.00055 - 80, 3);
  }

  /* ---------- 生物群系 ---------- */
  /**
   * @param x,z 世界坐标
   * @param h   已算好的高度（可为 null）
   * @param s   已算好的坡度（可为 null）
   * @param cl  已算好的气候 {t, m}（可为 null）—— 批量生成时传入可省掉重复噪声求值
   */
  biome(x, z, h = null, s = null, cl = null) {
    const hh = h === null ? this.height(x, z) : h;
    const ss = s === null ? this.slope(x, z) : s;
    const t = cl ? cl.t : this.temperature(x, z);
    const m = cl ? cl.m : this.moisture(x, z);

    if (hh < SEA_LEVEL - 0.4) return BIOMES.OCEAN;
    if (hh < SEA_LEVEL + 2.0 && ss < 0.35) return BIOMES.BEACH;

    // 高海拔
    if (hh > 78 || (hh > 62 && t < -0.25)) return BIOMES.SNOW;
    if (hh > 46 || ss > 0.78) return BIOMES.MOUNTAIN;
    if (hh > 30 && ss > 0.5) return BIOMES.HIGHLAND;

    // 气候带
    if (t > 0.16 && m < -0.12) return BIOMES.DESERT;
    if (m > 0.24 && hh < 8 && ss < 0.18) return BIOMES.SWAMP;
    if (m > 0.10) return BIOMES.FOREST;
    if (t < -0.30) return BIOMES.SNOW;
    return BIOMES.GRASSLAND;
  }

  /**
   * 地表颜色：基于群系基色 + 坡度和噪声做自然过渡
   * 返回 [r, g, b] 浮点数组
   */
  surfaceColor(x, z, h, s, out = [0, 0, 0], cl = null) {
    const b = this.biome(x, z, h, s, cl);
    const c = b.color;
    let r = ((c >> 16) & 255) / 255;
    let g = ((c >> 8) & 255) / 255;
    let bl = (c & 255) / 255;

    // 噪声色斑，避免大片纯色
    const v = this.nDetail.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
    const k = 0.86 + v * 0.28;
    r *= k; g *= k; bl *= k;

    // 陡坡露出岩石色
    const rockMix = smoothstep(0.42, 0.8, s);
    r = lerp(r, 0.46 * (0.9 + v * 0.2), rockMix);
    g = lerp(g, 0.44 * (0.9 + v * 0.2), rockMix);
    bl = lerp(bl, 0.41 * (0.9 + v * 0.2), rockMix);

    // 水下略暗
    if (h < SEA_LEVEL) {
      const d = smoothstep(SEA_LEVEL, -9, h);
      r = lerp(r, 0.13, d * 0.85);
      g = lerp(g, 0.22, d * 0.85);
      bl = lerp(bl, 0.27, d * 0.85);
    }
    // 雪线以上提亮
    if (h > 70) {
      const sn = smoothstep(70, 95, h);
      r = lerp(r, 0.97, sn); g = lerp(g, 0.98, sn); bl = lerp(bl, 1.0, sn);
    }
    out[0] = r; out[1] = g; out[2] = bl;
    return out;
  }
}
