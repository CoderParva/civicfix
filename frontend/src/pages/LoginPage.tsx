import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <div className="mx-auto flex max-w-md flex-col gap-4">
      {state.expired && <Alert variant="warning">Your session expired. Please log in again.</Alert>}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Log in</CardTitle>
          <CardDescription>Welcome back to CivicFix.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LoginForm onSuccess={onSuccess} />
          <p className="text-center text-sm text-muted-foreground">
            New here?{' '}
            <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
