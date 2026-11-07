import { Link, useNavigate } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RegisterForm } from '@/features/auth/RegisterForm'
import { roleHome } from '@/routes/roles'

export function RegisterPage() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>Report issues and follow them until they are fixed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RegisterForm onSuccess={(user) => navigate(roleHome(user.role), { replace: true })} />
          <p className="text-center text-sm text-muted-foreground">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
