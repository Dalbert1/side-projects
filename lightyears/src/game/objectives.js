// A few light hints that teach the controls, then the open-ended trip to the
// Center of the Universe. Nothing here gates anything: do things in any order.
import { distanceToCore } from '../world/universe.js';

const STEPS = [
  {
    id: 'launch',
    text: () => 'Tap Launch to take off. Fuel is unlimited.',
    event: 'launched',
    reward: 100,
  },
  {
    id: 'space',
    text: () => 'Climb up out of the atmosphere into space',
    check: (g) => g.mode === 'ship' && g.nearest && !g.ship.inAtmo && g.ship.altitude > (g.nearest.params.atmo ? g.nearest.params.atmo.thickness * 1.3 : 600),
    reward: 150,
  },
  {
    id: 'pulse',
    text: () => 'Point at a planet marker and tap Pulse to race across the system',
    event: 'pulse',
    reward: 150,
  },
  {
    id: 'land',
    text: () => 'Pick any planet, fly down low, and tap Land',
    event: 'landed',
    reward: 250,
  },
  {
    id: 'warp',
    text: () => 'Open the Galaxy Map and warp to any star you like',
    event: 'warped',
    reward: 500,
  },
  {
    id: 'center',
    text: (g) => (g.star ? `Roam anywhere. The Center of the Universe is ${Math.round(distanceToCore(g.star)).toLocaleString()} ly away` : ''),
    check: (g) => g.system && g.system.core,
    reward: 5000,
  },
  {
    id: 'free',
    text: () => '',
  },
];

const indexOf = (id) => Math.max(0, STEPS.findIndex((s) => s.id === id));

export class Objectives {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.step = 0;
  }

  get current() {
    return STEPS[Math.min(this.step, STEPS.length - 1)];
  }

  text() {
    return this.current.text(this.game);
  }

  event(name) {
    const s = this.current;
    if (s.event === name) {
      this._complete();
      return;
    }
    // doing something later in the list skips ahead to it
    const i = STEPS.findIndex((q) => q.event === name);
    if (i > this.step && STEPS[i].id !== 'center') {
      this.step = i;
      this._complete();
    }
  }

  update() {
    const s = this.current;
    if (s.check && s.check(this.game)) this._complete();
  }

  _complete() {
    const g = this.game;
    const s = this.current;
    if (s.id === 'free') return;
    this.step++;
    if (s.reward) g.inv.units += s.reward;
    g.hud.toast(`Nice. +${s.reward} units`, 'good', 0);
    g.audio.sfx('objective');
    g.saveSoon();
  }

  toJSON() {
    return { id: this.current.id };
  }

  load(d) {
    if (d?.id) this.step = indexOf(d.id);
    // saves from before free roam stored a step number from the old tutorial
    else if (typeof d?.step === 'number') this.step = d.step >= 6 ? indexOf('center') : d.step >= 5 ? indexOf('warp') : 0;
    else this.step = 0;
  }
}
