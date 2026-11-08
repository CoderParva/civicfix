import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getApiErrorMessage } from '@/services/apiClient'
import { issuesApi } from '@/services/issuesApi'
import {
  adminApi,
  officerApi,
  type AdminListParams,
  type DepartmentInput,
  type OfficerInput,
  type StaffListParams,
} from '@/services/staffApi'

/**
 * Staff screens are shared state: an admin, an officer and a colleague may all change the same
 * issue. So staff queries are never considered fresh (refetch on mount) and refetch when the tab
 * regains focus, instead of showing the 30-second-old view the citizen pages are fine with.
 */
const LIVE = { staleTime: 0, refetchOnWindowFocus: true } as const

/** Every staff query key starts with 'staff', so one invalidation after any action refreshes them all. */
export const staffKeys = {
  all: ['staff'] as const,
  officerIssues: (params: StaffListParams) => ['staff', 'officer', 'issues', params] as const,
  officerIssue: (id: string) => ['staff', 'officer', 'issue', id] as const,
  notes: (id: string) => ['staff', 'officer', 'notes', id] as const,
  officerAnalytics: (days: number) => ['staff', 'officer', 'analytics', days] as const,
  adminIssues: (params: AdminListParams) => ['staff', 'admin', 'issues', params] as const,
  adminIssue: (id: string) => ['staff', 'admin', 'issue', id] as const,
  adminAnalytics: (days: number) => ['staff', 'admin', 'analytics', days] as const,
  departments: ['staff', 'admin', 'departments'] as const,
  comments: (issueId: string) => ['staff', 'admin', 'comments', issueId] as const,
}

// ---------------------------------------------------------------- officer

export const useOfficerIssues = (params: StaffListParams) =>
  useQuery({ queryKey: staffKeys.officerIssues(params), queryFn: () => officerApi.listIssues(params), placeholderData: keepPreviousData, ...LIVE })

export const useOfficerIssue = (id: string | undefined) =>
  useQuery({ queryKey: staffKeys.officerIssue(id ?? ''), queryFn: () => officerApi.getIssue(id!), enabled: !!id, ...LIVE })

export const useOfficerNotes = (id: string | undefined) =>
  useQuery({ queryKey: staffKeys.notes(id ?? ''), queryFn: () => officerApi.listNotes(id!), enabled: !!id, ...LIVE })

export const useOfficerAnalytics = (days = 90) =>
  useQuery({ queryKey: staffKeys.officerAnalytics(days), queryFn: () => officerApi.analytics(days), ...LIVE })

// ------------------------------------------------------------------ admin

export const useAdminIssues = (params: AdminListParams) =>
  useQuery({ queryKey: staffKeys.adminIssues(params), queryFn: () => adminApi.listIssues(params), placeholderData: keepPreviousData, ...LIVE })

export const useAdminIssue = (id: string | undefined) =>
  useQuery({ queryKey: staffKeys.adminIssue(id ?? ''), queryFn: () => adminApi.getIssue(id!), enabled: !!id, ...LIVE })

export const useAdminAnalytics = (days = 90) =>
  useQuery({ queryKey: staffKeys.adminAnalytics(days), queryFn: () => adminApi.analytics(days), ...LIVE })

export const useDepartments = () => useQuery({ queryKey: staffKeys.departments, queryFn: adminApi.listDepartments, ...LIVE })

/** The citizen-visible comments of an issue (hidden ones are already excluded by the API). */
export const useIssueComments = (issueId: string | undefined) =>
  useQuery({ queryKey: staffKeys.comments(issueId ?? ''), queryFn: () => issuesApi.listComments(issueId!), enabled: !!issueId })

// -------------------------------------------------------------- mutations

/**
 * One wrapper for every staff action: run it, say what happened (toast), refresh all staff data,
 * and surface the server's own message when it refuses (409 wrong state, 403, 400 validation...).
 */
function useStaffAction<TVars, TResult>(run: (vars: TVars) => Promise<TResult>, success: string | ((result: TResult) => string)) {
  const queryClient = useQueryClient()
  return useMutation<TResult, unknown, TVars>({
    mutationFn: run,
    onSuccess: (result) => {
      toast.success(typeof success === 'function' ? success(result) : success)
      // Deliberately not awaited: some actions move the issue out of the user's reach (an officer
      // sending an assignment back), and the caller may navigate away before the refetch lands.
      void queryClient.invalidateQueries({ queryKey: staffKeys.all })
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  })
}

export const useAcceptIssue = () => useStaffAction((id: string) => officerApi.accept(id), 'Assignment accepted. The issue is now in progress.')
export const useRejectAssignment = () =>
  useStaffAction(({ id, reason }: { id: string; reason: string }) => officerApi.reject(id, reason), 'Sent back to the admin for reassignment.')
export const useResolveIssue = () =>
  useStaffAction(({ id, image, remarks }: { id: string; image?: File | null; remarks?: string }) => officerApi.resolve(id, { image, remarks }), 'Issue marked as resolved.')
export const useAddNote = () => useStaffAction(({ id, note }: { id: string; note: string }) => officerApi.addNote(id, note), 'Note added.')

export const useApproveIssue = () => useStaffAction((id: string) => adminApi.approve(id), 'Issue approved and moved to review.')
export const useRejectIssue = () => useStaffAction(({ id, reason }: { id: string; reason: string }) => adminApi.reject(id, reason), 'Issue rejected.')
export const useAssignIssue = () =>
  useStaffAction(
    ({ id, department, officer }: { id: string; department: string; officer: string }) => adminApi.assign(id, department, officer),
    'Issue assigned.',
  )
export const useReopenIssue = () => useStaffAction(({ id, reason }: { id: string; reason: string }) => adminApi.reopen(id, reason), 'Issue reopened.')
export const useHideComment = () => useStaffAction((commentId: string) => adminApi.hideComment(commentId), 'Comment hidden from public view.')

export const useCreateDepartment = () => useStaffAction((input: DepartmentInput) => adminApi.createDepartment(input), 'Department created.')
export const useUpdateDepartment = () =>
  useStaffAction(({ id, ...input }: { id: string } & Partial<DepartmentInput>) => adminApi.updateDepartment(id, input), 'Department updated.')
export const useDeleteDepartment = () => useStaffAction((id: string) => adminApi.deleteDepartment(id), 'Department deleted.')
export const useCreateOfficer = () => useStaffAction((input: OfficerInput) => adminApi.createOfficer(input), (o) => `${o.name} can now sign in as an officer.`)
