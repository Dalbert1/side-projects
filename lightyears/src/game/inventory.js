// Things you pick up, your units, and ship and suit upgrades. Nothing here is needed
// to fly: fuel is unlimited and warps are free. Resources are just loot to sell.

export const RESOURCES = {
  carbon: { name: 'Carbon', sym: 'C', color: '#ff6b57', value: 12, desc: 'From plants and trees.' },
  ferrite: { name: 'Ferrite', sym: 'Fe', color: '#c9ccd6', value: 14, desc: 'From rocks and boulders.' },
  dihydrogen: { name: 'Di-hydrogen', sym: 'H', color: '#5fb2ff', value: 34, desc: 'Blue crystals.' },
  oxygen: { name: 'Oxygen', sym: 'O2', color: '#ff5f8a', value: 34, desc: 'Red flowers.' },
  sodium: { name: 'Sodium', sym: 'Na', color: '#ffb000', value: 41, desc: 'Yellow plants.' },
  tritium: { name: 'Tritium', sym: 'Tr', color: '#a6f0ff', value: 6, desc: 'Shot out of asteroids.' },
  gold: { name: 'Gold', sym: 'Au', color: '#ffd84a', value: 210, desc: 'Rare veins. Sells high.' },
};

export const UPGRADES = {
  engine: { name: 'Engine tuning', max: 3, cost: [1500, 3600, 7200], desc: 'Faster cruise and boost' },
  pulse: { name: 'Pulse injectors', max: 3, cost: [1800, 4200, 8000], desc: 'Faster pulse drive' },
  laser: { name: 'Mining beam', max: 3, cost: [1200, 3000, 6400], desc: 'Mine faster, heat slower' },
  jetpack: { name: 'Jetpack', max: 3, cost: [1000, 2600, 5400], desc: 'More thrust, longer flights' },
  capacity: { name: 'Cargo pods', max: 3, cost: [1600, 3800, 7600], desc: '+150 per resource stack' },
};

export class Inventory {
  constructor() {
    this.reset();
  }

  reset() {
    this.res = Object.fromEntries(Object.keys(RESOURCES).map((k) => [k, 0]));
    this.units = 1000;
    this.suit = { health: 100, jet: 100 };
    this.upgrades = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
  }

  get cap() {
    return 250 + this.upgrades.capacity * 150;
  }

  add(key, n) {
    const room = this.cap - this.res[key];
    const got = Math.max(0, Math.min(room, Math.round(n)));
    this.res[key] += got;
    return got;
  }

  toJSON() {
    return { res: this.res, units: this.units, suit: this.suit, upgrades: this.upgrades };
  }

  load(d) {
    if (!d) return;
    for (const k of Object.keys(this.res)) if (typeof d.res?.[k] === 'number') this.res[k] = d.res[k];
    this.units = d.units ?? this.units;
    if (d.suit) {
      this.suit.health = d.suit.health ?? 100;
      this.suit.jet = d.suit.jet ?? 100;
    }
    // older saves had hyperdrive and hazard upgrades, which no longer exist
    for (const k of Object.keys(this.upgrades)) if (typeof d.upgrades?.[k] === 'number') this.upgrades[k] = d.upgrades[k];
  }
}
