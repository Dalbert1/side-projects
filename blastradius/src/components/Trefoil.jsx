// The radiation trefoil, drawn as three annular blades on a 24x24 grid.

function blade(angleDeg) {
  const r1 = 3.4
  const r2 = 10
  const a0 = ((angleDeg - 30) * Math.PI) / 180
  const a1 = ((angleDeg + 30) * Math.PI) / 180
  const p = (r, a) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`
  return `M${p(r1, a0)} L${p(r2, a0)} A${r2} ${r2} 0 0 1 ${p(r2, a1)} L${p(r1, a1)} A${r1} ${r1} 0 0 0 ${p(r1, a0)} Z`
}

export const TREFOIL_PATH = [90, -30, -150].map(blade).join(' ')

export function trefoilSvg({ fill = '#111', bg = '#facc15', size = 24 } = {}) {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">` +
    `<circle cx="12" cy="12" r="11.5" fill="${bg}"/>` +
    `<path d="${TREFOIL_PATH}" fill="${fill}"/><circle cx="12" cy="12" r="2" fill="${fill}"/></svg>`
  )
}

export default function Trefoil({ className = 'h-6 w-6', bg = '#facc15', fill = '#0b0f14' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11.5" fill={bg} />
      <path d={TREFOIL_PATH} fill={fill} />
      <circle cx="12" cy="12" r="2" fill={fill} />
    </svg>
  )
}
