// Nuclear effects model.
//
// Radii come from the classic cube-root and power-law scaling in Glasstone & Dolan,
// "The Effects of Nuclear Weapons" (1977), with coefficients fit to their published
// tables. Everything here is an estimate for education, not a prediction. Real damage
// depends on terrain, buildings, weather and the exact weapon design.
//
// Units: yields in kilotons (kt), distances in kilometers.

const cbrt = Math.cbrt

// Height of burst that roughly maximizes the 5 psi area.
export function optimalHobKm(kt) {
  return 0.2 * cbrt(kt)
}

// Order used to decide the "worst" effect at a given spot.
export const SEVERITY = ['crater', 'fireball', 'heavy', 'radiation', 'moderate', 'thermal', 'light']

export const RING_INFO = {
  crater: {
    label: 'Crater',
    short: 'Crater',
    color: '#a16207',
    fillOpacity: 0.55,
    desc: 'The ground is blasted out and thrown into the sky. Anything here is simply gone.',
  },
  fireball: {
    label: 'Fireball',
    short: 'Fireball',
    color: '#fde047',
    fillOpacity: 0.5,
    desc: 'Hotter than the surface of the sun. Everything inside is vaporized.',
  },
  heavy: {
    label: 'Heavy blast (20 psi)',
    short: '20 psi',
    color: '#ef4444',
    fillOpacity: 0.28,
    desc: 'Even reinforced concrete buildings are crushed or knocked flat. Almost no one survives.',
  },
  radiation: {
    label: 'Radiation (500 rem)',
    short: '500 rem',
    color: '#4ade80',
    fillOpacity: 0.2,
    desc: 'A 500 rem dose from the initial flash of neutrons and gamma rays. Without hospital care, half or more of the people here die within a month.',
  },
  moderate: {
    label: 'Moderate blast (5 psi)',
    short: '5 psi',
    color: '#9ca3af',
    fillOpacity: 0.22,
    desc: 'Most homes and office buildings collapse. Injuries are nearly universal, deaths are widespread and fires start everywhere.',
  },
  thermal: {
    label: 'Third degree burns',
    short: 'Burns',
    color: '#fb923c',
    fillOpacity: 0.18,
    desc: 'The heat flash causes third degree burns on any exposed skin. Burns this deep destroy the nerves and often lead to amputation.',
  },
  light: {
    label: 'Light blast (1 psi)',
    short: '1 psi',
    color: '#60a5fa',
    fillOpacity: 0.12,
    desc: 'Windows blow out across the whole area. Flying glass injures the many people who walk to a window after seeing the flash.',
  },
}

// Blast rings for one detonation. Returns the burst height and a list of rings.
export function computeEffects(kt, burst) {
  const air = burst === 'air'
  const hob = air ? optimalHobKm(kt) : 0
  const c = cbrt(kt)

  const radii = {
    fireball: 0.07 * Math.pow(kt, 0.4) * (air ? 1 : 1.2),
    heavy: 0.24 * c * (air ? 1 : 0.8),
    moderate: 0.6 * c * (air ? 1 : 0.66),
    light: 1.7 * c * (air ? 1 : 0.62),
    thermal: 0.67 * Math.pow(kt, 0.41) * (air ? 1 : 0.72),
  }

  // Prompt radiation is a slant range, so an airburst loses some of it to altitude.
  const slant = 0.8 * Math.pow(kt, 0.18)
  radii.radiation = slant > hob ? Math.sqrt(slant * slant - hob * hob) : 0

  if (!air) radii.crater = 0.025 * c

  const rings = Object.entries(radii)
    .filter(([, r]) => r > 0.001)
    .map(([key, radiusKm]) => ({ key, radiusKm }))
    .sort((a, b) => a.radiusKm - b.radiusKm)

  return { hobKm: hob, rings }
}

// ---------------------------------------------------------------------------
// Fallout
//
// Idealized H+1 reference dose-rate contours for a surface burst, scaled from the
// Glasstone & Dolan 1 Mt / 15 mph reference pattern. Only fission makes fallout,
// so a weapon with fission fraction f draws the contour a pure fission weapon of
// the same size would draw at dose / f.

