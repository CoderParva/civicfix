import { useAuth } from '@/context/AuthContext'
import { EmptyState } from '@/components/EmptyState'

/** Landing spot for officer/admin accounts until their dashboards are built. */
export function ComingSoonPage() {
  const { role } = useAuth()
  return (
    <EmptyState
      title="Your dashboard is coming soon"
      description={`The ${role ?? 'staff'} workspace is not part of the web app yet. The citizen app is available to citizen accounts.`}
    />
  )
}
