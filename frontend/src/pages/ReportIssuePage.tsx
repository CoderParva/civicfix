import { Camera, ListChecks, MapPin, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { PageBanner } from '@/components/civic/PageBanner'
import { Card, CardContent } from '@/components/ui/card'
import { IssueForm } from '@/features/issues/components/IssueForm'
import type { SubmitReportResult } from '@/features/issues/hooks'

import type { ReportNotice } from './MyReportsPage'

const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: ListChecks, label: 'Describe it' },
  { icon: MapPin, label: 'Pin it' },
  { icon: Camera, label: 'Snap it' },
]

export function ReportIssuePage() {
  const navigate = useNavigate()

  function onSubmitted({ issue, failedPhotos }: SubmitReportResult) {
    const notice: ReportNotice =
      failedPhotos.length === 0
        ? { kind: 'success', message: `Report ${issue.reference_number} submitted. It will appear publicly once it has been reviewed.` }
        : {
            kind: 'warning',
            message: `Report ${issue.reference_number} was submitted, but these photos could not be uploaded: ${failedPhotos.join(', ')}.`,
          }
    navigate('/my-reports', { state: { notice } })
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageBanner title="Report an issue" description="Tell us what is wrong and where. Photos help a lot.">
        <ol className="relative flex flex-wrap gap-2 text-sm font-semibold">
          {STEPS.map(({ icon: Icon, label }, index) => (
            <li key={label} className="flex items-center gap-2 rounded-full bg-white/15 py-1.5 pr-4 pl-1.5 ring-1 ring-white/25 backdrop-blur">
              <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-brand text-brand-foreground">
                {index + 1}
              </span>
              <Icon aria-hidden className="size-4 text-white/85" />
              {label}
            </li>
          ))}
        </ol>
      </PageBanner>
      <Card className="rounded-3xl py-7">
        <CardContent className="px-5 sm:px-8">
          <IssueForm onSubmitted={onSubmitted} />
        </CardContent>
      </Card>
    </div>
  )
}
