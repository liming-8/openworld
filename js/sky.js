/* ============================================================
 *  sky.js — 天空穹顶 / 太阳 / 月亮 / 星空 / 昼夜循环
 * ============================================================ */
import * as THREE from '../libs/three.module.js';
import { clamp, lerp, smoothstep } from './noise.js';

/** 时间关键帧：[时刻, 天顶色, 地平色, 雾色, 太阳色, 太阳强度, 环境强度] */
const KEYS = [
  { t: 0.00, zen: 0x050b1c, hor: 0x0d1a33, fog: 0x0e1a2e, sun: 0xa8bfe8, si: 0.34, ai: 0.50, name: '深夜' },
  { t: 0.20, zen: 0x0b1830, hor: 0x2a2a4a, fog: 0x22304a, sun: 0xc9a7ff, si: 0.30, ai: 0.48, name: '黎明前' },
  { t: 0.26, zen: 0x3d6fb5, hor: 0xff9a5c, fog: 0xe9a883, sun: 0xffb173, si: 0.85, ai: 0.60, name: '日出' },
  { t: 0.34, zen: 0x4f92dd, hor: 0xbcd9f2, fog: 0xc4dcf0, sun: 0xfff0c8, si: 1.05, ai: 0.85, name: '清晨' },
  { t: 0.50, zen: 0x2f7fd6, hor: 0xa8cdf0, fog: 0xbcd8ef, sun: 0xfffaf0, si: 1.15, ai: 1.00, name: '正午' },
  { t: 0.68, zen: 0x3f83cf, hor: 0xd7dcae, fog: 0xcfd8c6, sun: 0xfff0d0, si: 1.05, ai: 0.88, name: '午后' },
  { t: 0.78, zen: 0x2c5fa8, hor: 0xff9155, fog: 0xe09a76, sun: 0xffa04a, si: 0.80, ai: 0.62, name: '黄昏' },
  { t: 0.85, zen: 0x14224a, hor: 0x6a4d7a, fog: 0x3c3a5c, sun: 0xc39ae0, si: 0.45, ai: 0.55, name: '入夜' },
  { t: 0.93, zen: 0x070f22, hor: 0x141f3a, fog: 0x141f34, sun: 0xa8bfe8, si: 0.34, ai: 0.50, name: '夜晚' },
  { t: 1.00, zen: 0x050b1c, hor: 0x0d1a33, fog: 0x0e1a2e, sun: 0xa8bfe8, si: 0.34, ai: 0.50, name: '深夜' },
];

