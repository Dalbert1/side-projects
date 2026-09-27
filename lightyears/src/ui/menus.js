// Panels: inventory, space station, pause and settings, and the ending.
import { RESOURCES, UPGRADES, RECIPES, REFUEL } from '../game/inventory.js';
import { distanceToCore } from '../world/universe.js';
import { BIOMES, HAZARD_LABEL } from '../world/planetgen.js';
import { hashInts } from '../core/rng.js';

const fmt = (n) => Math.round(n).toLocaleString();

export class Menus {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('panel');
    this.title = document.getElementById('panel-title');
    this.body = document.getElementById('panel-body');
    this.kind = null;
    document.getElementById('panel-close').addEventListener('click', () => {
      if (this.kind === 'station') return; // leave the station with Launch
      this.close();
    });
    this.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      this._act(btn.dataset.act, btn.dataset.arg, btn);
    });
    this.tab = 'trade';
  }

  get isOpen() {
    return this.kind !== null;
  }

  open(kind, title) {
    this.kind = kind;
    this.title.textContent = title;
    this.el.classList.remove('hidden');
    document.getElementById('panel-close').classList.toggle('hidden', kind === 'station' || kind === 'finale');
    this.game.input.clear();
    this.game.input.releasePointer();
    this.game.mining.stop();
    this.render();
  }

  close() {
    if (!this.kind) return;
    this.kind = null;
    this.el.classList.add('hidden');
    this.game.input.clear();
  }

  toggleMenu() {
    if (this.kind === 'menu') this.close();
    else if (this.kind !== 'station' && this.kind !== 'finale') this.open('menu', 'Paused');
  }

  toggleInventory() {
    if (this.kind === 'inventory') this.close();
    else if (!this.kind) this.open('inventory', 'Inventory');
  }

  openStation() {
    this.tab = 'trade';
    this.open('station', this.game.station.name);
  }

  openFinale() {
    this.open('finale', 'The Center of the Universe');
  }

  render() {
    const k = this.kind;
    if (k === 'inventory') this.body.innerHTML = this._inventory();
    else if (k === 'station') this.body.innerHTML = this._station();
    else if (k === 'menu') this.body.innerHTML = this._menu();
    else if (k === 'settings') this.body.innerHTML = this._settings();
    else if (k === 'help') this.body.innerHTML = this._help();
    else if (k === 'finale') this.body.innerHTML = this._finale();
  }

  _resGrid() {
    const inv = this.game.inv;
    return `<div class="grid-res">${Object.entries(RESOURCES).map(([key, r]) => `
      <div class="res-cell">
        <div class="sym" style="color:${r.color}">${r.sym}</div>
        <div class="nm">${r.name}</div>
        <div class="ct">${fmt(inv.res[key])}<span class="nm"> / ${inv.cap}</span></div>
      </div>`).join('')}</div>`;
  }

  _inventory() {
    const g = this.game;
    const inv = g.inv;
    const onFoot = g.mode === 'foot';
    const tanks = onFoot ? ['life', 'hazard', 'launch', 'shield'] : ['launch', 'pulse', 'shield', 'life', 'hazard'];
    const rows = tanks.map((t) => {
      const r = REFUEL[t];
      const cur = inv.tank(t);
      const ok = inv.res[r.res] >= r.amount && cur < 100;
      return `<div class="row"><div class="info">${r.label} <span style="color:var(--amber)">${Math.round(cur)}%</span>
        <small>${r.amount} ${RESOURCES[r.res].name} for +${r.gain}%</small></div>
        <button data-act="refuel" data-arg="${t}" ${ok ? '' : 'disabled'}>${cur >= 100 ? 'Full' : 'Refuel'}</button></div>`;
    }).join('');
    const rec = RECIPES.warpCell;
    const need = Object.entries(rec.needs).map(([k, v]) => `${v} ${RESOURCES[k].name}`).join(', ');
    const canCraft = inv.has(rec.needs);
    const star = g.star;
    const planet = g.mode === 'foot' ? g.player.planet : g.nearest;
    let where = '';
    if (planet && g.focusAlt < 3000) {
      const p = planet.params;
      where = `<div class="section"><h3>${p.name}</h3><div class="muted">${BIOMES[p.biome].label} world. ${p.hazard ? `${HAZARD_LABEL[p.hazard.type]} (${Math.round(p.hazard.level * 100)}%).` : 'No hazards.'} ${p.atmo ? '' : 'No atmosphere.'} ${p.liquid ? `Seas of ${p.liquid}.` : ''}</div></div>`;
    }
    const disc = g.discovered;
    return `
      <div class="row" style="border:none;padding-top:0"><div class="info">Units<small>Sell resources at a station</small></div><div class="units">${fmt(inv.units)} u</div></div>
      <div class="row"><div class="info">Warp Cells<small>One per hyperspace jump</small></div><div class="units" style="color:var(--cyan)">${inv.warpCells}</div></div>
      <div class="section"><h3>Resources</h3>${this._resGrid()}</div>
      <div class="section"><h3>Refuel and recharge</h3>${rows}</div>
      <div class="section"><h3>Craft</h3>
        <div class="row"><div class="info">${rec.name}<small>${need}</small></div><button data-act="craft" ${canCraft ? '' : 'disabled'}>Craft</button></div>
      </div>
      ${where}
      <div class="section"><h3>Journey</h3><div class="muted">
        ${star ? `${star.name}, ${fmt(distanceToCore(star))} ly from the Center of the Universe.<br>` : ''}
        ${Object.keys(disc.systems).length} systems, ${Object.keys(disc.planets).length} planets, ${Object.keys(disc.species).length} species discovered. ${g.jumps} jumps.
      </div></div>`;
  }

  _price(key) {
    const g = this.game;
    const base = RESOURCES[key].value;
    const mod = 0.85 + ((hashInts(g.star.seed, key.length, key.charCodeAt(0)) % 1000) / 1000) * 0.4;
    return Math.max(1, Math.round(base * mod));
  }

  _station() {
    const g = this.game;
    const inv = g.inv;
    const tabs = ['trade', 'shop', 'upgrades'];
    let html = `<div class="row" style="border:none;padding-top:0"><div class="info">Welcome, traveler<small>${g.system.name} system</small></div><div class="units">${fmt(inv.units)} u</div></div>
      <div class="tabs">${tabs.map((t) => `<button data-act="tab" data-arg="${t}" class="${this.tab === t ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    if (this.tab === 'trade') {
      html += Object.entries(RESOURCES).map(([key, r]) => {
        const n = inv.res[key];
        const p = this._price(key);
        return `<div class="row"><div class="info"><span style="color:${r.color}">${r.sym}</span> ${r.name} &times; ${n}<small>${p} u each</small></div>
          <div style="display:flex;gap:6px"><button data-act="sell" data-arg="${key}:10" ${n >= 10 ? '' : 'disabled'}>Sell 10</button><button data-act="sell" data-arg="${key}:all" ${n > 0 ? '' : 'disabled'}>All</button></div></div>`;
      }).join('');
    } else if (this.tab === 'shop') {
      const items = [
        ['warpcell', 'Warp Cell', 'Powers one hyperspace jump', 1400],
        ['dihydrogen', '40 Di-hydrogen', 'Launch thruster fuel', 520],
        ['tritium', '75 Tritium', 'Pulse engine fuel', 480],
        ['oxygen', '30 Oxygen', 'Life support', 420],
        ['sodium', '30 Sodium', 'Hazard protection', 480],
      ];
      html += items.map(([id, name, desc, cost]) => `<div class="row"><div class="info">${name}<small>${desc}</small></div>
        <button data-act="buy" data-arg="${id}:${cost}" ${inv.units >= cost ? '' : 'disabled'}>${fmt(cost)} u</button></div>`).join('');
    } else {
      html += Object.entries(UPGRADES).map(([key, u]) => {
        const lvl = inv.upgrades[key];
        const maxed = lvl >= u.max;
        const cost = maxed ? 0 : u.cost[lvl];
        return `<div class="row"><div class="info">${u.name} <span style="color:var(--amber)">${'&#9670;'.repeat(lvl)}${'&#9671;'.repeat(u.max - lvl)}</span><small>${u.desc}</small></div>
          <button data-act="upgrade" data-arg="${key}" ${!maxed && inv.units >= cost ? '' : 'disabled'}>${maxed ? 'Max' : `${fmt(cost)} u`}</button></div>`;
      }).join('');
      html += `<div class="muted" style="margin-top:8px">Hyperdrive range now ${fmt(inv.jumpRange)} ly.</div>`;
    }
    html += `<div class="section" style="display:grid;gap:8px"><button class="primary-btn" data-act="undock">Launch</button></div>`;
    return html;
  }

  _menu() {
    return `<div style="display:grid;gap:10px">
      <button class="primary-btn" data-act="resume">Resume</button>
      <button class="ghost-btn" data-act="settings">Settings</button>
      <button class="ghost-btn" data-act="help">How to play</button>
      <button class="ghost-btn" data-act="title">Save and quit to title</button>
    </div>
    <div class="muted" style="margin-top:14px;text-align:center">Progress saves on this device automatically.</div>`;
  }

  _seg(act, options, current) {
    return `<div class="seg">${options.map(([v, label]) => `<button data-act="${act}" data-arg="${v}" class="${String(current) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  }

  _settings() {
    const s = this.game.settings;
    return `
      <div class="toggle-row">Graphics ${this._seg('quality', [['low', 'Low'], ['med', 'Med'], ['high', 'High']], s.quality)}</div>
      <div class="toggle-row">Invert look ${this._seg('invert', [['0', 'Off'], ['1', 'On']], s.invertY ? 1 : 0)}</div>
      <div class="toggle-row">Look speed ${this._seg('sens', [['0.6', 'Slow'], ['1', 'Normal'], ['1.5', 'Fast']], s.sens)}</div>
      <div class="toggle-row">Sound ${this._seg('sound', [['0', 'Off'], ['1', 'On']], s.sound ? 1 : 0)}</div>
      <div class="toggle-row">Music ${this._seg('music', [['0', 'Off'], ['0.5', 'Low'], ['1', 'Full']], s.music)}</div>
      <div class="section"><button class="ghost-btn" data-act="back">Back</button></div>`;
  }

  _help() {
    const touch = this.game.isTouch;
    return `<div class="muted" style="display:grid;gap:10px">
      <div><b style="color:var(--ink)">On foot.</b> ${touch ? 'Left thumb moves, drag the right side to look.' : 'WASD to move, mouse to look.'} Hold <b>Mine</b> to cut resources with your beam, tap <b>Scan</b> to reveal deposits and discover new species, hold <b>Jet</b> to fly with your jetpack.</div>
      <div><b style="color:var(--ink)">Your ship.</b> ${touch ? 'Left thumb steers. The slider on the right is your throttle.' : 'Mouse or arrow keys steer, W and S set throttle.'} <b>Boost</b> for speed, <b>Fire</b> to shoot asteroids for Tritium. Get low over the ground and tap <b>Land</b>.</div>
      <div><b style="color:var(--ink)">Space.</b> <b>Pulse</b> jumps you across a system in seconds. Fly up to the station's glowing slot and tap <b>Dock</b> to trade and buy upgrades.</div>
      <div><b style="color:var(--ink)">The galaxy.</b> Craft a Warp Cell, open the map, pick a star in range, and warp. Every jump toward the core brings you closer to the Center of the Universe.</div>
      <div><b style="color:var(--ink)">Staying alive.</b> Oxygen (red flowers) refills life support. Sodium (yellow plants) recharges hazard protection on hot, frozen, toxic, or radioactive worlds. Your cockpit recharges both.</div>
    </div>
    <div class="section"><button class="ghost-btn" data-act="back">Back</button></div>`;
  }

  _finale() {
    return `<div class="muted" style="display:grid;gap:12px;font-size:16px">
      <div>Back home in Tulsa there is a little circle of bricks downtown. Stand in the middle and speak, and your own voice comes back to you, loud and strange, while people a step away hear nothing at all.</div>
      <div>Out here it works the same way. ${fmt(this.game.jumps)} jumps, ${fmt(Object.keys(this.game.discovered.planets).length)} worlds, and the whole galaxy echoes back at you.</div>
      <div style="color:var(--ink)">You found the Center of the Universe.</div>
    </div>
    <div class="section" style="display:grid;gap:8px">
      <button class="primary-btn" data-act="newgalaxy">Begin a new galaxy</button>
      <button class="ghost-btn" data-act="stay">Stay a while</button>
    </div>`;
  }

  _act(act, arg, btn) {
    const g = this.game;
    const inv = g.inv;
    switch (act) {
      case 'refuel': {
        const r = inv.refuel(arg);
        if (r === 'ok') {
          g.audio.sfx('collect');
          if (arg === 'launch') g.objectives.event('refueled');
        }
        break;
      }
      case 'craft':
        if (inv.craftWarpCell()) {
          g.audio.sfx('objective');
          g.hud.toast('Warp Cell crafted', 'good');
        }
        break;
      case 'tab':
        this.tab = arg;
        break;
      case 'sell': {
        const [key, amt] = arg.split(':');
        const n = amt === 'all' ? inv.res[key] : Math.min(10, inv.res[key]);
        inv.res[key] -= n;
        inv.units += n * this._price(key);
        g.audio.sfx('collect');
        break;
      }
      case 'buy': {
        const [id, costS] = arg.split(':');
        const cost = +costS;
        if (inv.units < cost) break;
        inv.units -= cost;
        if (id === 'warpcell') inv.warpCells++;
        else if (id === 'dihydrogen') inv.add('dihydrogen', 40);
        else if (id === 'tritium') inv.add('tritium', 75);
        else if (id === 'oxygen') inv.add('oxygen', 30);
        else if (id === 'sodium') inv.add('sodium', 30);
        g.audio.sfx('collect');
        break;
      }
      case 'upgrade': {
        const u = UPGRADES[arg];
        const lvl = inv.upgrades[arg];
        if (lvl >= u.max || inv.units < u.cost[lvl]) break;
        inv.units -= u.cost[lvl];
        inv.upgrades[arg]++;
        g.audio.sfx('objective');
        break;
      }
      case 'undock':
        this.close();
        g.undock();
        return;
      case 'resume':
        this.close();
        return;
      case 'settings':
        this.kind = 'settings';
        this.title.textContent = 'Settings';
        break;
      case 'help':
        this.kind = 'help';
        this.title.textContent = 'How to play';
        break;
      case 'back':
        this.kind = 'menu';
        this.title.textContent = 'Paused';
        break;
      case 'title':
        this.close();
        g.toTitle();
        return;
      case 'quality':
        if (g.settings.quality !== arg) {
          g.settings.quality = arg;
          g.saveSettings();
          g.save();
          location.reload();
          return;
        }
        break;
      case 'invert':
        g.settings.invertY = arg === '1';
        g.saveSettings();
        break;
      case 'sens':
        g.settings.sens = +arg;
        g.input.lookSensitivity = +arg;
        g.saveSettings();
        break;
      case 'sound':
        g.settings.sound = arg === '1';
        g.audio.applySettings();
        g.saveSettings();
        break;
      case 'music':
        g.settings.music = +arg;
        g.audio.applySettings();
        g.saveSettings();
        break;
      case 'newgalaxy':
        g.newGalaxy();
        return;
      case 'stay':
        this.close();
        return;
    }
    this.render();
    g.save();
  }
}

