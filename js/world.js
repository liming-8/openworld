/* ============================================================
 *  world.js — 世界流式加载器
 *  · 地形网格（按块生成 / 卸载）
 *  · 植被与岩石（按区域批量实例化）
 *  · 地标生成（宝箱 / 神瞳 / 篝火 / 传送锚点）
 * ============================================================ */
import * as THREE from '../libs/three.module.js';
import { rngFromChunk, hash2i, clamp, smoothstep } from './noise.js';
import { SEA_LEVEL, BIOMES } from './terrain.js';
import * as P from './props.js';

export const CHUNK_SIZE = 64;
export const REGION_CHUNKS = 3;                       // 一个“资源区域”包含 3x3 个地形块
export const REGION_SIZE = CHUNK_SIZE * REGION_CHUNKS;

/* 复用的临时对象，避免每次放置植被都分配 */
const _up = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

/* ---------- 品质档位 ---------- */
export const QUALITY = {
  低: { segments: 22, viewChunks: 4, grassRadius: 2, shadows: false, fov: 72 },
  中: { segments: 28, viewChunks: 5, grassRadius: 3, shadows: true, fov: 75 },
  高: { segments: 34, viewChunks: 6, grassRadius: 4, shadows: true, fov: 78 },
  极致: { segments: 40, viewChunks: 8, grassRadius: 5, shadows: true, fov: 80 },
};

/**
 * 各类植被 / 岩石的近似尺寸，用于相机避障。
 * ⚠️ 这里的数值必须和 props.js 里实际做出来的几何体对得上，
 * 否则镜头会照着"假的尺寸"避障，直接穿进石头里。
 * rock 实测：跨度≈2.5×scale，露出地面高≈1.2×scale
 * boulder 实测：跨度≈4.8×scale，露出地面高≈2.5×scale
 */
const PROP_METRICS = {
  pine: { h: 8.2, r: 0.55 },
  pineSnow: { h: 7.2, r: 0.5 },
  broadleaf: { h: 8.8, r: 0.7 },
  broadleafTall: { h: 13.5, r: 0.85 },
  palm: { h: 9.0, r: 0.5 },
  aridTree: { h: 5.4, r: 0.85 },
  swampTree: { h: 6.4, r: 1.0 },
  boulder: { h: 2.6, r: 2.4 },
  rock: { h: 1.3, r: 1.25 },
};

/** 需要贴合地形法线站立的植被（避免在坡地上歪倒 / 陷入地面） */
const ALIGN_TO_GROUND = new Set([
  'pine', 'pineSnow', 'broadleaf', 'broadleafTall', 'palm', 'aridTree', 'swampTree', 'cactus', 'bush', 'bushSmall',
]);