export const FALLOUT_LEVELS = [1000, 100, 10, 1]

export const FALLOUT_INFO = {
  1000: {
    label: 'Fallout 1,000 rad/hr',
    short: '1,000 rad/hr',
    color: '#7e22ce',
    fillOpacity: 0.38,
    desc: 'Deadly. A fatal dose builds up in about an hour outdoors.',
  },
  100: {
    label: 'Fallout 100 rad/hr',
    short: '100 rad/hr',
    color: '#a855f7',
    fillOpacity: 0.3,
    desc: 'A fatal dose within a day or so without shelter. Get underground and stay there.',
  },
  10: {
    label: 'Fallout 10 rad/hr',
    short: '10 rad/hr',
    color: '#c084fc',
    fillOpacity: 0.22,
    desc: 'Radiation sickness is likely with long exposure. Shelter indoors for at least 24 to 48 hours.',
  },
  1: {
    label: 'Fallout 1 rad/hr',
    short: '1 rad/hr',
    color: '#e9d5ff',
    fillOpacity: 0.14,
    desc: 'Raises long term cancer risk. Stay inside while the fallout decays.',
  },
}

const MIN_WIND = 1

export function computeFallout(kt, fission, windMph) {
  const v = Math.max(windMph, MIN_WIND)
  const f = Math.min(Math.max(fission, 0.01), 1)
  const mt = kt / 1000

  return FALLOUT_LEVELS.map((dose) => {
    const d = dose / f
    const lengthKm = 380 * Math.pow(d / 10, -0.4) * Math.sqrt(mt) * Math.sqrt(v / 15)
    const widthKm = lengthKm * Math.min(0.6, 0.1 * Math.sqrt(15 / v))
    const gzKm = 6.4 * Math.pow(d / 10, -0.26) * Math.pow(mt, 0.4)
    return { dose, lengthKm, widthKm, gzKm }
  })
}

// Distance from ground zero to the edge of a fallout contour, for a direction
// `theta` in radians measured from straight downwind. The shape is a circle
// around ground zero joined to a long ellipse stretched downwind. Both contain
// ground zero, so the union is star shaped and this one number describes it.
export function falloutRadius(contour, theta) {
  const back = 0.5 * contour.gzKm
  const a = (contour.lengthKm + back) / 2
  const b = contour.widthKm / 2
  const xc = (contour.lengthKm - back) / 2
  const cs = Math.cos(theta)
  const sn = Math.sin(theta)
  const A = (cs * cs) / (a * a) + (sn * sn) / (b * b)
  const B = (cs * xc) / (a * a)
  const C = (xc * xc) / (a * a) - 1
  const t = (B + Math.sqrt(B * B - A * C)) / A
  return Math.max(t, contour.gzKm)
}

// Directions (radians from downwind) to sample when drawing a contour. Plumes can
// be needle thin, so on top of an even sweep we add the directions of points spread
// along the ellipse, which crowds samples into the narrow downwind wedge.
export function falloutAngles(contour, n = 128) {
  const back = 0.5 * contour.gzKm
  const a = (contour.lengthKm + back) / 2
  const b = contour.widthKm / 2
  const xc = (contour.lengthKm - back) / 2
  const out = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    out.push(t)
    const th = Math.atan2(b * Math.sin(t), xc + a * Math.cos(t))
    out.push(th < 0 ? th + Math.PI * 2 : th)
  }
  return out.sort((p, q) => p - q)
}

export function falloutAreaKm2(contour) {
  const pts = falloutAngles(contour, 256).map((th) => {
    const r = falloutRadius(contour, th)
    return [r * Math.cos(th), r * Math.sin(th)]
  })
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

// Wind direction is where the wind blows FROM (weather convention).
export function downwindBearing(windFrom) {
  return (windFrom + 180) % 360
}

// How many Hiroshima bombs (about 15 kt) this yield equals.
export function hiroshimas(kt) {
  return kt / 15
}
