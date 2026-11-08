import type { Paginated } from '@/types/api'
import type {
  AdminIssue,
  CreatedOfficer,
  Department,
  DepartmentAnalytics,
  DepartmentNote,
  OfficerIssue,
  PlatformAnalytics,
} from '@/types/staff'

import { api } from './apiClient'

export interface StaffListParams {
  page?: number
  ordering?: string
  status?: string
  category?: string
}

export interface AdminListParams extends StaffListParams {
  moderation_status?: string
  flagged?: boolean
}

const clean = <T extends object>(params: T) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false))

export interface DepartmentInput {
  name: string
  city: string
  description: string
  is_active?: boolean
}

export interface OfficerInput {
  email: string
  full_name: string
  password: string
  department: string
  employee_reference: string
}

/** Everything the officer workspace calls (backend/departments/officer_views.py). */
export const officerApi = {
  listIssues: (params: StaffListParams) =>
    api.get<Paginated<OfficerIssue>>('/officer/issues/', { params: clean(params) }).then((r) => r.data),
  getIssue: (id: string) => api.get<OfficerIssue>(`/officer/issues/${id}/`).then((r) => r.data),
  accept: (id: string) => api.post<OfficerIssue>(`/officer/issues/${id}/accept/`).then((r) => r.data),
  reject: (id: string, reason: string) => api.post<OfficerIssue>(`/officer/issues/${id}/reject/`, { reason }).then((r) => r.data),
  resolve(id: string, { image, remarks }: { image?: File | null; remarks?: string }) {
    const form = new FormData()
    if (image) form.append('image', image)
    if (remarks) form.append('remarks', remarks)
    return api.post<OfficerIssue>(`/officer/issues/${id}/resolve/`, form).then((r) => r.data)
  },
  listNotes: (id: string) => api.get<Paginated<DepartmentNote>>(`/officer/issues/${id}/notes/`).then((r) => r.data.results),
  addNote: (id: string, note: string) => api.post<DepartmentNote>(`/officer/issues/${id}/notes/`, { note }).then((r) => r.data),
  analytics: (days = 90) => api.get<DepartmentAnalytics>('/officer/analytics/', { params: { days } }).then((r) => r.data),
}

/** Everything the admin workspace calls (backend/departments/admin_views.py). */
export const adminApi = {
  listIssues: (params: AdminListParams) =>
    api.get<Paginated<AdminIssue>>('/admin/issues/', { params: clean(params) }).then((r) => r.data),
  getIssue: (id: string) => api.get<AdminIssue>(`/admin/issues/${id}/`).then((r) => r.data),
  approve: (id: string) => api.post<AdminIssue>(`/admin/issues/${id}/approve/`).then((r) => r.data),
  reject: (id: string, reason: string) => api.post<AdminIssue>(`/admin/issues/${id}/reject/`, { reason }).then((r) => r.data),
  assign: (id: string, department: string, officer: string) =>
    api.post<AdminIssue>(`/admin/issues/${id}/assign/`, { department, officer }).then((r) => r.data),
  reopen: (id: string, reason: string) => api.post<AdminIssue>(`/admin/issues/${id}/reopen/`, { reason }).then((r) => r.data),
  hideComment: (commentId: string) => api.post<{ id: string; is_hidden: boolean }>(`/admin/comments/${commentId}/hide/`).then((r) => r.data),
  analytics: (days = 90) => api.get<PlatformAnalytics>('/admin/analytics/', { params: { days } }).then((r) => r.data),

  listDepartments: () => api.get<Paginated<Department>>('/admin/departments/').then((r) => r.data.results),
  createDepartment: (input: DepartmentInput) => api.post<Department>('/admin/departments/', input).then((r) => r.data),
  updateDepartment: (id: string, input: Partial<DepartmentInput>) => api.patch<Department>(`/admin/departments/${id}/`, input).then((r) => r.data),
  deleteDepartment: (id: string) => api.delete(`/admin/departments/${id}/`).then(() => undefined),
  createOfficer: (input: OfficerInput) => api.post<CreatedOfficer>('/admin/officers/', input).then((r) => r.data),
}
