import Navbar from '../components/shared/Navbar'
import AllRequests from '../components/chef/AllRequests'
import PendingQueue from '../components/manager/PendingQueue'
import { useAuth } from '../hooks/useAuth'

export default function Dashboard() {
  const { profile, loading, profileError, signOut } = useAuth()

  if (loading || (!profile && !profileError)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (profileError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600 text-sm text-center py-4">{profileError}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar profile={profile} onSignOut={signOut} />
      {profile.role === 'chef'
        ? <AllRequests />
        : <PendingQueue />
      }
    </div>
  )
}
