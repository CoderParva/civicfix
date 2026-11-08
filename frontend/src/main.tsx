import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AuthProvider } from '@/context/AuthContext'
import { appRoutes } from '@/routes'
import { createQueryClient } from '@/services/queryClient'

import './index.css'

const queryClient = createQueryClient()
const router = createBrowserRouter(appRoutes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" toastOptions={{ classNames: { toast: '!rounded-xl !border !shadow-md !font-sans' } }} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
