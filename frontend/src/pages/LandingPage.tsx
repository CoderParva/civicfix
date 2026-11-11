import { ArrowRight, BadgeCheck, Camera, Construction, Droplets, Eye, Lightbulb, Map as MapIcon, Route, Send, Sparkles, Trash2, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { CategoryIcon, SEEDED_CATEGORIES, categoryStyle } from '@/features/issues/categoryVisual'
import { FloatIcon, MockMap, MockReportCard } from '@/features/landing/Illustrations'
import { cn } from '@/utils/cn'

const BLURBS: Record<string, string> = {
  Pothole: 'Craters, cave-ins and broken tarmac',
  Garbage: 'Overflowing bins and dumped waste',
  Streetlight: 'Dark stretches and dead lamps',
  'Water leakage': 'Burst pipes and running taps',
  Drainage: 'Blocked drains and waterlogging',
  'Road damage': 'Cracked edges and crumbling roads',
}

const PROMISES: { icon: LucideIcon; label: string }[] = [
  { icon: Camera, label: 'Photo and map pin' },
  { icon: Eye, label: 'Public and transparent' },
  { icon: BadgeCheck, label: 'Tracked until fixed' },
]

const STEPS = [
  { icon: Camera, title: 'Snap it and pin it', text: 'Add a photo, drop a pin on the map, say what is wrong. It takes about two minutes.', color: 'var(--primary)' },
  { icon: Send, title: 'We send it to the right team', text: 'A reviewer checks your report and hands it to the department that can fix it.', color: 'oklch(0.62 0.2 350)' },
  { icon: BadgeCheck, title: 'Watch it get fixed', text: 'Follow every step on your dashboard until a photo proves the work is done.', color: 'oklch(0.6 0.16 155)' },
]

export function LandingPage() {
  return (
    <>
      <Hero />
      <WhatToReport />
      <HowItWorks />
      <PublicMapBand />
      <FinalCta />
    </>
  )
}

function Hero() {
  return (
    <section className="civic-hero">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-24 lg:grid-cols-[1.05fr_0.95fr] lg:pt-16 lg:pb-28">
        <div className="flex flex-col items-start gap-7">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur">
            <Sparkles aria-hidden className="size-4 text-brand" />
            Free for every resident
          </span>
          <h1 className="font-display text-5xl leading-[1.02] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl">
            Fix your city,{' '}
            <span className="relative inline-block text-brand">
              one report
              <svg aria-hidden viewBox="0 0 300 14" className="absolute -bottom-2 left-0 h-3 w-full text-brand/80" preserveAspectRatio="none">
                <path d="M3 9 Q 75 1 150 8 T 297 6" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
              </svg>
            </span>{' '}
            at a time
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-white/85 sm:text-xl">
            Report potholes, broken streetlights, garbage and more. Track every report until it is resolved.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/report" className={cn(buttonVariants({ size: 'lg', variant: 'brand' }), 'h-14 rounded-2xl px-8 text-lg')}>
              Report an Issue
              <ArrowRight aria-hidden className="size-5" />
            </Link>
            <Link
              to="/login"
              className={cn(
                buttonVariants({ size: 'lg', variant: 'outline' }),
                'on-dark h-14 rounded-2xl border-2 border-white/45 bg-white/10 px-8 text-lg text-white backdrop-blur hover:border-white hover:bg-white/20 hover:text-white',
              )}
            >
              Login
            </Link>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-white/90">
            {PROMISES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <Icon className="size-4 text-brand" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div aria-hidden className="relative mx-auto h-[22rem] w-full max-w-lg sm:h-[26rem]">
          <MockMap className="absolute inset-x-0 top-0 h-[17rem] rotate-2 sm:h-[20rem]" />
          <MockReportCard className="civic-float absolute bottom-0 left-0 -rotate-3 [--tilt:-3deg]" />
          <FloatIcon categoryId={2} icon={Trash2} className="-top-5 -left-3 sm:-left-8" tilt={-8} />
          <FloatIcon categoryId={3} icon={Lightbulb} className="-right-2 -bottom-2 [animation-delay:1.5s] sm:-right-6" tilt={8} />
          <FloatIcon categoryId={4} icon={Droplets} className="top-24 -right-3 size-12 [animation-delay:3s] sm:-right-10" tilt={6} />
        </div>
      </div>
      {/* a soft curve into the page below */}
      <svg aria-hidden viewBox="0 0 1440 80" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-12 w-full text-[var(--canvas)] sm:h-20">
        <path d="M0 80 V40 Q 360 -10 720 36 T 1440 30 V80Z" fill="currentColor" />
      </svg>
    </section>
  )
}

function WhatToReport() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="mb-10 flex flex-col gap-3 text-center">
        <p className="text-sm font-bold tracking-widest text-primary uppercase">What can you report?</p>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">If it is broken on your street, it belongs here</h2>
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
        {SEEDED_CATEGORIES.map((category) => (
          <li key={category.id}>
            <Link
              to={`/explore?category=${category.id}`}
              style={categoryStyle(category.id)}
              className="cat-tile group flex h-full flex-col gap-4 rounded-3xl p-5 sm:p-6"
            >
              <CategoryIcon category={category} className="size-14 rounded-2xl" iconClassName="size-7" />
              <span className="flex flex-col gap-1">
                <span className="font-display text-xl font-bold tracking-tight">{category.name}</span>
                <span className="text-sm leading-snug text-muted-foreground">{BLURBS[category.name]}</span>
              </span>
              <ArrowRight
                aria-hidden
                className="absolute right-5 bottom-5 size-5 text-[var(--cat)] opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-12 flex flex-col gap-3 text-center">
          <p className="text-sm font-bold tracking-widest text-primary uppercase">How it works</p>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">From report to repair in three steps</h2>
        </div>
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text, color }, index) => (
            <li key={title} className="civic-lift relative flex flex-col gap-4 overflow-hidden rounded-3xl border bg-card p-7 shadow-sm">
              <span
                aria-hidden
                className="font-display absolute -top-4 right-3 text-[9rem] leading-none font-extrabold opacity-[0.07]"
                style={{ color }}
              >
                {index + 1}
              </span>
              <span
                aria-hidden
                className="flex size-14 items-center justify-center rounded-2xl text-white shadow-lg"
                style={{ background: `linear-gradient(145deg, color-mix(in oklab, ${color} 80%, white), ${color})` }}
              >
                <Icon className="size-7" />
              </span>
              <h3 className="font-display text-xl font-bold tracking-tight">{title}</h3>
              <p className="leading-relaxed text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function PublicMapBand() {
  return (
    <section className="relative overflow-hidden bg-[color-mix(in_oklab,var(--brand)_26%,white)]">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2">
        <div className="flex flex-col items-start gap-5">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-white text-primary shadow-lg">
            <MapIcon className="size-6" />
          </span>
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">Everything reported is public, on one map</h2>
          <p className="max-w-lg text-lg leading-relaxed text-foreground/80">
            Browse what neighbours have reported, see what is being worked on, and check that yours has not been forgotten.
          </p>
          <Link to="/explore?view=map" className={cn(buttonVariants({ size: 'lg' }), 'h-12 rounded-2xl px-7')}>
            Explore the map
            <Route aria-hidden className="size-5" />
          </Link>
        </div>
        <MockMap className="h-72 -rotate-1 sm:h-80" />
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="px-4 pb-4">
      <div className="civic-banner mx-auto my-12 flex max-w-6xl flex-col items-start gap-6 rounded-[2rem] px-8 py-12 sm:px-14 sm:py-16">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
          <Construction className="size-6 text-brand" />
        </span>
        <h2 className="font-display max-w-2xl text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">Your street is waiting</h2>
        <p className="max-w-xl text-lg text-white/85">Two minutes now, a safer road tomorrow. Make an account and make the first report.</p>
        <Link to="/report" className={cn(buttonVariants({ size: 'lg', variant: 'brand' }), 'h-14 rounded-2xl px-8 text-lg')}>
          Start a report
          <ArrowRight aria-hidden className="size-5" />
        </Link>
      </div>
    </section>
  )
}
