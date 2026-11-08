import type { RouteObject } from 'react-router-dom'

import { PublicLayout } from '@/layouts/PublicLayout'
import { ExplorePage } from '@/pages/ExplorePage'
import { IssueDetailPage } from '@/pages/IssueDetailPage'
import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'

import { GuestOnly } from './guards'

export const publicRoutes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      // public: anyone can browse approved issues; the API decides what each viewer may see
      { path: 'explore', element: <ExplorePage /> },
      { path: 'issues/:id', element: <IssueDetailPage /> },
      {
        // login/register bounce signed-in users to their home
        element: <GuestOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
        ],
      },
    ],
  },
]
