// Resources, fuel tanks, suit systems, units, and upgrades.

export const RESOURCES = {
  carbon: { name: 'Carbon', sym: 'C', color: '#ff6b57', value: 12, desc: 'From plants. Crafting staple.' },
  ferrite: { name: 'Ferrite', sym: 'Fe', color: '#c9ccd6', value: 14, desc: 'From rocks. Shields and crafting.' },
  dihydrogen: { name: 'Di-hydrogen', sym: 'H', color: '#5fb2ff', value: 34, desc: 'Blue crystals. Launch fuel.' },
  oxygen: { name: 'Oxygen', sym: 'O2', color: '#ff5f8a', value: 34, desc: 'Red flowers. Life support.' },
  sodium: { name: 'Sodium', sym: 'Na', color: '#ffb000', value: 41, desc: 'Yellow plants. Hazard protection.' },
  tritium: { name: 'Tritium', sym: 'Tr', color: '#a6f0ff', value: 6, desc: 'Asteroids. Pulse drive fuel.' },
  gold: { name: 'Gold', sym: 'Au', color: '#ffd84a', value: 210, desc: 'Rare veins. Sells high.' },
};

export const UPGRADES = {
  hyperdrive: { name: 'Hyperdrive range', max: 4, cost: [2400, 5200, 9800, 16000], desc: '+550 ly jump range per level' },
  engine: { name: 'Engine tuning', max: 3, cost: [1500, 3600, 7200], desc: 'Faster cruise and boost' },
  pulse: { name: 'Pulse injectors', max: 3, cost: [1800, 4200, 8000], desc: 'Faster pulse drive, less fuel' },
  laser: { name: 'Mining beam', max: 3, cost: [1200, 3000, 6400], desc: 'Mine faster, heat slower' },
  jetpack: { name: 'Jetpack', max: 3, cost: [1000, 2600, 5400], desc: 'More thrust and fuel' },
  hazard: { name: 'Hazard lining', max: 3, cost: [1400, 3200, 6600], desc: 'Hazards drain slower' },
  capacity: { name: 'Cargo pods', max: 3, cost: [1600, 3800, 7600], desc: '+150 per resource stack' },
};

export const RECIPES = {
  warpCell: { name: 'Warp Cell', needs: { dihydrogen: 50, ferrite: 40, carbon: 30 }, desc: 'Powers one hyperspace jump' },
};

export const REFUEL = {
  launch: { res: 'dihydrogen', amount: 20, gain: 25, label: 'Launch thrusters' },
  pulse: { res: 'tritium', amount: 25, gain: 25, label: 'Pulse engine' },
  shield: { res: 'ferrite', amount: 20, gain: 40, label: 'Ship shield' },
  life: { res: 'oxygen', amount: 15, gain: 40, label: 'Life support' },
  hazard: { res: 'sodium', amount: 15, gain: 40, label: 'Hazard protection' },
};

export class Inventory {
  constructor() {
    this.reset();
  }

  reset() {
    this.res = Object.fromEntries(Object.keys(RESOURCES).map((k) => [k, 0]));
    this.res.carbon = 20;
    this.res.ferrite = 15;
    this.units = 750;
    this.warpCells = 0;
    this.fuel = { launch: 0, pulse: 100 };
    this.ship = { shield: 100 };
    this.suit = { health: 100, life: 100, hazard: 100, jet: 100 };
    this.upgrades = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
  }

  get cap() {
    return 250 + this.upgrades.capacity * 150;
  }

  get jumpRange() {
    return 900 + this.upgrades.hyperdrive * 550;
  }

  add(key, n) {
    const room = this.cap - this.res[key];
    const got = Math.max(0, Math.min(room, Math.round(n)));
    this.res[key] += got;
    return got;
  }

  has(needs) {
    return Object.entries(needs).every(([k, v]) => this.res[k] >= v);
  }

  spend(needs) {
    if (!this.has(needs)) return false;
    for (const [k, v] of Object.entries(needs)) this.res[k] -= v;
    return true;
  }

  refuel(kind) {
    const r = REFUEL[kind];
    const cur = this.tank(kind);
    if (cur >= 100) return 'full';
    if (this.res[r.res] < r.amount) return 'missing';
    this.res[r.res] -= r.amount;
    this.setTank(kind, Math.min(100, cur + r.gain));
    return 'ok';
  }

  tank(kind) {
    if (kind === 'launch' || kind === 'pulse') return this.fuel[kind];
    if (kind === 'shield') return this.ship.shield;
    return this.suit[kind];
  }

  setTank(kind, v) {
    if (kind === 'launch' || kind === 'pulse') this.fuel[kind] = v;
    else if (kind === 'shield') this.ship.shield = v;
    else this.suit[kind] = v;
  }

  drainPulse(dt) {
    this.fuel.pulse = Math.max(0, this.fuel.pulse - dt * (1.6 - this.upgrades.pulse * 0.35));
  }

  craftWarpCell() {
    if (!this.spend(RECIPES.warpCell.needs)) return false;
    this.warpCells++;
    return true;
  }

  toJSON() {
    return {
      res: this.res, units: this.units, warpCells: this.warpCells, fuel: this.fuel,
      ship: this.ship, suit: this.suit, upgrades: this.upgrades,
    };
  }

  load(d) {
    if (!d) return;
    Object.assign(this.res, d.res || {});
    this.units = d.units ?? this.units;
    this.warpCells = d.warpCells ?? 0;
    Object.assign(this.fuel, d.fuel || {});
    Object.assign(this.ship, d.ship || {});
    Object.assign(this.suit, d.suit || {});
    Object.assign(this.upgrades, d.upgrades || {});
  }
}
