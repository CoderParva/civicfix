import { Check } from 'lucide-react'

import { STATUS_META } from '@/features/issues/statusMeta'
import type { IssueStatus } from '@/types/api'
import { cn } from '@/utils/cn'

import { buildSteps } from './lifecycle'

/** Where the issue is on its path: done steps filled, the current one ringed in its own colour. */
export function LifecycleStepper({ status }: { status: IssueStatus }) {
  const steps = buildSteps(status)
  return (
    <ol aria-label="Progress" className="flex items-start">
      {steps.map((step, index) => {
        const meta = STATUS_META[step.label]
        const Icon = meta.icon
        const last = index === steps.length - 1
        return (
          <li key={step.label} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined} className={cn('flex items-start', !last && 'flex-1')}>
            <div className="flex w-20 flex-col items-center gap-2 sm:w-24">
              <span
                data-tone={step.label}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border transition-colors duration-150',
                  step.state === 'done' && 'tone-chip',
                  step.state === 'current' && 'tone-dot border-transparent text-white ring-4 ring-[color-mix(in_oklab,var(--tone)_18%,transparent)]',
                  step.state === 'upcoming' && 'border-dashed bg-surface text-muted-foreground/60',
                )}
              >
                {step.state === 'done' ? <Check aria-hidden className="size-4" /> : <Icon aria-hidden className="size-4" />}
              </span>
              <span className={cn('type-caption text-center', step.state === 'current' && 'font-semibold text-foreground', step.state === 'upcoming' && 'text-muted-foreground/70')}>
                {meta.label}
              </span>
            </div>
            {!last && <span aria-hidden className={cn('mt-4 h-0.5 flex-1 rounded-full', step.state === 'done' ? 'bg-primary/40' : 'bg-border')} />}
          </li>
        )
      })}
    </ol>
  )
}
