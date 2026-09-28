import { ChevronDown } from 'lucide-react'
import { COUNTRIES, WEAPONS, countryOf, weaponById } from '../data/weapons'
import { formatTnt, formatYield } from '../lib/format'
import { hiroshimas } from '../lib/effects'
import { Section } from './ui'

const MIN_LOG = -2 // 10 tons
const MAX_LOG = 5 // 100 megatons
const STEPS = 1000

const toSlider = (kt) => Math.round(((Math.log10(kt) - MIN_LOG) / (MAX_LOG - MIN_LOG)) * STEPS)
const fromSlider = (s) => +Math.pow(10, MIN_LOG + (s / STEPS) * (MAX_LOG - MIN_LOG)).toPrecision(3)

const TICKS = [
  { kt: 0.01, label: '10 t' },
  { kt: 1, label: '1 kt' },
  { kt: 1000, label: '1 Mt' },
  { kt: 100000, label: '100 Mt' },
]

function timesHiroshima(kt) {
  const x = hiroshimas(kt)
  if (x < 0.01) return 'A tiny fraction of the Hiroshima bomb'
  if (x < 0.95) return `About ${Math.round(x * 100)}% of the Hiroshima bomb`
  if (x < 1.05) return 'About the same as the Hiroshima bomb'
  const n = x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString('en-US')
  return `${n}x the Hiroshima bomb`
}

export default function WeaponPicker({ weaponId, yieldKt, onWeapon, onYield }) {
  const weapon = weaponById(weaponId)
  const country = countryOf(weapon)

  return (
    <Section title="Weapon">
      <div className="relative">
        <select
          value={weapon ? weapon.id : 'custom'}
          onChange={(e) => onWeapon(e.target.value)}
          aria-label="Choose a weapon"
          className="w-full appearance-none rounded-xl border border-white/10 bg-white/[0.05] py-2.5 pl-3 pr-9 text-base text-white focus:border-hazard/60 focus:outline-none md:text-sm"
        >
          <option value="custom" className="bg-neutral-900">
            Custom yield
          </option>
          {COUNTRIES.map((c) => (
            <optgroup key={c.id} label={`${c.flag} ${c.name}`} className="bg-neutral-900">
              {WEAPONS.filter((w) => w.country === c.id).map((w) => (
                <option key={w.id} value={w.id} className="bg-neutral-900">
                  {w.name}, {formatYield(w.kt)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" aria-hidden="true" />
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-linear-to-br from-white/[0.06] to-white/[0.02] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
              {weapon ? `${country?.flag || ''} ${weapon.era}` : 'Your own design'}
            </p>
            <p className="mt-0.5 truncate font-semibold text-white">{weapon ? weapon.name : 'Custom weapon'}</p>
            <p className="text-xs text-white/50">{weapon ? weapon.kind : 'Drag the slider to set any yield'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-3xl font-semibold leading-none text-hazard">{formatYield(yieldKt)}</p>
            {weapon?.est && <p className="mt-1 text-[10px] uppercase tracking-wider text-white/40">estimated</p>}
          </div>
        </div>
        {weapon && <p className="mt-2.5 text-sm leading-snug text-white/70">{weapon.note}</p>}
        <p className="mt-2.5 border-t border-white/10 pt-2.5 text-xs text-white/55">
          {formatTnt(yieldKt)}. {timesHiroshima(yieldKt)}.
        </p>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 flex items-center justify-between text-xs text-white/55">
          <span>Custom yield</span>
          <span className="font-mono text-white/80">{formatYield(yieldKt)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={STEPS}
          step={1}
          value={toSlider(yieldKt)}
          onChange={(e) => onYield(fromSlider(Number(e.target.value)))}
          aria-label="Yield"
          aria-valuetext={formatYield(yieldKt)}
          className="w-full accent-hazard"
        />
      </label>
      <div className="relative mt-0.5 h-4 text-[10px] text-white/35" aria-hidden="true">
        {TICKS.map((t) => {
          const pct = (toSlider(t.kt) / STEPS) * 100
          return (
            <span
              key={t.label}
              className="absolute top-0 whitespace-nowrap"
              style={{ left: `${pct}%`, transform: pct === 0 ? 'none' : pct === 100 ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {t.label}
            </span>
          )
        })}
      </div>
    </Section>
  )
}
