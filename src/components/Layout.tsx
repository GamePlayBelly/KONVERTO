import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  PlusCircle,
  Trophy,
  Bot,
  User,
  Leaf,
  LogOut,
  Menu,
  X,
  MessageCircle,
  History,
  ShoppingBag,
  Building2,
  Car,
  Users,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NotificationBell } from '@/components/NotificationBell'

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/trip/new', icon: PlusCircle, label: 'Nuovo viaggio' },
  { to: '/trips', icon: History, label: 'Storico viaggi' },
  { to: '/leaderboard', icon: Trophy, label: 'Classifica' },
  { to: '/clubs', icon: Building2, label: 'Club' },
  { to: '/carpooling', icon: Car, label: 'Carpooling' },
  { to: '/shop', icon: ShoppingBag, label: 'EcoShop' },
  { to: '/chat', icon: MessageCircle, label: 'Chat' },
  { to: '/friends', icon: Users, label: 'Amici' },
  { to: '/ai-assistant', icon: Bot, label: 'AI Coach' },
  { to: '/profile', icon: User, label: 'Profilo' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  const initials = profile?.username?.slice(0, 2).toUpperCase() ?? 'EC'

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-100 fixed h-full z-30">
        {/* Logo + Bell */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-eco-green rounded-xl flex items-center justify-center shadow-sm">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl text-gray-900">EcoTrack</span>
          </Link>
          <NotificationBell />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + '/')
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                  active
                    ? 'bg-eco-green-light text-eco-green'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon className={cn('w-5 h-5 flex-shrink-0', active ? 'text-eco-green' : 'text-gray-400')} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="w-9 h-9">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {profile?.full_name ?? profile?.username ?? 'Utente'}
              </p>
              <p className="text-xs text-eco-green font-medium">{profile?.eco_score ?? 0} pts</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-gray-500" onClick={handleSignOut}>
            <LogOut className="w-4 h-4" /> Esci
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-eco-green rounded-lg flex items-center justify-center">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg text-gray-900">EcoTrack</span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-xl text-gray-600 hover:bg-gray-100"
            aria-label="Menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black/30" onClick={() => setMobileOpen(false)}>
          <div
            className="absolute top-0 right-0 h-full w-72 bg-white shadow-xl p-6 pt-20 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="space-y-0.5">
              {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
                const active = location.pathname === to || location.pathname.startsWith(to + '/')
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all',
                      active ? 'bg-eco-green-light text-eco-green' : 'text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {label}
                  </Link>
                )
              })}
            </nav>
            <div className="mt-6 pt-6 border-t border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="w-9 h-9">
                  {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{profile?.full_name ?? profile?.username}</p>
                  <p className="text-xs text-eco-green">{profile?.eco_score ?? 0} pts</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="w-full justify-start text-gray-500" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" /> Esci
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 lg:ml-64 pt-16 lg:pt-0">
        <div className="p-4 pb-8 lg:p-8 max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  )
}
