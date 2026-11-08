import type { RouteObject } from 'react-router-dom'

import { AdminLayout } from '@/layouts/AdminLayout'

import { ProtectedRoute } from './guards'

export const adminRoutes: RouteObject[] = [
  {
    // UX gate; the real enforcement is IsSuperAdmin on every /admin endpoint.
    element: <ProtectedRoute allowedRoles={['admin']} />,
    children: [
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import('@/pages/admin/AdminDashboardPage')).AdminDashboardPage }) },
          { path: 'issues', lazy: async () => ({ Component: (await import('@/pages/admin/AdminIssuesPage')).AdminIssuesPage }) },
          { path: 'issues/:id', lazy: async () => ({ Component: (await import('@/pages/admin/AdminIssuePage')).AdminIssuePage }) },
          { path: 'departments', lazy: async () => ({ Component: (await import('@/pages/admin/AdminDepartmentsPage')).AdminDepartmentsPage }) },
        ],
      },
    ],
  },
]