function sampleKeys(t) {
  t = ((t % 1) + 1) % 1;
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const s = smoothstep(0, 1, k);
  return {
    zen: new THREE.Color(a.zen).lerp(new THREE.Color(b.zen), s),
    hor: new THREE.Color(a.hor).lerp(new THREE.Color(b.hor), s),
    fog: new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), s),
    sun: new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), s),
    si: lerp(a.si, b.si, s),
    ai: lerp(a.ai, b.ai, s),
    name: (s < 0.5 ? a.name : b.name),
  };
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.34;          // 从清晨开始
    this.dayLength = 480;      // 一天 = 480 秒（8 分钟）
    this.paused = false;

    /* --- 天穹 --- */
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x2f7fd6) },
      uHorizon: { value: new THREE.Color(0xa8cdf0) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.2) },
      uSunColor: { value: new THREE.Color(0xfffaf0) },
      uSunPower: { value: 1 },
      uNight: { value: 0 },
    };
    const domeGeo = new THREE.SphereGeometry(1500, 32, 20);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uSunColor, uSunDir;
        uniform float uSunPower, uNight;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
          vec3 col = mix(uHorizon, uZenith, t);
          // 地平线以下（海洋方向）
          col = mix(col, uHorizon * 0.55, clamp(-d.y * 2.2, 0.0, 1.0));

          // 太阳/月亮光晕
          float cd = max(dot(d, normalize(uSunDir)), 0.0);
          float glow = pow(cd, 12.0) * 0.55 + pow(cd, 220.0) * 1.6;
          col += uSunColor * glow * (0.55 + uSunPower * 0.9);

          // 深夜压暗
          col = mix(col, col * 0.55, uNight * 0.6);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.scene.add(this.dome);

    /* --- 太阳 / 月亮圆盘 --- */
    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(46, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false, transparent: true, depthWrite: false })
    );
    this.sunDisc.renderOrder = -9;
    this.sunDisc.frustumCulled = false;
    this.scene.add(this.sunDisc);

    this.moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(30, 28),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false, transparent: true, opacity: 0.9, depthWrite: false })
    );
    this.moonDisc.renderOrder = -9;
    this.moonDisc.frustumCulled = false;
    this.scene.add(this.moonDisc);

    /* --- 星空 --- */
    const starCount = 900;
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const R = 1200;
      sp[i * 3] = Math.cos(a) * r * R;
      sp[i * 3 + 1] = Math.abs(u) * R * 0.95 + 40;
      sp[i * 3 + 2] = Math.sin(a) * r * R;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 3.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
    }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -8;
    this.scene.add(this.stars);

    /* --- 云层（低多边形扁平云块） --- */
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, emissive: 0x6a7d95, emissiveIntensity: 0.25 });
    const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 90; i++) {
      const c = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < puffs; k++) {
        const m = new THREE.Mesh(cloudGeo, cloudMat);
        m.position.set((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 40);
        const s = 14 + Math.random() * 26;
        m.scale.set(s, s * (0.35 + Math.random() * 0.25), s * (0.7 + Math.random() * 0.4));
        c.add(m);
      }
      const ang = Math.random() * Math.PI * 2;
      const rad = 120 + Math.random() * 700;
      c.position.set(Math.cos(ang) * rad, 190 + Math.random() * 130, Math.sin(ang) * rad);
      this.clouds.add(c);
    }
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);

    /* --- 光源 --- */
    this.sun = new THREE.DirectionalLight(0xfffaf0, 1.1);
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.camera.left = -95;
    this.sun.shadow.camera.right = 95;
    this.sun.shadow.camera.top = 95;
    this.sun.shadow.camera.bottom = -95;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.1;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(0xbcd8ef, 0x51603f, 0.85);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.ambient);

    this.current = sampleKeys(this.time);
    this.sunDir = new THREE.Vector3(0.3, 0.6, 0.2);
    /** 实际用于打光的方向（夜晚为月光方向） */
    this.lightDir = new THREE.Vector3(0.3, 0.6, 0.2);
    this._apply();
  }

  /** 手动设定时间（0~1） */
  setTime(t) { this.time = ((t % 1) + 1) % 1; this._apply(); }

  get clockText() {
    const h = Math.floor(this.time * 24);
    const m = Math.floor((this.time * 24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt, playerPos) {
    if (!this.paused) this.time = (this.time + dt / this.dayLength) % 1;
    this._apply();
    // 跟随玩家，保持穹顶/云在第一人称感受上的稳定
    this.dome.position.set(playerPos.x, 0, playerPos.z);
    this.clouds.position.set(playerPos.x, 0, playerPos.z);
    this.stars.position.set(playerPos.x, 0, playerPos.z);
    // 云缓慢飘移
    this.clouds.children.forEach((c, i) => {
      c.position.x += dt * (1.4 + (i % 5) * 0.25);
      if (c.position.x - playerPos.x > 860) c.position.x -= 1720;
    });
  }

  _apply() {
    const k = sampleKeys(this.time);
    this.current = k;

    // 太阳角度：0.25 = 日出（东），0.5 = 正午，0.75 = 日落
    const ang = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang) * 0.55, Math.sin(ang), Math.sin(ang * 0.6) * 0.35).normalize();

    const night = smoothstep(0.02, -0.18, this.sunDir.y); // 太阳越低越夜

    this.uniforms.uZenith.value.copy(k.zen);
    this.uniforms.uHorizon.value.copy(k.hor);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uSunColor.value.copy(k.sun);
    this.uniforms.uSunPower.value = k.si;
    this.uniforms.uNight.value = night;

    // 太阳/月亮圆盘
    const R = 1100;
    const sunUp = this.sunDir.y > -0.12;
    this.sunDisc.visible = sunUp;
    this.sunDisc.position.set(this.sunDir.x * R, this.sunDir.y * R, this.sunDir.z * R);
    this.sunDisc.lookAt(0, 0, 0);
    this.sunDisc.material.color.copy(k.sun);
    this.sunDisc.material.opacity = clamp(0.35 + k.si, 0, 1);

    this.moonDisc.visible = this.sunDir.y < 0.12;
    this.moonDisc.position.set(-this.sunDir.x * R, -this.sunDir.y * R, -this.sunDir.z * R);
    this.moonDisc.lookAt(0, 0, 0);
    this.moonDisc.material.opacity = clamp(night * 0.95, 0, 0.95);

    // 星空
    this.stars.material.opacity = night * 0.95;

    // 光照
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.si;
    // 太阳落下后，方向光切换为月光方向（避免从地底打光）
    this.lightDir.copy(this.sunDir.y > 0.06 ? this.sunDir : this.sunDir.clone().negate());
    this.sun.visible = true;
    this.hemi.intensity = k.ai * 0.9;
    this.hemi.color.copy(k.zen).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.setHex(k.si > 0.6 ? 0x6b7a52 : 0x2a3346);
    this.ambient.intensity = 0.10 + k.ai * 0.14;

    // 云染色
    const cloudTint = k.sun.clone().lerp(new THREE.Color(0xffffff), 0.55).multiplyScalar(clamp(0.5 + k.si * 0.7, 0.35, 1.25));
    this.clouds.children.forEach((c) => c.traverse((o) => {
      if (o.isMesh) { o.material.color.copy(cloudTint); o.material.opacity = 0.45 + k.si * 0.3; }
    }));
  }

  /** 跟随玩家的阴影相机 */
  updateShadow(playerPos) {
    const d = 110;
    this.sunTarget.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.sun.position.set(
      playerPos.x + this.lightDir.x * d,
      playerPos.y + this.lightDir.y * d,
      playerPos.z + this.lightDir.z * d
    );
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  setShadows(on) {
    this.sun.castShadow = on;
  }

  get fogColor() { return this.current.fog; }
  get nightFactor() { return smoothstep(0.02, -0.18, this.sunDir.y); }
}
