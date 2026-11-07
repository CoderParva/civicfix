// Hand-written mirrors of the DRF serializers (backend/accounts, backend/issues).

export type Role = 'citizen' | 'officer' | 'admin'

export interface User {
  id: string
  email: string
  full_name: string
  role: Role
  phone_number: string
  city: string
  state: string
  created_at: string
}

export interface TokenPair {
  access: string
  refresh: string
}

export interface LoginResponse extends TokenPair {
  user: User
}

export type IssueStatus =
  | 'reported'
  | 'under_review'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'reopened'
  | 'rejected'

export type IssuePriority = 'low' | 'medium' | 'high' | 'critical'
export type ModerationStatus = 'pending' | 'approved' | 'rejected'

export interface Category {
  id: number
  name: string
  icon: string
}

export interface IssueImage {
  id: string
  url: string
  image_type: 'report' | 'resolution'
  uploaded_at: string
}

export interface Issue {
  id: string
  reference_number: string
  title: string
  description: string
  category: Category
  status: IssueStatus
  priority: IssuePriority
  location: { latitude: number; longitude: number }
  address: string
  landmark: string
  images: IssueImage[]
  vote_count: number
  comment_count: number
  has_voted: boolean
  is_following: boolean
  is_mine: boolean
  /** Only present on the owner's own issues. */
  moderation_status?: ModerationStatus
  is_public?: boolean
  created_at: string
  resolved_at: string | null
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface CreateIssuePayload {
  category: number
  title: string
  description: string
  latitude: number
  longitude: number
  address?: string
  landmark?: string
}
