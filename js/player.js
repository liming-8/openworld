/* ============================================================
 *  player.js — 角色：模型、物理、状态机、程序化动画
 *  状态：idle / run / sprint / jump / fall / glide / swim / slide
 *
 *  模型：全部由基础几何体程序化拼接 + 顶点色，再按“可动部件”合并成
 *  少量网格（躯干 / 头 / 大臂 / 小臂 / 大腿 / 小腿 / 披风），
 *  共用同一个材质，既精细又把 draw call 压在 13 个左右。
 * ============================================================ */
import * as THREE from '../libs/three.module.js';
import { clamp, lerp } from './noise.js';
import { SEA_LEVEL } from './terrain.js';
import { paint, mergeGeoms } from './props.js';

export const PLAYER = {
  radius: 0.42,
  height: 1.78,
  walkSpeed: 5.4,
  runSpeed: 8.8,
  sprintSpeed: 11.6,
  swimSpeed: 3.4,
  glideSpeed: 13.5,
  accelGround: 46,
  accelAir: 16,
  frictionGround: 12,
  frictionAir: 1.1,
  gravity: 26,
  jumpSpeed: 9.4,
  glideFall: -2.4,
  glideDrain: 6,
  sprintDrain: 7.5,
  swimDrain: 2.2,
  staminaMax: 100,
  staminaRegen: 22,
  healthMax: 100,
  /** 最大可攀爬坡度（tan 值）：1.9 ≈ 62° */
  climbSlope: 1.9,
  /** 陡坡下滑加速度上限 */
  slideAccel: 15,
};

/* ---------------- 调色板 ---------------- */
const C = {
  skin: 0xf5d3ad, skinDark: 0xdfb287,
  hair: 0x2e2c3c, hairTip: 0x4b4763,
  tunic: 0x2fa093, tunicDark: 0x1f7a70, trim: 0xf2d79a,
  pants: 0x46566f, pantsDark: 0x36435a,
  boot: 0x5a3d22, bootSole: 0x3a2814,
  scarf: 0xff8f3f, scarfDark: 0xd96f28,
  pack: 0x7d5c39, strap: 0x4e3a25, belt: 0x5e4126, gold: 0xe0b054,
  eye: 0x1d2430,
};

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

/* ---------------- 几何工具 ---------------- */
function P(geo, hex, x = 0, y = 0, z = 0, variation = 0.05) {
  if (x || y || z) geo.translate(x, y, z);
  return paint(geo, hex, variation);
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cap = (r, h, seg = 8) => new THREE.CapsuleGeometry(r, h, 3, seg);
const sph = (r, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3));

/** 合并部件并生成网格（共用材质） */
function meshOf(parts, cast = true) {
  const g = mergeGeoms(parts);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, MAT);
  m.castShadow = cast;
  return m;
}

export class Player {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.grounded = true;
    this.groundY = 0;
    this.state = 'idle';
    this.facing = 0;
    this.targetFacing = 0;
    this.speed = 0;

    this.stamina = PLAYER.staminaMax;
    this.health = PLAYER.healthMax;
    this.airTime = 0;
    this.jumpHeld = 0;
    this.gliding = false;
    this.swimming = false;
    this.sliding = false;
    this.blockedTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.animPhase = 0;
    this.lanternOn = false;

