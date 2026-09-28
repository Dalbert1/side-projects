const R = 6371.0088
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function bearingDeg(lat1, lng1, lat2, lng2) {
  const p1 = toRad(lat1)
  const p2 = toRad(lat2)
  const dl = toRad(lng2 - lng1)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// Point reached by travelling `distKm` from a start point on a great circle.
export function destination(lat, lng, bearing, distKm) {
  const d = distKm / R
  const b = toRad(bearing)
  const p1 = toRad(lat)
  const l1 = toRad(lng)
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return [toDeg(p2), toDeg(l2)]
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

export function compassPoint(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

export { toRad, toDeg }
