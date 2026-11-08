import { Building2, ClipboardList, LayoutDashboard } from 'lucide-react'

import { StaffShell, type StaffNavItem } from './StaffShell'

const ITEMS: StaffNavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/issues', label: 'Issues', icon: ClipboardList },
  { to: '/admin/departments', label: 'Departments', icon: Building2 },
]

export function AdminLayout() {
  return <StaffShell items={ITEMS} workspace="Admin console" />
}
