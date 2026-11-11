import { Heart, MapPinned } from 'lucide-react'
import { Link } from 'react-router-dom'

/** Bottom of every citizen-facing page. */
export function SiteFooter() {
  return (
    <footer className="mt-12 bg-gradient-to-br from-primary-deep to-[oklch(0.25_0.12_275)] text-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <MapPinned className="size-5" />
          </span>
          <p className="text-sm text-white/85">
            <span className="font-display text-base font-bold text-white">CivicFix</span> · report it, track it, get it fixed
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm text-white/80">
          <Link to="/explore" className="underline-offset-4 transition-colors hover:text-brand hover:underline">
            Browse reports
          </Link>
          <span className="flex items-center gap-1.5">
            Made for neighbourhoods <Heart aria-hidden className="size-4 fill-brand text-brand" />
          </span>
        </div>
      </div>
    </footer>
  )
}
