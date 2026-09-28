// Free, keyless public APIs: OpenStreetMap Nominatim for place search and
// Open-Meteo for winds aloft. Both are called straight from the browser.

const NOMINATIM = 'https://nominatim.openstreetmap.org'

function shortName(displayName) {
  return displayName.split(',').slice(0, 2).map((s) => s.trim()).join(', ')
}

export async function searchPlaces(query, signal) {
  const url = `${NOMINATIM}/search?format=jsonv2&limit=6&accept-language=en&q=${encodeURIComponent(query)}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const rows = await res.json()
  return rows.map((r) => ({
    id: `osm-${r.osm_type}-${r.osm_id}`,
    label: shortName(r.display_name),
    detail: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }))
}

export async function reverseGeocode(lat, lng, signal) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=14&accept-language=en&lat=${lat}&lon=${lng}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`)
  const r = await res.json()
  if (r.error || !r.address) return null
  const a = r.address
  const local = a.neighbourhood || a.suburb || a.quarter || a.hamlet
  const city = a.city || a.town || a.village || a.county
  const region = a.state || a.country
  const parts = [...new Set([local, city].filter(Boolean))]
  if (parts.length === 0) return region || null
  if (parts.length === 1 && region && region !== parts[0]) parts.push(region)
  return parts.join(', ')
}

// Fallout rides the winds aloft, not the breeze at ground level. Average the
// wind vector at roughly 5,000, 10,000 and 18,000 feet for the current hour.
const LEVELS = [850, 700, 500]

export async function fetchWindsAloft(lat, lng, signal) {
  const vars = LEVELS.flatMap((p) => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`]).join(',')
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&hourly=${vars}&wind_speed_unit=mph&forecast_days=1&timezone=GMT`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Weather failed (${res.status})`)
  const data = await res.json()
  const times = data.hourly?.time || []
  const hour = new Date().toISOString().slice(0, 13) + ':00'
  let i = times.indexOf(hour)
  if (i < 0) i = 0

  let u = 0
  let v = 0
  let n = 0
  for (const p of LEVELS) {
    const spd = data.hourly[`wind_speed_${p}hPa`]?.[i]
    const dir = data.hourly[`wind_direction_${p}hPa`]?.[i]
    if (spd == null || dir == null) continue
    const rad = (dir * Math.PI) / 180
    // Direction is where the wind comes FROM, so it blows toward the opposite side.
    u += -spd * Math.sin(rad)
    v += -spd * Math.cos(rad)
    n++
  }
  if (!n) throw new Error('No wind data here')
  u /= n
  v /= n
  const speed = Math.hypot(u, v)
  const from = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360
  return { windFrom: Math.round(from), windMph: Math.max(1, Math.round(speed)) }
}