export class World {
  constructor(scene, terrain, opts = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.seed = terrain.seed;
    this.quality = opts.quality || '中';
    const q = QUALITY[this.quality] || QUALITY['中'];
    this.segments = q.segments;
    // 告诉地形当前的网格步长 —— 角色 / 道具贴地都要用它才不会悬空
    this.terrain.meshStep = CHUNK_SIZE / this.segments;
    this.viewChunks = q.viewChunks;
    this.grassRadius = q.grassRadius;
    this.shadows = q.shadows;

    this.chunks = new Map();       // 已加载地形块
    this.regions = new Map();      // 已加载资源区域
    this.pending = [];             // 待生成队列
    this.entities = new Map();     // 区域 → 地标描述

    this.terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.propMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.grassMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.1, transparent: false,
    });

    this.geoCache = {};
    this._initGeometries();

    this.onLandmarks = null;       // (descriptors[]) => void
    this.stats = { chunks: 0, regions: 0, tris: 0 };
  }

  _initGeometries() {
    this.geoCache.pine = P.makePine({ height: 8.2, radial: 7 });
    this.geoCache.pineSnow = P.makePine({ height: 7.2, radial: 7, snowy: true });
    this.geoCache.broadleaf = P.makeBroadleaf({ height: 7.6, radial: 7 });
    this.geoCache.broadleafTall = P.makeBroadleaf({ height: 11.0, radial: 8 });
    this.geoCache.palm = P.makePalm({ height: 9.0 });
    this.geoCache.cactus = P.makeCactus({ height: 3.6 });
    // 原来这里只有一棵"枯树"，沙漠和沼泽共用 —— 现在拆成两种有叶的乔木：
    // 沙漠用旱生黄绿、树形偏矮；沼泽用湿生浓绿、树形更高更密。
    this.geoCache.aridTree = P.makeGnarledTree({
      height: 5.4, leaf: 0.86, leafColor: 0x7f924e, leafColor2: 0x99a962,
    });
    this.geoCache.swampTree = P.makeGnarledTree({
      height: 6.4, leaf: 1.16, branches: 7, leafColor: 0x4f8a3d, leafColor2: 0x6ba24a,
    });
    // 岩石半径按"主石半径"解释：rock ≈ 1.2m 主石，boulder ≈ 2.1m 主石
    this.geoCache.rock = P.makeRockCluster({ size: 1.15, count: 3, detail: 0 });
    this.geoCache.boulder = P.makeRockCluster({ size: 2.1, count: 3, detail: 1, seedish: 1.7 });
    this.geoCache.bush = P.makeBush({ size: 1.5 });
    this.geoCache.bushSmall = P.makeBush({ size: 1.0 });
    this.geoCache.grass = P.makeGrassTuft({ height: 0.5, blades: 4 });
    this.geoCache.grassTall = P.makeGrassTuft({ height: 0.95, blades: 5, color: 0x8bab57 });
    this.geoCache.flowerA = P.makeFlower({ color: 0xff86b0 });
    this.geoCache.flowerB = P.makeFlower({ color: 0xffd166 });
    this.geoCache.flowerC = P.makeFlower({ color: 0xbba6ff });
    this.geoCache.reed = P.makeReed({ height: 1.3 });
  }

  setQuality(name) {
    const q = QUALITY[name];
    if (!q || name === this.quality) return false;
    this.quality = name;
    this.segments = q.segments;
    this.terrain.meshStep = CHUNK_SIZE / this.segments;   // 画质变了，网格步长跟着变
    this.viewChunks = q.viewChunks;
    this.grassRadius = q.grassRadius;
    this.shadows = q.shadows;
    this.rebuild();
    return true;
  }

  rebuild() {
    for (const c of this.chunks.values()) this._disposeChunk(c);
    this.chunks.clear();
    for (const arr of this.regions.values()) this._disposeRegion(arr);
    this.regions.clear();
    this.entities.clear();
    this.pending.length = 0;
  }

  /* ==================== 地形块 ==================== */
  _buildChunk(cx, cz) {
    const seg = this.segments;
    const size = CHUNK_SIZE;
    const step = size / seg;
    const ox = cx * size, oz = cz * size;
    const side = seg + 1;
    const count = side * side;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const heights = new Float32Array(count);
    const rgb = [0, 0, 0];
    const terrain = this.terrain;

    // 1) 只做高度采样（每顶点 1 次噪声求值）
    let p = 0;
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const wx = ox + i * step;
        const wz = oz + j * step;
        const h = terrain.height(wx, wz);
        heights[p] = h;
        positions[p * 3] = i * step;
        positions[p * 3 + 1] = h;
        positions[p * 3 + 2] = j * step;
        p++;
      }
    }

    // 2) 气候场：稀疏采样 + 双线性插值（气候是低频信号，无需逐顶点求值）
    const CL_STRIDE = 4;
    const cn = Math.ceil(seg / CL_STRIDE) + 1;
    const climT = new Float32Array(cn * cn);
    const climM = new Float32Array(cn * cn);
    for (let j = 0; j < cn; j++) {
      for (let i = 0; i < cn; i++) {
        const wx = ox + Math.min(i * CL_STRIDE, seg) * step;
        const wz = oz + Math.min(j * CL_STRIDE, seg) * step;
        climT[j * cn + i] = terrain.temperature(wx, wz);
        climM[j * cn + i] = terrain.moisture(wx, wz);
      }
    }

    // 3) 着色：坡度用网格高度差估算，气候用插值，避免重复的高度采样风暴
    const clim = { t: 0, m: 0 };
    const inv2Step = 1 / (2 * step);
    p = 0;
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        // 坡度（中心差分，边界退化为单侧差分）
        const iL = i > 0 ? i - 1 : i;
        const iR = i < seg ? i + 1 : i;
        const jD = j > 0 ? j - 1 : j;
        const jU = j < seg ? j + 1 : j;
        const dx = (heights[j * side + iR] - heights[j * side + iL]) * inv2Step;
        const dz = (heights[jU * side + i] - heights[jD * side + i]) * inv2Step;
        const s = Math.min(Math.hypot(dx, dz) / 2.2, 1);

        // 气候双线性插值
        const fx = i / CL_STRIDE, fz = j / CL_STRIDE;
        const i0 = Math.min(Math.floor(fx), cn - 2);
        const j0 = Math.min(Math.floor(fz), cn - 2);
        const tx = Math.min(fx - i0, 1), tz = Math.min(fz - j0, 1);
        const c00 = j0 * cn + i0, c10 = c00 + 1, c01 = c00 + cn, c11 = c01 + 1;
        clim.t = (climT[c00] * (1 - tx) + climT[c10] * tx) * (1 - tz)
               + (climT[c01] * (1 - tx) + climT[c11] * tx) * tz;
        clim.m = (climM[c00] * (1 - tx) + climM[c10] * tx) * (1 - tz)
               + (climM[c01] * (1 - tx) + climM[c11] * tx) * tz;

        terrain.surfaceColor(ox + i * step, oz + j * step, heights[p], s, rgb, clim);
        colors[p * 3] = rgb[0];
        colors[p * 3 + 1] = rgb[1];
        colors[p * 3 + 2] = rgb[2];
        p++;
      }
    }

    const indices = [];
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * side + i;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.terrainMaterial);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = this.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `chunk_${cx}_${cz}`;
    this.scene.add(mesh);
    return { mesh, geo, cx, cz };
  }

  _disposeChunk(c) {
    this.scene.remove(c.mesh);
    c.geo.dispose();
  }

  /* ==================== 资源区域（植被） ==================== */
  _scatterRegion(rx, rz, wantGrass, near = true) {
    const terrain = this.terrain;
    const size = REGION_SIZE;
    const ox = rx * size, oz = rz * size;
    const rand = rngFromChunk(rx, rz, this.seed ^ 0x9e37);

    const buckets = new Map();
    const blockers = [];
    const push = (key, m) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(m);
    };

    const dummy = new THREE.Object3D();
    const step = near ? 3.8 : 5.4;   // 远处区域用更粗的采样步长：更省 CPU、更少实例
    const half = step / 2;

    // 区域气候（低频信号）：3x3 控制网格 + 双线性插值，避免逐点求噪声
    const cn = 4;
    const climT = new Float32Array(cn * cn);
    const climM = new Float32Array(cn * cn);
    for (let j = 0; j < cn; j++) {
      for (let i = 0; i < cn; i++) {
        const wx = ox + (i / (cn - 1)) * size;
        const wz = oz + (j / (cn - 1)) * size;
        climT[j * cn + i] = terrain.temperature(wx, wz);
        climM[j * cn + i] = terrain.moisture(wx, wz);
      }
    }
    const cl = { t: 0, m: 0 };

    for (let gx = ox; gx < ox + size; gx += step) {
      for (let gz = oz; gz < oz + size; gz += step) {
        const r0 = rand();
        const x = gx + rand() * step - half;
        const z = gz + rand() * step - half;
        const h = terrain.height(x, z);
        if (h < SEA_LEVEL + 0.9) continue;

        // 气候插值
        const fx = (x - ox) / size * (cn - 1);
        const fz = (z - oz) / size * (cn - 1);
        const i0 = Math.min(Math.floor(fx), cn - 2);
        const j0 = Math.min(Math.floor(fz), cn - 2);
        const tx = Math.min(Math.max(fx - i0, 0), 1);
        const tz = Math.min(Math.max(fz - j0, 0), 1);
        const c00 = j0 * cn + i0, c10 = c00 + 1, c01 = c00 + cn, c11 = c01 + 1;
        cl.t = (climT[c00] * (1 - tx) + climT[c10] * tx) * (1 - tz)
             + (climT[c01] * (1 - tx) + climT[c11] * tx) * tz;
        cl.m = (climM[c00] * (1 - tx) + climM[c10] * tx) * (1 - tz)
             + (climM[c01] * (1 - tx) + climM[c11] * tx) * tz;

        // 坡度很贵（4 次高度采样）：只在高低海拔处先算，其余用估值，
        // 真正要放置物件时再补算精确坡度。
        let sExact = false;
        let s;
        if (h > 22 || h < SEA_LEVEL + 3.5) { s = terrain.slope(x, z); sExact = true; }
        else s = 0.16;

        const biome = terrain.biome(x, z, h, s, cl);
        const m = cl.m;
        const T = near ? 1 : 0.55;        // 远处树木密度系数
        const small = near;               // 远处不再生成小型装饰物

        let kind = null;
        let scale = 1;
        let key = null;

        const roll = r0;
        switch (biome.id) {
          case 'FOREST': {
            const density = (0.26 + m * 0.30) * T;
            if (roll < density * 0.34) {
              key = rand() < 0.68 ? 'pine' : 'broadleaf';
              if (rand() < 0.1) key = 'broadleafTall';
              scale = 0.78 + rand() * 0.55;
            } else if (small && roll < density * 0.42) {
              key = rand() < 0.55 ? 'bush' : 'bushSmall'; scale = 0.75 + rand() * 0.6;
            } else if (small && roll < density * 0.48) {
              key = 'rock'; scale = 0.6 + rand() * 0.7;
            } else if (wantGrass) {
              kind = 'grass';
              key = m > 0.34 ? 'grassTall' : 'grass';
              if (rand() < 0.10) key = rand() < 0.5 ? 'flowerA' : rand() < 0.5 ? 'flowerB' : 'flowerC';
            }
            break;
          }
          case 'GRASSLAND': {
            if (roll < 0.032 * T) { key = rand() < 0.72 ? 'broadleaf' : 'pine'; scale = 0.8 + rand() * 0.5; }
            else if (small && roll < 0.048) { key = rand() < 0.4 ? 'bush' : 'bushSmall'; scale = 0.7 + rand() * 0.6; }
            else if (small && roll < 0.068) { key = 'rock'; scale = 0.5 + rand() * 0.8; }
            else if (wantGrass) {
              kind = 'grass';
              key = 'grass';
              if (rand() < 0.14) key = rand() < 0.5 ? 'flowerA' : rand() < 0.5 ? 'flowerB' : 'flowerC';
              else if (rand() < 0.2) key = 'grassTall';
            }
            break;
          }
          case 'BEACH': {
            if (roll < 0.04 * T) { key = 'palm'; scale = 0.85 + rand() * 0.4; }
            else if (small && roll < 0.075) { key = 'rock'; scale = 0.5 + rand() * 0.6; }
            else if (wantGrass && rand() < 0.35) { kind = 'grass'; key = 'grass'; }
            break;
          }
          case 'DESERT': {
            if (roll < 0.045 * T) { key = 'cactus'; scale = 0.8 + rand() * 0.7; }
            else if (small && roll < 0.10) { key = 'rock'; scale = 0.5 + rand() * 0.9; }
            else if (small && roll < 0.125) { key = 'aridTree'; scale = 0.7 + rand() * 0.5; }
            else if (wantGrass && rand() < 0.25) { kind = 'grass'; key = 'grassTall'; }
            break;
          }
          case 'SNOW': {
            if (roll < 0.11 * T) { key = rand() < 0.78 ? 'pineSnow' : 'pine'; scale = 0.75 + rand() * 0.6; }
            else if (small && roll < 0.17) { key = 'rock'; scale = 0.6 + rand() * 1.0; }
            break;
          }
          case 'MOUNTAIN': {
            if (roll < 0.05 * T) { key = 'pine'; scale = 0.6 + rand() * 0.5; }
            else if (roll < 0.18) { key = rand() < 0.3 ? 'boulder' : 'rock'; scale = 0.6 + rand() * 1.3; }
            break;
          }
          case 'HIGHLAND': {
            if (roll < 0.075 * T) { key = 'pine'; scale = 0.65 + rand() * 0.55; }
            else if (roll < 0.2) { key = 'rock'; scale = 0.6 + rand() * 1.1; }
            else if (wantGrass && rand() < 0.4) { kind = 'grass'; key = 'grassTall'; }
            break;
          }
          case 'SWAMP': {
            if (roll < 0.09 * T) { key = 'swampTree'; scale = 0.8 + rand() * 0.6; }
            else if (wantGrass && roll < 0.5) { kind = 'grass'; key = 'reed'; }
            break;
          }
          default: break;
        }

        if (!key) continue;
        if (kind !== 'grass' && !this.geoCache[key]) continue;
        // 真正的坡度校验（只有确实要放东西时才付这 4 次高度采样的代价）
        if (kind !== 'grass' && !sExact) {
          s = terrain.slope(x, z);
          if (s > 0.66) continue;
        }

        const sy = kind === 'grass'
          ? 0.68 + rand() * 0.6
          : scale * (0.9 + rand() * 0.2);
        const sxz = kind === 'grass'
          ? 0.75 + rand() * 0.55
          : scale * (0.9 + rand() * 0.2);
        const yaw = rand() * Math.PI * 2;

        // 落点高度用 meshHeight（与画出来的地形网格逐点一致）。
        // 上面算出的 h 是解析高度，只用来判生物群系和海平面 ——
        // 拿它当摆放高度的话，植被和石头就会悬在半空或埋进土里。
        const hy = terrain.meshHeight(x, z);

        // 树木 / 灌木沿地形法线站立（按 55% 混合），避免在坡地上歪倒或陷进地面
        if (kind !== 'grass' && ALIGN_TO_GROUND.has(key)) {
          const n = terrain.normal(x, z, 1.3);
          _up.set(n[0] * 0.55, 1 + (n[1] - 1) * 0.55, n[2] * 0.55).normalize();
          dummy.quaternion.setFromUnitVectors(_yAxis, _up);
          dummy.rotateY(yaw);
          dummy.position.set(x, hy - 0.08, z);
        } else {
          dummy.position.set(x, hy - 0.1, z);
          dummy.rotation.set(0, yaw, 0);
          if (kind !== 'grass' && s > 0.35) dummy.rotation.z = (rand() - 0.5) * 0.12;
        }
        dummy.scale.set(sxz, sy, sxz);
        dummy.updateMatrix();
        push(key, dummy.matrix.clone());
        // 记录相机遮挡体（树木 / 巨石）
        const metric = kind === 'grass' ? null : PROP_METRICS[key];
        if (metric) {
          blockers.push({
            x, y: hy, z,
            r: metric.r * scale + 0.35,
            h: metric.h * sy,
          });
        }
      }
    }

    /* --- 创建 InstancedMesh --- */
    const group = new THREE.Group();
    group.name = `region_${rx}_${rz}`;
    group.userData.matrices = buckets;
    group.userData.blockers = blockers;
    for (const [key, mats] of buckets) {
      const geo = this.geoCache[key];
      if (!geo) continue;
      const isGrass = ['grass', 'grassTall', 'flowerA', 'flowerB', 'flowerC', 'reed'].includes(key);
      const mat = isGrass ? this.grassMaterial : this.propMaterial;
      const inst = new THREE.InstancedMesh(geo, mat, mats.length);
      for (let i = 0; i < mats.length; i++) inst.setMatrixAt(i, mats[i]);
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = this.shadows && !isGrass;
      inst.receiveShadow = false;
      inst.frustumCulled = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    this.scene.add(group);
    return { group, rx, rz };
  }

  _disposeRegion(r) {
    this.scene.remove(r.group);
    r.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }

  /**
   * 收集玩家附近可能遮挡相机的植被（复用缓冲区，避免每帧分配）
   * @returns {Array<{x,y,z,r,h}>}
   */
  blockersNear(x, z, radius = 22) {
    if (!this._blockerBuf) this._blockerBuf = [];
    const out = this._blockerBuf;
    out.length = 0;
    const r2 = radius * radius;
    for (const r of this.regions.values()) {
      const list = r.group.userData.blockers;
      if (!list || !list.length) continue;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const dx = b.x - x, dz = b.z - z;
        if (dx * dx + dz * dz < r2) out.push(b);
      }
    }
    return out;
  }

  /* ==================== 地标 ==================== */
  _genLandmarks(rx, rz) {
    const rand = rngFromChunk(rx, rz, this.seed ^ 0x5bd1);
    const out = [];
    const size = REGION_SIZE;
    const ox = rx * size, oz = rz * size;

    const findSpot = (minH, maxSlope) => {
      for (let k = 0; k < 14; k++) {
        const x = ox + rand() * size;
        const z = oz + rand() * size;
        // 地标同样要贴着画出来的地面，否则宝箱 / 神瞳会浮在坡上
        const h = this.terrain.meshHeight(x, z);
        const s = this.terrain.slope(x, z);
        if (h > minH && s < maxSlope) return { x, h, z };
      }
      return null;
    };

    // 宝箱
    const chestCount = rand() < 0.55 ? 1 : rand() < 0.5 ? 2 : 0;
    for (let i = 0; i < chestCount; i++) {
      const sp = findSpot(SEA_LEVEL + 1.2, 0.42);
      if (sp) out.push({ id: `chest:${rx}:${rz}:${i}`, type: 'chest', x: sp.x, y: sp.h, z: sp.z });
    }
    // 风之瞳
    const orbCount = rand() < 0.5 ? 1 : rand() < 0.6 ? 2 : 0;
    for (let i = 0; i < orbCount; i++) {
      const sp = findSpot(SEA_LEVEL + 2.0, 0.75);
      if (sp) out.push({ id: `orb:${rx}:${rz}:${i}`, type: 'orb', x: sp.x, y: sp.h + 2.2, z: sp.z });
    }
    // 篝火
    if (rand() < 0.22) {
      const sp = findSpot(SEA_LEVEL + 1.5, 0.30);
      if (sp) out.push({ id: `camp:${rx}:${rz}:0`, type: 'camp', x: sp.x, y: sp.h, z: sp.z });
    }
    // 传送锚点（稀疏）
    const wh = hash2i(rx, rz, this.seed ^ 0x77);
    if (wh < 0.055) {
      const sp = findSpot(SEA_LEVEL + 2.0, 0.35);
      if (sp) out.push({ id: `way:${rx}:${rz}:0`, type: 'waypoint', x: sp.x, y: sp.h, z: sp.z });
    }
    return out;
  }

  /* ==================== 更新 / 流式加载 ==================== */
  update(playerPos, timeBudgetMs = 7) {
    const start = performance.now();
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    const R = this.viewChunks;

    // 1) 生成需要的地形块列表
    const wanted = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const d2 = dx * dx + dz * dz;
        if (d2 > (R + 0.35) * (R + 0.35)) continue;
        const key = cx + ',' + cz;
        if (!this.chunks.has(key)) wanted.push({ cx, cz, d2 });
      }
    }
    wanted.sort((a, b) => a.d2 - b.d2);

    for (const w of wanted) {
      if (performance.now() - start > timeBudgetMs) break;
      const c = this._buildChunk(w.cx, w.cz);
      this.chunks.set(w.cx + ',' + w.cz, c);
    }

    // 2) 卸载远处地形块
    const maxD = (R + 2) * (R + 2);
    for (const [key, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > maxD) {
        this._disposeChunk(c);
        this.chunks.delete(key);
      }
    }

    // 3) 资源区域（REGION_CHUNKS x REGION_CHUNKS 块）
    const viewDist = R * CHUNK_SIZE;
    const maxRegionDist = viewDist + REGION_SIZE * 0.45;
    const prx = Math.floor(playerPos.x / REGION_SIZE);
    const prz = Math.floor(playerPos.z / REGION_SIZE);
    const RR = Math.ceil(maxRegionDist / REGION_SIZE);
    const wantedRegions = [];
    for (let dz = -RR; dz <= RR; dz++) {
      for (let dx = -RR; dx <= RR; dx++) {
        const rx = prx + dx, rz = prz + dz;
        const key = rx + ',' + rz;
        if (this.regions.has(key)) continue;
        // 用区域中心到玩家的真实距离判断，避免加载视野外的“角落区域”
        const cxm = (rx + 0.5) * REGION_SIZE;
        const czm = (rz + 0.5) * REGION_SIZE;
        const dWorld = Math.hypot(cxm - playerPos.x, czm - playerPos.z);
        if (dWorld > maxRegionDist) continue;
        wantedRegions.push({ rx, rz, dWorld });
      }
    }
    wantedRegions.sort((a, b) => a.dWorld - b.dWorld);
    for (const w of wantedRegions) {
      if (performance.now() - start > timeBudgetMs * 1.6) break;
      const wantGrass = w.dWorld < viewDist * 0.5;
      const near = w.dWorld < viewDist * 0.75;
      const r = this._scatterRegion(w.rx, w.rz, wantGrass, near);
      this.regions.set(w.rx + ',' + w.rz, r);
      // 地标
      const lms = this._genLandmarks(w.rx, w.rz);
      this.entities.set(w.rx + ',' + w.rz, lms);
      if (this.onLandmarks) this.onLandmarks(lms);
    }
    // 卸载远处资源区域
    for (const [key, r] of this.regions) {
      const dx = r.rx - prx, dz = r.rz - prz;
      if (Math.abs(dx) > RR + 1 || Math.abs(dz) > RR + 1) {
        this._disposeRegion(r);
        this.regions.delete(key);
        this.entities.delete(r.rx + ',' + r.rz);
        if (this.onRegionUnload) this.onRegionUnload(r.rx, r.rz);
      }
    }

    this.stats.chunks = this.chunks.size;
    this.stats.regions = this.regions.size;
  }

  /** 当前的区域加载是否已完成（用于开场加载） */
  isAreaReady(playerPos) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.chunks.has((pcx + dx) + ',' + (pcz + dz))) return false;
      }
    }
    return true;
  }

  /** 在给定坐标附近寻找一块平坦的出生点 */
  findSpawn(startX = 0, startZ = 0) {
    let best = { x: startX, z: startZ, h: 0, score: -1e9 };
    for (let r = 0; r < 900; r += 24) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2 + r * 0.13;
        const x = startX + Math.cos(ang) * r;
        const z = startZ + Math.sin(ang) * r;
        const h = this.terrain.height(x, z);
        if (h < SEA_LEVEL + 3) continue;
        const s = this.terrain.slope(x, z);
        const biome = this.terrain.biome(x, z, h, s);
        if (biome.id === 'OCEAN') continue;
        const score = -s * 100 - Math.abs(h - 9) * 0.4 + (biome.id === 'GRASSLAND' ? 12 : 0) + (biome.id === 'FOREST' ? 8 : 0);
        if (score > best.score) best = { x, z, h, score };
      }
      if (best.score > -20) break;
    }
    return best;
  }
}
