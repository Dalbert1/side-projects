import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { RING_INFO, FALLOUT_INFO, falloutAngles, falloutRadius, downwindBearing } from '../lib/effects'
import { destination } from '../lib/geo'
import { trefoilSvg } from './Trefoil'

// Every map style uses tile servers that need no API key.
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM = { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'

export const BASEMAPS = {
  dark: {
    name: 'Dark',
    bg: '#0b0e13',
    // Standard OSM tiles, darkened with a CSS filter (see .tiles-dark).
    layers: [[OSM_URL, { ...OSM, className: 'tiles-dark' }]],
  },
  streets: {
    name: 'Streets',
    bg: '#e5e3df',
    layers: [[OSM_URL, OSM]],
  },
  satellite: {
    name: 'Satellite',
    bg: '#0b0e13',
    layers: [
      [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }],
      [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, zIndex: 2 }],
    ],
  },
}

const targetIcon = L.divIcon({
  className: 'gz-target',
  html:
    '<div class="gz-ring"></div>' +
    '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">' +
    '<circle cx="20" cy="20" r="9" fill="rgba(0,0,0,.35)" stroke="#facc15" stroke-width="2.5"/>' +
    '<path d="M20 3v10M20 27v10M3 20h10M27 20h10" stroke="#facc15" stroke-width="2.5" stroke-linecap="round"/>' +
    '<circle cx="20" cy="20" r="2.5" fill="#facc15"/></svg>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
})

