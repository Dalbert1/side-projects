// DOM heads-up display: status bars, markers, toasts, context button, flight readouts.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Hud {
  constructor() {
    this.el = document.getElementById('hud');
    this.bars = document.getElementById('bars');
    this.toastsEl = document.getElementById('toasts');
    this.markersEl = document.getElementById('markers');
    this.ctxBtn = document.getElementById('btn-ctx');
    this.ctxLabel = document.getElementById('btn-ctx-label');
    this.ctx2Btn = document.getElementById('btn-ctx2');
    this.ctx2Label = document.getElementById('btn-ctx2-label');
    this.ctx2Key = '';
    this.targetEl = document.getElementById('target');
    this.targetName = document.getElementById('target-name');
    this.targetFill = document.getElementById('target-fill');
    this.heatEl = document.getElementById('heat');
    this.heatFill = document.getElementById('heat-fill');
    this.crosshair = document.getElementById('crosshair');
    this.flightEl = document.getElementById('flight');
    this.speedVal = document.getElementById('speed-val');
    this.altEl = document.getElementById('alt');
    this.throttleEl = document.getElementById('throttle');
    this.locEl = document.getElementById('location');
    this.vignette = document.getElementById('vignette');
    this.speedlines = document.getElementById('speedlines');
    this.objective = document.getElementById('objective');
    this.objectiveText = document.getElementById('objective-text');
    this.discEl = document.getElementById('discovery');
    this.pulseBtn = document.getElementById('btn-pulse');
    this.markerPool = new Map();
    this.barEls = new Map();
    this.mode = null;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.discQueue = [];
    this.discTimer = 0;
    this.lastToast = new Map();
    this.ctxKey = '';
    if (!this.isTouch) {
      const k = document.createElement('div');
      k.id = 'keys';
      this.el.appendChild(k);
      this.keysEl = k;
    }
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const foot = mode === 'foot';
    const ship = mode === 'ship';
    document.querySelectorAll('.act.foot').forEach((b) => b.classList.toggle('hidden', !foot));
    document.querySelectorAll('.act.ship').forEach((b) => b.classList.toggle('hidden', !ship));
    this.throttleEl.classList.toggle('hidden', !ship);
    this.flightEl.classList.toggle('hidden', !ship);
    this.crosshair.classList.toggle('ship', ship);
    this.crosshair.classList.toggle('hidden', !foot && !ship);
    if (!foot) { this.setTarget(null); this.setHeat(0, false); }
    this.bars.innerHTML = '';
    this.barEls.clear();
    if (this.keysEl) {
      this.keysEl.innerHTML = foot
        ? 'WASD move &middot; Mouse look &middot; Click mine &middot; Space jetpack<br>Shift sprint &middot; F scan &middot; E interact &middot; I inventory &middot; M map'
        : ship
          ? 'W/S throttle &middot; Mouse or arrows steer &middot; Shift boost &middot; Click fire<br>Q pulse drive &middot; E land or dock &middot; I inventory &middot; M map'
          : '';
    }
  }

  setBars(list) {
    for (const b of list) {
      let el = this.barEls.get(b.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'bar';
        el.innerHTML = `<span class="ic">${b.label}</span><div class="track"><div class="fill"></div></div>`;
        el.fill = el.querySelector('.fill');
        el.ic = el.querySelector('.ic');
        el.fill.style.background = b.color || '';
        this.bars.appendChild(el);
        this.barEls.set(b.id, el);
      }
      if (el.ic.textContent !== b.label) el.ic.textContent = b.label;
      const v = Math.max(0, Math.min(1, b.value));
      const w = `${(v * 100).toFixed(1)}%`;
      if (el.fill.style.width !== w) el.fill.style.width = w;
      el.classList.toggle('low', v < 0.2 && !b.noLow);
    }
  }

  setObjective(text) {
    if (!text) { this.objective.classList.add('hidden'); return; }
    this.objective.classList.remove('hidden');
    if (this.objectiveText.textContent !== text) this.objectiveText.textContent = text;
  }

  setContext(label, key = 'E') {
    const k = label || '';
    if (k === this.ctxKey) return;
    this.ctxKey = k;
    if (!label) { this.ctxBtn.classList.add('hidden'); return; }
    this.ctxBtn.classList.remove('hidden');
    this.ctxLabel.innerHTML = label + (this.isTouch ? '' : `<span class="keyhint">${key}</span>`);
  }

  setContext2(label, key = 'L') {
    const k = label || '';
    if (k === this.ctx2Key) return;
    this.ctx2Key = k;
    if (!label) { this.ctx2Btn.classList.add('hidden'); return; }
    this.ctx2Btn.classList.remove('hidden');
    this.ctx2Label.innerHTML = label + (this.isTouch ? '' : `<span class="keyhint">${key}</span>`);
  }

  setPulse(visible, on) {
    this.pulseBtn.classList.toggle('hidden', !visible || this.mode !== 'ship');
    this.pulseBtn.classList.toggle('on', !!on);
  }

  setTarget(t) {
    if (!t) { this.targetEl.classList.add('hidden'); this.crosshair.classList.remove('on'); return; }
    this.targetEl.classList.remove('hidden');
    this.crosshair.classList.add('on');
    if (this.targetName.textContent !== t.name) this.targetName.textContent = t.name;
    this.targetFill.style.width = `${Math.max(0, t.hp) * 100}%`;
  }

  setHeat(v, over) {
    this.heatEl.classList.toggle('hidden', v <= 0.01);
    this.heatEl.classList.toggle('over', !!over);
    this.heatFill.style.width = `${v * 100}%`;
  }

  setFlight(speed, altText) {
    const s = Math.round(speed).toString();
    if (this.speedVal.textContent !== s) this.speedVal.textContent = s;
    if (this.altEl.textContent !== altText) this.altEl.textContent = altText;
  }

  setSpeedLines(v) { this.speedlines.style.opacity = v.toFixed(2); }

  setVignette(kind) {
    this.vignette.classList.toggle('hurt', kind === 'hurt');
    this.vignette.classList.toggle('hazard', kind === 'hazard');
  }

  toast(text, kind = '', dedupeMs = 2500) {
    const now = performance.now();
    const last = this.lastToast.get(text);
    if (last && now - last < dedupeMs) return;
    this.lastToast.set(text, now);
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.toastsEl.appendChild(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => t.classList.add('fade'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  discovery(kicker, name, sub, ms = 3600) {
    this.discQueue.push({ kicker, name, sub, ms });
    if (!this.discShowing) this._nextDiscovery();
  }

  _nextDiscovery() {
    const d = this.discQueue.shift();
    if (!d) { this.discShowing = false; this.discEl.classList.add('hidden'); return; }
    this.discShowing = true;
    document.getElementById('disc-kicker').textContent = d.kicker;
    document.getElementById('disc-name').textContent = d.name;
    document.getElementById('disc-sub').textContent = d.sub || '';
    this.discEl.classList.remove('hidden');
    this.discEl.style.animation = 'none';
    void this.discEl.offsetWidth;
    this.discEl.style.animation = '';
    clearTimeout(this.discTimeout);
    this.discTimeout = setTimeout(() => this._nextDiscovery(), d.ms);
  }

  setLocation(name, sub) {
    document.getElementById('loc-name').textContent = name;
    document.getElementById('loc-sub').textContent = sub || '';
    this.locEl.classList.add('show');
    clearTimeout(this.locTimer);
    this.locTimer = setTimeout(() => this.locEl.classList.remove('show'), 4200);
  }

  // markers: [{ id, pos (world Vector3), label, color, kind, dist }]
  updateMarkers(camera, list, w, h) {
    const seen = new Set();
    const margin = 28;
    for (const m of list) {
      seen.add(m.id);
      let el = this.markerPool.get(m.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `marker ${m.kind || ''}`;
        el.innerHTML = m.kind === 'res'
          ? `<div class="dot">${m.symbol || ''}</div>`
          : `<div class="dot"></div><span class="label"></span><span class="dist"></span>${m.kind === 'ship' ? '<div class="arrow"></div>' : ''}`;
        el.labelEl = el.querySelector('.label');
        el.distEl = el.querySelector('.dist');
        el.arrowEl = el.querySelector('.arrow');
        this.markersEl.appendChild(el);
        this.markerPool.set(m.id, el);
        el.style.color = m.color || '#fff';
      }
      // decide "behind" from view space depth: the projection's near/far planes change
      // between render passes, so projected z alone is not reliable
      _v.copy(m.pos).applyMatrix4(camera.matrixWorldInverse);
      const behind = _v.z > 0;
      _v.applyMatrix4(camera.projectionMatrix);
      let x = (_v.x * 0.5 + 0.5) * w;
      let y = (-_v.y * 0.5 + 0.5) * h;
      let edge = false;
      if (behind) { x = w - x; y = h - y; }
      if (behind || x < margin || x > w - margin || y < margin + 40 || y > h - margin) {
        if (m.kind === 'res') { el.style.display = 'none'; continue; }
        edge = true;
        const cx = w / 2, cy = h / 2;
        let dx = x - cx, dy = y - cy;
        if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
        // keep edge markers (and the ship arrow) fully on screen and clear of the top HUD row
        const sx = (w / 2 - margin - 16) / Math.abs(dx || 1e-6);
        const sy = (h / 2 - margin - 40) / Math.abs(dy || 1e-6);
        const s = Math.min(sx, sy);
        x = cx + dx * s;
        y = cy + dy * s;
        if (el.arrowEl) el.arrowEl.style.transform = `translate(-50%, -50%) rotate(${(Math.atan2(dy, dx) + Math.PI / 2).toFixed(3)}rad) translateY(-22px)`;
      }
      el.style.display = '';
      el.classList.toggle('edge', edge);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.left = '0px';
      el.style.top = '0px';
      if (el.labelEl && el.labelEl.textContent !== m.label) el.labelEl.textContent = m.label;
      if (el.distEl) {
        const d = m.dist;
        const txt = d == null ? '' : d > 9999 ? `${(d / 1000).toFixed(0)}k u` : d > 999 ? `${(d / 1000).toFixed(1)}k u` : `${Math.round(d)} u`;
        if (el.distEl.textContent !== txt) el.distEl.textContent = txt;
      }
    }
    for (const [id, el] of this.markerPool) {
      if (!seen.has(id)) { el.remove(); this.markerPool.delete(id); }
    }
  }
}
