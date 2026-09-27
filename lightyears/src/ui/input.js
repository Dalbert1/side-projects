// Unified input: a floating thumbstick on the left, drag-to-look on the right,
// DOM buttons (hold or tap), a throttle slider, plus keyboard and mouse on desktop.

export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };
    this.stick = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.held = new Set();
    this.pressed = new Set();
    this.keys = new Set();
    this.throttle = 0.35;
    this.throttleTouched = false;
    this.enabled = true;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.pointerLocked = false;
    this.lookSensitivity = 1;

    this.stickPointer = null;
    this.lookPointer = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.stickRadius = 58;

    this.stickEl = document.getElementById('stick');
    this.knobEl = document.getElementById('stick-knob');
    this.touchLayer = document.getElementById('touch');

    this._bindTouchLayer();
    this._bindButtons();
    this._bindThrottle();
    this._bindKeys();
    this._bindMouse();
  }

  _bindTouchLayer() {
    const layer = this.touchLayer;
    layer.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse' && !this.isTouch) return; // desktop uses pointer lock
      const leftZone = e.clientX < window.innerWidth * 0.45;
      if (leftZone && this.stickPointer === null) {
        this.stickPointer = e.pointerId;
        this.stickOrigin.x = e.clientX;
        this.stickOrigin.y = e.clientY;
        this.stickEl.style.left = e.clientX + 'px';
        this.stickEl.style.top = e.clientY + 'px';
        this.stickEl.classList.add('on');
        this._setStick(e.clientX, e.clientY);
      } else if (!leftZone && this.lookPointer === null) {
        this.lookPointer = e.pointerId;
        this.lastLook = { x: e.clientX, y: e.clientY };
      }
      layer.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) {
        this._setStick(e.clientX, e.clientY);
      } else if (e.pointerId === this.lookPointer) {
        const dx = e.clientX - this.lastLook.x;
        const dy = e.clientY - this.lastLook.y;
        this.look.x += dx * 1.6 * this.lookSensitivity;
        this.look.y += dy * 1.6 * this.lookSensitivity;
        this.lastLook.x = e.clientX;
        this.lastLook.y = e.clientY;
      }
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId === this.stickPointer) {
        this.stickPointer = null;
        this.stick.x = 0;
        this.stick.y = 0;
        this.stickEl.classList.remove('on');
      }
      if (e.pointerId === this.lookPointer) this.lookPointer = null;
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
    layer.addEventListener('lostpointercapture', end);
  }

  _setStick(x, y) {
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const r = this.stickRadius;
    if (len > r) {
      // drag the base along so the stick never feels stuck at the rim
      const k = (len - r) / len;
      this.stickOrigin.x += dx * k;
      this.stickOrigin.y += dy * k;
      this.stickEl.style.left = this.stickOrigin.x + 'px';
      this.stickEl.style.top = this.stickOrigin.y + 'px';
      dx *= r / len;
      dy *= r / len;
    }
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    let sx = dx / r, sy = dy / r;
    const m = Math.hypot(sx, sy);
    const dead = 0.12;
    if (m < dead) { sx = 0; sy = 0; } else {
      const k = (m - dead) / (1 - dead) / m;
      sx *= k; sy *= k;
    }
    this.stick.x = sx;
    this.stick.y = sy;
  }

  _bindButtons() {
    document.querySelectorAll('[data-hold],[data-press]').forEach((btn) => this.bindButton(btn));
  }

  bindButton(btn) {
    const hold = btn.dataset.hold;
    const press = btn.dataset.press;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.enabled && !btn.dataset.always) return;
      btn.classList.add('down');
      if (hold) this.held.add(hold);
      if (press) this.pressed.add(press);
      btn.setPointerCapture?.(e.pointerId);
    };
    const up = (e) => {
      btn.classList.remove('down');
      if (hold) this.held.delete(hold);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindThrottle() {
    const el = document.getElementById('throttle');
    if (!el) return;
    const fill = document.getElementById('throttle-fill');
    let active = null;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      const t = 1 - (e.clientY - r.top) / r.height;
      this.throttle = Math.max(0, Math.min(1, t));
      this.throttleTouched = true;
      fill.style.height = `${this.throttle * 100}%`;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      active = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      set(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === active) set(e); });
    const end = (e) => { if (e.pointerId === active) active = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    this.throttleFill = fill;
  }

  setThrottle(t) {
    this.throttle = Math.max(0, Math.min(1, t));
    if (this.throttleFill) this.throttleFill.style.height = `${this.throttle * 100}%`;
  }

  _bindKeys() {
    const map = {
      Space: 'jump', ShiftLeft: 'boost', ShiftRight: 'boost',
    };
    const pressMap = {
      KeyE: 'interact', KeyF: 'scan', KeyC: 'scan', KeyQ: 'pulse', KeyM: 'map', Tab: 'map',
      Escape: 'menu', KeyI: 'inventory', KeyL: 'interact2', KeyR: 'recharge',
    };
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') e.preventDefault();
      if (this.keys.has(e.code)) return;
      this.keys.add(e.code);
      if (map[e.code]) this.held.add(map[e.code]);
      if (pressMap[e.code]) this.pressed.add(pressMap[e.code]);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (map[e.code]) this.held.delete(map[e.code]);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held.clear();
    });
  }

  _bindMouse() {
    const canvasHost = this.touchLayer;
    canvasHost.addEventListener('mousedown', (e) => {
      if (this.isTouch || !this.enabled) return;
      if (!this.pointerLocked && this.wantsPointerLock) {
        canvasHost.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.held.add('primary');
      if (e.button === 2) this.held.add('secondary');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.delete('primary');
      if (e.button === 2) this.held.delete('secondary');
    });
    canvasHost.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvasHost;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.look.x += e.movementX * 0.9 * this.lookSensitivity;
      this.look.y += e.movementY * 0.9 * this.lookSensitivity;
    });
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  // Keyboard driven analog axes merged with the thumbstick
  update() {
    const k = this.keys;
    let kx = 0, ky = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) ky -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) ky += 1;
    const kl = Math.hypot(kx, ky);
    if (kl > 1) { kx /= kl; ky /= kl; }
    this.move.x = Math.max(-1, Math.min(1, this.stick.x + kx));
    this.move.y = Math.max(-1, Math.min(1, this.stick.y + ky));
  }

  consumePressed() {
    const p = new Set(this.pressed);
    this.pressed.clear();
    return p;
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;
    return l;
  }

  clear() {
    this.held.clear();
    this.pressed.clear();
    this.look.x = this.look.y = 0;
    this.stick.x = this.stick.y = 0;
    this.stickPointer = null;
    this.lookPointer = null;
    this.stickEl?.classList.remove('on');
  }
}
