import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info, Layers, Minimize2, Maximize2, Volume2, VolumeX } from 'lucide-react'
import MapView, { BASEMAPS } from './components/MapView'
import TargetPicker from './components/TargetPicker'
import WeaponPicker from './components/WeaponPicker'
import BurstPicker from './components/BurstPicker'
import ResultsPanel, { LegendStrip } from './components/ResultsPanel'
import AboutModal from './components/AboutModal'
import Trefoil from './components/Trefoil'
import { IconButton, Segmented } from './components/ui'
import { DEFAULT_WEAPON_ID, weaponById } from './data/weapons'
import { DEFAULT_PLACE_ID, PLACES, placeById, placeLabel } from './data/places'
import { fromHash, makeDetonation, toHash } from './lib/detonation'
import { fetchWindsAloft, reverseGeocode } from './lib/api'
import { formatCoords, formatYield } from './lib/format'
import { haversineKm } from './lib/geo'
import { playBoom, unlockAudio } from './lib/sound'
import { storage, useElementHeight, useMediaQuery } from './lib/hooks'

function initialState() {
  const shared = fromHash(window.location.hash)
  if (shared) {
    const w = weaponById(shared.weaponId)
    const sameYield = w && Math.abs(w.kt - shared.kt) / w.kt < 0.01
    return {
      target: { lat: shared.lat, lng: shared.lng, label: shared.label || formatCoords(shared.lat, shared.lng), fly: false },
      weaponId: sameYield ? w.id : 'custom',
      yieldKt: shared.kt,
      burst: shared.burst,
      fission: shared.fission ?? w?.fission ?? 0.5,
      wind: { windFrom: shared.windFrom, windMph: shared.windMph },
      auto: true,
    }
  }
  const p = placeById(DEFAULT_PLACE_ID)
  const w = weaponById(DEFAULT_WEAPON_ID)
  return {
    target: { lat: p.lat, lng: p.lng, label: placeLabel(p), fly: false },
    weaponId: w.id,
    yieldKt: w.kt,
    burst: 'air',
    fission: w.fission,
    // Winds aloft over Oklahoma mostly blow out of the west-southwest.
    wind: { windFrom: 250, windMph: 15 },
    auto: false,
  }
}

function nearbyPlace(lat, lng) {
  let best = null
  for (const p of PLACES) {
    const d = haversineKm(lat, lng, p.lat, p.lng)
    if (d < 1.5 && (!best || d < best.d)) best = { p, d }
  }
  return best?.p || null
}

const intensity = (kt) => Math.min(1, Math.max(0, (Math.log10(kt) + 2) / 7))

