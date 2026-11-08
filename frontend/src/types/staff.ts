// Mirrors of the staff-facing DRF serializers (backend/departments, backend/analytics).
import type { Issue, IssuePriority, IssueStatus, ModerationStatus, Role } from './api'

export interface OfficerSummary {
  id: string
  name: string
  employee_reference: string
}

export interface Department {
  id: string
  name: string
  description: string
  city: string
  is_active: boolean
  officers: OfficerSummary[]
}

export type AssignmentStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

export interface Assignment {
  id: string
  department: { id: string; name: string }
  officer: OfficerSummary
  status: AssignmentStatus
  rejection_reason: string
  assigned_at: string
  accepted_at: string | null
  /** The requesting user is the assigned officer. */
  is_mine: boolean
}

export interface StatusHistoryEntry {
  id: string
  old_status: IssueStatus | ''
  new_status: IssueStatus
  changed_by: { name: string; role: Role } | null
  reason: string
  created_at: string
}

export interface OfficerIssue extends Issue {
  assignment: Assignment | null
  /** Only on the detail endpoint. */
  status_history?: StatusHistoryEntry[]
}

export interface AdminIssue extends Issue {
  moderation_status: ModerationStatus
  is_public: boolean
  reporter: { id: string; full_name: string; email: string }
  report_count: number
  assignment: Assignment | null
  status_history?: StatusHistoryEntry[]
}

export interface DepartmentNote {
  id: string
  author_name: string
  department: string
  note: string
  created_at: string
}

export interface CreatedOfficer {
  id: string
  name: string
  employee_reference: string
  department: { id: string; name: string; city: string; is_active: boolean }
}

// ---- analytics ----

export interface StatusCount {
  status: IssueStatus
  count: number
}
export interface PriorityCount {
  priority: IssuePriority
  count: number
}
export interface CategoryCount {
  id: number
  name: string
  count: number
}
export interface DayPoint {
  date: string
  reported: number
  resolved: number
}

interface BaseAnalytics {
  range_days: number
  by_status: StatusCount[]
  by_priority: PriorityCount[]
  by_category: CategoryCount[]
  over_time: DayPoint[]
}

export interface DepartmentPerformance {
  id: string
  name: string
  city: string
  is_active: boolean
  in_queue: number
  in_progress: number
  resolved: number
  rejected_assignments: number
  avg_resolution_hours: number | null
}

export interface PlatformAnalytics extends BaseAnalytics {
  totals: {
    issues: number
    awaiting_moderation: number
    open: number
    resolved: number
    rejected: number
    flagged: number
    avg_resolution_hours: number | null
  }
  departments: DepartmentPerformance[]
}

export interface DepartmentAnalytics extends BaseAnalytics {
  department: { id: string; name: string; city: string }
  totals: {
    in_queue: number
    awaiting_acceptance: number
    in_progress: number
    resolved: number
    rejected_assignments: number
    avg_resolution_hours: number | null
  }
}
