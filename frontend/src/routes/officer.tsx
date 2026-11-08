import type { RouteObject } from 'react-router-dom'

import { OfficerLayout } from '@/layouts/OfficerLayout'

import { ProtectedRoute } from './guards'

// Pages load on demand (the chart library is only needed here), each with the shell's skeleton.
export const officerRoutes: RouteObject[] = [
  {
    // UX gate; the real enforcement is the Django permission classes (IsAssignedDepartment) on every endpoint.
    element: <ProtectedRoute allowedRoles={['officer']} />,
    children: [
      {
        path: 'officer',
        element: <OfficerLayout />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import('@/pages/officer/OfficerDashboardPage')).OfficerDashboardPage }) },
          { path: 'issues', lazy: async () => ({ Component: (await import('@/pages/officer/OfficerQueuePage')).OfficerQueuePage }) },
          { path: 'analytics', lazy: async () => ({ Component: (await import('@/pages/officer/OfficerAnalyticsPage')).OfficerAnalyticsPage }) },
          { path: 'issues/:id', lazy: async () => ({ Component: (await import('@/pages/officer/OfficerIssuePage')).OfficerIssuePage }) },
        ],
      },
    ],
  },
]
