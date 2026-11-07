import { z } from 'zod'

// Client-side checks are for fast feedback only. The backend (Django validators) is authoritative
// and its errors are mapped back onto these fields.

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Enter your full name').max(150, 'Name is too long'),
    email: z.email('Enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .refine((v) => !/^\d+$/.test(v), 'Password cannot be only numbers'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
export type RegisterValues = z.infer<typeof registerSchema>
