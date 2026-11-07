import type { RouteObject } from 'react-router-dom'

import { PublicLayout } from '@/layouts/PublicLayout'
import { ComingSoonPage } from '@/pages/ComingSoonPage'
import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'

import { GuestOnly } from './guards'

export const publicRoutes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'coming-soon', element: <ComingSoonPage /> },
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