    this._build();
  }

  /* ==================== 模型 ==================== */
  _build() {
    this.group = new THREE.Group();
    this.group.name = 'player';

    this.bodyPivot = new THREE.Group();
    this.group.add(this.bodyPivot);

    /* ---------- 躯干（合并） ---------- */
    const bodyParts = [];
    bodyParts.push(P(box(0.38, 0.44, 0.25), C.tunic, 0, 1.24, 0));            // 胸腹
    bodyParts.push(P(box(0.32, 0.20, 0.06), C.tunicDark, 0, 1.32, 0.125));    // 胸口护片
    bodyParts.push(P(cyl(0.205, 0.205, 0.085, 12), C.belt, 0, 1.01, 0));      // 腰带
    bodyParts.push(P(box(0.10, 0.075, 0.05), C.gold, 0, 1.01, 0.185));        // 带扣
    bodyParts.push(P(cyl(0.215, 0.30, 0.30, 12), C.tunicDark, 0, 0.86, 0));   // 短裙下摆
    bodyParts.push(P(box(0.30, 0.16, 0.22), C.pants, 0, 0.79, 0));            // 髋
    bodyParts.push(P(cyl(0.145, 0.165, 0.13, 12), C.scarf, 0, 1.50, 0));      // 领口围巾
    bodyParts.push(P(box(0.26, 0.28, 0.13), C.pack, 0, 1.21, -0.115));        // 背包（内收，避免顶破披风）
    const roll = cyl(0.058, 0.058, 0.32, 8); roll.rotateZ(Math.PI / 2);
    bodyParts.push(P(roll, C.trim, 0, 1.38, -0.13));                           // 卷铺盖
    const st1 = box(0.05, 0.40, 0.05); st1.rotateX(0.18);
    bodyParts.push(P(st1, C.strap, -0.115, 1.30, -0.10));
    const st2 = box(0.05, 0.40, 0.05); st2.rotateX(0.18);
    bodyParts.push(P(st2, C.strap, 0.115, 1.30, -0.10));
    bodyParts.push(P(box(0.12, 0.13, 0.10), C.pack, 0.205, 0.94, 0.06));      // 侧挂小包
    bodyParts.push(P(cyl(0.05, 0.05, 0.13, 8), C.trim, -0.205, 0.95, -0.06)); // 水壶
    for (const sx of [-1, 1]) {
      const pad = sph(0.10, 9); pad.scale(1.15, 0.75, 1.1);
      bodyParts.push(P(pad, C.tunicDark, sx * 0.215, 1.44, 0, 0.03));          // 肩甲
    }
    this.body = meshOf(bodyParts);
    this.bodyPivot.add(this.body);

    /* ---------- 头（合并） ---------- */
    this.head = new THREE.Group();
    this.head.position.y = 1.60;
    this.bodyPivot.add(this.head);

    const hp = [];
    hp.push(P(cyl(0.068, 0.075, 0.10, 8), C.skinDark, 0, -0.12, 0));          // 脖子
    const skull = sph(0.212, 14); skull.scale(1, 1.06, 0.97);
    hp.push(P(skull, C.skin, 0, 0, 0));
    // 颅顶发：只盖住头顶，露出面部
    const hairTop = new THREE.SphereGeometry(0.228, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.40);
    hp.push(P(hairTop, C.hair, 0, 0.016, -0.008, 0.03));
    // 后脑 + 两侧发：正面留开口（不遮眼）
    const hairBack = new THREE.SphereGeometry(0.226, 16, 10,
      Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.62);
    hp.push(P(hairBack, C.hair, 0, 0.014, -0.014, 0.03));
    hp.push(P(box(0.40, 0.105, 0.16), C.hair, 0, 0.135, 0.135, 0.03));        // 刘海
    hp.push(P(box(0.075, 0.24, 0.10), C.hair, -0.195, 0.0, 0.055, 0.03));     // 侧发
    hp.push(P(box(0.075, 0.24, 0.10), C.hair, 0.195, 0.0, 0.055, 0.03));
    const tail = cap(0.058, 0.18, 7); tail.rotateX(-2.09);
    hp.push(P(tail, C.hair, 0, 0.06, -0.21, 0.03));                            // 马尾（上扬，避免穿出披风）
    hp.push(P(sph(0.05, 8), C.hairTip, 0, -0.015, -0.355, 0.03));              // 发梢（贴合马尾末端）
    hp.push(P(sph(0.062, 8), C.trim, 0, 0.005, -0.175, 0.02));                 // 束发圈
    for (const sx of [-1, 1]) {
      hp.push(P(sph(0.027, 8), C.eye, sx * 0.076, 0.012, 0.192, 0));           // 眼
      const brow = box(0.072, 0.020, 0.028); brow.rotateZ(sx * 0.16);
      hp.push(P(brow, C.hair, sx * 0.078, 0.072, 0.188, 0.02));                // 眉
    }
    hp.push(P(box(0.035, 0.05, 0.045), C.skinDark, 0, -0.03, 0.196, 0));       // 鼻
    hp.push(P(cyl(0.175, 0.165, 0.10, 12), C.scarf, 0, -0.14, 0.01, 0.03));    // 围脖
    this.headMesh = meshOf(hp);
    this.head.add(this.headMesh);

    /* ---------- 四肢：两段式（带肘 / 膝） ---------- */
    const buildArm = (side) => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.275, 1.42, 0);
      upper.add(meshOf([
        P(cap(0.068, 0.20, 8), C.tunic, 0, -0.14, 0),
        P(sph(0.058, 8), C.tunicDark, 0, -0.30, 0),
      ]));
      this.bodyPivot.add(upper);

      const lower = new THREE.Group();
      lower.position.y = -0.30;
      upper.add(lower);
      lower.add(meshOf([
        P(cap(0.056, 0.17, 8), C.skin, 0, -0.115, 0),
        P(box(0.10, 0.11, 0.10), C.scarf, 0, -0.235, 0, 0.02),
        P(sph(0.052, 8), C.skinDark, 0, -0.30, 0),
      ]));
      return { upper, lower };
    };
    this.armL = buildArm(-1);
    this.armR = buildArm(1);

    const buildLeg = (side) => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.105, 0.83, 0);
      upper.add(meshOf([
        P(cap(0.085, 0.22, 8), C.pants, 0, -0.16, 0),
        P(sph(0.068, 8), C.pantsDark, 0, -0.33, 0),
      ]));
      this.bodyPivot.add(upper);

      const lower = new THREE.Group();
      lower.position.y = -0.33;
      upper.add(lower);
      lower.add(meshOf([
        P(cap(0.062, 0.17, 8), C.pantsDark, 0, -0.10, 0),
        P(box(0.155, 0.115, 0.20), C.boot, 0, -0.245, 0.025),
        P(box(0.14, 0.075, 0.10), C.boot, 0, -0.255, 0.135),
        P(box(0.165, 0.045, 0.30), C.bootSole, 0, -0.315, 0.05),
      ]));
      return { upper, lower };
    };
    this.legL = buildLeg(-1);
    this.legR = buildLeg(1);

    /* ---------- 披风：弧形壳体（贴合背部，可随速度飘动） ---------- */
    const capeGeo = new THREE.CylinderGeometry(0.19, 0.28, 0.52, 12, 8, true, -0.925, 1.85);
    capeGeo.scale(0.86, 1, 1.14);                         // 椭圆截面：横向收窄、向后延展
    capeGeo.translate(0, -0.26, 0);                       // 顶边对齐到原点
    this.cape = new THREE.Mesh(
      capeGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    );
    paint(this.cape.geometry, C.scarf, 0.05);
    this.cape.castShadow = true;
    this.cape.position.set(0, 1.49, -0.03);
    this.cape.rotation.y = Math.PI;
    this.capeBase = this.cape.geometry.attributes.position.array.slice();
    this.capeTarget = 0.3;
    this._capeK = 0.3;
    this.bodyPivot.add(this.cape);

    const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), new THREE.MeshLambertMaterial({ color: C.gold }));
    clasp.position.set(0, 1.46, 0.145);
    this.bodyPivot.add(clasp);

    /* ---------- 提灯 ---------- */
    this.lantern = new THREE.Group();
    this.lantern.add(new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.15, 8), new THREE.MeshBasicMaterial({ color: 0xffdb8a })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 6, 10), new THREE.MeshLambertMaterial({ color: 0x4a4038 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.095;
    this.lantern.add(ring);
    this.lanternLight = new THREE.PointLight(0xffc061, 0, 18, 2);
    this.lantern.add(this.lanternLight);
    this.lantern.position.set(0, -0.34, 0.06);
    this.lantern.visible = false;
    this.armL.lower.add(this.lantern);

    /* ---------- 落地阴影贴片 ---------- */
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, opacity: 0.26, depthWrite: false, color: 0x243040 })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
    this.group.add(this.blob);

    this.scene.add(this.group);
  }

  /* ==================== 位置与状态 ==================== */
  reset(x, y, z) {
    this.position.set(x, y, z);
    // 贴地一律用 meshHeight：它和画出来的地形网格逐点一致
    this.groundY = this.terrain.meshHeight(x, z);
    this.velocity.set(0, 0, 0);
    this.stamina = PLAYER.staminaMax;
    this.health = PLAYER.healthMax;
    this.blockedTime = 0;
    this.sliding = false;
    this.group.position.copy(this.position);
  }

  get isMoving() { return this.speed > 0.6; }

  /* ==================== 主更新 ==================== */
  update(dt, input, camYaw) {
    const P = PLAYER;
    const terrain = this.terrain;

    /* ---- 1. 输入方向（相机相对） ----
       cameraRig.yaw 描述的是“从角色指向相机”的方向，
       所以相机正前方是它的反方向 —— 之前 W/S 反了就是这里。 */
    const axis = input.moveAxis();
    const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const wish = new THREE.Vector3()
      .addScaledVector(forward, axis.y)
      .addScaledVector(right, axis.x);
    const wishLen = wish.length();
    if (wishLen > 0.001) wish.normalize();

    const sprinting = input.downAny(['ShiftLeft', 'ShiftRight']) && this.stamina > 1 && wishLen > 0.1 && !this.swimming;
    const wantsJump = input.down('Space');
    if (input.justPressed('Space')) this.jumpBuffer = 0.18;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    /* ---- 2. 环境检测 ----
       贴地用 meshHeight（= 地形网格逐点插值），不能用 height()：
       height() 里有比网格更细的细节，直接拿来当脚底高度就会悬空 / 陷地。 */
    const h = terrain.meshHeight(this.position.x, this.position.z);
    this.groundY = h;
    const wasGrounded = this.grounded;
    this.grounded = this.position.y <= h + 0.06 && this.velocity.y <= 0.6;

    if (this.grounded) { this.coyote = 0.12; this.airTime = 0; }
    else { this.coyote = Math.max(0, this.coyote - dt); this.airTime += dt; }

    const prevSwimming = this.swimming;
    this.swimming = this.position.y + 0.55 < SEA_LEVEL && h < SEA_LEVEL - 0.6;
    if (this.swimming && !prevSwimming) this.onEvent && this.onEvent('splash', this.position);

    /* ---- 3. 速度目标 ---- */
    const targetSpeed = this.swimming
      ? P.swimSpeed
      : sprinting ? P.sprintSpeed : P.runSpeed * 0.62;

    const slope = terrain.slope(this.position.x, this.position.z);
    const slopePenalty = 1 - smooth01(0.25, 0.8, slope) * 0.45;
    let desired = wish.clone().multiplyScalar(targetSpeed * slopePenalty * (wishLen > 0.1 ? 1 : 0));

    const canGlide = !this.grounded && !this.swimming && this.velocity.y < 1.5
      && this.airTime > 0.22 && this.stamina > 2;
    this.gliding = wantsJump && canGlide;
    if (this.gliding) {
      const dir = wishLen > 0.1
        ? wish
        : new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
      desired = dir.multiplyScalar(P.glideSpeed);
      this.velocity.y = lerp(this.velocity.y, P.glideFall, 1 - Math.pow(0.001, dt));
      this.stamina -= P.glideDrain * dt;
    }

    /* ---- 4. 加速 ---- */
    if (this.swimming) {
      this.velocity.x = moveToward(this.velocity.x, desired.x, 14 * dt);
      this.velocity.z = moveToward(this.velocity.z, desired.z, 14 * dt);
      const targetY = SEA_LEVEL - 0.35;
      this.velocity.y += (targetY - this.position.y) * 12 * dt;
      this.velocity.y *= Math.pow(0.02, dt);
      if (wantsJump) this.velocity.y += 8 * dt;
      this.stamina -= P.swimDrain * dt;
      this.velocity.y = clamp(this.velocity.y, -6, 5);
    } else {
      const accel = this.grounded ? P.accelGround : P.accelAir;
      if (desired.lengthSq() > 0.0001) {
        this.velocity.x = moveToward(this.velocity.x, desired.x, accel * dt);
        this.velocity.z = moveToward(this.velocity.z, desired.z, accel * dt);
      } else if (this.grounded) {
        const f = P.frictionGround * dt;
        this.velocity.x = moveToward(this.velocity.x, 0, f * Math.max(6, Math.abs(this.velocity.x)));
        this.velocity.z = moveToward(this.velocity.z, 0, f * Math.max(6, Math.abs(this.velocity.z)));
      } else {
        this.velocity.x *= Math.pow(0.35, dt);
        this.velocity.z *= Math.pow(0.35, dt);
      }
      if (!this.gliding) this.velocity.y -= P.gravity * dt;
      if (this.jumpBuffer > 0 && this.coyote > 0) {
        this.velocity.y = P.jumpSpeed;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.jumpHeld = 0.16;
        this.onEvent && this.onEvent('jump', this.position);
      }
    }

    const maxV = Math.hypot(this.velocity.x, this.velocity.z);
    if (maxV > P.sprintSpeed * 1.25) {
      const k = P.sprintSpeed * 1.25 / maxV;
      this.velocity.x *= k; this.velocity.z *= k;
    }

    /* ---- 5. 位移与陡坡处理（软限制 + 下滑，不再硬卡住） ---- */
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    const moved = Math.hypot(nx - this.position.x, nz - this.position.z);
    this.sliding = false;

    if (this.swimming) {
      this.position.x = nx;
      this.position.z = nz;
    } else {
      const nh = terrain.meshHeight(nx, nz);      // 与网格一致，越障判定才和看到的一致
      const dh = nh - this.position.y;
      const maxStep = 0.42 + moved * P.climbSlope;
      if (this.grounded && dh > maxStep) {
        // 太陡：只推进一部分，其余变成沿坡面下滑
        const k = clamp(maxStep / Math.max(dh, 1e-4), 0.08, 1);
        this.position.x += this.velocity.x * dt * k;
        this.position.z += this.velocity.z * dt * k;
        const n = terrain.normal(this.position.x, this.position.z, 1.5);
        const sl = Math.hypot(n[0], n[2]);
        if (sl > 1e-4) {
          const force = clamp((dh - maxStep) * 10, 0, P.slideAccel);
          this.velocity.x += (n[0] / sl) * force * dt;
          this.velocity.z += (n[2] / sl) * force * dt;
        }
        this.sliding = true;
        this.blockedTime += dt;
      } else {
        this.position.x = nx;
        this.position.z = nz;
        this.blockedTime = Math.max(0, this.blockedTime - dt * 2);
      }
    }

    this.position.y += this.velocity.y * dt;

    /* ---- 6. 地面吸附（脚不会陷进地形） ---- */
    const newH = terrain.meshHeight(this.position.x, this.position.z);
    this.groundY = newH;
    if (this.position.y <= newH) {
      if (!wasGrounded && this.velocity.y < -8) {
        this.onEvent && this.onEvent('land', this.position, -this.velocity.y);
      }
      this.position.y = newH;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }
    if (this.position.y < newH) this.position.y = newH;

    /* ---- 7. 体力 ---- */
    if (sprinting) this.stamina -= P.sprintDrain * dt;
    else if (!this.gliding && !this.swimming) {
      this.stamina += P.staminaRegen * (this.grounded ? 1 : 0.45) * dt;
    }
    this.stamina = clamp(this.stamina, -20, P.staminaMax);
    if (this.stamina < 0 && !this.swimming && !this.gliding) this.stamina += 22 * dt;

    /* ---- 8. 朝向与状态机 ---- */
    const hv = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = hv;
    if (hv > 0.35) this.targetFacing = Math.atan2(this.velocity.x, this.velocity.z);
    else if (wishLen > 0.1) this.targetFacing = Math.atan2(wish.x, wish.z);
    this.facing = angleLerp(this.facing, this.targetFacing, 1 - Math.pow(0.0006, dt));

    const prevState = this.state;
    if (this.swimming) this.state = 'swim';
    else if (this.gliding) this.state = 'glide';
    else if (!this.grounded) this.state = this.velocity.y > 0.5 ? 'jump' : 'fall';
    else if (this.sliding && hv > 1.2) this.state = 'slide';
    else if (hv > P.runSpeed * 0.92) this.state = 'sprint';
    else if (hv > 0.6) this.state = 'run';
    else this.state = 'idle';
    if (prevState !== this.state && this.onEvent) this.onEvent('state', this.state);

    /* ---- 9. 模型应用 ---- */
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    if (this.grounded) {
      const n = terrain.normal(this.position.x, this.position.z, 1.6);
      const tiltX = clamp(n[2] * 0.4, -0.34, 0.34);
      const tiltZ = clamp(-n[0] * 0.4, -0.34, 0.34);
      const cf = Math.cos(this.facing), sf = Math.sin(this.facing);
      this.group.rotation.x = lerp(this.group.rotation.x, tiltX * cf - tiltZ * sf, 1 - Math.pow(0.002, dt));
      this.group.rotation.z = lerp(this.group.rotation.z, tiltZ * cf + tiltX * sf, 1 - Math.pow(0.002, dt));
    } else {
      this.group.rotation.x = lerp(this.group.rotation.x, 0, 1 - Math.pow(0.05, dt));
      this.group.rotation.z = lerp(this.group.rotation.z, 0, 1 - Math.pow(0.05, dt));
    }

    this._animate(dt, hv, sprinting);

    /* ---- 10. 提灯与阴影贴片 ---- */
    this.lantern.visible = this.lanternOn;
    this.lanternLight.intensity = lerp(this.lanternLight.intensity, this.lanternOn ? 2.6 : 0, 1 - Math.pow(0.02, dt));

    this.blob.position.set(0, this.groundY - this.position.y + 0.035, 0);
    const airGap = clamp(this.position.y - this.groundY, 0, 6);
    this.blob.scale.setScalar(1 - airGap / 9);
    this.blob.material.opacity = 0.24 * (1 - airGap / 7);
    if (this.grounded) {
      const n = terrain.normal(this.position.x, this.position.z, 1.4);
      this.blob.rotation.x = -Math.PI / 2 + Math.atan2(n[2], n[1]) * 0.9;
      this.blob.rotation.z = -Math.atan2(n[0], n[1]) * 0.9;
    }

    return this;
  }

  /* ==================== 程序化动画 ==================== */
  _animate(dt, hv, sprinting) {
    const P = PLAYER;
    const st = this.state;
    const speedK = clamp(hv / P.sprintSpeed, 0, 1.15);
    const stepRate = st === 'swim' ? 3.0 : lerp(6.5, 12.0, clamp(hv / P.runSpeed, 0, 1.4));
    this.animPhase += dt * stepRate * (hv > 0.3 ? 1 : 0.3);

    const t = performance.now() / 1000;
    const prevHalf = Math.floor((this._prevPhase || 0) / Math.PI);

    if (st === 'jump') { this._poseJump(); this._updateCape(dt, hv); return; }
    if (st === 'fall') { this._poseFall(); this._updateCape(dt, hv); return; }
    if (st === 'glide') { this._poseGlide(); this._updateCape(dt, hv); return; }
    if (st === 'swim') { this._poseSwim(t); this._updateCape(dt, hv); return; }

    let legAmp = 0, armAmp = 0, bob = 0, lean = 0, armZ = 0, bodyY = 0;

    if (st === 'idle') {
      bodyY = Math.sin(t * 1.7) * 0.012;
      this.bodyPivot.rotation.x = lerp(this.bodyPivot.rotation.x, 0.02, 0.1);
      this.head.rotation.y = Math.sin(t * 0.42) * 0.28;
      this.head.rotation.x = Math.sin(t * 0.85) * 0.05;
      this.capeTarget = 0.06;
      this.legL.lower.rotation.x = lerp(this.legL.lower.rotation.x, 0.06, 0.1);
      this.legR.lower.rotation.x = lerp(this.legR.lower.rotation.x, 0.06, 0.1);
      this.armL.lower.rotation.x = lerp(this.armL.lower.rotation.x, -0.20, 0.1);
      this.armR.lower.rotation.x = lerp(this.armR.lower.rotation.x, -0.20, 0.1);
      this.armL.upper.rotation.x = lerp(this.armL.upper.rotation.x, Math.sin(t * 1.7) * 0.04, 0.1);
      this.armR.upper.rotation.x = lerp(this.armR.upper.rotation.x, -Math.sin(t * 1.7) * 0.04, 0.1);
      this.armL.upper.rotation.z = lerp(this.armL.upper.rotation.z, 0.09, 0.1);
      this.armR.upper.rotation.z = lerp(this.armR.upper.rotation.z, -0.09, 0.1);
      this.legL.upper.rotation.x = lerp(this.legL.upper.rotation.x, 0, 0.1);
      this.legR.upper.rotation.x = lerp(this.legR.upper.rotation.x, 0, 0.1);
    } else {
      // run / sprint / slide
      legAmp = 0.72 + speedK * 0.42;
      armAmp = 0.52 + speedK * 0.38;
      bob = Math.abs(Math.sin(this.animPhase)) * 0.052 * (0.6 + speedK);
      lean = 0.10 + speedK * 0.20;
      armZ = 0.10 + speedK * 0.06;
      this.head.rotation.y = lerp(this.head.rotation.y, 0, 0.15);
      this.head.rotation.x = lerp(this.head.rotation.x, -lean * 0.55, 0.15);
      this.capeTarget = 0.55 + speedK * 0.75;
      if (st === 'slide') { lean += 0.16; this.capeTarget = 1.7; }

      const s = Math.sin(this.animPhase);
      const c = Math.cos(this.animPhase);

      this.legL.upper.rotation.x = s * legAmp;
      this.legR.upper.rotation.x = -s * legAmp;
      this.legL.upper.rotation.z = 0;
      this.legR.upper.rotation.z = 0;
      // 膝盖：后摆收小腿，落地缓冲
      this.legL.lower.rotation.x = 0.10 + Math.max(0, -s) * 1.15 + Math.max(0, s) * 0.14;
      this.legR.lower.rotation.x = 0.10 + Math.max(0, s) * 1.15 + Math.max(0, -s) * 0.14;

      this.armL.upper.rotation.x = -s * armAmp;
      this.armR.upper.rotation.x = s * armAmp;
      this.armL.upper.rotation.z = armZ;
      this.armR.upper.rotation.z = -armZ;
      this.armL.lower.rotation.x = -(0.28 + Math.max(0, -s) * 0.65 + 0.30 * speedK);
      this.armR.lower.rotation.x = -(0.28 + Math.max(0, s) * 0.65 + 0.30 * speedK);

      this.bodyPivot.rotation.z = lerp(this.bodyPivot.rotation.z, c * 0.035 * speedK, 1 - Math.pow(0.01, dt));
      this.head.rotation.z = lerp(this.head.rotation.z, -c * 0.04 * speedK, 1 - Math.pow(0.01, dt));

      // 踏步事件
      const half = Math.floor(this.animPhase / Math.PI);
      if (half !== prevHalf && this.grounded && hv > 0.6) {
        this.onEvent && this.onEvent('step', this.position, hv);
      }
      this._prevPhase = this.animPhase;
    }

    this.bodyPivot.position.y = lerp(this.bodyPivot.position.y, bodyY, 1 - Math.pow(0.001, dt));
    this.bodyPivot.rotation.x = lerp(this.bodyPivot.rotation.x, lean, 1 - Math.pow(0.004, dt));
    this._updateCape(dt, hv);
  }

  _poseJump() {
    this.legL.upper.rotation.x = lerp(this.legL.upper.rotation.x, -0.70, 0.22);
    this.legR.upper.rotation.x = lerp(this.legR.upper.rotation.x, 0.26, 0.22);
    this.legL.lower.rotation.x = lerp(this.legL.lower.rotation.x, 1.00, 0.22);
    this.legR.lower.rotation.x = lerp(this.legR.lower.rotation.x, 0.35, 0.22);
    this.armL.upper.rotation.x = lerp(this.armL.upper.rotation.x, 1.30, 0.2);
    this.armR.upper.rotation.x = lerp(this.armR.upper.rotation.x, 1.00, 0.2);
    this.armL.upper.rotation.z = lerp(this.armL.upper.rotation.z, 0.24, 0.15);
    this.armR.upper.rotation.z = lerp(this.armR.upper.rotation.z, -0.24, 0.15);
    this.armL.lower.rotation.x = lerp(this.armL.lower.rotation.x, -0.55, 0.2);
    this.armR.lower.rotation.x = lerp(this.armR.lower.rotation.x, -0.75, 0.2);
    this.bodyPivot.rotation.x = lerp(this.bodyPivot.rotation.x, -0.09, 0.12);
    this.bodyPivot.position.y = lerp(this.bodyPivot.position.y, 0.045, 0.15);
    this.capeTarget = 1.35;
  }

  _poseFall() {
    this.legL.upper.rotation.x = lerp(this.legL.upper.rotation.x, -0.38, 0.09);
    this.legR.upper.rotation.x = lerp(this.legR.upper.rotation.x, 0.16, 0.09);
    this.legL.lower.rotation.x = lerp(this.legL.lower.rotation.x, 0.55, 0.09);
    this.legR.lower.rotation.x = lerp(this.legR.lower.rotation.x, 0.22, 0.09);
    this.armL.upper.rotation.x = lerp(this.armL.upper.rotation.x, -0.40, 0.08);
    this.armR.upper.rotation.x = lerp(this.armR.upper.rotation.x, -0.40, 0.08);
    this.armL.upper.rotation.z = lerp(this.armL.upper.rotation.z, 0.92, 0.08);
    this.armR.upper.rotation.z = lerp(this.armR.upper.rotation.z, -0.92, 0.08);
    this.armL.lower.rotation.x = lerp(this.armL.lower.rotation.x, -1.0, 0.08);
    this.armR.lower.rotation.x = lerp(this.armR.lower.rotation.x, -1.0, 0.08);
    this.bodyPivot.rotation.x = lerp(this.bodyPivot.rotation.x, 0.05, 0.08);
    this.capeTarget = 1.7;
  }

  _poseGlide() {
    this.legL.upper.rotation.x = lerp(this.legL.upper.rotation.x, -0.14, 0.12);
    this.legR.upper.rotation.x = lerp(this.legR.upper.rotation.x, 0.14, 0.12);
    this.legL.upper.rotation.z = lerp(this.legL.upper.rotation.z, 0.05, 0.1);
    this.legR.upper.rotation.z = lerp(this.legR.upper.rotation.z, -0.05, 0.1);
    this.legL.lower.rotation.x = lerp(this.legL.lower.rotation.x, 0.18, 0.12);
    this.legR.lower.rotation.x = lerp(this.legR.lower.rotation.x, 0.18, 0.12);
    this.armL.upper.rotation.z = lerp(this.armL.upper.rotation.z, 1.5, 0.16);
    this.armR.upper.rotation.z = lerp(this.armR.upper.rotation.z, -1.5, 0.16);
    this.armL.upper.rotation.x = lerp(this.armL.upper.rotation.x, -0.14, 0.16);
    this.armR.upper.rotation.x = lerp(this.armR.upper.rotation.x, -0.14, 0.16);
    this.armL.lower.rotation.x = lerp(this.armL.lower.rotation.x, -0.08, 0.16);
    this.armR.lower.rotation.x = lerp(this.armR.lower.rotation.x, -0.08, 0.16);
    this.bodyPivot.rotation.x = lerp(this.bodyPivot.rotation.x, 0.32, 0.12);
    this.bodyPivot.position.y = lerp(this.bodyPivot.position.y, 0, 0.1);
    this.capeTarget = 2.5;
  }

  _poseSwim(t) {
    const s = Math.sin(t * 4.2);
    this.legL.upper.rotation.x = s * 0.5;
    this.legR.upper.rotation.x = -s * 0.5;
    this.legL.lower.rotation.x = lerp(this.legL.lower.rotation.x, 0.40 + s * 0.3, 0.15);
    this.legR.lower.rotation.x = lerp(this.legR.lower.rotation.x, 0.40 - s * 0.3, 0.15);
    this.armL.upper.rotation.z = lerp(this.armL.upper.rotation.z, 1.05 + s * 0.3, 0.2);
    this.armR.upper.rotation.z = lerp(this.armR.upper.rotation.z, -1.05 - s * 0.3, 0.2);
    this.armL.upper.rotation.x = lerp(this.armL.upper.rotation.x, -0.30, 0.15);
    this.armR.upper.rotation.x = lerp(this.armR.upper.rotation.x, -0.30, 0.15);
    this.armL.lower.rotation.x = lerp(this.armL.lower.rotation.x, -0.50, 0.15);
    this.armR.lower.rotation.x = lerp(this.armR.lower.rotation.x, -0.50, 0.15);
    this.bodyPivot.rotation.x = lerp(this.bodyPivot.rotation.x, 0.44, 0.1);
    this.bodyPivot.position.y = lerp(this.bodyPivot.position.y, Math.sin(t * 2.1) * 0.03, 0.1);
    this.head.rotation.x = lerp(this.head.rotation.x, -0.35, 0.1);
    this.capeTarget = 2.6;
  }

  /** 披风飘动：沿径向偏移顶点（弧形壳） */
  _updateCape(dt, hv) {
    const arr = this.cape.geometry.attributes.position;
    const base = this.capeBase;
    const t = performance.now() / 1000;
    this._capeK = lerp(this._capeK, this.capeTarget || 0.3, 1 - Math.pow(0.02, dt));
    const k = Math.min(1, this._capeK * 0.42);
    const amp = clamp(0.03 + hv * 0.028, 0, 0.30) * k;
    for (let i = 0; i < arr.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const down = clamp(-by / 0.52, 0, 1);          // 0 = 肩线, 1 = 下摆
      const r = Math.hypot(bx, bz) || 1e-4;
      const nx = bx / r, nz = bz / r;                // 径向朝外（局部 +z → 世界 -z，即身后）
      const wave = Math.sin(down * 3.4 - t * 7.2 + bx * 9) * amp * down;
      const off = wave + down * down * k * 0.30;     // 下摆外飘
      arr.setXYZ(i, bx + nx * off, by + down * down * k * 0.17, bz + nz * off);
    }
    arr.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();
    this.cape.rotation.x = k * 0.5;                  // 下摆向后扬起
  }

  headPosition(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.position.y + 1.5, this.position.z);
  }
}

/* ---------------- 工具函数 ---------------- */
function moveToward(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function smooth01(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
