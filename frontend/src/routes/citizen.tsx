import type { RouteObject } from 'react-router-dom'

import { CitizenLayout } from '@/layouts/CitizenLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { MyReportsPage } from '@/pages/MyReportsPage'
import { ReportIssuePage } from '@/pages/ReportIssuePage'

import { ProtectedRoute } from './guards'

export const citizenRoutes: RouteObject[] = [
  {
    // UX gate; the real enforcement is the Django permission classes on every endpoint.
    element: <ProtectedRoute allowedRoles={['citizen']} />,
    children: [
      {
        element: <CitizenLayout />,
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'my-reports', element: <MyReportsPage /> },
          { path: 'report', element: <ReportIssuePage /> },
        ],
      },
    ],
  },
]
