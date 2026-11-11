import { Link, useNavigate } from 'react-router-dom'

import { AuthShell, LOGIN_POINTS } from '@/features/auth/AuthShell'
import { RegisterForm } from '@/features/auth/RegisterForm'
import { roleHome } from '@/routes/roles'

export function RegisterPage() {
  const navigate = useNavigate()
  return (
    <AuthShell pitch="Two minutes to your first report." points={LOGIN_POINTS}>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground">Report issues and follow them until they are fixed.</p>
      </div>
      <RegisterForm onSuccess={(user) => navigate(roleHome(user.role), { replace: true })} />
      <p className="text-center text-sm text-muted-foreground">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  )
}
