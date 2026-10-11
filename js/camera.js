/* ============================================================
 *  camera.js — 第三人称跟随相机（含地形避障、第一人称、轻微抖动）
 * ============================================================ */
import * as THREE from '../libs/three.module.js';
import { clamp, lerp } from './noise.js';

/** 镜头被遮挡时允许压到的最近距离 */
const MIN_DIST = 1.5;
/** 低于这个距离就算"镜头被顶住了"，会尝试抬高机位 */
const COMFORT_DIST = 3.4;
/** 探头步长（米）：足够密才不会漏掉近处的崖壁 */
const PROBE_STEP = 0.35;

export class CameraRig {
  constructor(camera, terrain, opts = {}) {
    this.camera = camera;
    this.terrain = terrain;
    this.yaw = Math.PI;
    this.pitch = -0.16;
    this.distance = 6.0;
    this.targetDistance = 6.0;
    this.minDistance = 1.9;
    this.maxDistance = 15;
    this.height = 1.45;
    this.pitchMin = -1.15;
    this.pitchMax = 1.05;
    this.smoothPos = new THREE.Vector3();
    this.smoothLook = new THREE.Vector3();
    this.firstPerson = false;
    this.shake = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this.fov = opts.fov || 75;
    this.sensitivityScale = 1;
    this._init = false;
    /** 由外部注入：(x, z) => 附近的植被遮挡体列表 */
    this.blockerProvider = null;
    this._blockers = [];
  }

