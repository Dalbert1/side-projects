export function Section({ title, aside, children }) {
  return (
    <section className="border-b border-white/[0.07] px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-white/55">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Segmented({ options, value, onChange, size = 'md', label }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-xl bg-white/[0.06] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`rounded-lg font-medium transition ${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} ${
              on ? 'bg-hazard text-black shadow' : 'text-white/70 hover:text-white'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function IconButton({ label, onClick, active, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-panel/90 backdrop-blur transition md:h-10 md:w-10 ${
        active ? 'text-hazard' : 'text-white/80 hover:text-white'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function Chip({ onClick, active, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active ? 'border-hazard bg-hazard/15 text-hazard' : 'border-white/10 bg-white/[0.04] text-white/75 hover:border-white/25 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
