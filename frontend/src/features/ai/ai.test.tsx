import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { CATEGORIES, makeIssue } from '@/test/factories'
import { server } from '@/test/server'
import { makeAdminIssue, makeHistory, staffDefaults } from '@/test/staff'
import { issuesListHandler, renderApp, signInAs, url } from '@/test/utils'
import type { AIAnalysis, ClassificationResult, DuplicateMatch } from '@/types/ai'

const photo = (name = 'street.png') => new File([new Uint8Array(2048)], name, { type: 'image/png' })

const classification = (over: Partial<ClassificationResult> = {}): ClassificationResult => ({
  status: 'ok',
  reason: 'confident',
  threshold: 0.5,
  suggestions: [
    { category_id: 1, category_name: 'Pothole', confidence: 0.87 },
    { category_id: 2, category_name: 'Garbage', confidence: 0.06 },
  ],
  model: { name: 'clip', version: 'zero-shot' },
  ...over,
})

const unavailable: ClassificationResult = { status: 'unavailable', reason: 'disabled', threshold: 0.5, suggestions: [], model: null }

const match = (over: Partial<DuplicateMatch> = {}): DuplicateMatch => ({
  id: 'issue-existing',
  reference_number: 'CF-2611-AAAAAA',
  title: 'Deep pothole near Rajwada',
  category: { id: 1, name: 'Pothole' },
  status: 'assigned',
  distance_m: 42,
  score: 0.83,
  text_similarity: 0.8,
  likelihood: 'likely',
  reported_at: '2026-11-05T10:00:00+05:30',
  ...over,
})

interface Backend {
  created: Record<string, unknown>[]
  classifyCalls: number
  duplicateCalls: Record<string, unknown>[]
}

function backend(opts: { classify?: ClassificationResult | 'error'; matches?: DuplicateMatch[] | 'error' } = {}): Backend {
  const seen: Backend = { created: [], classifyCalls: 0, duplicateCalls: [] }
  server.use(
    http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
    http.post(url('/ai/classify/'), () => {
      seen.classifyCalls += 1
      return opts.classify === 'error' ? HttpResponse.json({ detail: 'boom' }, { status: 500 }) : HttpResponse.json(opts.classify ?? classification())
    }),
    http.post(url('/ai/duplicates/'), async ({ request }) => {
      seen.duplicateCalls.push((await request.json()) as Record<string, unknown>)
      if (opts.matches === 'error') return HttpResponse.json({ detail: 'boom' }, { status: 500 })
      return HttpResponse.json({ method: 'semantic', radius_m: 150, matches: opts.matches ?? [] })
    }),
    http.post(url('/issues/'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      seen.created.push(body)
      return HttpResponse.json(makeIssue({ id: 'new-issue', reference_number: 'CF-2611-NEW001', title: String(body.title) }), { status: 201 })
    }),
    http.post(url('/issues/:id/images/'), () => HttpResponse.json({ id: 'img', url: 'http://x/y.png', image_type: 'report', uploaded_at: '2026-11-07T00:00:00Z' }, { status: 201 })),
    issuesListHandler([]),
  )
  return seen
}

async function openForm() {
  signInAs('citizen')
  renderApp('/report')
  await screen.findByRole('form', { name: /report an issue/i })
  await screen.findByRole('option', { name: 'Pothole' })
}

async function fill(category: string | null = 'Garbage') {
  await userEvent.type(screen.getByLabelText('Title'), 'Garbage heap near the market')
  await userEvent.type(screen.getByLabelText('Description'), 'A big pile of garbage has been lying here for a week.')
  if (category) await userEvent.selectOptions(screen.getByLabelText('Category'), category)
  await userEvent.type(screen.getByLabelText('Latitude'), '22.7196')
  await userEvent.type(screen.getByLabelText('Longitude'), '75.8577')
}

const categoryValue = () => (screen.getByLabelText('Category') as HTMLSelectElement).selectedOptions[0].textContent

