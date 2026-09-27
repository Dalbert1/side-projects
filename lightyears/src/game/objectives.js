// A short guided start, then the long haul to the Center of the Universe.
import { distanceToCore } from '../world/universe.js';

const STEPS = [
  {
    id: 'crystals',
    text: (g) => `Mine blue Di-hydrogen crystals for launch fuel  ${Math.min(g.inv.res.dihydrogen + (g.inv.fuel.launch >= 25 ? 40 : 0), 40)}/40`,
    check: (g) => g.inv.res.dihydrogen >= 40 || g.inv.fuel.launch >= 25,
    reward: 150,
  },
  {
    id: 'launch',
    text: () => 'Board your ship and launch. Thrusters refuel from your Di-hydrogen.',
    event: 'launched',
    reward: 200,
  },
  {
    id: 'space',
    text: () => 'Climb out of the atmosphere into space',
    check: (g) => g.mode === 'ship' && g.nearest && !g.ship.inAtmo && g.ship.altitude > (g.nearest.params.atmo ? g.nearest.params.atmo.thickness * 1.3 : 600),
    reward: 250,
  },
  {
    id: 'station',
    text: (g) => `Fly to ${g.station ? g.station.name : 'the station'}. Tap Pulse to cross space fast.`,
    event: 'docked',
    reward: 400,
  },
  {
    id: 'warpcell',
    text: () => 'Craft a Warp Cell in the inventory, or buy one at the station',
    check: (g) => g.inv.warpCells > 0,
    reward: 300,
  },
  {
    id: 'warp',
    text: () => 'Open the Galaxy Map and warp to a new star',
    event: 'warped',
    reward: 800,
  },
  {
    id: 'center',
    text: (g) => (g.star ? `Journey to the Center of the Universe  ${Math.round(distanceToCore(g.star)).toLocaleString()} ly` : ''),
    check: (g) => g.system && g.system.core,
    reward: 5000,
  },
  {
    id: 'free',
    text: () => '',
  },
];

export class Objectives {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.step = 0;
    this.hidden = false;
  }

  get current() {
    return STEPS[Math.min(this.step, STEPS.length - 1)];
  }

  text() {
    if (this.hidden) return '';
    return this.current.text(this.game);
  }

  event(name) {
    const s = this.current;
    if (s.event === name) this._complete();
    // warping from the very start skips the tutorial chain gracefully
    if (name === 'warped' && this.step < 5) {
      this.step = 6;
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
    g.hud.toast(`Objective complete  +${s.reward} units`, 'good', 0);
    g.audio.sfx('objective');
    g.saveSoon();
  }

  toJSON() {
    return { step: this.step };
  }

  load(d) {
    this.step = d?.step ?? 0;
  }
}
