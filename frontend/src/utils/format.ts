export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const WHEN = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

/** "7 Nov, 3:42 pm" */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : WHEN.format(date).replace(/\bam\b/i, 'am').replace(/\bpm\b/i, 'pm')
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 days ago", "yesterday", "in 2 hours". `now` is injectable for tests. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime()
  if (Number.isNaN(diff)) return ''
  const minutes = diff / 60_000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['day', 1440], ['hour', 60], ['minute', 1]]
  for (const [unit, size] of steps) {
    if (Math.abs(minutes) >= size) return RELATIVE.format(Math.trunc(minutes / size), unit)
  }
  return 'just now'
}

/** A span of hours as people say it: "45 min", "6 h", "2 d 4 h". null -> an em dash. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${Math.round(hours)} h`
  const days = Math.floor(hours / 24)
  const rest = Math.round(hours - days * 24)
  return rest ? `${days} d ${rest} h` : `${days} d`
}

/** Elapsed time between two ISO timestamps, as formatHours. */
export function elapsedBetween(fromIso: string, toIso: string): string {
  return formatHours((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000)
}

export function greeting(date: Date = new Date()): string {
  const hour = date.getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}
