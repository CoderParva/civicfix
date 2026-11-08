import { Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { PriorityBadge } from '@/features/issues/components/PriorityBadge'
import { StatusBadge } from '@/features/issues/components/StatusBadge'
import type { IssuePriority } from '@/types/api'
import type { AIAnalysis, ClassificationResult } from '@/types/ai'
import { formatRelative } from '@/utils/format'

import { useAiAnalysis } from './hooks'
import { percent } from './PhotoSuggestion'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="type-overline">{title}</h3>
      {children}
    </section>
  )
}

function PrioritySection({ analysis, current }: { analysis: AIAnalysis; current: IssuePriority }) {
  const rec = analysis.result.priority
  if (!rec) return null
  return (
    <Section title="Suggested priority">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={rec.priority} compact />
        <span className="type-caption">
          score {rec.score}
          {rec.priority !== current && ` · currently ${current}`}
        </span>
      </div>
      <ul aria-label="Why this priority" className="type-caption flex flex-col gap-1">
        {rec.reasons.map((reason) => (
          <li key={`${reason.factor}-${reason.detail}`} className="flex justify-between gap-3">
            <span>
              <span className="text-foreground">{reason.factor}</span>: {reason.detail}
            </span>
            <span className="tabular">+{reason.points}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function PhotoSection({ classification, reported }: { classification?: ClassificationResult; reported: string }) {
  if (!classification) {
    return (
      <Section title="Photo check">
        <p className="type-caption">No photo has been checked for this issue.</p>
      </Section>
    )
  }
  if (classification.status === 'unavailable') {
    return (
      <Section title="Photo check">
        <p className="type-caption">Not run: the image model was not available when this was reported.</p>
      </Section>
    )
  }
  const top = classification.suggestions[0]
  return (
    <Section title="Photo check">
      {classification.status === 'ok' && top ? (
        <p className="type-body">
          Looks like <strong>{top.category_name}</strong> ({percent(top.confidence)} sure).{' '}
          {classification.agrees_with_reporter ? (
            <span className="text-emerald-700">Matches the reporter&rsquo;s category.</span>
          ) : (
            <span className="text-amber-700">The reporter chose {reported}.</span>
          )}
        </p>
      ) : (
        <p className="type-body">The model was not sure what the photo shows.</p>
      )}
      {classification.suggestions.length > 0 && (
        <ul aria-label="Category guesses" className="type-caption flex flex-col gap-1">
          {classification.suggestions.map((s) => (
            <li key={s.category_id} className="flex justify-between gap-3">
              <span>{s.category_name}</span>
              <span className="tabular">{percent(s.confidence)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function DuplicatesSection({ analysis }: { analysis: AIAnalysis }) {
  const duplicates = analysis.result.duplicates
  if (!duplicates) return null
  return (
    <Section title="Possible duplicates">
      {duplicates.matches.length === 0 ? (
        <p className="type-caption">No similar reports within {duplicates.radius_m} m.</p>
      ) : (
        <ul aria-label="Possible duplicates" className="flex flex-col gap-2">
          {duplicates.matches.map((match) => (
            <li key={match.id} className="flex flex-col gap-1 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/admin/issues/${match.id}`} className="type-body font-medium text-primary hover:underline">
                  {match.title}
                </Link>
                <span className="type-caption tabular shrink-0">{percent(match.score)}</span>
              </div>
              <div className="type-caption flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusBadge status={match.status} />
                <span>{match.likelihood === 'likely' ? 'Very similar' : 'Possibly the same'}</span>
                <span>{match.distance_m} m away</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {duplicates.method === 'lexical' && duplicates.matches.length > 0 && (
        <p className="type-caption">Matched by location and wording only (the text model was not available).</p>
      )}
    </Section>
  )
}

/** What the AI helpers said about an issue. Advice for the admin: nothing here is applied automatically. */
export function AiAnalysisPanel({ issueId, currentPriority, reportedCategory }: { issueId: string; currentPriority: IssuePriority; reportedCategory: string }) {
  const { data } = useAiAnalysis(issueId)
  // Nothing recorded (an older issue) or the lookup failed: the page is complete without this panel.
  if (!data || data.processing_status === 'not_analyzed') return null

  return (
    <Panel aria-label="AI analysis">
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            AI analysis
            <Sparkles aria-hidden className="size-4 text-primary" />
          </span>
        }
        description="Suggestions only. Nothing here changes the issue by itself."
      />
      <PanelBody className="flex flex-col gap-5 pt-4">
        <PrioritySection analysis={data} current={currentPriority} />
        <PhotoSection classification={data.result.classification} reported={reportedCategory} />
        <DuplicatesSection analysis={data} />
        <p className="type-caption border-t pt-3">
          {data.model_name ? `Photo model: ${data.model_name}. ` : 'Rules only. '}
          {data.updated_at ? `Analysed ${formatRelative(data.updated_at)}.` : ''}
        </p>
      </PanelBody>
    </Panel>
  )
}
