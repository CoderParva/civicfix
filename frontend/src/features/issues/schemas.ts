import { z } from 'zod'

export const MAX_PHOTOS = 5
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const coordinate = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .pipe(
      z
        .transform(Number)
        .pipe(z.number({ error: `${label} must be a number` }).min(min, `${label} must be ≥ ${min}`).max(max, `${label} must be ≤ ${max}`)),
    )

/**
 * Form values are strings (that is what inputs give us); the parsed output has real numbers,
 * matching CreateIssuePayload. Limits mirror the DRF IssueCreateSerializer.
 */
export const reportIssueSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(150, 'Title must be at most 150 characters'),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the problem in at least 10 characters')
    .max(2000, 'Description must be at most 2000 characters'),
  category: z
    .string()
    .min(1, 'Choose a category')
    .transform(Number),
  latitude: coordinate('Latitude', -90, 90),
  longitude: coordinate('Longitude', -180, 180),
  address: z.string().trim().max(255, 'Address must be at most 255 characters'),
  landmark: z.string().trim().max(255, 'Landmark must be at most 255 characters'),
})
export type ReportIssueInput = z.input<typeof reportIssueSchema>
export type ReportIssueValues = z.output<typeof reportIssueSchema>

/** Same rules the server enforces on uploads (type, size). Returns an error message or null. */
export function validatePhoto(file: File): string | null {
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return `${file.name}: only JPEG, PNG or WebP images are allowed`
  if (file.size > MAX_PHOTO_BYTES) return `${file.name}: larger than ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`
  if (file.size === 0) return `${file.name}: the file is empty`
  return null
}
