import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CATEGORIES, makeIssue } from '@/test/factories'
import { server } from '@/test/server'
import { issuesListHandler, renderApp, signInAs, url } from '@/test/utils'

import { reportIssueSchema, validatePhoto } from './schemas'

const png = (name = 'pothole.png', type = 'image/png', size = 2048) =>
  new File([new Uint8Array(size)], name, { type })

interface Captured {
  created: Record<string, unknown>[]
  uploads: { issueId: string; names: string[] }[]
}

/** Backend stand-in for the report flow; returns what it received so tests can assert on it. */
function mockReportBackend(opts: { failUploadFor?: string } = {}): Captured {
  const captured: Captured = { created: [], uploads: [] }
  server.use(
    http.get(url('/categories/'), () => HttpResponse.json(CATEGORIES)),
    http.post(url('/issues/'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      captured.created.push(body)
      return HttpResponse.json(makeIssue({ id: 'new-issue', reference_number: 'CF-2611-ABC123', title: String(body.title) }), {
        status: 201,
      })
    }),
    http.post(url('/issues/:id/images/'), async ({ request, params }) => {
      const form = await request.formData()
      const file = form.get('image') as File
      captured.uploads.push({ issueId: String(params.id), names: [file.name] })
      if (opts.failUploadFor && file.name === opts.failUploadFor) {
        return HttpResponse.json({ image: ['The uploaded file is not a valid image.'] }, { status: 400 })
      }
      return HttpResponse.json({ id: 'img', url: 'http://x/y.png', image_type: 'report', uploaded_at: '2026-11-07T00:00:00Z' }, { status: 201 })
    }),
    issuesListHandler([makeIssue({ title: 'Garbage heap near the market' })]),
  )
  return captured
}

async function openForm() {
  signInAs('citizen')
  const rendered = renderApp('/report')
  await screen.findByRole('form', { name: /report an issue/i })
  await screen.findByRole('option', { name: 'Pothole' }) // categories loaded
  return rendered
}

async function fillValid(overrides: { latitude?: string; longitude?: string } = {}) {
  await userEvent.type(screen.getByLabelText('Title'), 'Garbage heap near the market')
  await userEvent.type(screen.getByLabelText('Description'), 'A big pile of garbage has been lying here for a week.')
  await userEvent.selectOptions(screen.getByLabelText('Category'), 'Garbage')
  await userEvent.type(screen.getByLabelText('Latitude'), overrides.latitude ?? '22.7196')
  await userEvent.type(screen.getByLabelText('Longitude'), overrides.longitude ?? '75.8577')
}

afterEach(() => vi.unstubAllGlobals())

describe('reportIssueSchema', () => {
  const base = { title: 'Pothole on road', description: 'A deep pothole near the junction.', category: '1', latitude: '22.7', longitude: '75.8', address: '', landmark: '' }

  it('turns string inputs into the numbers the API expects', () => {
    const parsed = reportIssueSchema.parse(base)
    expect(parsed).toMatchObject({ category: 1, latitude: 22.7, longitude: 75.8 })
  })

  it.each([
    ['latitude above 90', { latitude: '91' }],
    ['latitude below -90', { latitude: '-90.5' }],
    ['longitude above 180', { longitude: '181' }],
    ['non-numeric latitude', { latitude: 'north' }],
    ['empty longitude', { longitude: '' }],
    ['short title', { title: 'abc' }],
    ['short description', { description: 'too short' }],
    ['missing category', { category: '' }],
  ])('rejects %s', (_label, override) => {
    expect(reportIssueSchema.safeParse({ ...base, ...override }).success).toBe(false)
  })

  it('accepts the boundary values', () => {
    expect(reportIssueSchema.safeParse({ ...base, latitude: '90', longitude: '-180' }).success).toBe(true)
  })
})

describe('validatePhoto', () => {
  it('accepts jpeg/png/webp up to 5 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(validatePhoto(png('a', type))).toBeNull()
  })
  it('rejects other types, oversize and empty files', () => {
    expect(validatePhoto(png('a.gif', 'image/gif'))).toMatch(/only JPEG, PNG or WebP/)
    expect(validatePhoto(png('a.pdf', 'application/pdf'))).toMatch(/only JPEG, PNG or WebP/)
    expect(validatePhoto(png('big.png', 'image/png', 5 * 1024 * 1024 + 1))).toMatch(/larger than 5 MB/)
    expect(validatePhoto(png('empty.png', 'image/png', 0))).toMatch(/empty/)
  })
})