  /** 该点是否位于树木/巨石的遮挡体内 */
  _insideProp(x, y, z) {
    const list = this._blockers;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz < b.r * b.r && y < b.y + b.h && y > b.y - 1.2) return true;
    }
    return false;
  }

  addShake(v) { this.shake = Math.min(1.2, this.shake + v); }

  handleMouse(dx, dy) {
    this.yaw -= dx * this.sensitivityScale;
    this.pitch -= dy * this.sensitivityScale;
    this.pitch = clamp(this.pitch, this.pitchMin, this.pitchMax);
  }

  handleWheel(w) {
    if (!w) return;
    this.targetDistance = clamp(this.targetDistance + w * 0.9, this.minDistance, this.maxDistance);
  }

  toggleFirstPerson() {
    this.firstPerson = !this.firstPerson;
    return this.firstPerson;
  }

  /**
   * 沿指定俯仰角，从焦点向镜头方向密集步进，试探"能拉多远而不被挡住"
   * @returns {number} 该角度下实际可用的镜头距离
   */
  _probe(focus, pitch, dist) {
    const terrain = this.terrain;
    const cy = Math.cos(pitch);
    const dx = Math.sin(this.yaw) * cy;
    const dy = Math.sin(pitch);
    const dz = Math.cos(this.yaw) * cy;
    const steps = Math.max(16, Math.ceil(dist / PROBE_STEP));
    for (let i = 1; i <= steps; i++) {
      const tt = (i / steps) * dist;
      const sx = focus.x + dx * tt;
      const sz = focus.z + dz * tt;
      const sy = focus.y - dy * tt + 0.25;
      // 地形：走到崖壁前就停住（留 0.55m 余量）
      if (sy < terrain.meshHeight(sx, sz) + 0.65) return clamp(tt - 0.55, MIN_DIST, dist);
      // 植被：只统计离角色 2.2m 之外的树干，拉到障碍前但不贴脸
      if (tt > 2.2 && this._insideProp(sx, sy, sz)) return clamp(tt - 0.5, 2.0, dist);
    }
    return dist;
  }

  /**
   * @param player 玩家
   * @param dt 时间步
   * @param useSmooth 是否使用平滑（加载/传送时可直接吸附）
   */
  update(player, dt, useSmooth = true) {
    const terrain = this.terrain;
    const px = player.position.x, py = player.position.y, pz = player.position.z;

    const focus = this._tmp.set(px, py + this.height + (player.swimming ? -0.35 : 0), pz);

    // 期望的相机位置
    // 注意：这里必须用 targetDistance（玩家设定的目标距离）作为探测上限，
    // 不能用 this.distance —— 否则会形成"单向棘轮"：一旦被地形压近过一次，
    // 探测上限也跟着变小，镜头就再也拉不回来了。
    const maxDist = this.firstPerson ? 0.35 : this.targetDistance;
    const dirX = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * Math.cos(this.pitch);

    let ox = focus.x + dirX * maxDist;
    let oy = focus.y - dirY * maxDist + (this.firstPerson ? 0.12 : 0.25);
    let oz = focus.z + dirZ * maxDist;

    // 避障：从焦点向相机位置密集步进，遇到地形/植被就停在障碍物之前
    if (!this.firstPerson) {
      // 收集附近植被遮挡体
      this._blockers = this.blockerProvider ? this.blockerProvider(focus.x, focus.z) : [];

      // 先用用户当前的俯仰角探一次
      let pitchUse = this.pitch;
      let realDist = this._probe(focus, pitchUse, maxDist);

      // 被土坡 / 树冠顶住时，不要硬挤到角色脸上（那样角色会占满画面被迫隐藏）——
      // 改为逐级抬高镜头改走"俯视机位"，只要能看清角色就不再继续抬
      if (realDist < COMFORT_DIST) {
        let bestPitch = pitchUse, bestDist = realDist;
        for (let k = 1; k <= 5; k++) {
          const p2 = clamp(this.pitch - k * 0.20, this.pitchMin, this.pitchMax);
          if (p2 === pitchUse) break;
          const d2 = this._probe(focus, p2, maxDist);
          if (d2 > bestDist) { bestDist = d2; bestPitch = p2; }
          if (bestDist >= COMFORT_DIST) break;
        }
        realDist = bestDist;
        pitchUse = bestPitch;
      }

      // 平滑拉近（拉近反应要快，拉远慢一些，避免镜头跳动）
      if (realDist < this.distance) this.distance = lerp(this.distance, realDist, clamp(1 - Math.pow(1e-12, dt), 0, 1));
      else this.distance = lerp(this.distance, realDist, 1 - Math.pow(0.35, dt));

      const cy = Math.cos(pitchUse);
      ox = focus.x + Math.sin(this.yaw) * cy * this.distance;
      oy = focus.y - Math.sin(pitchUse) * this.distance + 0.25;
      oz = focus.z + Math.cos(this.yaw) * cy * this.distance;
      // 最终再夹一次：镜头绝不允许低于地面
      const gh = terrain.meshHeight(ox, oz) + 0.75;
      if (oy < gh) oy = gh;
    } else {
      // 第一人称：眼睛位置
      ox = focus.x + dirX * 0.3;
      oy = py + 1.62;
      oz = focus.z + dirZ * 0.3;
    }

    const targetPos = this._tmp2.set(ox, oy, oz);

    if (!this._init || !useSmooth) {
      this.smoothPos.copy(targetPos);
      this.smoothLook.copy(focus);
      this._init = true;
    } else {
      const posLerp = 1 - Math.pow(0.00001, dt * (player.state === 'glide' ? 0.55 : 1));
      const lookLerp = 1 - Math.pow(0.0000001, dt);
      this.smoothPos.lerp(targetPos, clamp(posLerp, 0, 1));
      this.smoothLook.lerp(focus, clamp(lookLerp, 0, 1));
      // 垂直方向单独平滑，减少上下颠簸
      this.smoothPos.y = lerp(this.smoothPos.y, targetPos.y, clamp(1 - Math.pow(0.0005, dt), 0, 1));
    }

    this.camera.position.copy(this.smoothPos);
    if (!this.firstPerson) {
      // 平滑之后仍要再夹一次：镜头绝不允许低于地面
      // （只把约束加在"目标位置"上是不够的 —— 平滑滞后会让镜头在快速移动/传送后短暂陷进山体）
      const gh2 = terrain.meshHeight(this.camera.position.x, this.camera.position.z) + 0.6;
      if (this.camera.position.y < gh2) {
        this.camera.position.y = gh2;
        this.smoothPos.y = gh2;
      }
      // 平滑滞后还有一个副作用：快速转动镜头时，平滑中的位置还没到位，
      // 这一小段时间里"角色 → 镜头"的视线会从山体里穿过去，角色被挡在坡后面。
      // 所以再沿真实连线检查一次，被挡就把镜头拉到障碍之前。
      if (this._init) {
        const dx = this.smoothPos.x - focus.x;
        const dy = this.smoothPos.y - focus.y;
        const dz = this.smoothPos.z - focus.z;
        const L = Math.hypot(dx, dy, dz);
        if (L > 0.6) {
          const steps = Math.max(8, Math.ceil(L / PROBE_STEP));
          let cut = L;
          for (let i = 1; i <= steps; i++) {
            const tt = (i / steps) * L;
            const sx = focus.x + (dx / L) * tt;
            const sy = focus.y + (dy / L) * tt;
            const sz = focus.z + (dz / L) * tt;
            if (sy < terrain.meshHeight(sx, sz) + 0.5) { cut = Math.max(1.4, tt - 0.5); break; }
          }
          if (cut < L) {
            const k = cut / L;
            this.smoothPos.set(focus.x + dx * k, focus.y + dy * k, focus.z + dz * k);
            this.camera.position.copy(this.smoothPos);
          }
        }
      }
    }
    this.camera.fov = lerp(this.camera.fov, this.fov + clamp(player.speed - 8, 0, 6) * 0.9 + (player.gliding ? 6 : 0), 1 - Math.pow(0.02, dt));
    this.camera.updateProjectionMatrix();

    const look = this.smoothLook;
    this.camera.lookAt(look.x, look.y + (this.firstPerson ? 0 : 0.05), look.z);

    // 抖动
    if (this.shake > 0.001) {
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.28;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.28;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.28;
      this.shake = Math.max(0, this.shake - dt * 3.2);
    }

    return this.camera;
  }

  /** 相机朝向的水平角（用于角色移动方向） */
  get moveYaw() { return this.yaw + Math.PI; }

  /** 相机正前方（世界方向）：yaw 描述的是"角色 → 相机"，所以正前方是它的反方向 */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
}
