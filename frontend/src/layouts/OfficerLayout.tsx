import { BarChart3, Inbox, LayoutDashboard } from 'lucide-react'

import { StaffShell, type StaffNavItem } from './StaffShell'

const ITEMS: StaffNavItem[] = [
  { to: '/officer', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/officer/issues', label: 'My queue', icon: Inbox },
  { to: '/officer/analytics', label: 'Analytics', icon: BarChart3 },
]

export function OfficerLayout() {
  return <StaffShell items={ITEMS} workspace="Officer workspace" />
}