describe('Report Issue form', () => {
  it('loads the category dropdown from /categories/', async () => {
    mockReportBackend()
    await openForm()
    const options = within(screen.getByLabelText('Category')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Select a category', 'Pothole', 'Garbage'])
  })

  it('blocks an empty submit with field errors and sends nothing', async () => {
    const captured = mockReportBackend()
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))

    expect(await screen.findByText('Title must be at least 5 characters')).toBeInTheDocument()
    expect(screen.getByText('Describe the problem in at least 10 characters')).toBeInTheDocument()
    expect(screen.getByText('Choose a category')).toBeInTheDocument()
    expect(screen.getByText('Latitude is required')).toBeInTheDocument()
    expect(screen.getByText('Longitude is required')).toBeInTheDocument()
    expect(captured.created).toHaveLength(0)
  })

  it('rejects out-of-range coordinates client-side', async () => {
    const captured = mockReportBackend()
    await openForm()
    await fillValid({ latitude: '123', longitude: '200' })
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))

    expect(await screen.findByText('Latitude must be ≤ 90')).toBeInTheDocument()
    expect(screen.getByText('Longitude must be ≤ 180')).toBeInTheDocument()
    expect(captured.created).toHaveLength(0)
  })

  it('submits the issue as JSON with numeric fields, uploads each photo, then shows it in My reports', async () => {
    const captured = mockReportBackend()
    const { router } = await openForm()
    await fillValid()
    await userEvent.upload(screen.getByLabelText('Upload photos'), [png('one.png'), png('two.png')])
    expect(await screen.findByAltText('Preview of one.png')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))

    expect(await screen.findByRole('heading', { name: 'My reports' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/my-reports')
    expect(captured.created).toEqual([
      {
        category: 2,
        title: 'Garbage heap near the market',
        description: 'A big pile of garbage has been lying here for a week.',
        latitude: 22.7196,
        longitude: 75.8577,
        address: '',
        landmark: '',
      },
    ])
    expect(captured.uploads.map((u) => [u.issueId, ...u.names])).toEqual([
      ['new-issue', 'one.png'],
      ['new-issue', 'two.png'],
    ])
    expect(screen.getByRole('alert')).toHaveTextContent('Report CF-2611-ABC123 submitted')
    expect(await screen.findByText('Garbage heap near the market')).toBeInTheDocument()
  })

  it('submits fine without any photo', async () => {
    const captured = mockReportBackend()
    await openForm()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))
    await screen.findByRole('heading', { name: 'My reports' })
    expect(captured.created).toHaveLength(1)
    expect(captured.uploads).toHaveLength(0)
  })

  it('still reports success but names the photos that failed to upload', async () => {
    mockReportBackend({ failUploadFor: 'bad.png' })
    await openForm()
    await fillValid()
    await userEvent.upload(screen.getByLabelText('Upload photos'), [png('good.png'), png('bad.png')])
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))

    await screen.findByRole('heading', { name: 'My reports' })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('was submitted, but these photos could not be uploaded: bad.png')
    expect(alert).not.toHaveTextContent('good.png')
  })

  it('puts server-side validation errors on the matching field', async () => {
    mockReportBackend()
    server.use(
      http.post(url('/issues/'), () => HttpResponse.json({ title: ['Server says this title is not allowed.'] }, { status: 400 })),
    )
    await openForm()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))
    expect(await screen.findByText('Server says this title is not allowed.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
  })

  it('explains rate limiting (429) instead of failing silently', async () => {
    mockReportBackend()
    server.use(http.post(url('/issues/'), () => HttpResponse.json({ detail: 'Request was throttled.' }, { status: 429 })))
    await openForm()
    await fillValid()
    await userEvent.click(screen.getByRole('button', { name: /submit report/i }))
    expect(await screen.findByText(/too many requests/i)).toBeInTheDocument()
  })

  it('fills latitude/longitude from the browser Geolocation API', async () => {
    mockReportBackend()
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 22.719568, longitude: 75.857727 } } as GeolocationPosition),
      },
    })
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }))
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toHaveValue('22.719568'))
    expect(screen.getByLabelText('Longitude')).toHaveValue('75.857727')
  })

  it('tells the user to type coordinates when location permission is denied', async () => {
    mockReportBackend()
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError) },
    })
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }))
    expect(await screen.findByText(/permission was denied/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Latitude')).toHaveValue('') // untouched, still editable
  })
})

describe('Photo dropzone', () => {
  it('rejects a non-image and an oversize file with messages, keeping the valid one', async () => {
    mockReportBackend()
    await openForm()
    await userEvent.upload(screen.getByLabelText('Upload photos'), [
      png('ok.png'),
      png('notes.pdf', 'application/pdf'),
      png('huge.png', 'image/png', 5 * 1024 * 1024 + 1),
    ], )
    // userEvent filters by the input's accept attribute, so drop the files to exercise our own validation too
    const dropzone = screen.getByTestId('photo-dropzone')
    const dataTransfer = { files: [png('notes.pdf', 'application/pdf'), png('huge.png', 'image/png', 5 * 1024 * 1024 + 1)] }
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.drop(dropzone, { dataTransfer })

    expect(await screen.findByText(/notes\.pdf: only JPEG, PNG or WebP/)).toBeInTheDocument()
    expect(screen.getByText(/huge\.png: larger than 5 MB/)).toBeInTheDocument()
    expect(screen.getByAltText('Preview of ok.png')).toBeInTheDocument()
    expect(screen.queryByAltText('Preview of notes.pdf')).not.toBeInTheDocument()
  })

  it('accepts dropped images and lets the user remove one', async () => {
    mockReportBackend()
    await openForm()
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.drop(screen.getByTestId('photo-dropzone'), { dataTransfer: { files: [png('a.png'), png('b.png')] } })

    expect(await screen.findByAltText('Preview of a.png')).toBeInTheDocument()
    expect(screen.getByAltText('Preview of b.png')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.png' }))
    expect(screen.queryByAltText('Preview of a.png')).not.toBeInTheDocument()
    expect(screen.getByAltText('Preview of b.png')).toBeInTheDocument()
  })

  it('caps the selection at 5 photos', async () => {
    mockReportBackend()
    await openForm()
    const files = Array.from({ length: 7 }, (_, i) => png(`p${i}.png`))
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.drop(screen.getByTestId('photo-dropzone'), { dataTransfer: { files } })

    expect(await screen.findAllByRole('img', { name: /preview of/i })).toHaveLength(5)
    expect(screen.getByText(/p5\.png: at most 5 photos/)).toBeInTheDocument()
  })
})
