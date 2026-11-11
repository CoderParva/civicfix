import { BadgeCheck, Camera, ThumbsUp, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { MockReportCard } from '@/features/landing/Illustrations'

interface AuthShellProps {
  /** Big line on the colour panel. Not a heading: the form card owns the page's h1. */
  pitch: string
  points: { icon: LucideIcon; text: string }[]
  children: ReactNode
}

export const LOGIN_POINTS = [
  { icon: BadgeCheck, text: 'See where each of your reports stands' },
  { icon: Camera, text: 'Add photos and a map pin in minutes' },
  { icon: ThumbsUp, text: 'Back your neighbours’ reports with a vote' },
]

/** Two columns on a wide screen: a bold colour panel, and the form. On a phone only the form shows. */
export function AuthShell({ pitch, points, children }: AuthShellProps) {
  return (
    <div className="mx-auto grid max-w-5xl items-stretch gap-0 overflow-hidden rounded-[2rem] bg-card shadow-2xl ring-1 ring-black/5 lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="civic-banner relative hidden flex-col justify-between gap-10 p-10 lg:flex">
        <div className="flex flex-col gap-6">
          <p className="font-display max-w-xs text-4xl leading-[1.05] font-extrabold tracking-tight text-balance">{pitch}</p>
          <ul className="flex flex-col gap-3.5">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[0.95rem] font-medium text-white/90">
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                  <Icon className="size-[1.1rem] text-brand" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <MockReportCard className="civic-float -rotate-3 self-start [--tilt:-3deg]" />
      </aside>
      <div className="flex flex-col justify-center gap-4 p-6 sm:p-10">{children}</div>
    </div>
  )
}
