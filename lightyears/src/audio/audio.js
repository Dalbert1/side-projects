// All sound is synthesized with WebAudio: a slow generative score, engine and wind
// loops, and small effects. Nothing to download.

import { Rng, hashInts } from '../core/rng.js';

const SCALES = [
  [0, 2, 4, 6, 7, 9, 11], // lydian
  [0, 2, 3, 5, 7, 9, 10], // dorian
  [0, 2, 4, 5, 7, 9, 10], // mixolydian
  [0, 2, 4, 7, 9], // major pentatonic
  [0, 3, 5, 7, 10], // minor pentatonic
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.started = false;
  }

  start() {
    if (this.started) {
      this.ctx?.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    this.ctx = ctx;
    this.started = true;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.game.settings.sound ? 0.8 : 0;
    this.master.connect(comp);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(4.5, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.32 * this.game.settings.music;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.25;
    this.sfxBus.connect(this.sfxSend).connect(this.reverb);

    this.noiseBuf = this._noise(2);
    this._engine();
    this._wind();
    this.nextChord = ctx.currentTime + 0.5;
    this.nextPluck = ctx.currentTime + 3;
    this.chordIndex = 0;
    this._setScale(918);

    const resume = () => ctx.state !== 'running' && ctx.resume();
    window.addEventListener('pointerdown', resume, { passive: true });
    window.addEventListener('keydown', resume);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
  }

  applySettings() {
    if (!this.ctx) return;
    const s = this.game.settings;
    this.master.gain.setTargetAtTime(s.sound ? 0.8 : 0, this.ctx.currentTime, 0.1);
    this.musicBus.gain.setTargetAtTime(0.32 * s.music, this.ctx.currentTime, 0.2);
  }

  _impulse(secs, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _noise(secs) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    return s;
  }

  _engine() {
    const ctx = this.ctx;
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300;
    bp.Q.value = 0.8;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 45;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    const og = ctx.createGain();
    og.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp).connect(g);
    osc.connect(lp).connect(og).connect(g);
    g.connect(this.sfxBus);
    n.start();
    osc.start();
    this.eng = { g, bp, osc, lp };
    // pulse drive hum
    const p = ctx.createOscillator();
    p.type = 'triangle';
    p.frequency.value = 110;
    const p2 = ctx.createOscillator();
    p2.type = 'sine';
    p2.frequency.value = 165.5;
    const pg = ctx.createGain();
    pg.gain.value = 0;
    p.connect(pg);
    p2.connect(pg);
    pg.connect(this.sfxBus);
    pg.connect(this.sfxSend);
    p.start();
    p2.start();
    this.pulseHum = { g: pg, p, p2 };
    // mining laser
    const l = ctx.createOscillator();
    l.type = 'sawtooth';
    l.frequency.value = 220;
    const l2 = ctx.createOscillator();
    l2.type = 'square';
    l2.frequency.value = 331;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 17;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 18;
    lfo.connect(lfoG).connect(l.frequency);
    const lbp = ctx.createBiquadFilter();
    lbp.type = 'bandpass';
    lbp.frequency.value = 1400;
    lbp.Q.value = 1.5;
    const lg = ctx.createGain();
    lg.gain.value = 0;
    l.connect(lbp);
    l2.connect(lbp);
    lbp.connect(lg).connect(this.sfxBus);
    l.start();
    l2.start();
    lfo.start();
    this.laserNode = { g: lg };
  }

  _wind() {
    const ctx = this.ctx;
    const n = this._noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 260;
    lfo.connect(lfoG).connect(lp.frequency);
    n.connect(lp).connect(g).connect(this.sfxBus);
    n.start();
    lfo.start();
    this.windNode = { g, lp };
  }

  _setScale(seed) {
    const rng = new Rng(hashInts(seed, 55));
    this.scale = SCALES[rng.int(0, SCALES.length - 1)];
    this.root = 38 + rng.int(0, 9);
    this.progression = [0, rng.pick([3, 4, 5]), rng.pick([1, 5, 2]), rng.pick([4, 3, 6])];
    this.scaleSeed = seed;
  }

  _degree(d, octave = 0) {
    const s = this.scale;
    const n = s.length;
    const o = Math.floor(d / n);
    const i = ((d % n) + n) % n;
    return this.root + s[i] + 12 * (o + octave);
  }

  _pad(notes, t, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.1, t + dur * 0.35);
    out.gain.linearRampToValueAtTime(0.0, t + dur * 1.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(900 + Math.random() * 700, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(350, t + dur * 1.15);
    lp.Q.value = 0.7;
    lp.connect(out).connect(this.musicBus);
    for (const m of notes) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.16;
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + dur * 1.2);
      }
    }
    // soft bass
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = mtof(notes[0] - 12);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.22, t + dur * 0.3);
    bg.gain.linearRampToValueAtTime(0, t + dur * 1.1);
    b.connect(bg).connect(this.musicBus);
    b.start(t);
    b.stop(t + dur * 1.2);
  }

  _pluck(m, t, vel = 0.2) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(m);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = mtof(m + 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 2.2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    o.start(t);
    o2.start(t);
    o.stop(t + 2.3);
    o2.stop(t + 2.3);
  }

  _music() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const sysSeed = this.game.star ? this.game.star.seed : 918;
    if (sysSeed !== this.scaleSeed) this._setScale(sysSeed);
    if (now > this.nextChord - 0.1) {
      const dur = 9;
      const deg = this.progression[this.chordIndex % this.progression.length];
      this.chordIndex++;
      const notes = [this._degree(deg, 1), this._degree(deg + 2, 1), this._degree(deg + 4, 1), this._degree(deg + 6, 1)];
      this._pad(notes, Math.max(now, this.nextChord), dur);
      this.nextChord += dur * 0.85;
      this.currentDeg = deg;
    }
    if (now > this.nextPluck) {
      const deg = (this.currentDeg || 0) + [0, 2, 4, 7, 9][Math.floor(Math.random() * 5)];
      const m = this._degree(deg, 2 + (Math.random() < 0.3 ? 1 : 0));
      this._pluck(m, now + 0.02, 0.07 + Math.random() * 0.06);
      if (Math.random() < 0.4) this._pluck(this._degree(deg + 2, 2), now + 0.32, 0.05);
      this.nextPluck = now + 1.6 + Math.random() * 4;
    }
  }

  update(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const g = this.game;
    const t = this.ctx.currentTime;
    this._music();
    const ship = g.ship;
    const inShip = g.mode === 'ship' || g.mode === 'warp';
    const sp = ship.speed || 0;
    const engVol = inShip ? (ship.state === 'landed' ? 0.05 : 0.08 + Math.min(0.22, sp / 1200) + (ship.boosting ? 0.1 : 0)) : 0;
    this.eng.g.gain.setTargetAtTime(engVol, t, 0.15);
    this.eng.bp.frequency.setTargetAtTime(220 + Math.min(1800, sp * 2.2), t, 0.2);
    this.eng.osc.frequency.setTargetAtTime(38 + Math.min(70, sp * 0.15), t, 0.2);
    // wind in atmospheres
    const nearest = g.nearest;
    let wind = 0;
    if (nearest && nearest.params.atmo && (g.mode === 'foot' || (inShip && ship.inAtmo))) {
      wind = g.mode === 'foot' ? 0.045 : 0.02 + Math.min(0.12, sp / 1500);
    }
    this.windNode.g.gain.setTargetAtTime(wind, t, 0.5);
  }

  laser(on) {
    if (!this.ctx) return;
    this.laserNode.g.gain.setTargetAtTime(on ? 0.07 : 0, this.ctx.currentTime, 0.04);
  }

  pulseStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.pulseHum.g.gain.setTargetAtTime(0.06, t, 0.4);
    this.pulseHum.p.frequency.setValueAtTime(70, t);
    this.pulseHum.p.frequency.exponentialRampToValueAtTime(110, t + 1.2);
    this._sweep(200, 1400, 1.2, 0.12, 'sawtooth');
    this._whoosh(1.4, 0.25, 400, 3000);
  }

  pulseStop() {
    if (!this.ctx) return;
    this.pulseHum.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    this._whoosh(0.8, 0.18, 2000, 300);
  }

  _tone(freq, t, dur, vol, type = 'sine', dest = this.sfxBus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  _sweep(f0, f1, dur, vol, type = 'sine') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(lp).connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _whoosh(dur, vol, f0, f1, q = 1) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    n.connect(bp).connect(g).connect(this.sfxBus);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  creature(seed, size, vol) {
    if (!this.ctx || vol <= 0) return;
    const ctx = this.ctx;
    const rng = new Rng(seed);
    const base = 900 / Math.pow(size, 0.8) * rng.range(0.6, 1.4);
    const t = ctx.currentTime + 0.05;
    const count = rng.int(1, 3);
    for (let i = 0; i < count; i++) {
      const st = t + i * rng.range(0.18, 0.3);
      const o = ctx.createOscillator();
      o.type = rng.pick(['sine', 'triangle', 'sawtooth']);
      o.frequency.setValueAtTime(base * rng.range(0.8, 1.1), st);
      o.frequency.exponentialRampToValueAtTime(base * rng.range(0.5, 1.6), st + 0.22);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base * 1.5;
      bp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.12 * vol, st + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0006, st + 0.3);
      o.connect(bp).connect(g).connect(this.sfxBus);
      o.start(st);
      o.stop(st + 0.35);
    }
  }

  sfx(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'collect':
        this._tone(880, t, 0.12, 0.14);
        this._tone(1320, t + 0.07, 0.18, 0.12);
        break;
      case 'scan':
        this._sweep(300, 2200, 0.9, 0.12);
        this._tone(1760, t + 0.9, 0.5, 0.06, 'sine', this.sfxSend);
        break;
      case 'discover':
        [0, 4, 7, 11, 14].forEach((s, i) => this._tone(mtof(72 + s), t + i * 0.07, 1.6, 0.07));
        break;
      case 'objective':
        [0, 7, 12].forEach((s, i) => this._tone(mtof(67 + s), t + i * 0.1, 0.9, 0.09, 'triangle'));
        break;
      case 'deny':
        this._tone(140, t, 0.25, 0.14, 'square');
        this._tone(110, t + 0.12, 0.25, 0.12, 'square');
        break;
      case 'door':
        this._whoosh(0.5, 0.2, 1800, 400, 0.7);
        break;
      case 'launch':
        this._whoosh(2.4, 0.35, 150, 1800, 0.6);
        this._sweep(60, 180, 2.2, 0.2, 'sawtooth');
        break;
      case 'land':
        this._whoosh(2.4, 0.25, 1600, 200, 0.6);
        break;
      case 'dock':
        this._whoosh(3, 0.2, 1200, 300, 0.6);
        [0, 5, 9].forEach((s, i) => this._tone(mtof(76 + s), t + i * 0.15, 1.2, 0.06));
        break;
      case 'warp': {
        this._whoosh(4.5, 0.4, 100, 5000, 0.5);
        this._sweep(55, 880, 4.2, 0.18, 'sawtooth');
        this._sweep(82, 1320, 4.2, 0.1, 'sawtooth');
        break;
      }
      case 'shoot':
        this._sweep(1400, 180, 0.12, 0.08, 'square');
        break;
      case 'boom':
        this._whoosh(1.2, 0.4, 900, 60, 0.5);
        this._sweep(90, 30, 0.8, 0.3, 'sine');
        break;
      case 'hit':
        this._sweep(160, 50, 0.3, 0.3, 'sine');
        this._whoosh(0.3, 0.2, 600, 150);
        break;
      case 'overheat':
        this._whoosh(0.9, 0.2, 3000, 800, 2);
        break;
      default:
        this._tone(660, t, 0.1, 0.08);
    }
  }
}
