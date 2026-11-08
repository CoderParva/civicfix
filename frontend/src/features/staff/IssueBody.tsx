import { MapPin } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'

import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import type { Issue } from '@/types/api'

const IssueLocationMap = lazy(() => import('@/features/map/IssueLocationMap'))

/** What the citizen reported, in three panels shared by the officer and admin detail pages. */
export function IssueDescription({ issue }: { issue: Issue }) {
  return (
    <Panel aria-label="Description">
      <PanelHeader title="Description" />
      <PanelBody className="pt-4">
        <p className="type-body whitespace-pre-line text-foreground/90">{issue.description}</p>
      </PanelBody>
    </Panel>
  )
}

export function IssuePhotos({ issue }: { issue: Issue }) {
  if (issue.images.length === 0) return null
  return (
        <Panel aria-label="Photos">
          <PanelHeader title="Photos" description="What was reported, and the proof of the fix once there is one" />
          <PanelBody className="pt-4">
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {issue.images.map((image) => (
                <li key={image.id} className="group overflow-hidden rounded-xl border">
                  <a href={image.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden">
                    <img
                      src={image.url}
                      alt={image.image_type === 'resolution' ? `Resolution photo for ${issue.title}` : `Photo of ${issue.title}`}
                      loading="lazy"
                      className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </a>
                  <p className="type-caption px-4 py-2">{image.image_type === 'resolution' ? 'After: resolution photo' : 'Before: reported'}</p>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
  )
}

export function IssueLocation({ issue }: { issue: Issue }) {
  return (
      <Panel aria-label="Location">
        <PanelHeader
          title="Location"
          description={
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden className="size-3" />
              {[issue.address, issue.landmark && `Near ${issue.landmark}`].filter(Boolean).join(' · ') || 'No address given'}
              <span className="tabular" data-testid="coordinates">
                {' · '}
                {issue.location.latitude.toFixed(5)}, {issue.location.longitude.toFixed(5)}
              </span>
            </span>
          }
        />
        <PanelBody className="pt-4">
          <Suspense fallback={<Skeleton role="status" aria-label="Loading map" className="h-64 rounded-xl" />}>
            <IssueLocationMap latitude={issue.location.latitude} longitude={issue.location.longitude} categoryId={issue.category.id} />
          </Suspense>
        </PanelBody>
      </Panel>
  )
}

/** A compact label / value list for side panels. */
export function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-4">
          <dt className="type-body text-muted-foreground">{row.label}</dt>
          <dd className="type-body min-w-0 text-right font-medium text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
