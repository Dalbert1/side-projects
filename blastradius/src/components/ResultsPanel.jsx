import { useMemo, useState } from 'react'
import { Eye, EyeOff, Maximize, Share2, Wind, X } from 'lucide-react'
import { RING_INFO, FALLOUT_INFO, falloutAreaKm2, downwindBearing } from '../lib/effects'
import { placesInRange } from '../lib/detonation'
import { compassPoint } from '../lib/geo'
import { formatArea, formatDistance, formatHours, formatSpeed, formatYield } from '../lib/format'
import { countryOf, weaponById } from '../data/weapons'
import { Section, Segmented } from './ui'

const UNITS = [
  { value: 'mi', label: 'mi' },
  { value: 'km', label: 'km' },
]

export default function ResultsPanel({ det, detonations, onSelect, onRemove, onClear, units, onUnits, hidden, onToggle, onFocus, onShare }) {
  const country = countryOf(weaponById(det.weaponId))
  const index = detonations.findIndex((d) => d.id === det.id) + 1

  return (
    <div>
      {detonations.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-white/[0.07] px-4 py-2.5 [scrollbar-width:none]">
          {detonations.map((d, i) => (
            <span key={d.id} className={`flex shrink-0 items-center rounded-full border text-xs ${d.id === det.id ? 'border-hazard bg-hazard/15 text-hazard' : 'border-white/10 text-white/60'}`}>
              <button type="button" onClick={() => onSelect(d.id)} className="py-1 pl-3 pr-1.5 font-medium">
                #{i + 1} {formatYield(d.yieldKt)}
              </button>
              <button type="button" onClick={() => onRemove(d.id)} aria-label={`Remove strike ${i + 1}`} className="grid h-6 w-6 place-items-center rounded-full hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <button type="button" onClick={onClear} className="shrink-0 px-2 text-xs text-white/45 underline-offset-2 hover:text-white hover:underline">
            Clear all
          </button>
        </div>
      )}

      <div className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
            Strike #{index} {country ? `· ${country.flag}` : ''}
          </p>
          <div className="w-24 shrink-0">
            <Segmented label="Units" size="sm" options={UNITS} value={units} onChange={onUnits} />
          </div>
        </div>
        <h2 className="-mt-1 font-display text-2xl font-semibold leading-tight text-white">
          {det.weaponName} <span className="text-hazard">{formatYield(det.yieldKt)}</span>
        </h2>
        <p className="mt-1 text-sm text-white/60">
          {det.burst === 'air' ? `Airburst at ${formatDistance(det.hobKm, units)} over ` : 'Surface burst at '}
          <span className="text-white/85">{det.label}</span>
        </p>
        {det.burst === 'surface' && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
            <Wind className="h-3.5 w-3.5" /> Wind from {compassPoint(det.windFrom)} at {formatSpeed(det.windMph, units)}, fallout drifts{' '}
            {compassPoint(downwindBearing(det.windFrom))}
          </p>
        )}
      </div>

      <Section title="Blast effects" aside={<ZoomButton onClick={() => onFocus('blast')} label="Zoom to blast" />}>
        <ul className="-mx-2 space-y-0.5">
          {det.rings.map((r) => {
            const info = RING_INFO[r.key]
            return (
              <EffectRow
                key={r.key}
                color={info.color}
                title={info.label}
                value={formatDistance(r.radiusKm, units)}
                sub={`${formatArea(Math.PI * r.radiusKm * r.radiusKm, units)}`}
                desc={info.desc}
                hidden={hidden.has(r.key)}
                onToggle={() => onToggle(r.key)}
              />
            )
          })}
        </ul>
        <p className="mt-2 text-[11px] text-white/35">Distances are the radius from ground zero. Tap a row to hide it on the map.</p>
      </Section>

      {det.fallout.length > 0 && (
        <Section title="Fallout plume" aside={<ZoomButton onClick={() => onFocus('fallout')} label="Zoom to fallout" />}>
          <ul className="-mx-2 space-y-0.5">
            {det.fallout.map((c) => {
              const info = FALLOUT_INFO[c.dose]
              const key = `fallout-${c.dose}`
              return (
                <EffectRow
                  key={key}
                  color={info.color}
                  title={info.label}
                  value={formatDistance(c.lengthKm, units)}
                  sub={`downwind, ${formatDistance(c.widthKm, units)} wide · ${formatArea(falloutAreaKm2(c), units)}`}
                  desc={info.desc}
                  hidden={hidden.has(key)}
                  onToggle={() => onToggle(key)}
                />
              )
            })}
          </ul>
          <p className="mt-2 text-[11px] text-white/35">Dose rates one hour after the blast, once fallout has landed. Fallout decays fast: after 7 hours it is about 10 times weaker.</p>
        </Section>
      )}

      <InRange det={det} units={units} />

      <div className="px-4 pb-5 pt-1">
        <button
          type="button"
          onClick={() => onShare(det)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-hazard/40 bg-hazard/10 px-4 py-2.5 text-sm font-semibold text-hazard transition hover:bg-hazard/20"
        >
          <Share2 className="h-4 w-4" /> Share this strike
        </button>
      </div>
    </div>
  )
}

function ZoomButton({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-[11px] font-medium text-white/50 hover:text-hazard">
      <Maximize className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

function EffectRow({ color, title, value, sub, desc, hidden, onToggle }) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!hidden}
        className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.04] ${hidden ? 'opacity-45' : ''}`}
      >
        <span
          className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2"
          style={{ borderColor: color, background: hidden ? 'transparent' : `${color}aa` }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-white">{title}</span>
            <span className="shrink-0 font-mono text-sm tabular-nums text-white">{value}</span>
          </span>
          <span className="block text-right text-[11px] text-white/40">{sub}</span>
          <span className="mt-0.5 block text-xs leading-snug text-white/55">{desc}</span>
        </span>
        <span className="mt-0.5 text-white/35" aria-hidden="true">
          {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </span>
      </button>
    </li>
  )
}

function InRange({ det, units }) {
  const rows = useMemo(() => placesInRange(det), [det])
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, 8)

  return (
    <Section title="What's in range" aside={rows.length > 0 && <span className="text-[11px] text-white/40">{rows.length} places</span>}>
      {rows.length === 0 ? (
        <p className="text-sm text-white/50">None of our mapped Tulsa landmarks or major cities are inside the damage zones. Try a bigger bomb, a surface burst, or a busier target.</p>
      ) : (
        <ul className="-mx-1 divide-y divide-white/[0.06]">
          {shown.map(({ place, distanceKm, zone, fallout, arrivalHrs }) => (
            <li key={place.id} className="flex items-start justify-between gap-3 px-1 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{place.name}</p>
                <p className="truncate text-[11px] text-white/40">
                  {place.area} · {distanceKm < 0.05 ? 'ground zero' : formatDistance(distanceKm, units)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {zone && <ZoneTag color={RING_INFO[zone].color} text={RING_INFO[zone].short} />}
                {fallout && (
                  <ZoneTag
                    color={FALLOUT_INFO[fallout.dose].color}
                    text={`${FALLOUT_INFO[fallout.dose].short}${arrivalHrs > 0.05 ? `, in ${formatHours(arrivalHrs)}` : ''}`}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-medium text-hazard hover:underline">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </Section>
  )
}

function ZoneTag({ color, text }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-white/85" style={{ borderColor: `${color}66`, background: `${color}1f` }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {text}
    </span>
  )
}

// Compact horizontal legend for the mobile peek state.
export function LegendStrip({ det, units, hidden }) {
  const items = [
    ...det.rings.map((r) => ({ key: r.key, color: RING_INFO[r.key].color, text: RING_INFO[r.key].short, value: formatDistance(r.radiusKm, units) })),
    ...det.fallout
      .filter((c) => c.dose === 100 || c.dose === 1)
      .map((c) => ({ key: `fallout-${c.dose}`, color: FALLOUT_INFO[c.dose].color, text: FALLOUT_INFO[c.dose].short, value: formatDistance(c.lengthKm, units) })),
  ].filter((i) => !hidden.has(i.key))

  return (
    <div className="flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
      {items.map((i) => (
        <span key={i.key} className="flex shrink-0 items-center gap-1.5 text-[11px] text-white/60">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
          {i.text}
          <span className="font-mono text-white">{i.value}</span>
        </span>
      ))}
    </div>
  )
}
