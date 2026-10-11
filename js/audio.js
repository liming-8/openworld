/* ============================================================
 *  audio.js — 纯程序化音效（WebAudio，无需任何音频素材）
 * ============================================================ */

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterVolume = 0.6;
    this.sfxVolume = 0.8;
    this.ambientVolume = 0.5;
    this._started = false;
  }

  /** 必须由用户手势触发 */
  start() {
    if (this._started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this._started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.ambBus = this.ctx.createGain();
    this.ambBus.gain.value = this.ambientVolume;
    this.ambBus.connect(this.master);

    this._buildAmbience();
    this._noiseBuffer = this._makeNoise(2);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolumes({ master, sfx, ambient }) {
    if (master !== undefined) { this.masterVolume = master; if (this.master) this.master.gain.value = master; }
    if (sfx !== undefined) { this.sfxVolume = sfx; if (this.sfxBus) this.sfxBus.gain.value = sfx; }
    if (ambient !== undefined) { this.ambientVolume = ambient; if (this.ambBus) this.ambBus.gain.value = ambient; }
  }

  _makeNoise(seconds = 1) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildAmbience() {
    const ctx = this.ctx;
    // 风声：噪声 → 带通 → LFO 调制音量
    const src = ctx.createBufferSource();
    src.buffer = this._makeNoise(3);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(bp).connect(g).connect(this.ambBus);
    src.start();
    lfo.start();
    this.windGain = g;
    this.windFilter = bp;

    // 夜晚低频嗡鸣
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 58;
    const dg = ctx.createGain();
    dg.gain.value = 0;
    drone.connect(dg).connect(this.ambBus);
    drone.start();
    this.droneGain = dg;
  }

  /** 随环境更新氛围（风力、夜晚） */
  updateAmbience(dt, { wind = 0.5, night = 0, underwater = false }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.windGain) this.windGain.gain.setTargetAtTime(0.035 + wind * 0.09, t, 0.6);
    if (this.windFilter) this.windFilter.frequency.setTargetAtTime(underwater ? 180 : 340 + wind * 500, t, 0.5);
    if (this.droneGain) this.droneGain.gain.setTargetAtTime(night * 0.05, t, 1.2);
  }

  /**
   * 简易音效合成
   * type: step|jump|land|pickup|chest|unlock|splash|ui|levelup
   */
  play(type, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.sfxBus;

    const noiseHit = (dur, freq, q, vol, type_ = 'bandpass') => {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter();
      f.type = type_;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(out);
      src.start(t);
      src.stop(t + dur + 0.05);
    };

    const tone = (freq, dur, vol, wave = 'sine', slideTo = null, delay = 0) => {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(freq, t + delay);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + delay + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(vol, t + delay + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g).connect(out);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.05);
    };

    switch (type) {
      case 'step': {
        const surface = opts.surface || 'grass';
        const table = {
          grass: [900, 1.1, 0.16], dirt: [600, 1.0, 0.18], sand: [1500, 0.8, 0.13],
          snow: [2400, 0.9, 0.11], rock: [1800, 1.6, 0.16], water: [700, 0.8, 0.2], wood: [1200, 1.4, 0.15],
        };
        const [f, q, v] = table[surface] || table.grass;
        noiseHit(0.09, f * (0.9 + Math.random() * 0.2), q, v * clamp01(opts.vol ?? 1));
        break;
      }
      case 'jump': tone(320, 0.16, 0.8, 'triangle', 620); break;
      case 'land': noiseHit(0.16, 320, 1.2, 1.0 * clamp01(opts.vol ?? 1), 'lowpass'); tone(120, 0.12, 0.5, 'sine', 70); break;
      case 'splash': noiseHit(0.35, 1400, 0.7, 0.9, 'bandpass'); tone(500, 0.2, 0.3, 'sine', 220); break;
      case 'pickup': tone(880, 0.18, 0.5, 'sine'); tone(1320, 0.24, 0.42, 'sine', null, 0.07); tone(1760, 0.3, 0.3, 'sine', null, 0.14); break;
      case 'chest': [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.4, 0.35, 'triangle', null, i * 0.07)); break;
      case 'unlock': [392, 523.25, 659.25].forEach((f, i) => tone(f, 0.6, 0.34, 'sine', null, i * 0.12)); noiseHit(0.5, 2200, 1.0, 0.18); break;
      case 'levelup': [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.5, 0.3, 'triangle', null, i * 0.09)); break;
      case 'ui': tone(680, 0.07, 0.28, 'square', 880); break;
      case 'damage': noiseHit(0.2, 260, 0.8, 0.7, 'lowpass'); tone(180, 0.22, 0.35, 'sawtooth', 110); break;
      case 'glide_open': noiseHit(0.7, 900, 0.5, 0.35, 'bandpass'); break;
      default: break;
    }
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
