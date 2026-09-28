import { useRef } from 'react'
import { CloudSun, LoaderCircle } from 'lucide-react'
import { compassPoint } from '../lib/geo'
import { formatDistance, formatSpeed } from '../lib/format'
import { optimalHobKm } from '../lib/effects'
import { Section, Segmented } from './ui'

const BURSTS = [
  { value: 'air', label: 'Airburst' },
  { value: 'surface', label: 'Surface burst' },
]

export default function BurstPicker({ burst, onBurst, yieldKt, units, fission, onFission, windFrom, windMph, onWind, onLiveWind, windLoading, windNote }) {
  return (
    <Section title="Detonation">
      <Segmented label="Burst type" options={BURSTS} value={burst} onChange={onBurst} />
      <p className="mt-2.5 text-xs leading-relaxed text-white/55">
        {burst === 'air'
          ? `Goes off about ${formatDistance(optimalHobKm(yieldKt), units)} up, the height that spreads the blast wave the farthest. The fireball never touches the ground, so there is little local fallout.`
          : 'Goes off at ground level. The blast reaches less far, but the fireball digs a crater and sucks up tons of dirt that rains back down downwind as deadly fallout.'}
      </p>

      {burst === 'surface' && (
        <div className="mt-4 space-y-4">
          <WindDial windFrom={windFrom} windMph={windMph} units={units} onWind={onWind} onLiveWind={onLiveWind} loading={windLoading} note={windNote} />

          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-xs text-white/55">
              <span>Fission share of yield</span>
              <span className="font-mono text-white/80">{Math.round(fission * 100)}%</span>
            </span>
            <input
              type="range"
              min={1}
              max={100}
              value={Math.round(fission * 100)}
              onChange={(e) => onFission(Number(e.target.value) / 100)}
              aria-label="Fission share of yield"
              className="w-full accent-hazard"
            />
            <span className="mt-1 block text-[11px] text-white/40">Only fission makes fallout. Most hydrogen bombs are about half fission.</span>
          </label>
        </div>
      )}
    </Section>
  )
}

function WindDial({ windFrom, windMph, units, onWind, onLiveWind, loading, note }) {
  const ref = useRef(null)
  const dragging = useRef(false)
  const toward = (windFrom + 180) % 360

  const aim = (e) => {
    const r = ref.current.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    if (Math.hypot(dx, dy) < 4) return
    const bearing = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    onWind({ windFrom: (Math.round(bearing / 5) * 5 + 180) % 360 })
  }

  const onKey = (e) => {
    const step = e.shiftKey ? 15 : 5
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onWind({ windFrom: (windFrom + step) % 360 })
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onWind({ windFrom: (windFrom - step + 360) % 360 })
    else return
    e.preventDefault()
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-4">
        <svg
          ref={ref}
          viewBox="0 0 100 100"
          className="h-28 w-28 shrink-0 cursor-grab touch-none select-none focus:outline-none active:cursor-grabbing"
          role="slider"
          tabIndex={0}
          aria-label="Fallout direction. Drag to aim where the fallout drifts."
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.round(toward)}
          aria-valuetext={`Fallout drifts ${compassPoint(toward)}`}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            aim(e)
          }}
          onPointerMove={(e) => dragging.current && aim(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={onKey}
        >
          <circle cx="50" cy="50" r="46" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)" />
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i * 22.5 * Math.PI) / 180
            const long = i % 4 === 0
            return (
              <line
                key={i}
                x1={50 + Math.sin(a) * (long ? 38 : 41)}
                y1={50 - Math.cos(a) * (long ? 38 : 41)}
                x2={50 + Math.sin(a) * 45}
                y2={50 - Math.cos(a) * 45}
                stroke="rgba(255,255,255,0.25)"
              />
            )
          })}
          {[
            ['N', 50, 17],
            ['E', 84, 53.5],
            ['S', 50, 89],
            ['W', 16, 53.5],
          ].map(([t, x, y]) => (
            <text key={t} x={x} y={y} textAnchor="middle" fontSize="10" fontWeight="600" fill="rgba(255,255,255,0.45)">
              {t}
            </text>
          ))}
          <g transform={`rotate(${toward} 50 50)`}>
            <path d="M50 50 L42 22 Q50 8 58 22 Z" fill="rgba(192,132,252,0.35)" stroke="#c084fc" strokeWidth="1" />
            <line x1="50" y1="66" x2="50" y2="18" stroke="#facc15" strokeWidth="3" strokeLinecap="round" />
            <path d="M50 10 L43 22 L57 22 Z" fill="#facc15" />
          </g>
          <circle cx="50" cy="50" r="4" fill="#facc15" />
        </svg>

        <div className="min-w-0 flex-1 text-sm">
          <p className="text-white/55">Wind from</p>
          <p className="font-semibold text-white">
            {compassPoint(windFrom)} <span className="font-mono text-xs text-white/45">{Math.round(windFrom)}°</span>
          </p>
          <p className="mt-1.5 text-white/55">Fallout drifts</p>
          <p className="font-semibold text-[#d8b4fe]">{compassPoint(toward)}</p>
          <p className="mt-1.5 text-[11px] leading-snug text-white/40">Drag the dial to aim the plume.</p>
        </div>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 flex items-center justify-between text-xs text-white/55">
          <span>Wind speed</span>
          <span className="font-mono text-white/80">{formatSpeed(windMph, units)}</span>
        </span>
        <input
          type="range"
          min={1}
          max={60}
          value={windMph}
          onChange={(e) => onWind({ windMph: Number(e.target.value) })}
          aria-label="Wind speed"
          className="w-full accent-hazard"
        />
      </label>

      <button
        type="button"
        onClick={onLiveWind}
        disabled={loading}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/80 transition hover:border-hazard/50 hover:text-white disabled:opacity-60"
      >
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CloudSun className="h-4 w-4" />}
        Use today's real winds here
      </button>
      {note && <p className="mt-1.5 text-center text-[11px] text-white/40">{note}</p>}
    </div>
  )
}
