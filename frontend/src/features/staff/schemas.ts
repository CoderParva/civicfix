import { z } from 'zod'

// Client-side checks give fast feedback; the backend (DRF + Django validators) is authoritative and
// its field errors are mapped back onto these inputs.

export const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Enter the department name').max(150, 'Keep it under 150 characters'),
  city: z.string().trim().max(100, 'Keep it under 100 characters'),
  description: z.string().trim().max(1000, 'Keep it under 1000 characters'),
  is_active: z.boolean(),
})
export type DepartmentValues = z.infer<typeof departmentSchema>

export const officerSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter the officer’s full name').max(150, 'Name is too long'),
  email: z.email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine((v) => !/^\d+$/.test(v), 'Password cannot be only numbers'),
  department: z.string().min(1, 'Choose a department'),
  employee_reference: z.string().trim().min(2, 'Enter the employee reference').max(50, 'Keep it under 50 characters'),
})
export type OfficerValues = z.infer<typeof officerSchema>
