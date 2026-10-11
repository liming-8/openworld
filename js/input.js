/* ============================================================
 *  input.js — 键盘 / 鼠标 / 触屏输入
 * ============================================================ */

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.wheel = 0;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = true;

    /* 触屏虚拟摇杆 */
    this.touch = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, lookId: null, lx: 0, ly: 0 };

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressedThisFrame.add(k);
      this.keys.add(k);
      // 防止空格滚动页面
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onBlur = () => { this.keys.clear(); this.touch.active = false; this.touch.lookId = null; };

    this._onMouseMove = (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX * this.sensitivity;
      this.mouseDY += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
    };
    this._onWheel = (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    domElement.addEventListener('wheel', this._onWheel, { passive: true });

    this._initTouch(domElement);
  }

  _initTouch(el) {
    const isUI = (t) => t.target && t.target.closest && t.target.closest('[data-ui]');
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (isUI(t)) continue;
        if (t.clientX < window.innerWidth * 0.45 && !this.touch.active) {
          this.touch.active = true; this.touch.id = t.identifier;
          this.touch.ox = t.clientX; this.touch.oy = t.clientY;
          this.touch.x = t.clientX; this.touch.y = t.clientY;
        } else if (this.touch.lookId === null) {
          this.touch.lookId = t.identifier; this.touch.lx = t.clientX; this.touch.ly = t.clientY;
        }
      }
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) {
          this.touch.x = t.clientX; this.touch.y = t.clientY;
        } else if (t.identifier === this.touch.lookId) {
          this.mouseDX += (t.clientX - this.touch.lx) * 0.004;
          this.mouseDY += (t.clientY - this.touch.ly) * 0.004;
          this.touch.lx = t.clientX; this.touch.ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) { this.touch.active = false; this.touch.id = null; }
        if (t.identifier === this.touch.lookId) { this.touch.lookId = null; }
      }
    };
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
  }

  get hasTouch() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; }

  /** 虚拟摇杆方向（已归一化） */
  touchVector() {
    if (!this.touch.active) return { x: 0, y: 0 };
    let dx = (this.touch.x - this.touch.ox) / 60;
    let dy = (this.touch.y - this.touch.oy) / 60;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    return { x: dx, y: dy };
  }

  down(code) { return this.keys.has(code); }
  downAny(codes) { return codes.some((c) => this.keys.has(c)); }
  justPressed(code) { return this.pressedThisFrame.has(code); }

  /** 移动轴：x 左右，y 前后（W 为 +） */
  moveAxis() {
    let x = 0, y = 0;
    if (this.downAny(['KeyW', 'ArrowUp'])) y += 1;
    if (this.downAny(['KeyS', 'ArrowDown'])) y -= 1;
    if (this.downAny(['KeyA', 'ArrowLeft'])) x -= 1;
    if (this.downAny(['KeyD', 'ArrowRight'])) x += 1;
    if (x === 0 && y === 0) {
      const t = this.touchVector();
      x = t.x; y = -t.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY, wheel: this.wheel };
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    return d;
  }

  endFrame() { this.pressedThisFrame.clear(); }

  requestLock() {
    if (this.dom.requestPointerLock) this.dom.requestPointerLock();
  }
  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }
}
