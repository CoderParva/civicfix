import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/utils/cn'

export function LandingPage() {
  return (
    <section className="flex flex-col items-center gap-6 py-16 text-center">
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">Fix your city, one report at a time</h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Report potholes, broken streetlights, garbage and more. Track every report until it is resolved.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/report" className={cn(buttonVariants({ size: 'lg' }))}>
          Report an Issue
        </Link>
        <Link to="/login" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>
          Login
        </Link>
      </div>
    </section>
  )
}
