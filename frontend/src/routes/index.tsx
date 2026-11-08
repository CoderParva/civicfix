import type { RouteObject } from 'react-router-dom'

import { NotFoundPage } from '@/pages/NotFoundPage'

import { adminRoutes } from './admin'
import { citizenRoutes } from './citizen'
import { officerRoutes } from './officer'
import { publicRoutes } from './public'

export const appRoutes: RouteObject[] = [...publicRoutes, ...citizenRoutes, ...officerRoutes, ...adminRoutes, { path: '*', element: <NotFoundPage /> }]
