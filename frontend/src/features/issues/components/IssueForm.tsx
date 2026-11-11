import { zodResolver } from '@hookform/resolvers/zod'
import { lazy, Suspense, useState } from 'react'
import { useForm } from 'react-hook-form'

import { ErrorState } from '@/components/ErrorState'
import { FormField } from '@/components/FormField'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { DuplicateWarning } from '@/features/ai/DuplicateWarning'
import { PhotoSuggestion } from '@/features/ai/PhotoSuggestion'
import { formatCoordinate, parseCoordinatePair } from '@/features/map/coordinates'
import { useGeolocation } from '@/hooks/useGeolocation'
import { aiApi } from '@/services/aiApi'
import { getApiErrorMessage, getFieldErrors } from '@/services/apiClient'
import type { DuplicateMatch } from '@/types/ai'

import { useCategories, useSubmitReport, type SubmitReportResult } from '../hooks'
import { reportIssueSchema, type ReportIssueInput, type ReportIssueValues } from '../schemas'
import { CategoryChips } from './CategoryChips'
import { PhotoDropzone } from './PhotoDropzone'

// The map pulls in Leaflet + MapLibre, so it loads on demand instead of with the form.
const LocationPicker = lazy(() => import('@/features/map/LocationPicker'))

const SERVER_FIELDS = ['category', 'title', 'description', 'latitude', 'longitude', 'address', 'landmark'] as const
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive'

