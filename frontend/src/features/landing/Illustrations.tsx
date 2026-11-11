import { BadgeCheck, Construction, Droplets, Lightbulb, Trash2, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import { colorForCategory } from '@/features/map/palette'
import { cn } from '@/utils/cn'

/**
 * Pure decoration for the landing page: a mock neighbourhood map with category-coloured pins, a mock report
 * card and a few floating category icons. Everything here is aria-hidden and has no text, so it never shows up
 * as content to assistive technology (or to the tests that look for real text).
 */

function Pin({ x, y, categoryId, icon: Icon, delay = 0 }: { x: number; y: number; categoryId: number; icon: LucideIcon; delay?: number }) {
  const color = colorForCategory(categoryId)
  return (
    <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
      <span className="civic-ping absolute inset-0 rounded-full" style={{ background: color, animationDelay: `${delay}s` }} />
      <span
        className="relative flex size-9 items-center justify-center rounded-full border-[3px] border-white text-white shadow-lg"
        style={{ background: color }}
      >
        <Icon className="size-4" />
      </span>
    </span>
  )
}

/** A stylised street map: blocks, a river, a park, two avenues, and pins. */
export function MockMap({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('relative overflow-hidden rounded-3xl bg-[oklch(0.96_0.03_265)] shadow-2xl ring-1 ring-black/5', className)}>
      <svg viewBox="0 0 400 300" className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice">
        {/* park and river */}
        <path d="M-10 210 Q80 170 150 215 T320 205 T420 230 V320 H-10Z" fill="oklch(0.88 0.06 235)" />
        <ellipse cx="318" cy="70" rx="70" ry="48" fill="oklch(0.9 0.09 150)" />
        {/* city blocks */}
        {[
          [20, 24, 70, 44], [104, 24, 60, 44], [20, 84, 40, 60], [74, 84, 90, 60], [180, 20, 80, 52],
          [180, 90, 60, 54], [254, 90, 50, 54], [20, 160, 80, 34], [120, 160, 70, 34], [210, 160, 90, 34],
          [330, 130, 56, 64],
        ].map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="8" fill="white" opacity="0.92" />
        ))}
        {/* avenues */}
        <path d="M0 150 Q120 128 230 150 T400 140" stroke="oklch(0.84 0.1 80)" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d="M168 0 Q150 90 176 170 T190 300" stroke="oklch(0.9 0.02 270)" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M0 150 Q120 128 230 150 T400 140" stroke="white" strokeWidth="2" strokeDasharray="6 8" fill="none" />
      </svg>
      <Pin x={24} y={32} categoryId={1} icon={Construction} />
      <Pin x={62} y={26} categoryId={3} icon={Lightbulb} delay={0.6} />
      <Pin x={48} y={62} categoryId={2} icon={Trash2} delay={1.2} />
      <Pin x={82} y={58} categoryId={5} icon={Droplets} delay={1.8} />
    </div>
  )
}

/** A report card caught mid-journey: category icon, two text lines, and a progress bar of three segments. */
export function MockReportCard({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('flex w-60 flex-col gap-3 rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-black/5', className)}>
      <div className="flex items-center gap-3">
        <span className="cat-icon size-11 rounded-xl" style={{ '--cat': colorForCategory(1) } as CSSProperties}>
          <Construction className="size-5" />
        </span>
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="h-3 w-4/5 rounded-full bg-[oklch(0.88_0.03_275)]" />
          <span className="h-2.5 w-3/5 rounded-full bg-[oklch(0.94_0.02_275)]" />
        </div>
      </div>
      <div className="flex gap-1.5">
        <span className="h-2 flex-1 rounded-full bg-[oklch(0.65_0.17_160)]" />
        <span className="h-2 flex-1 rounded-full bg-[oklch(0.65_0.17_160)]" />
        <span className="h-2 flex-1 rounded-full bg-[oklch(0.92_0.02_275)]" />
      </div>
      <div className="flex items-center justify-between">
        <span className="h-2.5 w-16 rounded-full bg-[oklch(0.94_0.02_275)]" />
        <span className="flex size-7 items-center justify-center rounded-full bg-[oklch(0.65_0.17_160)] text-white">
          <BadgeCheck className="size-4" />
        </span>
      </div>
    </div>
  )
}

/** A round floating category icon. */
export function FloatIcon({ categoryId, icon: Icon, className, tilt = 0 }: { categoryId: number; icon: LucideIcon; className?: string; tilt?: number }) {
  return (
    <span
      aria-hidden
      className={cn('civic-float cat-icon absolute size-14 rounded-2xl ring-4 ring-white/70', className)}
      style={{ '--cat': colorForCategory(categoryId), '--tilt': `${tilt}deg` } as CSSProperties}
    >
      <Icon className="size-7" />
    </span>
  )
}