export default function App() {
  const [init] = useState(initialState)
  const [target, setTarget] = useState(init.target)
  const [weaponId, setWeaponId] = useState(init.weaponId)
  const [yieldKt, setYieldKt] = useState(init.yieldKt)
  const [burst, setBurst] = useState(init.burst)
  const [fission, setFission] = useState(init.fission)
  const [wind, setWind] = useState(init.wind)
  const [windState, setWindState] = useState({ loading: false, note: '' })
  const [detonations, setDetonations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())
  const [units, setUnits] = useState(() => (storage.get('units') === 'km' ? 'km' : 'mi'))
  const [basemap, setBasemap] = useState(() => (BASEMAPS[storage.get('basemap')] ? storage.get('basemap') : 'dark'))
  const [sound, setSound] = useState(() => storage.get('sound') !== 'off')
  const [focus, setFocus] = useState(null)
  const [about, setAbout] = useState(false)
  const [sheet, setSheet] = useState('peek')
  const [tab, setTab] = useState('setup')
  const [resultsOpen, setResultsOpen] = useState(true)
  const [flash, setFlash] = useState(0)
  const [toast, setToast] = useState(null)
  const [locating, setLocating] = useState(false)
  const [sheetEl, setSheetEl] = useState(null)
  const [dockEl, setDockEl] = useState(null)
  const sheetH = useElementHeight(sheetEl)
  const dockH = useElementHeight(dockEl)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const mapWrapRef = useRef(null)
  const soundRef = useRef(sound)
  soundRef.current = sound
  const pickReq = useRef(0)
  const pickTimer = useRef(0)
  const toastTimer = useRef(0)

  const weapon = weaponById(weaponId)
  const active = detonations.find((d) => d.id === activeId) || detonations[detonations.length - 1] || null

  useEffect(() => storage.set('units', units), [units])
  useEffect(() => storage.set('basemap', basemap), [basemap])
  useEffect(() => storage.set('sound', sound ? 'on' : 'off'), [sound])

  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current)
    setToast({ msg, key: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  // Keep fitted views clear of the panels.
  const padding = useMemo(
    () =>
      isDesktop
        ? { left: 384, top: 0, right: active && resultsOpen ? 372 : 0, bottom: 0 }
        : { left: 0, top: 64, right: 0, bottom: dockH + 30 },
    [isDesktop, active, resultsOpen, dockH],
  )

  const pick = useCallback((ll) => {
    const { lat, lng } = ll
    const req = ++pickReq.current
    const near = nearbyPlace(lat, lng)
    setTarget({ lat, lng, label: near ? `Near ${near.name}` : formatCoords(lat, lng), fly: false })
    clearTimeout(pickTimer.current)
    pickTimer.current = setTimeout(() => {
      reverseGeocode(lat, lng)
        .then((label) => {
          if (label && pickReq.current === req) setTarget((t) => (t.lat === lat && t.lng === lng ? { ...t, label } : t))
        })
        .catch(() => {})
    }, 700)
  }, [])

  const selectPlace = useCallback(
    (spot) => {
      pickReq.current++
      clearTimeout(pickTimer.current)
      setTarget({ lat: spot.lat, lng: spot.lng, label: spot.label, fly: true })
      if (!isDesktop) setSheet('peek')
    },
    [isDesktop],
  )

  const locate = () => {
    if (!navigator.geolocation) return showToast('Location is not available on this device')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        selectPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Your location' })
      },
      () => {
        setLocating(false)
        showToast('Could not get your location')
      },
      { timeout: 10000, maximumAge: 60000 },
    )
  }

  const onWeapon = (id) => {
    const w = weaponById(id)
    setWeaponId(w ? w.id : 'custom')
    if (w) {
      setYieldKt(w.kt)
      setFission(w.fission)
    }
  }

  const onYield = (kt) => {
    setYieldKt(kt)
    setWeaponId('custom')
  }

  const liveWind = async () => {
    setWindState({ loading: true, note: '' })
    try {
      setWind(await fetchWindsAloft(target.lat, target.lng))
      setWindState({ loading: false, note: 'Current average wind 5,000 to 18,000 ft up' })
    } catch {
      setWindState({ loading: false, note: 'Could not load live winds. Try again later.' })
    }
  }

  const detonate = (opts = {}) => {
    if (!opts.silent) unlockAudio()
    const det = {
      ...makeDetonation({ target, weapon, yieldKt, burst, fission, ...wind }),
      animate: true,
      silent: !!opts.silent,
    }
    setDetonations((ds) => [...ds, det])
    setActiveId(det.id)
    setResultsOpen(true)
    setTab('results')
    if (!isDesktop) setSheet('peek')
    try {
      window.history.replaceState(null, '', toHash(det))
    } catch {
      // Some embedded browsers block history changes. Sharing still works.
    }
  }

  // A shared link sets itself off once the map is up.
  const detonateRef = useRef(detonate)
  detonateRef.current = detonate
  useEffect(() => {
    if (!init.auto) return
    const t = setTimeout(() => detonateRef.current({ silent: true }), 350)
    return () => clearTimeout(t)
  }, [init.auto])

  const onBoom = useCallback((det) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduce) {
      setFlash((f) => f + 1)
      const el = mapWrapRef.current
      if (el) {
        el.classList.remove('shake')
        void el.offsetWidth
        el.classList.add('shake')
      }
    }
    if (det.silent) return
    if (soundRef.current) playBoom(intensity(det.yieldKt))
    navigator.vibrate?.([60, 40, 220])
  }, [])

  const selectDetonation = useCallback(
    (id) => {
      setActiveId(id)
      setResultsOpen(true)
      setTab('results')
      if (!isDesktop) setSheet('open')
    },
    [isDesktop],
  )

  const removeDetonation = (id) => {
    setDetonations((ds) => ds.filter((d) => d.id !== id))
    if (id === active?.id) setActiveId(null)
  }

  const clearAll = () => {
    setDetonations([])
    setActiveId(null)
    setTab('setup')
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      // Ignore.
    }
  }

  const toggleHidden = (key) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const focusOn = (mode) => {
    if (!active) return
    setFocus({ id: active.id, mode, n: Date.now() })
    if (!isDesktop) setSheet('peek')
  }

  const share = async (det) => {
    const url = `${window.location.origin}${window.location.pathname}${toHash(det)}`
    const text = `What a ${formatYield(det.yieldKt)} ${det.weaponName} would do to ${det.label}`
    if (navigator.share && !isDesktop) {
      try {
        await navigator.share({ title: '918 Blast Radius', text, url })
        return
      } catch (e) {
        if (e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      showToast('Link copied. Send it to a friend.')
    } catch {
      window.history.replaceState(null, '', toHash(det))
      showToast('Copy the link from your address bar')
    }
  }

  const setup = (
    <>
      <TargetPicker target={target} onSelect={selectPlace} onLocate={locate} locating={locating} />
      <WeaponPicker weaponId={weaponId} yieldKt={yieldKt} onWeapon={onWeapon} onYield={onYield} />
      <BurstPicker
        burst={burst}
        onBurst={setBurst}
        yieldKt={yieldKt}
        units={units}
        fission={fission}
        onFission={setFission}
        windFrom={wind.windFrom}
        windMph={wind.windMph}
        onWind={(w) => setWind((cur) => ({ ...cur, ...w }))}
        onLiveWind={liveWind}
        windLoading={windState.loading}
        windNote={windState.note}
      />
    </>
  )

  const results = active && (
    <ResultsPanel
      det={active}
      detonations={detonations}
      onSelect={selectDetonation}
      onRemove={removeDetonation}
      onClear={clearAll}
      units={units}
      onUnits={setUnits}
      hidden={hidden}
      onToggle={toggleHidden}
      onFocus={focusOn}
      onShare={share}
    />
  )

  const tools = (
    <>
      <StyleMenu value={basemap} onChange={setBasemap} />
      <IconButton label={sound ? 'Mute sound' : 'Turn sound on'} onClick={() => setSound(!sound)}>
        {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
      </IconButton>
      <IconButton label="About this map" onClick={() => setAbout(true)}>
        <Info className="h-5 w-5" />
      </IconButton>
    </>
  )

  const summary = (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-white">
        <span className="text-hazard">{formatYield(yieldKt)}</span> {weapon ? weapon.name : 'Custom weapon'}
      </p>
      <p className="truncate text-xs text-white/50">
        {burst === 'air' ? 'Airburst' : 'Surface burst'} over {target.label}
      </p>
    </div>
  )

  return (
    <div className={`fixed inset-0 overflow-hidden bg-[#06080b] ${isDesktop ? 'app-desktop' : 'app-mobile'}`} style={{ '--sheet-h': `${sheetH}px` }}>
      <div ref={mapWrapRef} className="absolute inset-0">
        <MapView
          target={target}
          detonations={detonations}
          activeId={active?.id ?? null}
          hidden={hidden}
          basemap={basemap}
          padding={padding}
          focus={focus}
          onPick={pick}
          onSelect={selectDetonation}
          onBoom={onBoom}
        />
      </div>

      {isDesktop ? (
        <>
          <aside className="absolute bottom-3 left-3 top-3 z-[1100] flex w-[360px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur-xl">
            <header className="relative z-10 border-b border-white/[0.07] px-4 pb-3 pt-4">
              <div className="flex items-start justify-between gap-2">
                <Brand />
              </div>
              <div className="mt-3 flex gap-2">{tools}</div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{setup}</div>
            <div className="border-t border-white/[0.07] p-4">
              <div className="mb-3">{summary}</div>
              <DetonateButton wide onClick={() => detonate()} />
              {detonations.length > 0 && (
                <button type="button" onClick={clearAll} className="mt-2 w-full text-center text-xs text-white/45 hover:text-white">
                  Clear {detonations.length === 1 ? 'the strike' : `all ${detonations.length} strikes`}
                </button>
              )}
            </div>
          </aside>

          {active && (
            <aside className="absolute right-3 top-3 z-[1100] flex max-h-[calc(100%-8rem)] w-[360px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/[0.07] py-2 pl-4 pr-2">
                <p className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-white/55">Damage report</p>
                <button
                  type="button"
                  onClick={() => setResultsOpen(!resultsOpen)}
                  aria-label={resultsOpen ? 'Collapse damage report' : 'Expand damage report'}
                  className="grid h-8 w-8 place-items-center rounded-lg text-white/50 hover:bg-white/5 hover:text-white"
                >
                  {resultsOpen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
              </div>
              {resultsOpen ? (
                <div className="min-h-0 overflow-y-auto overscroll-contain">{results}</div>
              ) : (
                <div className="py-2.5">
                  <LegendStrip det={active} units={units} hidden={hidden} />
                </div>
              )}
            </aside>
          )}
        </>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1100] flex items-start justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto min-w-0 overflow-hidden rounded-xl border border-white/10 bg-panel/90 px-2.5 py-2 backdrop-blur">
              <Brand compact />
            </div>
            <div className="pointer-events-auto flex shrink-0 gap-1.5">{tools}</div>
          </div>

          <div
            ref={setSheetEl}
            className="absolute inset-x-0 bottom-0 z-[1100] flex max-h-[86dvh] flex-col rounded-t-3xl border-t border-white/10 bg-panel/95 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={() => setSheet(sheet === 'open' ? 'peek' : 'open')}
              aria-label={sheet === 'open' ? 'Collapse controls' : 'Expand controls'}
              aria-expanded={sheet === 'open'}
              className="flex w-full justify-center pb-2 pt-2.5"
            >
              <span className="h-1.5 w-11 rounded-full bg-white/25" />
            </button>

            {sheet === 'open' && (
              <>
                {active && (
                  <div className="px-4 pb-2">
                    <Segmented
                      label="Panel"
                      options={[
                        { value: 'setup', label: 'Setup' },
                        { value: 'results', label: 'Damage report' },
                      ]}
                      value={tab}
                      onChange={setTab}
                    />
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/[0.07]">{tab === 'results' && active ? results : setup}</div>
              </>
            )}

            <div ref={setDockEl}>
              {sheet === 'peek' && active && (
                <button type="button" className="block w-full text-left" onClick={() => (setTab('results'), setSheet('open'))} aria-label="Open damage report">
                  <LegendStrip det={active} units={units} hidden={hidden} />
                </button>
              )}
              <div className="flex items-center gap-3 border-t border-white/[0.07] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (setTab('setup'), setSheet('open'))}>
                  {summary}
                </button>
                <DetonateButton onClick={() => detonate()} />
              </div>
            </div>
          </div>
        </>
      )}

      {flash > 0 && <div key={flash} className="flash pointer-events-none fixed inset-0 z-[2500]" aria-hidden="true" />}

      {toast && (
        <div key={toast.key} role="status" className="toast fixed left-1/2 top-4 z-[2600] -translate-x-1/2 rounded-full border border-white/10 bg-black/85 px-4 py-2 text-sm text-white shadow-xl">
          {toast.msg}
        </div>
      )}

      {about && <AboutModal onClose={() => setAbout(false)} />}
    </div>
  )
}

function Brand({ compact }) {
  return (
    <div className="flex items-center gap-2.5">
      <Trefoil className={`shrink-0 ${compact ? 'h-6 w-6' : 'h-10 w-10'}`} />
      <div className="min-w-0 leading-none">
        <h1 className={`truncate font-display font-bold uppercase tracking-wide text-white ${compact ? 'text-base' : 'text-2xl'}`}>
          918 <span className="text-hazard">Blast Radius</span>
        </h1>
        {!compact && <p className="mt-1 text-xs text-white/50">Pick a nuke. Pick a target. See how far it reaches.</p>}
      </div>
    </div>
  )
}

function DetonateButton({ onClick, wide }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative shrink-0 overflow-hidden rounded-xl bg-linear-to-b from-red-500 to-red-700 font-display font-semibold uppercase text-white shadow-[0_0_28px_rgba(239,68,68,0.45)] ring-1 ring-red-300/40 transition hover:from-red-400 hover:to-red-600 active:scale-[0.97] ${
        wide ? 'w-full py-3.5 text-xl tracking-[0.2em]' : 'px-4 py-3 text-base tracking-[0.14em]'
      }`}
    >
      <span className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.14)_0_10px,transparent_10px_20px)]" aria-hidden="true" />
      <span className="relative flex items-center justify-center gap-2">
        <Trefoil className="h-5 w-5" bg="#ffffff" fill="#b91c1c" />
        Detonate
      </span>
    </button>
  )
}

function StyleMenu({ value, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <IconButton label="Map style" onClick={() => setOpen(!open)} active={open}>
        <Layers className="h-5 w-5" />
      </IconButton>
      {open && (
        <div className="absolute left-0 top-12 z-20 w-36 overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl max-md:left-auto max-md:right-0">
          {Object.entries(BASEMAPS).map(([key, b]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onChange(key)
                setOpen(false)
              }}
              className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-white/5 ${key === value ? 'font-semibold text-hazard' : 'text-white/80'}`}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
