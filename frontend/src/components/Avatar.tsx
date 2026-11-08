import { cn } from '@/utils/cn'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

/** Initials in a quiet circle. Decorative (the name is always shown next to it). */
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground ring-1 ring-border',
        size === 'sm' ? 'size-6 text-[0.625rem]' : 'size-8 text-xs',
        className,
      )}
    >
      {initials(name) || '?'}
    </span>
  )
}