const detIcon = (active) =>
  L.divIcon({
    className: `det-icon${active ? '' : ' inactive'}`,
    html: trefoilSvg({ size: 22 }),
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t)
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const canHover = () => window.matchMedia?.('(hover: hover)').matches

// Outline of a fallout contour. `reachKm` trims it so the plume can grow downwind.
function falloutLatLngs(det, contour, reachKm = Infinity, samples = 128) {
  const dw = downwindBearing(det.windFrom)
  return falloutAngles(contour, samples).map((theta) =>
    destination(det.lat, det.lng, dw + (theta * 180) / Math.PI, Math.min(falloutRadius(contour, theta), reachKm)),
  )
}

// mode: 'auto' (blast plus the 100 rad/hr plume), 'blast' or 'fallout' (whole plume).
function detBounds(det, mode = 'auto') {
  const maxR = Math.max(...det.rings.map((r) => r.radiusKm))
  const b = L.latLng(det.lat, det.lng).toBounds(maxR * 2000)
  if (det.fallout.length && mode !== 'blast') {
    const c = det.fallout.find((f) => f.dose === (mode === 'fallout' ? 1 : 100))
    if (c) b.extend(L.latLngBounds(falloutLatLngs(det, c, Infinity, 48)))
  }
  return b
}

function buildEntry(det, onSelect) {
  const group = L.featureGroup()
  const items = []
  const hover = canHover()

  for (const c of [...det.fallout].sort((a, b) => a.dose - b.dose)) {
    const info = FALLOUT_INFO[c.dose]
    const layer = L.polygon(falloutLatLngs(det, c), {
      color: info.color,
      weight: 1,
      opacity: 0.75,
      fillColor: info.color,
      fillOpacity: info.fillOpacity,
      interactive: false,
    })
    items.push({ key: `fallout-${c.dose}`, kind: 'fallout', contour: c, layer })
  }

  for (const r of [...det.rings].sort((a, b) => b.radiusKm - a.radiusKm)) {
    const info = RING_INFO[r.key]
    const layer = L.circle([det.lat, det.lng], {
      radius: r.radiusKm * 1000,
      color: info.color,
      weight: 1.5,
      opacity: 0.9,
      fillColor: info.color,
      fillOpacity: info.fillOpacity,
      interactive: hover,
    })
    if (hover) layer.bindTooltip(info.label, { sticky: true, direction: 'top', className: 'ring-tip' })
    items.push({ key: r.key, kind: 'ring', ring: r, layer })
  }

  for (const it of items) group.addLayer(it.layer)
  const marker = L.marker([det.lat, det.lng], { icon: detIcon(true), keyboard: false, title: det.weaponName })
  marker.on('click', () => onSelect(det.id))
  group.addLayer(marker)

  return { det, group, items, marker, raf: 0, timer: 0, dead: false }
}

function applyHidden(entry, hidden) {
  for (const it of entry.items) {
    const show = !hidden.has(it.key)
    const has = entry.group.hasLayer(it.layer)
    if (show && !has) entry.group.addLayer(it.layer)
    if (!show && has) entry.group.removeLayer(it.layer)
  }
  // Re-added layers land on top, so restore the big-to-small stacking order.
  for (const it of entry.items) if (entry.group.hasLayer(it.layer)) it.layer.bringToFront()
}

function setFrame(entry, t) {
  const rings = entry.items.filter((i) => i.kind === 'ring')
  const fall = entry.items.filter((i) => i.kind === 'fallout')
  const radii = rings.map((i) => i.ring.radiusKm)
  const maxR = Math.max(...radii)
  const minR = Math.min(...radii)
  let done = true

  for (const it of rings) {
    const k = Math.log(it.ring.radiusKm / minR + 1) / Math.log(maxR / minR + 1)
    const p = Math.min(1, t / (700 + 1300 * k))
    if (p < 1) done = false
    it.layer.setRadius(Math.max(1, it.ring.radiusKm * 1000 * easeOutCubic(p)))
  }

  if (fall.length) {
    const plume = Math.max(...fall.map((i) => i.contour.lengthKm))
    const p = Math.min(1, Math.max(0, (t - 700) / 3200))
    if (p < 1) done = false
    const reach = Math.max(0.001, plume * easeInOutSine(p))
    for (const it of fall) it.layer.setLatLngs(falloutLatLngs(entry.det, it.contour, reach))
  }

  if (entry.shock) {
    const p = Math.min(1, t / 2200)
    if (p < 1) done = false
    entry.shock.setRadius(Math.max(1, maxR * 1080 * easeOutQuad(p)))
    entry.shock.setStyle({ opacity: 0.95 * (1 - p), weight: 1 + 4 * (1 - p) })
  }

  return done
}

function runAnimation(entry) {
  entry.shock = L.circle([entry.det.lat, entry.det.lng], {
    radius: 1,
    color: '#ffffff',
    weight: 4,
    fill: false,
    interactive: false,
  }).addTo(entry.group)
  const t0 = performance.now()
  const frame = (now) => {
    if (entry.dead) return
    if (setFrame(entry, now - t0)) {
      entry.shock.remove()
      entry.shock = null
      entry.raf = 0
    } else {
      entry.raf = requestAnimationFrame(frame)
    }
  }
  entry.raf = requestAnimationFrame(frame)
}

function fitOptions(padding) {
  return {
    paddingTopLeft: [padding.left + 16, padding.top + 16],
    paddingBottomRight: [padding.right + 16, padding.bottom + 16],
    maxZoom: 16,
  }
}

export default function MapView({ target, detonations, activeId, hidden, basemap, padding, focus, onPick, onSelect, onBoom }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const targetRef = useRef(null)
  const entriesRef = useRef(new Map())
  const live = useRef({})
  live.current = { onPick, onSelect, onBoom, padding, hidden }

  useEffect(() => {
    const map = L.map(elRef.current, {
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 2,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 90,
    })
    map.setView([target.lat, target.lng], 11)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.on('click', (e) => live.current.onPick?.(e.latlng.wrap(), 'click'))

    const marker = L.marker([target.lat, target.lng], {
      icon: targetIcon,
      draggable: true,
      keyboard: false,
      zIndexOffset: 1000,
      title: 'Ground zero (drag me)',
    }).addTo(map)
    marker.on('dragend', () => live.current.onPick?.(marker.getLatLng().wrap(), 'drag'))

    mapRef.current = map
    targetRef.current = marker
    const entries = entriesRef.current
    return () => {
      for (const e of entries.values()) {
        e.dead = true
        cancelAnimationFrame(e.raf)
        clearTimeout(e.timer)
      }
      entries.clear()
      map.remove()
      mapRef.current = null
    }
    // The map is created once; later target changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const cfg = BASEMAPS[basemap] || BASEMAPS.dark
    map.getContainer().style.background = cfg.bg
    const layers = cfg.layers.map(([url, opts]) => L.tileLayer(url, { detectRetina: false, ...opts }).addTo(map))
    return () => layers.forEach((l) => l.remove())
  }, [basemap])

  useEffect(() => {
    const map = mapRef.current
    targetRef.current.setLatLng([target.lat, target.lng])
    if (target.fly) {
      if (prefersReducedMotion()) map.setView([target.lat, target.lng], 11)
      else map.flyTo([target.lat, target.lng], 11, { duration: 1.2 })
    }
  }, [target])

  useEffect(() => {
    const map = mapRef.current
    const entries = entriesRef.current
    const ids = new Set(detonations.map((d) => d.id))

    for (const [id, e] of entries) {
      if (ids.has(id)) continue
      e.dead = true
      cancelAnimationFrame(e.raf)
      clearTimeout(e.timer)
      e.group.remove()
      entries.delete(id)
    }

    for (const det of detonations) {
      if (entries.has(det.id)) continue
      const entry = buildEntry(det, (id) => live.current.onSelect?.(id))
      entries.set(det.id, entry)
      entry.group.addTo(map)
      applyHidden(entry, live.current.hidden)

      const opts = fitOptions(live.current.padding)
      if (!det.animate || prefersReducedMotion()) {
        map.fitBounds(detBounds(det), opts)
        if (det.animate) live.current.onBoom?.(det)
        continue
      }

      // Hide the effects, fly to the target, then set it off.
      setFrame(entry, 0)
      let started = false
      const boom = () => {
        if (started || entry.dead) return
        started = true
        clearTimeout(entry.timer)
        live.current.onBoom?.(det)
        runAnimation(entry)
      }
      map.once('moveend', boom)
      entry.timer = setTimeout(boom, 1100)
      map.flyToBounds(detBounds(det), { ...opts, duration: 0.8 })
    }
  }, [detonations])

  useEffect(() => {
    for (const e of entriesRef.current.values()) applyHidden(e, hidden)
  }, [hidden])

  useEffect(() => {
    for (const [id, e] of entriesRef.current) e.marker.setIcon(detIcon(id === activeId))
  }, [activeId, detonations])

  useEffect(() => {
    if (!focus) return
    const e = entriesRef.current.get(focus.id)
    if (!e) return
    mapRef.current.flyToBounds(detBounds(e.det, focus.mode), { ...fitOptions(live.current.padding), duration: 0.9 })
  }, [focus])

  return <div ref={elRef} className="absolute inset-0" role="application" aria-label="World map. Tap to place ground zero." />
}
