import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapPin, Leaf, Loader2, MessageCircle, UserPlus, Check, Users, Route, Zap, Flame, CheckCircle2, Sprout, Bike, Mountain, Globe, Star, Trophy, Medal, Search, Crown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  supabase, getFriendStatus, sendFriendRequest, createOrGetPrivateConversation,
} from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'

// ── Badge definitions (same as Shop.tsx) ─────────────────────────────────────

type BadgeMetric = 'trips' | 'km' | 'co2' | 'streak' | 'points'

interface ActivityBadge {
  id: string
  icon: LucideIcon
  color: string
  name: string
  desc: string
  threshold: number
  metric: BadgeMetric
}

const ACTIVITY_BADGES: ActivityBadge[] = [
  { id: 'first_trip', icon: Sprout,   color: 'text-emerald-500',  name: 'Primo passo',        desc: 'Registra il tuo primo viaggio',       threshold: 1,    metric: 'trips'  },
  { id: 'km_50',      icon: Bike,     color: 'text-blue-500',     name: 'Ciclista',           desc: 'Percorri 50 km totali',               threshold: 50,   metric: 'km'     },
  { id: 'km_100',     icon: Route,    color: 'text-indigo-500',   name: 'Esploratore',        desc: 'Percorri 100 km totali',              threshold: 100,  metric: 'km'     },
  { id: 'km_500',     icon: Mountain, color: 'text-slate-600',    name: 'Maratoneta Verde',   desc: 'Percorri 500 km totali',              threshold: 500,  metric: 'km'     },
  { id: 'co2_10',     icon: Leaf,     color: 'text-green-500',    name: 'Eco Warrior',        desc: 'Risparmia 10 kg CO₂',                 threshold: 10,   metric: 'co2'    },
  { id: 'co2_50',     icon: Globe,    color: 'text-teal-500',     name: 'Custode del Clima',  desc: 'Risparmia 50 kg CO₂',                 threshold: 50,   metric: 'co2'    },
  { id: 'streak_7',   icon: Flame,    color: 'text-orange-500',   name: 'Settimana Verde',    desc: '7 giorni di streak',                  threshold: 7,    metric: 'streak' },
  { id: 'streak_30',  icon: Zap,      color: 'text-yellow-500',   name: 'Mese Sostenibile',   desc: '30 giorni di streak',                 threshold: 30,   metric: 'streak' },
  { id: 'pts_1000',   icon: Star,     color: 'text-amber-500',    name: 'Eco Star',           desc: 'Raggiungi 1000 punti totali',         threshold: 1000, metric: 'points' },
  { id: 'pts_5000',   icon: Trophy,   color: 'text-yellow-600',   name: 'Eco Leggenda',       desc: 'Raggiungi 5000 punti totali',         threshold: 5000, metric: 'points' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicProfileData {
  username: string
  full_name: string | null
  avatar_url: string | null
  city: string | null
  bio: string | null
  eco_score: number
  total_co2_saved: number | null
  streak_days: number | null
  active_title: string | null
}

interface TripStats {
  tripCount: number
  totalKm: number
  totalCo2: number
}

interface ClubMembership {
  club_id: string
  role: string
  clubs: {
    id: string
    name: string
    description: string | null
    avatar_url: string | null
  } | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PublicProfile() {
  const { userId } = useParams<{ userId: string }>()
  const { user, profile: myProfile } = useAuth()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<PublicProfileData | null>(null)
  const [stats, setStats] = useState<TripStats>({ tripCount: 0, totalKm: 0, totalCo2: 0 })
  const [clubs, setClubs] = useState<ClubMembership[]>([])
  const [friendStatus, setFriendStatus] = useState<'none' | 'pending_sent' | 'pending_received' | 'friends'>('none')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setNotFound(false)

    // 1. Profile — use * to avoid failing on missing optional columns
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    // Only set notFound if there's genuinely no row (no error means the query ran fine)
    if (!profileData && !profileError) {
      setNotFound(true)
      setLoading(false)
      return
    }
    // If there's a query error (e.g. missing column), still try to show the page
    if (!profileData) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setProfile(profileData as PublicProfileData)

    // 2. Side data — each fails silently
    await Promise.allSettled([
      // trips (RLS blocks other users' data — returns empty array, not error)
      supabase
        .from('trips')
        .select('distance_km, co2_saved_kg')
        .eq('user_id', userId)
        .then(({ data: tripsData }) => {
          const trips = (tripsData ?? []) as { distance_km: number; co2_saved_kg: number }[]
          setStats({
            tripCount: trips.length,
            totalKm: trips.reduce((s, t) => s + Number(t.distance_km), 0),
            totalCo2: trips.reduce((s, t) => s + Number(t.co2_saved_kg), 0),
          })
        }),
      // clubs
      supabase
        .from('club_members')
        .select('club_id, role, clubs(id, name, description, avatar_url)')
        .eq('user_id', userId)
        .then(({ data: clubData }) => {
          setClubs((clubData ?? []) as unknown as ClubMembership[])
        }),
      // friend status
      (async () => {
        if (!user || user.id === userId) return
        try {
          const status = await getFriendStatus(user.id, userId)
          setFriendStatus(status)
        } catch { /* silent */ }
      })(),
    ])

    setLoading(false)
  }, [userId, user])

  useEffect(() => { load() }, [load])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleAddFriend = async () => {
    if (!user || !myProfile || !userId) return
    setActionLoading(true)
    try {
      await sendFriendRequest(user.id, userId, {
        username: myProfile.username,
        avatar_url: myProfile.avatar_url,
      })
      setFriendStatus('pending_sent')
    } catch { /* already sent */ }
    finally { setActionLoading(false) }
  }

  const handleChat = async () => {
    if (!user || !userId) return
    setActionLoading(true)
    try {
      const convId = await createOrGetPrivateConversation(user.id, userId)
      navigate(`/chat/${convId}`)
    } finally {
      setActionLoading(false)
    }
  }

  // ── Badge helpers ──────────────────────────────────────────────────────────

  const getValue = (metric: BadgeMetric): number => {
    if (!profile) return 0
    switch (metric) {
      case 'trips':  return stats.tripCount
      case 'km':     return stats.totalKm
      case 'co2':    return Number(profile.total_co2_saved ?? stats.totalCo2)
      case 'streak': return profile.streak_days ?? 0
      case 'points': return profile.eco_score ?? 0
    }
  }

  const unlockedBadges = ACTIVITY_BADGES.filter(b => getValue(b.metric) >= b.threshold)

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-5 pb-24 lg:pb-8">
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    )
  }

  if (notFound || !profile) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <Search className="w-16 h-16 text-gray-200 mx-auto mb-4" />
        <p className="text-lg font-semibold text-gray-700">Utente non trovato</p>
        <p className="text-sm text-gray-400 mt-1">Il profilo potrebbe essere stato rimosso o non esiste.</p>
        <Button className="mt-6" variant="outline" onClick={() => navigate(-1)}>Torna indietro</Button>
      </div>
    )
  }

  const isOwnProfile = user?.id === userId
  const initials = profile.username.slice(0, 2).toUpperCase()

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 lg:pb-8">

      {/* ── Header card ── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <Avatar className="w-20 h-20 border-4 border-eco-green/20 flex-shrink-0">
              {profile.avatar_url && <AvatarImage src={profile.avatar_url} />}
              <AvatarFallback className="text-2xl font-bold bg-eco-green-light text-eco-teal">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <p className="text-xl font-bold text-gray-900 truncate">
                {profile.full_name ?? profile.username}
              </p>
              <p className="text-sm text-gray-400">@{profile.username}</p>

              {profile.active_title && (
                <span className="inline-flex items-center gap-1 mt-1 bg-yellow-100 text-yellow-800 border border-yellow-300 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  <Crown className="w-3 h-3 text-yellow-600" /> {profile.active_title}
                </span>
              )}

              {profile.city && (
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-1.5">
                  <MapPin className="w-3 h-3" /> {profile.city}
                </p>
              )}

              {profile.bio && (
                <p className="text-sm text-gray-600 mt-2 italic leading-relaxed">{profile.bio}</p>
              )}

              {/* Eco score + badge count */}
              <div className="flex gap-4 mt-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-eco-green flex items-center gap-1 justify-center">
                    <Zap className="w-4 h-4" />{(profile.eco_score ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400">Eco score</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-amber-500">{unlockedBadges.length}</p>
                  <p className="text-xs text-gray-400">Badge</p>
                </div>
                {(profile.streak_days ?? 0) > 0 && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-orange-500 flex items-center gap-1 justify-center">
                      <Flame className="w-4 h-4" />{profile.streak_days}
                    </p>
                    <p className="text-xs text-gray-400">Streak</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Friend actions ── */}
          {!isOwnProfile && user && (
            <div className="flex gap-2 mt-4">
              {friendStatus === 'friends' ? (
                <>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-eco-green bg-eco-green-light px-3 py-1.5 rounded-full">
                    <Check className="w-3.5 h-3.5" /> Amici
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={actionLoading}
                    onClick={handleChat}
                  >
                    {actionLoading
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <MessageCircle className="w-3.5 h-3.5" />}
                    Chatta
                  </Button>
                </>
              ) : friendStatus === 'pending_sent' ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full">
                  <Check className="w-3.5 h-3.5" /> Richiesta inviata
                </span>
              ) : friendStatus === 'pending_received' ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-500 bg-blue-50 px-3 py-1.5 rounded-full">
                  Vuole essere tuo amico
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-300 text-blue-600 hover:bg-blue-50 gap-1.5"
                  disabled={actionLoading}
                  onClick={handleAddFriend}
                >
                  {actionLoading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <UserPlus className="w-3.5 h-3.5" />}
                  Aggiungi amico
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { Icon: Route,  color: 'text-indigo-500',  bg: 'bg-indigo-50',  label: 'Viaggi',          value: stats.tripCount.toLocaleString() },
          { Icon: Bike,   color: 'text-blue-500',    bg: 'bg-blue-50',    label: 'Km totali',        value: `${stats.totalKm.toFixed(1)} km` },
          { Icon: Leaf,   color: 'text-green-500',   bg: 'bg-green-50',   label: 'CO₂ risparmiata',  value: `${(Number(profile.total_co2_saved ?? stats.totalCo2)).toFixed(1)} kg` },
          { Icon: Flame,  color: 'text-orange-500',  bg: 'bg-orange-50',  label: 'Streak',           value: `${profile.streak_days ?? 0} gg` },
        ] as const).map(({ Icon, color, bg, label, value }) => (
          <Card key={label}>
            <CardContent className="p-4 text-center">
              <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center mx-auto mb-2`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <p className="text-base font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Club memberships ── */}
      {clubs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <Users className="w-4 h-4 text-eco-green" /> Club ({clubs.length})
          </h2>
          <div className="space-y-2">
            {clubs.map(m => {
              const club = m.clubs
              if (!club) return null
              return (
                <Card
                  key={m.club_id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/clubs/${club.id}`)}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <Avatar className="w-10 h-10 flex-shrink-0">
                      {club.avatar_url && <AvatarImage src={club.avatar_url} />}
                      <AvatarFallback className="text-sm bg-eco-green-light text-eco-teal font-bold">
                        {club.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{club.name}</p>
                      {club.description && (
                        <p className="text-xs text-gray-400 truncate">{club.description}</p>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full capitalize flex-shrink-0">
                      {m.role}
                    </span>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Badges grid ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          <Medal className="w-4 h-4 text-amber-500" /> Badge sbloccati ({unlockedBadges.length}/{ACTIVITY_BADGES.length})
        </h2>

        {unlockedBadges.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <Sprout className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Nessun badge sbloccato ancora</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {ACTIVITY_BADGES.map(badge => {
              const unlocked = getValue(badge.metric) >= badge.threshold
              return (
                <div
                  key={badge.id}
                  title={`${badge.name} — ${badge.desc}`}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${
                    unlocked
                      ? 'bg-gradient-to-br from-eco-green-light to-emerald-50 border-eco-green/30'
                      : 'bg-gray-50 border-gray-100 opacity-35 grayscale'
                  }`}
                >
                  <badge.icon className={`w-6 h-6 ${unlocked ? badge.color : 'text-gray-400'}`} />
                  <p className="text-[9px] font-semibold text-center leading-tight text-gray-700 line-clamp-2">
                    {badge.name}
                  </p>
                  {unlocked && (
                    <CheckCircle2 className="w-3 h-3 text-eco-green flex-shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Transport stats placeholder ── */}
      <div className="text-center py-2">
        <p className="text-xs text-gray-300 flex items-center justify-center gap-1.5">
          <Route className="w-3 h-3" />
          <Leaf className="w-3 h-3" />
          EcoTrack — profilo pubblico di @{profile.username}
        </p>
      </div>
    </div>
  )
}
