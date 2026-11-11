import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Alert } from '@/components/ui/alert'
import { AuthShell, LOGIN_POINTS } from '@/features/auth/AuthShell'
import { LoginForm } from '@/features/auth/LoginForm'
import { postLoginTarget } from '@/routes/roles'
import type { User } from '@/types/api'

interface LoginLocationState {
  from?: string
  expired?: boolean
}

export function LoginPage() {
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as LoginLocationState

  function onSuccess(user: User) {
    navigate(postLoginTarget(user.role, state.from), { replace: true })
  }

  return (
    <AuthShell pitch="Welcome back. Your city is still waiting." points={LOGIN_POINTS}>
      {state.expired && <Alert variant="warning">Your session expired. Please log in again.</Alert>}
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Log in</h1>
        <p className="text-muted-foreground">Welcome back to CivicFix.</p>
      </div>
      <LoginForm onSuccess={onSuccess} />
      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link to="/register" className="font-semibold text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  )
}
