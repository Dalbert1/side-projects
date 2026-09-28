import { useMemo, useRef, useState } from 'react'
import { Crosshair, LoaderCircle, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { PLACES, QUICK_TARGETS, placeById, placeLabel } from '../data/places'
import { searchPlaces } from '../lib/api'
import { formatCoords } from '../lib/format'
import { Chip, Section } from './ui'

export default function TargetPicker({ target, onSelect, onLocate, locating }) {
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState({ q: '', rows: [], loading: false, error: '' })
  const abortRef = useRef(null)

  const q = query.trim().toLowerCase()
  const local = useMemo(() => {
    if (q.length < 2) return []
    return PLACES.filter((p) => p.name.toLowerCase().includes(q) || p.area.toLowerCase().includes(q)).slice(0, 5)
  }, [q])

  const runSearch = async (e) => {
    e?.preventDefault()
    const text = query.trim()
    if (text.length < 2) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRemote({ q: text, rows: [], loading: true, error: '' })
    try {
      const rows = await searchPlaces(text, ctrl.signal)
      setRemote({ q: text, rows, loading: false, error: rows.length ? '' : 'No matches found.' })
    } catch (err) {
      if (err.name !== 'AbortError') setRemote({ q: text, rows: [], loading: false, error: 'Search is unavailable right now.' })
    }
  }

  const choose = (spot) => {
    onSelect(spot)
    setQuery('')
    setRemote({ q: '', rows: [], loading: false, error: '' })
  }

  const showRemote = remote.q && remote.q === query.trim()
  const open = q.length >= 2

  return (
    <Section title="Ground zero">
      <div className="mb-3 flex items-start gap-3 rounded-xl border border-hazard/25 bg-hazard/[0.06] p-3">
        <Crosshair className="mt-0.5 h-5 w-5 shrink-0 text-hazard" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-white" title={target.label}>
            {target.label}
          </p>
          <p className="font-mono text-[11px] text-white/45">{formatCoords(target.lat, target.lng)}</p>
        </div>
      </div>

      <p className="mb-3 text-xs text-white/50">Tap anywhere on the map or drag the crosshair to move it.</p>

      <form onSubmit={runSearch} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any city or address"
          aria-label="Search for a place"
          className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2.5 pl-9 pr-20 text-base text-white placeholder:text-white/35 focus:border-hazard/60 focus:outline-none md:text-sm"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="grid h-8 w-8 place-items-center rounded-lg text-white/40 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onLocate}
            aria-label="Use my location"
            title="Use my location"
            className="grid h-8 w-8 place-items-center rounded-lg text-white/60 hover:text-hazard"
          >
            {locating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          </button>
        </div>
      </form>

      {open && (
        <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/40">
          {local.map((p) => (
            <ResultRow key={p.id} title={p.name} detail={p.area} onClick={() => choose({ lat: p.lat, lng: p.lng, label: placeLabel(p) })} />
          ))}
          {showRemote &&
            remote.rows.map((r) => <ResultRow key={r.id} title={r.label} detail={r.detail} onClick={() => choose({ lat: r.lat, lng: r.lng, label: r.label })} />)}
          {showRemote && remote.loading && (
            <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-white/50">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Searching the world...
            </p>
          )}
          {showRemote && remote.error && <p className="px-3 py-2.5 text-sm text-white/50">{remote.error}</p>}
          {!showRemote && (
            <button type="button" onClick={runSearch} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-hazard hover:bg-white/5">
              <Search className="h-4 w-4" /> Search the world for "{query.trim()}"
            </button>
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {QUICK_TARGETS.map((g) => (
          <div key={g.title}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/35">{g.title}</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {g.ids.map((id) => {
                const p = placeById(id)
                const on = Math.abs(p.lat - target.lat) < 1e-4 && Math.abs(p.lng - target.lng) < 1e-4
                return (
                  <Chip key={id} active={on} title={placeLabel(p)} onClick={() => onSelect({ lat: p.lat, lng: p.lng, label: placeLabel(p) })}>
                    {p.name.replace(/^The /, '')}
                  </Chip>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function ResultRow({ title, detail, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-2 border-b border-white/5 px-3 py-2.5 text-left last:border-b-0 hover:bg-white/5">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-white">{title}</span>
        <span className="block truncate text-xs text-white/40">{detail}</span>
      </span>
    </button>
  )
}
