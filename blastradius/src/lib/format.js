const KM_PER_MI = 1.609344

function trim(n, digits) {
  return Number(n.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function formatDistance(km, units) {
  if (units === 'km') {
    if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10).toLocaleString('en-US')} m`
    if (km < 10) return `${trim(km, 1)} km`
    return `${Math.round(km).toLocaleString('en-US')} km`
  }
  const mi = km / KM_PER_MI
  if (mi < 0.1) return `${Math.max(10, Math.round((mi * 5280) / 10) * 10).toLocaleString('en-US')} ft`
  if (mi < 1) return `${trim(mi, 2)} mi`
  if (mi < 10) return `${trim(mi, 1)} mi`
  return `${Math.round(mi).toLocaleString('en-US')} mi`
}

export function formatArea(km2, units) {
  const v = units === 'km' ? km2 : km2 / (KM_PER_MI * KM_PER_MI)
  const unit = units === 'km' ? 'km²' : 'sq mi'
  if (v < 0.01) return `< 0.01 ${unit}`
  if (v < 1) return `${trim(v, 2)} ${unit}`
  if (v < 100) return `${trim(v, 1)} ${unit}`
  return `${Math.round(v).toLocaleString('en-US')} ${unit}`
}

export function formatYield(kt) {
  if (kt < 1) return `${trim(kt * 1000, kt < 0.1 ? 1 : 0)} tons`
  if (kt < 1000) return `${trim(kt, kt < 10 ? 1 : 0)} kt`
  return `${trim(kt / 1000, kt < 10000 ? 2 : 1)} Mt`
}

// Long form like "475,000 tons of TNT".
export function formatTnt(kt) {
  const tons = kt * 1000
  if (tons < 1e6) return `${Math.round(tons).toLocaleString('en-US')} tons of TNT`
  return `${trim(tons / 1e6, 1)} million tons of TNT`
}

export function formatSpeed(mph, units) {
  if (units === 'km') return `${Math.round(mph * KM_PER_MI)} km/h`
  return `${Math.round(mph)} mph`
}

export function formatHours(h) {
  if (!isFinite(h)) return 'never'
  if (h < 1) return `${Math.max(5, Math.round((h * 60) / 5) * 5)} min`
  if (h < 10) return `${trim(h, 1)} hr`
  return `${Math.round(h)} hr`
}

export function formatCoords(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`
}

export { KM_PER_MI }
