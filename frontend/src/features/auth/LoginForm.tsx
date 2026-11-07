import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { FormField } from '@/components/FormField'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { getApiErrorMessage } from '@/services/apiClient'
import type { User } from '@/types/api'

import { loginSchema, type LoginValues } from './schemas'

export function LoginForm({ onSuccess }: { onSuccess: (user: User) => void }) {
  const { login } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      onSuccess(await login(values.email.trim(), values.password))
    } catch (error) {
      setServerError(getApiErrorMessage(error, 'Could not sign you in. Please try again.'))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Log in">
      {serverError && <Alert variant="destructive">{serverError}</Alert>}
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
      </FormField>
      <FormField id="password" label="Password" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          {...register('password')}
        />
      </FormField>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  )
}