describe('Photo suggestion', () => {
  it('shows what the photo looks like with its confidence, and applies it only when asked', async () => {
    const seen = backend()
    await openForm()
    await userEvent.upload(screen.getByLabelText('Upload photos'), photo())

    const box = await screen.findByTestId('photo-suggestion')
    expect(box).toHaveTextContent('Pothole')
    expect(box).toHaveTextContent('87% sure')
    expect(categoryValue()).toBe('Select a category') // shown, never applied by itself
    expect(seen.classifyCalls).toBe(1)

    await userEvent.click(within(box).getByRole('button', { name: 'Use Pothole' }))
    expect(categoryValue()).toBe('Pothole')
    expect(screen.getByTestId('photo-suggestion')).toHaveTextContent('matches the category you picked')
  })

  it('never overrides a category the person already chose; switching is their call', async () => {
    backend()
    await openForm()
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Garbage')
    await userEvent.upload(screen.getByLabelText('Upload photos'), photo())

    const box = await screen.findByTestId('photo-suggestion')
    expect(box).toHaveTextContent('You chose something else')
    expect(categoryValue()).toBe('Garbage')
    await userEvent.click(within(box).getByRole('button', { name: 'Switch to Pothole' }))
    expect(categoryValue()).toBe('Pothole')
  })

  it('when the model is unsure it says so and offers the closest guesses, not an answer', async () => {
    backend({
      classify: classification({
        status: 'uncertain',
        reason: 'low_confidence',
        suggestions: [
          { category_id: 1, category_name: 'Pothole', confidence: 0.41 },
          { category_id: 2, category_name: 'Garbage', confidence: 0.33 },
        ],
      }),
    })
    await openForm()
    await userEvent.upload(screen.getByLabelText('Upload photos'), photo())

    const box = await screen.findByTestId('photo-suggestion')
    expect(box).toHaveTextContent('not sure what this photo shows')
    expect(within(box).queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
    expect(categoryValue()).toBe('Select a category')
    await userEvent.click(within(box).getByRole('button', { name: 'Garbage, 33%' }))
    expect(categoryValue()).toBe('Garbage')
  })

  it('a photo that is not a street problem offers no guesses at all', async () => {
    backend({ classify: classification({ status: 'uncertain', reason: 'not_a_civic_issue' }) })
    await openForm()
    await userEvent.upload(screen.getByLabelText('Upload photos'), photo())
    const box = await screen.findByTestId('photo-suggestion')
    expect(box).toHaveTextContent('does not look like a street problem')
    expect(within(box).queryAllByRole('button')).toHaveLength(0)
  })

  it.each([
    ['the model is unavailable (production)', unavailable],
    ['the request fails', 'error' as const],
  ])('says nothing when %s, and the form still works', async (_name, classify) => {
    const seen = backend({ classify })
    await openForm()
    await userEvent.upload(screen.getByLabelText('Upload photos'), photo())
    await waitFor(() => expect(seen.classifyCalls).toBe(1))
    await waitFor(() => expect(screen.queryByRole('status', { name: /looking/i })).not.toBeInTheDocument())
    expect(screen.queryByTestId('photo-suggestion')).not.toBeInTheDocument()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    await waitFor(() => expect(seen.created).toHaveLength(1))
  })

  it('classifies the first photo once, not on every re-render or extra photo', async () => {
    const seen = backend()
    await openForm()
    await userEvent.upload(screen.getByLabelText('Upload photos'), photo('one.png'))
    await screen.findByTestId('photo-suggestion')
    await userEvent.upload(screen.getByLabelText('Upload photos'), photo('two.png'))
    await userEvent.type(screen.getByLabelText('Title'), 'Typing re-renders the form')
    expect(seen.classifyCalls).toBe(1)
  })
})

describe('Duplicate warning', () => {
  it('asks the backend with what the person typed, shows what looks the same, and sends nothing yet', async () => {
    const seen = backend({ matches: [match(), match({ id: 'issue-2', title: 'Hole by the temple', likelihood: 'possible', distance_m: 120 })] })
    await openForm()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    const dialog = await screen.findByRole('dialog', { name: /already reported/i })
    expect(seen.duplicateCalls).toEqual([
      { latitude: 22.7196, longitude: 75.8577, title: 'Garbage heap near the market', description: 'A big pile of garbage has been lying here for a week.', category: 2 },
    ])
    const list = within(dialog).getByRole('list', { name: 'Similar reports' })
    expect(within(list).getByRole('link', { name: /Deep pothole near Rajwada/ })).toHaveAttribute('href', '/issues/issue-existing')
    expect(within(list).getByText('Very similar')).toBeInTheDocument()
    expect(within(list).getByText('Possibly the same')).toBeInTheDocument()
    expect(within(list).getByText('40 m away')).toBeInTheDocument()
    expect(within(list).getByText('120 m away')).toBeInTheDocument()
    expect(seen.created).toHaveLength(0)
  })

  it('"Submit anyway" always sends the report', async () => {
    const seen = backend({ matches: [match()] })
    await openForm()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Submit anyway' }))
    await waitFor(() => expect(seen.created).toHaveLength(1))
    expect(seen.created[0]).toMatchObject({ title: 'Garbage heap near the market', category: 2 })
  })

  it('"Go back and edit" keeps the form as it was and sends nothing', async () => {
    const seen = backend({ matches: [match()] })
    await openForm()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Go back and edit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Title')).toHaveValue('Garbage heap near the market')
    expect(seen.created).toHaveLength(0)
  })

  it('nothing similar: the report goes straight through, with no dialog', async () => {
    const seen = backend({ matches: [] })
    await openForm()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    await waitFor(() => expect(seen.created).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a failing duplicate check never stops a report', async () => {
    const seen = backend({ matches: 'error' })
    await openForm()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    await waitFor(() => expect(seen.created).toHaveLength(1))
  })

  it('does not check anything while the form is invalid', async () => {
    const seen = backend({ matches: [match()] })
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    expect(await screen.findByText('Choose a category')).toBeInTheDocument()
    expect(seen.duplicateCalls).toHaveLength(0)
  })
})

describe('Admin AI analysis panel', () => {
  const analysis = (over: Partial<AIAnalysis> = {}): AIAnalysis => ({
    id: 'a1',
    issue_id: 'issue-1',
    reported_category: 'Pothole',
    processing_status: 'completed',
    model_name: 'sentence-transformers/clip-ViT-B-32',
    model_version: 'zero-shot',
    predicted_category: 'Pothole',
    confidence: 0.87,
    duplicate_score: 0.83,
    suggested_priority: 'high',
    result: {
      priority: {
        priority: 'high',
        score: 6,
        method: 'rules',
        version: 'rules-v1',
        reasons: [
          { factor: 'category', detail: 'Pothole', points: 2 },
          { factor: 'life-threatening hazard', detail: 'mentions “accident”', points: 4 },
        ],
      },
      classification: { ...classification(), agrees_with_reporter: true },
      duplicates: { method: 'semantic', radius_m: 150, matches: [match({ id: 'issue-9' })] },
    },
    created_at: '2026-11-07T10:00:00+05:30',
    updated_at: '2026-11-07T10:00:01+05:30',
    ...over,
  })

  async function openAdmin(data: AIAnalysis | 'error') {
    signInAs('admin')
    const issue = makeAdminIssue({ id: 'issue-1', title: 'Pothole on MG Road' })
    server.use(
      ...staffDefaults(),
      http.get(url('/admin/issues/issue-1/'), () => HttpResponse.json({ ...issue, status_history: makeHistory(['reported']) })),
      http.get(url('/ai/analysis/issue-1/'), () => (data === 'error' ? HttpResponse.json({ detail: 'boom' }, { status: 500 }) : HttpResponse.json(data))),
    )
    renderApp('/admin/issues/issue-1')
    await screen.findByRole('heading', { name: 'Pothole on MG Road' })
  }

  it('shows the suggested priority with its reasons, the photo check, and the possible duplicates', async () => {
    await openAdmin(analysis())
    const panel = await screen.findByRole('region', { name: 'AI analysis' })
    expect(within(panel).getByText('Suggestions only. Nothing here changes the issue by itself.')).toBeInTheDocument()

    const why = within(panel).getByRole('list', { name: 'Why this priority' })
    expect(within(why).getByText(/mentions “accident”/)).toBeInTheDocument()
    expect(within(why).getByText('+4')).toBeInTheDocument()
    expect(within(panel).getByText('score 6 · currently medium')).toBeInTheDocument()

    expect(within(panel).getByText(/87% sure/)).toBeInTheDocument()
    expect(within(panel).getByText(/Matches the reporter/)).toBeInTheDocument()

    const dupes = within(panel).getByRole('list', { name: 'Possible duplicates' })
    expect(within(dupes).getByRole('link', { name: 'Deep pothole near Rajwada' })).toHaveAttribute('href', '/admin/issues/issue-9')
    expect(within(dupes).getByText('83%')).toBeInTheDocument()
  })

  it('points out when the photo disagrees with the reporter, without changing anything', async () => {
    await openAdmin(analysis({ result: { ...analysis().result, classification: { ...classification(), agrees_with_reporter: false } } }))
    const panel = await screen.findByRole('region', { name: 'AI analysis' })
    expect(within(panel).getByText('The reporter chose Pothole.')).toBeInTheDocument()
  })

  it('explains a degraded analysis plainly (no model was available)', async () => {
    await openAdmin(
      analysis({
        processing_status: 'partial',
        model_name: '',
        result: {
          priority: analysis().result.priority,
          classification: { status: 'unavailable', reason: 'disabled', threshold: 0.5, suggestions: [], model: null },
          duplicates: { method: 'lexical', radius_m: 150, matches: [match()] },
        },
      }),
    )
    const panel = await screen.findByRole('region', { name: 'AI analysis' })
    expect(within(panel).getByText(/image model was not available/)).toBeInTheDocument()
    expect(within(panel).getByText(/location and wording only/)).toBeInTheDocument()
    expect(within(panel).getByText(/Rules only/)).toBeInTheDocument()
  })

  it('says there are no similar reports when there are none', async () => {
    await openAdmin(analysis({ result: { priority: analysis().result.priority, duplicates: { method: 'none', radius_m: 150, matches: [] } } }))
    const panel = await screen.findByRole('region', { name: 'AI analysis' })
    expect(within(panel).getByText('No similar reports within 150 m.')).toBeInTheDocument()
    expect(within(panel).getByText('No photo has been checked for this issue.')).toBeInTheDocument()
  })

  it.each([
    ['an issue with no analysis (older issues)', analysis({ processing_status: 'not_analyzed', result: {} })],
    ['a failing lookup', 'error' as const],
  ])('shows no panel for %s, and the rest of the page is intact', async (_name, data) => {
    await openAdmin(data)
    expect(screen.getByRole('region', { name: 'Moderation' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI analysis' })).not.toBeInTheDocument())
  })
})
