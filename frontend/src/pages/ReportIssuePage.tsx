import { useNavigate } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { IssueForm } from '@/features/issues/components/IssueForm'
import type { SubmitReportResult } from '@/features/issues/hooks'

import type { ReportNotice } from './MyReportsPage'

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
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Report an issue</CardTitle>
          <CardDescription>Tell us what is wrong and where. Photos help a lot.</CardDescription>
        </CardHeader>
        <CardContent>
          <IssueForm onSubmitted={onSubmitted} />
        </CardContent>
      </Card>
    </div>
  )
}
