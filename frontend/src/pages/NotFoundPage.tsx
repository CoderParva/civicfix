import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/utils/cn'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist."
        action={
          <Link to="/" className={cn(buttonVariants())}>
            Go home
          </Link>
        }
      />
    </div>
  )
}
