import type { Category, Issue, Role, User } from '@/types/api'

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'asha@example.com',
    full_name: 'Asha Verma',
    role: 'citizen',
    phone_number: '',
    city: '',
    state: '',
    created_at: '2026-11-01T10:00:00+05:30',
    ...overrides,
  }
}

export const CATEGORIES: Category[] = [
  { id: 1, name: 'Pothole', icon: 'pothole' },
  { id: 2, name: 'Garbage', icon: 'trash' },
]

let issueCounter = 0
export function makeIssue(overrides: Partial<Issue> = {}): Issue {
  issueCounter += 1
  return {
    id: `issue-${issueCounter}`,
    reference_number: `CF-2611-${String(issueCounter).padStart(6, '0')}`,
    title: `Issue number ${issueCounter}`,
    description: 'A description that is long enough to be valid.',
    category: CATEGORIES[0],
    status: 'reported',
    priority: 'medium',
    location: { latitude: 22.7196, longitude: 75.8577 },
    address: '',
    landmark: '',
    images: [],
    vote_count: 0,
    comment_count: 0,
    has_voted: false,
    is_following: false,
    is_mine: true,
    moderation_status: 'pending',
    is_public: true,
    created_at: '2026-11-02T09:00:00+05:30',
    resolved_at: null,
    ...overrides,
  }
}

function b64url(value: unknown): string {
  // UTF-8 first, like a real JWT encoder (btoa alone would produce latin-1 for non-ASCII).
  const binary = Array.from(new TextEncoder().encode(JSON.stringify(value)), (b) => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** An unsigned JWT-shaped string. The frontend only decodes the payload, never verifies it. */
export function fakeJwt(claims: { role: Role; email?: string; exp?: number }): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ user_id: 'user-1', exp: 9999999999, ...claims })}.sig`
}

/** n public (approved) issues, newest first, numbered "Issue 01", "Issue 02"... */
export function makePublicIssues(n: number, overrides: (index: number) => Partial<Issue> = () => ({})): Issue[] {
  return Array.from({ length: n }, (_, i) =>
    makeIssue({
      title: `Public issue ${String(i + 1).padStart(2, '0')}`,
      moderation_status: undefined,
      is_public: undefined,
      is_mine: false,
      status: 'in_progress',
      ...overrides(i),
    }),
  )
}
