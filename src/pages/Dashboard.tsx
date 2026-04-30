import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  PlusCircle, Flame, Leaf, TrendingUp, MapPin, Award, Calendar, ArrowRight,
  Car, MessageCircle, Building2, ShoppingBag, AlertTriangle, Hand, Route, Trophy
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getTrips, getUserBadges } from '@/lib/supabase'
import { formatCO2, formatDistance, formatRelative, TRANSPORT_META, getBestEquivalent, getEcoLevel } from '@/lib/utils'
import type { Trip, UserBadge } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import EcoMap from '@/components/EcoMap'

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string
}) {
  return (
    <Card className="hover:scale-[1.02] transition-transform">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TripRow({ trip }: { trip: Trip }) {
  const meta = TRANSPORT_META[trip.transport_mode]
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${meta.bgColor}`}>
        {meta.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{meta.label}</p>
        <p className="text-xs text-gray-400">{formatRelative(trip.recorded_at)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold text-eco-green">+{trip.eco_points} pts</p>
        <p className="text-xs text-gray-400">{formatDistance(trip.distance_km)} · {formatCO2(Number(trip.co2_saved_kg))}</p>
      </div>
    </div>
  )
}

const QUICK_LINKS = [
  { to: '/carpooling', icon: Car, label: 'Carpooling', color: 'bg-orange-50 text-orange-600' },
  { to: '/clubs', icon: Building2, label: 'Club', color: 'bg-blue-50 text-blue-600' },
  { to: '/chat', icon: MessageCircle, label: 'Chat', color: 'bg-violet-50 text-violet-600' },
  { to: '/shop', icon: ShoppingBag, label: 'Shop', color: 'bg-amber-50 text-amber-600' },
]

export default function Dashboard() {
  const { profile, user } = useAuth()
  const [trips, setTrips] = useState<Trip[]>([])
  const [badges, setBadges] = useState<UserBadge[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const [t, b] = await Promise.all([getTrips(user.id, 5), getUserBadges(user.id)])
      setTrips(t)
      setBadges(b)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const co2Today = trips.filter(t => t.recorded_at.startsWith(today)).reduce((s, t) => s + Number(t.co2_saved_kg), 0)
  const co2Week = trips.filter(t => t.recorded_at >= weekAgo).reduce((s, t) => s + Number(t.co2_saved_kg), 0)

  // Streak warning: streak active but no activity today
  const showStreakWarning = !loading && profile && (profile.streak_days ?? 0) > 0 && (profile.last_activity_date ?? '') !== today

  // CO₂ equivalents banner
  const totalCO2 = Number(profile?.total_co2_saved ?? 0)
  const equiv = totalCO2 > 0 ? getBestEquivalent(totalCO2) : null

  const initials = profile?.username?.slice(0, 2).toUpperCase() ?? 'EC'

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      {/* Streak warning */}
      {showStreakWarning && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 animate-fade-in">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              Streak a rischio! {profile.streak_days} giorni
            </p>
            <p className="text-xs text-amber-600">Registra un viaggio oggi per non interrompere la serie</p>
          </div>
          <Link to="/trip/new">
            <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100 flex-shrink-0">
              Vai
            </Button>
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="w-12 h-12 border-2 border-eco-green/20">
            {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
            <AvatarFallback className="text-base">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm text-gray-500">Bentornato,</p>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              {profile?.full_name ?? profile?.username ?? 'Utente'} <Hand className="w-5 h-5 text-amber-400" />
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {profile && (profile.streak_days ?? 0) > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Flame className="w-3 h-3 text-orange-500" />
              {profile.streak_days}gg
            </Badge>
          )}
          <Badge className="gap-1">
            <Leaf className="w-3 h-3" />
            {(profile?.eco_score ?? 0).toLocaleString()} pts
          </Badge>
        </div>
      </div>

      {/* CTA */}
      <Button size="lg" className="w-full shadow-lg shadow-eco-green/20" asChild>
        <Link to="/trip/new">
          <PlusCircle className="w-5 h-5" />
          Registra nuovo viaggio
        </Link>
      </Button>

      {/* Level card */}
      {profile && (() => {
        const lvl = getEcoLevel(profile.eco_score ?? 0)
        const isMax = lvl.maxPts === -1
        return (
          <div className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${lvl.bg} ${lvl.border}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-lg ${lvl.bg} border ${lvl.border}`}>
              <span className={`font-black text-lg ${lvl.color}`}>{lvl.level}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className={`text-sm font-bold ${lvl.color}`}>Liv. {lvl.level} — {lvl.name}</p>
                <p className="text-xs text-gray-400">{isMax ? 'Livello massimo!' : `${lvl.ptsToNext} pts al prossimo`}</p>
              </div>
              <div className="h-2 bg-white/60 rounded-full overflow-hidden">
                <div
                  className={`h-full ${lvl.progressColor} rounded-full transition-all duration-700`}
                  style={{ width: `${lvl.pct}%` }}
                />
              </div>
            </div>
          </div>
        )
      })()}

      {/* CO₂ equivalents banner */}
      {equiv && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-eco-green-light to-emerald-50 border border-eco-green/15 rounded-2xl px-4 py-3">
          <span className="text-3xl">{equiv.emoji}</span>
          <div>
            <p className="text-xs text-eco-teal font-medium">Il tuo impatto totale equivale a</p>
            <p className="text-base font-bold text-eco-teal">{equiv.text}</p>
          </div>
          <div className="ml-auto">
            <p className="text-xs text-gray-400 text-right">
              {formatCO2(totalCO2)}<br />
              <span className="text-eco-green font-medium">risparmiata</span>
            </p>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK_LINKS.map(({ to, icon: Icon, label, color }) => (
          <Link key={to} to={to}>
            <div className={`rounded-2xl p-3 flex flex-col items-center gap-1.5 transition-all hover:scale-105 ${color}`}>
              <Icon className="w-5 h-5" />
              <span className="text-[11px] font-semibold">{label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : (
          <>
            <StatCard label="CO₂ oggi" value={formatCO2(co2Today)} sub="risparmiata" icon={Leaf} color="bg-eco-green-light text-eco-green" />
            <StatCard label="CO₂ settimana" value={formatCO2(co2Week)} sub="ultimi 7 giorni" icon={TrendingUp} color="bg-blue-50 text-blue-600" />
            <StatCard label="CO₂ totale" value={formatCO2(totalCO2)} sub="dal primo giorno" icon={Award} color="bg-amber-50 text-amber-600" />
            <StatCard label="Streak" value={`${profile?.streak_days ?? 0} gg`} sub="giorni consecutivi" icon={Flame} color="bg-orange-50 text-orange-500" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent trips */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-eco-green" />
                Ultimi viaggi
              </CardTitle>
              <Link to="/trips">
                <Button variant="ghost" size="sm" className="text-eco-green gap-1">
                  Tutti <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
              </div>
            ) : trips.length === 0 ? (
              <div className="text-center py-10">
                <MapPin className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">Nessun viaggio ancora</p>
                <p className="text-sm text-gray-400 mb-4">Registra il tuo primo spostamento sostenibile!</p>
                <Button size="sm" asChild><Link to="/trip/new">Inizia ora</Link></Button>
              </div>
            ) : (
              <div>
                {trips.map(trip => <TripRow key={trip.id} trip={trip} />)}
                <Link to="/trips" className="block mt-3">
                  <Button variant="outline" size="sm" className="w-full">
                    Vedi tutti i viaggi <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Badges */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Award className="w-5 h-5 text-eco-green" />
                Badge
              </CardTitle>
              <Link to="/profile">
                <Button variant="ghost" size="sm" className="text-eco-green gap-1 text-xs">
                  Tutti <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
              </div>
            ) : badges.length === 0 ? (
              <div className="text-center py-6">
                <Award className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Completa viaggi per sbloccare badge!</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {badges.slice(0, 9).map(ub => (
                  <div
                    key={ub.id}
                    className="bg-eco-green-light rounded-xl p-2 flex flex-col items-center gap-1"
                    title={ub.badge?.name}
                  >
                    {ub.badge?.icon_name
                      ? <span className="text-2xl">{ub.badge.icon_name}</span>
                      : <Trophy className="w-6 h-6 text-amber-500" />
                    }
                    <p className="text-[10px] font-medium text-eco-teal text-center leading-tight line-clamp-2">
                      {ub.badge?.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Map — only shown when at least one trip has GPS coords */}
      {(() => {
        const tripsWithCoords = trips.filter(t => t.start_location?.lat && t.start_location?.lng)
        if (tripsWithCoords.length === 0) return null

        const mapCO2 = tripsWithCoords.reduce((s, t) => s + Number(t.co2_saved_kg), 0)
        const mapKm  = tripsWithCoords.reduce((s, t) => s + Number(t.distance_km), 0)
        const modesUsed = [...new Set(tripsWithCoords.map(t => t.transport_mode))]

        const MODE_COLORS_MAP: Record<string, string> = {
          walking: '#10b981', cycling: '#3b82f6', ebike: '#06b6d4', escooter: '#14b8a6',
          public_transport: '#8b5cf6', tram_metro: '#6366f1', train: '#0ea5e9',
          electric_vehicle: '#f59e0b', motorcycle: '#f97316', carpooling: '#ef4444',
        }

        return (
          <Card className="overflow-hidden rounded-2xl">
            {/* Map — full bleed, no padding */}
            <div className="relative rounded-2xl overflow-hidden">
              <EcoMap trips={tripsWithCoords} height="340px" />

              {/* Floating title pill — top left (z-index above Leaflet controls ~1000) */}
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 shadow-md border border-white/60" style={{ zIndex: 1100 }}>
                <MapPin className="w-4 h-4 text-eco-green flex-shrink-0" />
                <span className="text-sm font-bold text-gray-800">Percorsi recenti</span>
              </div>

              {/* Floating stats row — bottom, full width overlay */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-4 pb-3 pt-8" style={{ zIndex: 1100 }}>
                <div className="flex items-end justify-between flex-wrap gap-2">
                  {/* Mode legend */}
                  <div className="flex gap-1.5 flex-wrap">
                    {modesUsed.map(m => {
                      const meta = TRANSPORT_META[m]
                      return (
                        <span
                          key={m}
                          className="flex items-center gap-1 text-[10px] font-semibold text-white bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded-full border border-white/20"
                        >
                          <span
                            style={{ background: MODE_COLORS_MAP[m] ?? '#1D9E75' }}
                            className="w-2 h-2 rounded-full inline-block flex-shrink-0"
                          />
                          {meta.emoji} {meta.label}
                        </span>
                      )
                    })}
                  </div>

                  {/* Stats */}
                  <div className="flex gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-white bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/20">
                      <MapPin className="w-3 h-3" /> {tripsWithCoords.length} {tripsWithCoords.length === 1 ? 'percorso' : 'percorsi'}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-bold text-white bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/20">
                      <Route className="w-3 h-3" /> {formatDistance(mapKm)}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-bold text-white bg-eco-green/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-eco-green/40">
                      <Leaf className="w-3 h-3" /> {formatCO2(mapCO2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )
      })()}
    </div>
  )
}
