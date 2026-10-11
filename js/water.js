/* ============================================================
 *  water.js — 动态海面 / 湖面
 *  自定义 Shader：正弦波叠加 + 菲涅尔 + 高光 + 雾融合
 * ============================================================ */
import * as THREE from '../libs/three.module.js';

export class Ocean {
  constructor({ size = 1200, segments = 96 } = {}) {
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x2e7f96) },
      uDeep: { value: new THREE.Color(0x0d3350) },
      uSky: { value: new THREE.Color(0xbcd9f2) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunColor: { value: new THREE.Color(0xfff2d0) },
      uSunPower: { value: 1.0 },
      uFogColor: { value: new THREE.Color(0xbcd6ea) },
      uFogNear: { value: 60 },
      uFogFar: { value: 480 },
      uNight: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying float vWave;

        vec3 waveOffset(vec2 p, float t){
          float h = 0.0;
          h += sin(p.x * 0.085 + t * 1.05) * 0.34;
          h += sin(p.y * 0.072 - t * 0.86) * 0.30;
          h += sin((p.x + p.y) * 0.045 + t * 0.62) * 0.42;
          h += sin((p.x - p.y) * 0.13 - t * 1.6) * 0.13;
          return vec3(0.0, h, 0.0);
        }
        float waveH(vec2 p, float t){
          float h = 0.0;
          h += sin(p.x * 0.085 + t * 1.05) * 0.34;
          h += sin(p.y * 0.072 - t * 0.86) * 0.30;
          h += sin((p.x + p.y) * 0.045 + t * 0.62) * 0.42;
          h += sin((p.x - p.y) * 0.13 - t * 1.6) * 0.13;
          return h;
        }
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float t = uTime;
          float h = waveH(wp.xz, t);
          wp.y += h;
          float e = 1.6;
          float hx = waveH(wp.xz + vec2(e, 0.0), t);
          float hz = waveH(wp.xz + vec2(0.0, e), t);
          vec3 n = normalize(vec3(h - hx, e, h - hz));
          vNrm = n;
          vWorld = wp.xyz;
          vWave = h;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uShallow, uDeep, uSky, uSunColor, uFogColor;
        uniform vec3 uSunDir;
        uniform float uSunPower, uFogNear, uFogFar, uNight, uTime;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying float vWave;

        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vNrm);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
          fres = mix(0.06, 1.0, fres);

          vec3 base = mix(uDeep, uShallow, clamp(0.35 + vWave * 0.9, 0.0, 1.0));
          vec3 col = mix(base, uSky, fres);

          // 阳光高光（闪烁）
          vec3 L = normalize(uSunDir);
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 180.0);
          float sparkle = 0.55 + 0.45 * sin(vWorld.x * 3.1 + vWorld.z * 2.7 + uTime * 3.0);
          col += uSunColor * spec * 2.4 * uSunPower * sparkle;

          // 波纹细线
          float ripple = smoothstep(0.86, 1.0, sin(vWorld.x * 0.7 + vWorld.z * 0.5 + uTime * 1.6) * 0.5 + 0.5);
          col += vec3(0.10, 0.14, 0.16) * ripple * 0.5;

          col = mix(col, col * 0.42, uNight);

          float d = distance(cameraPosition, vWorld);
          float fog = smoothstep(uFogNear, uFogFar, d);
          gl_FragColor = vec4(mix(col, uFogColor, fog), mix(0.90, 1.0, fog));
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.size = size;
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
  }

  /** 让海面始终跟随玩家，视觉上无限延伸 */
  follow(x, z) {
    this.mesh.position.set(Math.round(x / 8) * 8, 0, Math.round(z / 8) * 8);
  }

  setSky({ sunDir, sunColor, sunPower, fogColor, fogNear, fogFar, skyColor, night }) {
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSunPower.value = sunPower;
    this.uniforms.uFogColor.value.copy(fogColor);
    this.uniforms.uFogNear.value = fogNear;
    this.uniforms.uFogFar.value = fogFar;
    this.uniforms.uSky.value.copy(skyColor);
    this.uniforms.uNight.value = night;
  }
}
