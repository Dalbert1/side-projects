import { computeEffects, computeFallout, falloutRadius, downwindBearing, SEVERITY } from './effects'
import { haversineKm, bearingDeg, toRad } from './geo'
import { PLACES } from '../data/places'
import { KM_PER_MI } from './format'

let nextId = 1

export function makeDetonation({ target, weapon, yieldKt, burst, fission, windFrom, windMph }) {
  const { hobKm, rings } = computeEffects(yieldKt, burst)
  const fallout = burst === 'surface' ? computeFallout(yieldKt, fission, windMph) : []
  return {
    id: nextId++,
    lat: target.lat,
    lng: target.lng,
    label: target.label,
    weaponId: weapon?.id || 'custom',
    weaponName: weapon?.name || 'Custom yield',
    yieldKt,
    burst,
    fission,
    windFrom,
    windMph,
    hobKm,
    rings,
    fallout,
  }
}

export function ringRadius(det, key) {
  return det.rings.find((r) => r.key === key)?.radiusKm || 0
}

// Which contour (if any) covers a point at distance d and bearing brg from ground zero.
export function falloutAt(det, d, brg) {
  if (!det.fallout.length) return null
  const theta = toRad(brg - downwindBearing(det.windFrom))
  for (const c of [...det.fallout].sort((a, b) => b.dose - a.dose)) {
    if (d <= falloutRadius(c, theta)) return c
  }
  return null
}

export function placesInRange(det) {
  const out = []
  const mph = Math.max(det.windMph, 1)
  for (const p of PLACES) {
    const d = haversineKm(det.lat, det.lng, p.lat, p.lng)
    const zone = SEVERITY.find((key) => d <= ringRadius(det, key)) || null
    const fall = falloutAt(det, d, bearingDeg(det.lat, det.lng, p.lat, p.lng))
    if (!zone && !fall) continue
    out.push({ place: p, distanceKm: d, zone, fallout: fall, arrivalHrs: fall ? d / (mph * KM_PER_MI) : null })
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm)
}

// Share links carry the whole setup in the URL hash.
export function toHash(det) {
  const q = new URLSearchParams({
    lat: det.lat.toFixed(5),
    lng: det.lng.toFixed(5),
    kt: String(+det.yieldKt.toPrecision(4)),
    b: det.burst === 'surface' ? 's' : 'a',
    w: det.weaponId,
  })
  if (det.burst === 'surface') {
    q.set('ff', String(Math.round(det.fission * 100)))
    q.set('wd', String(Math.round(det.windFrom)))
    q.set('ws', String(Math.round(det.windMph)))
  }
  if (det.label) q.set('at', det.label)
  return `#${q.toString()}`
}

export function fromHash(hash) {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const lat = Number(q.get('lat'))
  const lng = Number(q.get('lng'))
  const kt = Number(q.get('kt'))
  if (!q.has('lat') || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 85 || !(kt > 0)) return null
  const num = (key, fallback, lo, hi) => {
    const v = Number(q.get(key))
    return q.has(key) && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
  }
  return {
    lat,
    lng: ((((lng + 180) % 360) + 360) % 360) - 180,
    kt: Math.min(100000, Math.max(0.01, kt)),
    burst: q.get('b') === 's' ? 'surface' : 'air',
    weaponId: q.get('w') || 'custom',
    fission: q.has('ff') ? num('ff', 50, 1, 100) / 100 : null,
    windFrom: num('wd', 250, 0, 359),
    windMph: num('ws', 15, 1, 60),
    label: (q.get('at') || '').slice(0, 80),
  }
}
