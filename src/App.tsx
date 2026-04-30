import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Layout } from '@/components/Layout'

import Landing from '@/pages/Landing'
import Login from '@/pages/Login'
import Signup from '@/pages/Signup'
import VerifyEmail from '@/pages/VerifyEmail'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import Dashboard from '@/pages/Dashboard'
import TripNew from '@/pages/TripNew'
import TripHistory from '@/pages/TripHistory'
import Leaderboard from '@/pages/Leaderboard'
import AIAssistant from '@/pages/AIAssistant'
import Profile from '@/pages/Profile'
import Shop from '@/pages/Shop'
import Clubs from '@/pages/Clubs'
import Carpooling from '@/pages/Carpooling'
import Chat from '@/pages/Chat'
import ChatRoom from '@/pages/ChatRoom'
import ClubDetail from '@/pages/ClubDetail'
import Friends from '@/pages/Friends'
import PublicProfile from '@/pages/PublicProfile'

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  )
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Protected routes */}
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/trip/new" element={<Protected><TripNew /></Protected>} />
      <Route path="/trips" element={<Protected><TripHistory /></Protected>} />
      <Route path="/leaderboard" element={<Protected><Leaderboard /></Protected>} />
      <Route path="/ai-assistant" element={<Protected><AIAssistant /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/shop" element={<Protected><Shop /></Protected>} />
      <Route path="/clubs" element={<Protected><Clubs /></Protected>} />
      <Route path="/clubs/:id" element={<Protected><ClubDetail /></Protected>} />
      <Route path="/carpooling" element={<Protected><Carpooling /></Protected>} />
      <Route path="/chat" element={<Protected><Chat /></Protected>} />
      <Route path="/chat/:id" element={<Protected><ChatRoom /></Protected>} />
      <Route path="/friends" element={<Protected><Friends /></Protected>} />
      <Route path="/user/:userId" element={<Protected><PublicProfile /></Protected>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
