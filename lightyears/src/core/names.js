// Procedural names. A little Markov chain trained on Oklahoma town names,
// so the galaxy ends up full of places that sound like they are just past Owasso.

import { Rng } from './rng.js';

const TRAINING = `tulsa owasso sapulpa bixby jenks skiatook claremore catoosa coweta wagoner
okmulgee muskogee tahlequah pawhuska nowata vinita bartlesville collinsville sperry mannford
keystone pawnee stillwater guthrie edmond norman shawnee ardmore durant idabel atoka wewoka
seminole okemah henryetta checotah eufaula sallisaw stilwell wyandotte quapaw ponca tonkawa
enid alva woodward guymon hominy cushing drumright chandler wetumka holdenville konawa tecumseh
sayre okarche kingfisher anadarko chickasha lawton altus mangum hobart cordell weatherford
clinton canute hammon cheyenne arapaho watonga okeene fairview waynoka perry tishomingo madill
marietta wapanucka antlers talihina heavener poteau spiro muldrow vian porum stigler kinta
keota pocola bokoshe wilburton krebs mcalester hartshorne quinton haskell boynton beggs mounds
kiefer glenpool oologah talala chelsea adair pryor locust chouteau salina grove afton fairland
commerce welch bluejacket lenapah ochelata ramona dewey copan hulbert peggs cookson qualls
braggs wainwright redbird inola porter okay coalgate tupelo sasakwa maud wanette asher earlsboro
bristow depew stroud davenport wellston luther jones harrah choctaw nicoma okfuskee boley paden`;

const ORDER = 2;
const chain = new Map();
const starts = [];

(function build() {
  const words = TRAINING.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const padded = '^'.repeat(ORDER) + w + '$';
    starts.push(w.slice(0, ORDER));
    for (let i = 0; i + ORDER < padded.length; i++) {
      const key = padded.slice(i, i + ORDER);
      const next = padded[i + ORDER];
      let arr = chain.get(key);
      if (!arr) { arr = []; chain.set(key, arr); }
      arr.push(next);
    }
  }
})();

const REAL = new Set(TRAINING.split(/\s+/));

function markov(rng, minLen = 4, maxLen = 9) {
  for (let attempt = 0; attempt < 30; attempt++) {
    let key = '^'.repeat(ORDER);
    let out = '';
    while (out.length < maxLen + 2) {
      const opts = chain.get(key);
      if (!opts) break;
      const c = opts[Math.floor(rng.float() * opts.length)];
      if (c === '$') break;
      out += c;
      key = (key + c).slice(-ORDER);
    }
    if (out.length >= minLen && out.length <= maxLen && (!REAL.has(out) || rng.chance(0.08))) {
      return out;
    }
  }
  return 'okla' + Math.floor(rng.float() * 99);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIV', 'XVI', 'XIX'];

export function systemName(seed) {
  const rng = new Rng(seed ^ 0x51a7);
  const base = cap(markov(rng, 4, 8));
  const style = rng.float();
  if (style < 0.3) return `${base}-${cap(markov(rng, 3, 5))}`;
  if (style < 0.5) return `${base} ${rng.pick(ROMAN)}`;
  if (style < 0.6) return `${rng.pick(['Upper', 'Lower', 'Old', 'New', 'Far'])} ${base}`;
  return base;
}

export function planetName(seed, index) {
  const rng = new Rng(seed ^ 0x9e37 ^ (index * 7919));
  const base = cap(markov(rng, 4, 9));
  const style = rng.float();
  if (style < 0.25) return `${base} ${rng.pick(['Prime', 'Minor', 'Major', 'Beta', 'Tau', 'Omega', 'Reach', 'Hollow', 'Flats'])}`;
  if (style < 0.45) return `${base} ${rng.pick(ROMAN)}`;
  if (style < 0.55) return `${base}-${rng.int(10, 99)}`;
  return base;
}

export function speciesName(seed) {
  const rng = new Rng(seed ^ 0x2c1b);
  const genus = cap(markov(rng, 4, 7)) + rng.pick(['us', 'ium', 'ia', 'ops', 'odon', 'ex', 'ara']);
  const species = markov(rng, 3, 6) + rng.pick(['i', 'ensis', 'ae', 'is', 'oides', 'ata']);
  return `${genus} ${species}`;
}

export function stationName(seed) {
  const rng = new Rng(seed ^ 0x77aa);
  return `${cap(markov(rng, 4, 8))} ${rng.pick(['Waystation', 'Trading Post', 'Outpost', 'Exchange', 'Depot'])}`;
}
