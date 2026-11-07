import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { FormField } from '@/components/FormField'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { getApiErrorMessage, getFieldErrors } from '@/services/apiClient'
import type { User } from '@/types/api'

import { registerSchema, type RegisterValues } from './schemas'

const SERVER_FIELDS = ['full_name', 'email', 'password'] as const

/** Creates the account, then signs in with the same credentials so the user lands inside the app. */
export function RegisterForm({ onSuccess }: { onSuccess: (user: User) => void }) {
  const { register: registerAccount, login } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: '', email: '', password: '', confirmPassword: '' },
  })

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    const email = values.email.trim()
    try {
      await registerAccount({ email, full_name: values.full_name, password: values.password })
    } catch (error) {
      // Show the server's per-field messages (duplicate email, weak password...) on the right input.
      const fieldErrors = getFieldErrors(error)
      let mapped = false
      for (const field of SERVER_FIELDS) {
        if (fieldErrors[field]) {
          setError(field, { message: fieldErrors[field] })
          mapped = true
        }
      }
      if (!mapped) setServerError(getApiErrorMessage(error, 'Could not create your account. Please try again.'))
      return
    }
    try {
      onSuccess(await login(email, values.password))
    } catch {
      setServerError('Your account was created, but signing in failed. Please log in.')
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Create account">
      {serverError && <Alert variant="destructive">{serverError}</Alert>}
      <FormField id="full_name" label="Full name" error={errors.full_name?.message}>
        <Input id="full_name" autoComplete="name" aria-invalid={!!errors.full_name} {...register('full_name')} />
      </FormField>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
      </FormField>
      <FormField id="password" label="Password" error={errors.password?.message} hint="At least 8 characters.">
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...register('password')}
        />
      </FormField>
      <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
      </FormField>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  )
}
