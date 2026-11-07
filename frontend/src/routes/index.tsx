import type { RouteObject } from 'react-router-dom'

import { NotFoundPage } from '@/pages/NotFoundPage'

import { citizenRoutes } from './citizen'
import { publicRoutes } from './public'

// officer.tsx / admin.tsx join this list in later phases.
export const appRoutes: RouteObject[] = [...publicRoutes, ...citizenRoutes, { path: '*', element: <NotFoundPage /> }]
