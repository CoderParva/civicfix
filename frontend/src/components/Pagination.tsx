import { Button } from '@/components/ui/button'

interface PaginationProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

/** Previous / Next with "Page x of y". Renders nothing when there is only one page. */
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  if (pageCount <= 1) return null
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-4">
      <Button variant="outline" size="sm" className="h-10 rounded-full px-5" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </Button>
      <span className="text-sm font-semibold text-muted-foreground" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <Button variant="outline" size="sm" className="h-10 rounded-full px-5" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        Next
      </Button>
    </nav>
  )
}
