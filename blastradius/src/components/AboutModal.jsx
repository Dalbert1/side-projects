import { useEffect } from 'react'
import { X } from 'lucide-react'
import Trefoil from './Trefoil'

export default function AboutModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-panel p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl md:rounded-3xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Trefoil className="h-9 w-9" />
            <h2 id="about-title" className="font-display text-2xl font-semibold uppercase tracking-wide text-white">
              About 918 Blast Radius
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/60 hover:bg-white/5 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-white/70">
          <p>
            A map that shows how far the effects of a nuclear weapon reach. Pick a real warhead or dial in your own yield, drop ground zero anywhere on Earth and hit detonate. Made in Tulsa, which is why
            the crosshair starts on the Center of the Universe.
          </p>

          <div>
            <h3 className="mb-1 font-semibold text-white">How the rings are figured</h3>
            <p>
              Blast, heat and radiation ranges use the scaling laws from Glasstone and Dolan's <em>The Effects of Nuclear Weapons</em> (1977), the standard public reference. Blast damage grows with the cube
              root of the yield, so a bomb 1,000 times bigger only reaches about 10 times farther. Airbursts are set at the height that spreads 5 psi of pressure the farthest.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-semibold text-white">How fallout is figured</h3>
            <p>
              Only surface bursts make serious local fallout. The plume is a simplified version of the idealized patterns in the same book, stretched by wind speed and scaled by how much of the yield
              comes from fission. It shows dose rates one hour after the blast. Real fallout follows winds at many altitudes and lands in much messier shapes.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-semibold text-white">What it leaves out</h3>
            <p>
              No casualty counts, firestorms, terrain shielding, EMP or long term effects. Real outcomes depend on weather, buildings, terrain and the exact weapon, so treat every number here as a
              ballpark estimate for learning, not a prediction.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-semibold text-white">Credits</h3>
            <p>
              Inspired by Alex Wellerstein's{' '}
              <a className="text-hazard underline-offset-2 hover:underline" href="https://nuclearsecrecy.com/nukemap/" target="_blank" rel="noreferrer">
                NUKEMAP
              </a>
              . Map data from OpenStreetMap contributors, CARTO and Esri. Place search by Nominatim. Live winds from Open-Meteo. Weapon yields are public figures and many are estimates.
            </p>
          </div>

          <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-white/55">
            Built to show why these weapons must never be used. If this map makes one person care a little more about that, it did its job.
          </p>
        </div>
      </div>
    </div>
  )
}