export function IssueForm({ onSubmitted }: { onSubmitted: (result: SubmitReportResult) => void }) {
  const categories = useCategories()
  const submitReport = useSubmitReport()
  const { locate, locating, error: geoError } = useGeolocation()
  const [photos, setPhotos] = useState<File[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  // Set while the "this looks like something already reported" dialog is open: the matches and the held-back report.
  const [similar, setSimilar] = useState<{ matches: DuplicateMatch[]; values: ReportIssueValues } | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<ReportIssueInput, unknown, ReportIssueValues>({
    resolver: zodResolver(reportIssueSchema),
    defaultValues: { title: '', description: '', category: '', latitude: '', longitude: '', address: '', landmark: '' },
  })

  async function fillFromGps() {
    const position = await locate()
    if (!position) return
    setCoordinates(position.latitude, position.longitude)
  }

  /** Single place that writes the coordinate fields, so GPS and map clicks behave identically. */
  function setCoordinates(latitude: number, longitude: number) {
    setValue('latitude', formatCoordinate(latitude), { shouldValidate: true, shouldDirty: true })
    setValue('longitude', formatCoordinate(longitude), { shouldValidate: true, shouldDirty: true })
    clearErrors(['latitude', 'longitude'])
  }

  // The map pin follows whatever is in the fields, however it got there (typing, GPS, a map click).
  const pin = parseCoordinatePair(watch('latitude'), watch('longitude'))

  async function send(values: ReportIssueValues) {
    setServerError(null)
    try {
      const result = await submitReport.mutateAsync({
        payload: {
          category: values.category,
          title: values.title,
          description: values.description,
          latitude: values.latitude,
          longitude: values.longitude,
          address: values.address,
          landmark: values.landmark,
        },
        photos,
      })
      onSubmitted(result)
    } catch (error) {
      const fieldErrors = getFieldErrors(error)
      let mapped = false
      for (const field of SERVER_FIELDS) {
        if (fieldErrors[field]) {
          setError(field, { message: fieldErrors[field] })
          mapped = true
        }
      }
      if (!mapped) setServerError(getApiErrorMessage(error, 'Could not submit your report. Please try again.'))
    }
  }

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    // Look for the same problem already reported nearby. This is a courtesy: if the check fails or finds
    // nothing, the report goes straight through. If it finds something, the person decides.
    const found = await aiApi
      .findDuplicates({
        latitude: values.latitude,
        longitude: values.longitude,
        title: values.title,
        description: values.description,
        category: values.category,
      })
      .catch(() => null)
    if (found && found.matches.length > 0) {
      setSimilar({ matches: found.matches, values })
      return
    }
    await send(values)
  })

  async function submitAnyway() {
    const held = similar
    if (!held) return
    setSimilar(null)
    await send(held.values)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label="Report an issue">
      {serverError && <Alert variant="destructive">{serverError}</Alert>}

      <FormField id="title" label="Title" error={errors.title?.message}>
        <Input id="title" aria-invalid={!!errors.title} placeholder="e.g. Deep pothole on MG Road" {...register('title')} />
      </FormField>

      <FormField id="description" label="Description" error={errors.description?.message}>
        <Textarea
          id="description"
          aria-invalid={!!errors.description}
          placeholder="What is the problem and how does it affect people?"
          {...register('description')}
        />
      </FormField>

      <FormField id="category" label="Category" error={errors.category?.message}>
        {categories.isError ? (
          <ErrorState message="Could not load categories." onRetry={() => categories.refetch()} />
        ) : (
          <>
          {categories.data && (
            <CategoryChips
              categories={categories.data}
              value={watch('category')}
              onChange={(value) => setValue('category', value, { shouldValidate: true, shouldDirty: true })}
              groupLabel="Type of problem"
              size="lg"
            />
          )}
          <select
            id="category"
            className={SELECT_CLASS}
            aria-invalid={!!errors.category}
            disabled={categories.isPending}
            {...register('category')}
          >
            <option value="">{categories.isPending ? 'Loading categories…' : 'Select a category'}</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          </>
        )}
      </FormField>

      <fieldset className="flex flex-col gap-3 rounded-3xl border-2 border-primary/15 bg-primary-soft p-5">
        <legend className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground shadow-sm">Location</legend>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={fillFromGps} disabled={locating}>
            {locating ? 'Finding your location…' : 'Use my current location'}
          </Button>
          <span className="text-xs text-muted-foreground">or click the map, or enter coordinates yourself</span>
        </div>
        {geoError && <p role="alert" className="text-xs text-destructive">{geoError}</p>}
        <Suspense fallback={<Skeleton role="status" aria-label="Loading map" className="h-72 w-full rounded-xl" />}>
          <LocationPicker value={pin} onPick={(p) => setCoordinates(p.latitude, p.longitude)} />
        </Suspense>
        <p className="text-xs text-muted-foreground">Click the map to drop the pin, use your current location, or type the coordinates.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="latitude" label="Latitude" error={errors.latitude?.message}>
            <Input id="latitude" inputMode="decimal" placeholder="22.7196" aria-invalid={!!errors.latitude} {...register('latitude')} />
          </FormField>
          <FormField id="longitude" label="Longitude" error={errors.longitude?.message}>
            <Input id="longitude" inputMode="decimal" placeholder="75.8577" aria-invalid={!!errors.longitude} {...register('longitude')} />
          </FormField>
        </div>
        <FormField id="address" label="Address (optional)" error={errors.address?.message}>
          <Input id="address" autoComplete="street-address" aria-invalid={!!errors.address} {...register('address')} />
        </FormField>
        <FormField id="landmark" label="Nearby landmark (optional)" error={errors.landmark?.message}>
          <Input id="landmark" aria-invalid={!!errors.landmark} {...register('landmark')} />
        </FormField>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Photos (optional)</span>
        <PhotoDropzone files={photos} onChange={setPhotos} />
        <PhotoSuggestion
          photo={photos[0] ?? null}
          chosen={watch('category')}
          categories={categories.data ?? []}
          onChoose={(id) => setValue('category', String(id), { shouldValidate: true, shouldDirty: true })}
        />
      </div>

      <Button type="submit" size="lg" variant="brand" className="h-14 rounded-2xl text-lg" disabled={isSubmitting || submitReport.isPending}>
        {isSubmitting || submitReport.isPending ? 'Submitting…' : 'Submit report'}
      </Button>

      <DuplicateWarning
        matches={similar?.matches ?? null}
        submitting={submitReport.isPending}
        onSubmitAnyway={submitAnyway}
        onDismiss={() => setSimilar(null)}
      />
    </form>
  )
}
