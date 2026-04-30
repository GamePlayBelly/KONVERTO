import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

interface Props {
  children: React.ReactNode
  requireVerified?: boolean
}

export function ProtectedRoute({ children, requireVerified = true }: Props) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-eco-green-light">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-eco-green border-t-transparent rounded-full animate-spin" />
          <p className="text-eco-teal font-medium">Caricamento...</p>
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (requireVerified && !session.user.email_confirmed_at) {
    return <Navigate to="/verify-email" replace />
  }

  return <>{children}</>
}
