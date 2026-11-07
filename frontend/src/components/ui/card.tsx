import type * as React from 'react'

import { cn } from '@/utils/cn'

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('flex flex-col gap-4 rounded-xl border bg-card py-5 text-card-foreground shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5 px-5', className)} {...props} />
}

/** Rendered as an h1: every CardTitle in this app is the page title, which assistive tech needs as a heading. */
export function CardTitle({ className, ...props }: React.ComponentProps<'h1'>) {
  return <h1 data-slot="card-title" className={cn('leading-none font-semibold', className)} {...props} />
}

export function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />
}
