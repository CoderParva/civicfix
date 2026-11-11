import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/utils/cn'

export const buttonVariants = cva(
  "civic-btn inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'v-default bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'v-destructive bg-destructive text-white shadow-xs hover:bg-destructive/90',
        outline: 'v-outline border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'v-secondary bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'v-ghost hover:bg-accent hover:text-accent-foreground',
        link: 'v-link text-primary underline-offset-4 hover:underline',
        /** The one loud call to action on a page (saffron in the citizen theme). */
        brand: 'v-brand bg-brand text-brand-foreground shadow-xs hover:bg-brand/90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 gap-1.5 rounded-md px-3',
        lg: 'h-11 rounded-md px-6 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
