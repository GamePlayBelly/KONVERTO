import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, MapPin, Save, Leaf, TrendingUp, Route, Target, Swords, Check, X, Crown, UserPlus, MessageCircle, Trophy, Users, Sprout, Bike, Mountain, Globe, Flame, Zap, Star, Car, Sparkles, BarChart2 } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts'
import { useAuth } from '@/contexts/AuthContext'
import { getTrips, getAllBadges, getUserBadges, updateProfile, getChallenges, respondToChallenge, getUserPurchasedTitles, getFriends, createOrGetPrivateConversation, supabase } from '@/lib/supabase'
import { formatCO2, formatDistance, formatDate, getCO2Equivalents, TRANSPORT_META, getEcoLevel } from '@/lib/utils'
import type { Trip, Badge as BadgeType, UserBadge, Challenge, TransportMode } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { CityAutocomplete } from '@/components/CityAutocomplete'

// Usato nel picker "trasporto preferito" (solo modi eco/registrabili nel profilo)
const TRANSPORT_MODES: TransportMode[] = [
  'walking', 'cycling', 'ebike', 'escooter',
  'public_transport', 'tram_metro', 'train',
  'electric_vehicle', 'motorcycle', 'carpooling',
]

// Usato nei grafici breakdown (include tutti i modi compreso car/airplane)
const ALL_TRANSPORT_MODES: TransportMode[] = [
  ...TRANSPORT_MODES, 'car', 'airplane',
]

const MODE_COLORS: Record<TransportMode, string> = {
  walking:          '#10b981',
  cycling:          '#3b82f6',
  ebike:            '#06b6d4',
  escooter:         '#8b5cf6',
  public_transport: '#f59e0b',
  tram_metro:       '#a78bfa',
  train:            '#6366f1',
  electric_vehicle: '#22c55e',
  motorcycle:       '#f97316',
  carpooling:       '#ec4899',
  car:              '#6b7280',
  airplane:         '#0ea5e9',
}

function buildWeeklyChartData(trips: Trip[]) {
  const weeks: Record<string, { week: string; co2: number; km: number; pts: number }> = {}
  trips.forEach(t => {
    const date = new Date(t.recorded_at)
    const ws = new Date(date)
    const day = ws.getDay()
    ws.setDate(ws.getDate() - (day === 0 ? 6 : day - 1))
    const key = ws.toISOString().split('T')[0]
    if (!weeks[key]) weeks[key] = { week: formatDate(key), co2: 0, km: 0, pts: 0 }
    weeks[key].co2 += Number(t.co2_saved_kg)
    weeks[key].km += Number(t.distance_km)
    weeks[key].pts += t.eco_points
  })
  return Object.values(weeks).slice(-8).map(w => ({ ...w, co2: parseFloat(w.co2.toFixed(2)) }))
}

function buildHeatmapData(trips: Trip[]) {
  const tripsByDay: Record<string, number> = {}
  trips.forEach(t => {
    const day = t.recorded_at.split('T')[0]
    tripsByDay[day] = (tripsByDay[day] ?? 0) + 1
  })
  const today = new Date()
  const startDate = new Date(today)
  const dayOfWeek = startDate.getDay()
  startDate.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 15 * 7)
  const weeks: { date: string; count: number }[][] = []
  const cur = new Date(startDate)
  for (let w = 0; w < 16; w++) {
    const week: { date: string; count: number }[] = []
    for (let d = 0; d < 7; d++) {
      const dateStr = cur.toISOString().split('T')[0]
      week.push({ date: dateStr, count: tripsByDay[dateStr] ?? 0 })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

function buildTransportBreakdown(trips: Trip[]) {
  const past = trips.filter(t => t.recorded_at <= new Date().toISOString())
  const byMode: Record<TransportMode, { km: number; co2: number; count: number }> = {} as never
  ALL_TRANSPORT_MODES.forEach(m => { byMode[m] = { km: 0, co2: 0, count: 0 } })
  past.forEach(t => {
    if (byMode[t.transport_mode]) {
      byMode[t.transport_mode].km += Number(t.distance_km)
      byMode[t.transport_mode].co2 += Number(t.co2_saved_kg)
      byMode[t.transport_mode].count++
    }
  })
  return ALL_TRANSPORT_MODES.map(m => ({
    mode: m,
    label: TRANSPORT_META[m].label,
    emoji: TRANSPORT_META[m].emoji,
    color: MODE_COLORS[m],
    km: parseFloat(byMode[m].km.toFixed(1)),
    co2: parseFloat(byMode[m].co2.toFixed(2)),
    count: byMode[m].count,
  })).filter(d => d.count > 0)
}

const HEATMAP_COLORS = ['bg-gray-100', 'bg-eco-green/25', 'bg-eco-green/50', 'bg-eco-green/80', 'bg-eco-green']
const getHeatColor = (count: number) => HEATMAP_COLORS[Math.min(count, 4)]

const CHALLENGE_METRIC_LABELS: Record<string, string> = {
  eco_points: 'Punti eco',
  co2_saved: 'CO₂ risparmiata',
  distance_km: 'Km percorsi',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'In attesa', color: 'bg-yellow-100 text-yellow-700' },
  active: { label: 'Attiva', color: 'bg-eco-green-light text-eco-teal' },
  completed: { label: 'Terminata', color: 'bg-gray-100 text-gray-600' },
  rejected: { label: 'Rifiutata', color: 'bg-red-50 text-red-600' },
}

type Friend = { friendId: string; profile: { username: string; full_name: string | null; avatar_url: string | null; city: string | null; eco_score: number } }

export default function Profile() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [trips, setTrips] = useState<Trip[]>([])
  const [_allBadges, setAllBadges] = useState<BadgeType[]>([])
  const [userBadges, setUserBadges] = useState<UserBadge[]>([])
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [unlockedTitles, setUnlockedTitles] = useState<{ id: string; name: string; description: string | null }[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [chattingWith, setChattingWith] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const [editFullName, setEditFullName] = useState('')
  const [editCity, setEditCity] = useState('')
  const [editBio, setEditBio] = useState('')
  const [editTransport, setEditTransport] = useState<TransportMode | ''>('')
  const [editGoalKm, setEditGoalKm] = useState('')
  const [editActiveTitle, setEditActiveTitle] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      setEditFullName(profile.full_name ?? '')
      setEditCity(profile.city ?? '')
      setEditBio(profile.bio ?? '')
      setEditTransport(profile.preferred_transport ?? '')
      setEditGoalKm(String(profile.weekly_goal_km ?? ''))
      setEditActiveTitle(profile.active_title ?? null)
    }
  }, [profile])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [t, ab, ub, ch, titles, fr] = await Promise.all([
        getTrips(user.id, 200),
        getAllBadges(),
        getUserBadges(user.id),
        getChallenges(user.id),
        getUserPurchasedTitles(user.id),
        getFriends(user.id),
      ])
      setTrips(t)
      setAllBadges(ab)
      setUserBadges(ub)
      setChallenges(ch)
      setUnlockedTitles(titles)
      setFriends(fr)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    setSaveMsg('')
    try {
      await updateProfile(user.id, {
        full_name: editFullName.trim() || null,
        city: editCity.trim() || null,
        bio: editBio.trim() || null,
        preferred_transport: (editTransport as TransportMode) || null,
        weekly_goal_km: editGoalKm ? parseFloat(editGoalKm) : null,
        active_title: editActiveTitle || null,
      })
      await refreshProfile()
      setSaveMsg('Profilo aggiornato!')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? ''
      if (msg.includes('check') || msg.includes('23514') || msg.includes('transport')) {
        setSaveMsg('Errore: mezzo non valido per il profilo. Seleziona un mezzo eco-compatibile.')
      } else {
        setSaveMsg(`Errore nel salvataggio${msg ? ': ' + msg : ''}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploading(true)
    setUploadError('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${user.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (uploadErr) {
        if (uploadErr.message?.includes('Bucket not found') || uploadErr.message?.includes('bucket')) {
          throw new Error('Bucket "avatars" non trovato. Esegui il file supabase_storage_setup.sql nel tuo progetto Supabase.')
        }
        throw uploadErr
      }
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      await updateProfile(user.id, { avatar_url: publicUrl })
      await refreshProfile()
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Errore nel caricamento immagine')
    } finally {
      setUploading(false)
    }
  }

  const handleChallengeResponse = async (challengeId: string, accept: boolean) => {
    const challenge = challenges.find(c => c.id === challengeId)
    await respondToChallenge(
      challengeId,
      accept,
      challenge?.challenger_id,
      profile?.username,
    )
    setChallenges(prev => prev.map(c => c.id === challengeId
      ? { ...c, status: accept ? 'active' : 'rejected' }
      : c
    ))
  }

  const chartData = buildWeeklyChartData(trips)
  const heatmapData = buildHeatmapData(trips)
  const transportBreakdown = buildTransportBreakdown(trips)
  const totalKm = trips.filter(t => t.recorded_at <= new Date().toISOString()).reduce((s, t) => s + Number(t.distance_km), 0)
  const totalCO2 = Number(profile?.total_co2_saved ?? 0)
  const co2Eq = totalCO2 > 0 ? getCO2Equivalents(totalCO2) : null
  const initials = profile?.username?.slice(0, 2).toUpperCase() ?? 'EC'

  const weeklyGoal = profile?.weekly_goal_km ?? 0
  const thisWeekKm = trips
    .filter(t => {
      const d = new Date(t.recorded_at)
      const wd = d.getDay()
      const monday = new Date(d)
      monday.setDate(d.getDate() - (wd === 0 ? 6 : wd - 1))
      const weekStart = monday.toISOString().split('T')[0]
      return t.recorded_at >= weekStart && t.recorded_at <= new Date().toISOString()
    })
    .reduce((s, t) => s + Number(t.distance_km), 0)
  const weeklyProgress = weeklyGoal > 0 ? Math.min((thisWeekKm / weeklyGoal) * 100, 100) : 0

  const pendingChallenges = challenges.filter(c => c.status === 'pending' && c.challenged_id === user?.id)

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20 lg:pb-6">
      <h1 className="text-2xl font-bold text-gray-900">Il mio profilo</h1>

      {/* Pending challenges alert */}
      {pendingChallenges.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2 animate-fade-in">
          <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
            <Swords className="w-4 h-4" />
            {pendingChallenges.length} sfid{pendingChallenges.length === 1 ? 'a' : 'e'} in attesa
          </p>
          {pendingChallenges.map(c => (
            <div key={c.id} className="flex items-center gap-2 bg-white border border-amber-100 rounded-xl p-2.5">
              <div className="flex-1 text-xs text-gray-600">
                <span className="font-semibold">{c.challenger?.full_name ?? c.challenger?.username}</span>
                {' '}ti sfida su{' '}
                <span className="font-medium">{CHALLENGE_METRIC_LABELS[c.metric]}</span>
                {' '}per {c.duration_days} giorni
              </div>
              <button onClick={() => handleChallengeResponse(c.id, true)} className="p-1.5 bg-eco-green text-white rounded-lg hover:bg-eco-teal transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleChallengeResponse(c.id, false)} className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Profile card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="relative">
              <Avatar className="w-20 h-20 border-4 border-eco-green/20">
                {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
                <AvatarFallback className="text-2xl font-bold">{initials}</AvatarFallback>
              </Avatar>
              <label
                htmlFor="avatar-upload"
                className="absolute -bottom-1 -right-1 w-8 h-8 bg-eco-green rounded-full flex items-center justify-center cursor-pointer shadow-md hover:bg-eco-teal transition-colors"
              >
                {uploading
                  ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Camera className="w-4 h-4 text-white" />}
                <input id="avatar-upload" type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </label>
            </div>
            <div className="flex-1 min-w-0">
              {uploadError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1 mb-2">{uploadError}</p>
              )}
              <p className="text-xl font-bold text-gray-900">{profile?.full_name ?? profile?.username}</p>
              <p className="text-gray-500 text-sm">@{profile?.username}</p>
              {profile?.active_title && (
                <span className="inline-flex items-center gap-1 mt-1 bg-yellow-100 text-yellow-800 border border-yellow-300 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                  <Crown className="w-3 h-3" /> {profile.active_title}
                </span>
              )}
              {profile?.city && (
                <p className="text-gray-400 text-xs flex items-center gap-1 mt-1">
                  <MapPin className="w-3 h-3" /> {profile.city}
                </p>
              )}
              {profile?.bio && (
                <p className="text-sm text-gray-600 mt-2 italic">{profile.bio}</p>
              )}
              {profile?.preferred_transport && (
                <p className="text-xs text-gray-500 mt-1">
                  Trasporto preferito: {TRANSPORT_META[profile.preferred_transport].emoji} {TRANSPORT_META[profile.preferred_transport].label}
                </p>
              )}
              <div className="flex gap-4 mt-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-eco-green">{(profile?.eco_score ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-400">Punti</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-eco-green">{trips.filter(t => t.recorded_at <= new Date().toISOString()).length}</p>
                  <p className="text-xs text-gray-400">Viaggi</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-eco-green">{userBadges.length}</p>
                  <p className="text-xs text-gray-400">Badge</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-orange-500">{profile?.streak_days ?? 0}</p>
                  <p className="text-xs text-gray-400">Streak</p>
                </div>
              </div>

              {/* Level progress */}
              {profile && (() => {
                const lvl = getEcoLevel(profile.eco_score ?? 0)
                const isMax = lvl.maxPts === -1
                return (
                  <div className={`mt-3 rounded-xl border px-3 py-2 ${lvl.bg} ${lvl.border}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className={`text-xs font-bold ${lvl.color}`}>
                        Livello {lvl.level} — {lvl.name}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {isMax ? 'Max' : `${lvl.ptsToNext} pts al prossimo`}
                      </p>
                    </div>
                    <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
                      <div className={`h-full ${lvl.progressColor} rounded-full transition-all duration-700`} style={{ width: `${lvl.pct}%` }} />
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weekly goal */}
      {weeklyGoal > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-eco-green" /> Obiettivo settimanale
              </p>
              <p className="text-sm font-bold text-eco-green">{thisWeekKm.toFixed(1)} / {weeklyGoal} km</p>
            </div>
            <Progress value={weeklyProgress} className="h-2" />
            {weeklyProgress >= 100 && (
              <p className="text-xs text-eco-green font-semibold mt-1.5 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Obiettivo raggiunto questa settimana!</p>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="w-full grid grid-cols-5">
          <TabsTrigger value="overview" className="text-xs px-1">Stats</TabsTrigger>
          <TabsTrigger value="edit" className="text-xs px-1">Modifica</TabsTrigger>
          <TabsTrigger value="badges" className="text-xs px-1">Badge</TabsTrigger>
          <TabsTrigger value="challenges" className="text-xs px-1 relative">
            Sfide{(challenges ?? []).filter(c => c.status === 'active').length > 0 && (
              <span className="ml-1 w-4 h-4 bg-eco-green text-white text-[9px] rounded-full inline-flex items-center justify-center">
                {(challenges ?? []).filter(c => c.status === 'active').length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="friends" className="text-xs px-1 relative">
            Amici{friends.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-blue-500 text-white text-[9px] rounded-full inline-flex items-center justify-center">
                {friends.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Panoramica ── */}
        <TabsContent value="overview" className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
            ) : (
              <>
                <Card><CardContent className="p-4 text-center">
                  <Leaf className="w-5 h-5 text-eco-green mx-auto mb-1" />
                  <p className="text-base font-bold text-gray-900">{formatCO2(totalCO2)}</p>
                  <p className="text-xs text-gray-400">CO₂ risparmiata</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <Route className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                  <p className="text-base font-bold text-gray-900">{formatDistance(totalKm)}</p>
                  <p className="text-xs text-gray-400">Km percorsi</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <TrendingUp className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                  <p className="text-base font-bold text-gray-900">{profile?.streak_days ?? 0} gg</p>
                  <p className="text-xs text-gray-400">Streak</p>
                </CardContent></Card>
              </>
            )}
          </div>

          {/* CO₂ equivalents */}
          {co2Eq && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Il tuo impatto — CO₂ risparmiata</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: <Car className="w-6 h-6 text-orange-500" />, label: 'km non in auto', value: co2Eq.kmCar.toLocaleString() },
                    { icon: <Leaf className="w-6 h-6 text-eco-green" />, label: 'alberi equivalenti', value: co2Eq.trees },
                    { icon: <Zap className="w-6 h-6 text-amber-500" />, label: 'caffè risparmiati', value: co2Eq.coffees.toLocaleString() },
                    { icon: <Zap className="w-6 h-6 text-blue-500" />, label: 'cariche smartphone', value: co2Eq.phones.toLocaleString() },
                  ].map(({ icon, label, value }) => (
                    <div key={label} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                      {icon}
                      <div>
                        <p className="text-sm font-bold text-gray-900">{value}</p>
                        <p className="text-xs text-gray-400">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Activity heatmap */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Attività — ultime 16 settimane</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="flex gap-1 min-w-max">
                  {/* Day labels */}
                  <div className="flex flex-col gap-1 mr-1 pt-0">
                    {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => (
                      <div key={i} className="w-3.5 h-3.5 flex items-center justify-center text-[9px] text-gray-400">{d}</div>
                    ))}
                  </div>
                  {heatmapData.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-1">
                      {week.map((day, di) => (
                        <div
                          key={di}
                          className={`w-3.5 h-3.5 rounded-sm ${getHeatColor(day.count)} transition-colors`}
                          title={`${day.date}: ${day.count} viaggio/i`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 mt-2 text-[10px] text-gray-400">
                <span>Meno</span>
                {HEATMAP_COLORS.map((c, i) => (
                  <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
                ))}
                <span>Di più</span>
              </div>
            </CardContent>
          </Card>

          {/* Transport breakdown */}
          {transportBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Mezzo di trasporto</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={transportBreakdown} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <XAxis dataKey="emoji" tick={{ fontSize: 16 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 11 }}
                      formatter={(v: number, name: string) => [name === 'km' ? `${v} km` : `${v} viaggi`, name]}
                    />
                    <Bar dataKey="km" radius={[6, 6, 0, 0]}>
                      {transportBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {transportBreakdown.map(d => (
                    <p key={d.mode} className="text-xs text-gray-500">
                      {d.emoji} {d.count} viaggio/i · {d.km} km
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Weekly CO₂ chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">CO₂ risparmiata per settimana</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={140}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="co2Gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1D9E75" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#1D9E75" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} unit=" kg" width={40} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 11 }}
                      formatter={(v: number) => [`${v} kg CO₂`, 'Risparmio']}
                    />
                    <Area type="monotone" dataKey="co2" stroke="#1D9E75" strokeWidth={2} fill="url(#co2Gradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Edit ── */}
        <TabsContent value="edit">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Nome completo</Label>
                <Input id="fullName" value={editFullName} onChange={e => setEditFullName(e.target.value)} placeholder="Il tuo nome" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">Città</Label>
                <CityAutocomplete id="city" value={editCity} onChange={setEditCity} placeholder="Es. Milano" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  placeholder="Parlaci di te e del tuo impegno per l'ambiente..."
                  rows={3}
                  className="resize-none"
                />
              </div>
              <div className="space-y-2">
                <Label>Trasporto preferito</Label>
                <div className="grid grid-cols-5 gap-2">
                  {TRANSPORT_MODES.map(m => {
                    const meta = TRANSPORT_META[m]
                    const active = editTransport === m
                    return (
                      <button
                        key={m}
                        type="button"
                        title={meta.label}
                        onClick={() => setEditTransport(active ? '' : m)}
                        className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                          active
                            ? 'border-eco-green bg-eco-green-light shadow-sm'
                            : 'border-gray-100 hover:border-eco-green/40 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-xl">{meta.emoji}</span>
                        <span className="text-[9px] text-gray-500 font-medium text-center leading-tight">{meta.label.split(' ')[0]}</span>
                      </button>
                    )
                  })}
                </div>
                {editTransport && (
                  <p className="text-xs text-eco-teal font-medium flex items-center gap-1">
                    {TRANSPORT_META[editTransport].emoji} {TRANSPORT_META[editTransport].label} selezionato
                  </p>
                )}
              </div>
              {/* Titles selector */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-yellow-500" /> Titolo attivo
                </Label>
                {unlockedTitles.length === 0 ? (
                  <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-400">Nessun titolo sbloccato</p>
                    <p className="text-xs text-gray-400 mt-0.5">Acquistali nell'<span className="text-eco-green font-medium flex items-center gap-0.5 inline-flex">EcoShop <Crown className="w-3 h-3 text-yellow-500" /></span></p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setEditActiveTitle(null)}
                      className={`w-full text-left text-xs px-3 py-2 rounded-xl border-2 transition-all ${
                        !editActiveTitle ? 'border-gray-300 bg-gray-50 font-semibold text-gray-600' : 'border-gray-100 text-gray-400 hover:border-gray-200'
                      }`}
                    >
                      Nessun titolo
                    </button>
                    {unlockedTitles.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setEditActiveTitle(t.name)}
                        className={`w-full text-left px-3 py-2 rounded-xl border-2 transition-all ${
                          editActiveTitle === t.name
                            ? 'border-yellow-400 bg-yellow-50 shadow-sm'
                            : 'border-gray-100 hover:border-yellow-200 hover:bg-yellow-50/40'
                        }`}
                      >
                        <span className="text-sm font-semibold text-gray-800">{t.name}</span>
                        {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="goalKm" className="flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-eco-green" />
                  Obiettivo km settimanali
                </Label>
                <Input
                  id="goalKm"
                  type="number"
                  min="0"
                  step="5"
                  value={editGoalKm}
                  onChange={e => setEditGoalKm(e.target.value)}
                  placeholder="Es. 50"
                />
              </div>
              {saveMsg && (
                <p className={`text-sm font-medium ${saveMsg.includes('Errore') ? 'text-red-600' : 'text-eco-green'}`}>{saveMsg}</p>
              )}
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving
                  ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Salvataggio...</span>
                  : <><Save className="w-4 h-4" /> Salva modifiche</>}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Badges ── */}
        <TabsContent value="badges">
          {(() => {
            type BadgeMetric = 'trips' | 'km' | 'co2' | 'streak' | 'points'
            interface ActivityBadge {
              id: string; icon: React.ReactNode; name: string; desc: string
              threshold: number; metric: BadgeMetric
            }
            const ACTIVITY_BADGES: ActivityBadge[] = [
              { id: 'first_trip', icon: <Sprout className="w-6 h-6 text-eco-green" />,   name: 'Primo passo',       desc: 'Registra il tuo primo viaggio',      threshold: 1,    metric: 'trips'  },
              { id: 'km_50',      icon: <Bike className="w-6 h-6 text-blue-500" />,       name: 'Ciclista',          desc: 'Percorri 50 km totali',              threshold: 50,   metric: 'km'     },
              { id: 'km_100',     icon: <Route className="w-6 h-6 text-indigo-500" />,    name: 'Esploratore',       desc: 'Percorri 100 km totali',             threshold: 100,  metric: 'km'     },
              { id: 'km_500',     icon: <Mountain className="w-6 h-6 text-purple-500" />, name: 'Maratoneta Verde',  desc: 'Percorri 500 km totali',             threshold: 500,  metric: 'km'     },
              { id: 'co2_10',     icon: <Leaf className="w-6 h-6 text-eco-green" />,      name: 'Eco Warrior',       desc: 'Risparmia 10 kg CO₂',                threshold: 10,   metric: 'co2'    },
              { id: 'co2_50',     icon: <Globe className="w-6 h-6 text-teal-500" />,      name: 'Custode del Clima', desc: 'Risparmia 50 kg CO₂',                threshold: 50,   metric: 'co2'    },
              { id: 'streak_7',   icon: <Flame className="w-6 h-6 text-orange-500" />,    name: 'Settimana Verde',   desc: '7 giorni di streak',                 threshold: 7,    metric: 'streak' },
              { id: 'streak_30',  icon: <Zap className="w-6 h-6 text-amber-500" />,       name: 'Mese Sostenibile',  desc: '30 giorni di streak',                threshold: 30,   metric: 'streak' },
              { id: 'pts_1000',   icon: <Star className="w-6 h-6 text-yellow-500" />,     name: 'Eco Star',          desc: 'Raggiungi 1000 punti totali',        threshold: 1000, metric: 'points' },
              { id: 'pts_5000',   icon: <Trophy className="w-6 h-6 text-amber-500" />,    name: 'Eco Leggenda',      desc: 'Raggiungi 5000 punti totali',        threshold: 5000, metric: 'points' },
            ]

            const tripCount = trips.filter(t => t.recorded_at <= new Date().toISOString()).length

            const getValue = (metric: BadgeMetric): number => {
              switch (metric) {
                case 'trips':  return tripCount
                case 'km':     return totalKm
                case 'co2':    return Number(profile?.total_co2_saved ?? 0)
                case 'streak': return profile?.streak_days ?? 0
                case 'points': return profile?.eco_score ?? 0
              }
            }

            const unlocked = ACTIVITY_BADGES.filter(b => getValue(b.metric) >= b.threshold)
            const locked   = ACTIVITY_BADGES.filter(b => getValue(b.metric) < b.threshold)

            if (loading) {
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
                </div>
              )
            }

            return (
              <div className="space-y-5">
                {/* Unlocked */}
                {unlocked.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-2 h-2 bg-eco-green rounded-full" /> Sbloccati ({unlocked.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {unlocked.map(badge => {
                        const current = getValue(badge.metric)
                        return (
                          <div
                            key={badge.id}
                            className="bg-gradient-to-br from-eco-green-light to-emerald-50 border border-eco-green/30 rounded-2xl p-4 flex items-start gap-3"
                          >
                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm border border-eco-green/20">
                              {badge.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-bold text-gray-900">{badge.name}</p>
                                <span className="text-[10px] bg-eco-green text-white rounded-full px-2 py-0.5 font-semibold flex items-center gap-0.5">
                                  ✓ Sbloccato
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">{badge.desc}</p>
                              <div className="mt-2 h-1.5 bg-eco-green/20 rounded-full overflow-hidden">
                                <div className="h-full bg-eco-green rounded-full w-full" />
                              </div>
                              <p className="text-[10px] text-eco-teal font-medium mt-1">
                                {current >= badge.threshold ? badge.threshold : current}/{badge.threshold} — 100%
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Locked / in progress */}
                {locked.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-2 h-2 bg-gray-300 rounded-full" /> In corso ({locked.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {locked.map(badge => {
                        const current = Math.min(getValue(badge.metric), badge.threshold)
                        const pct = badge.threshold > 0 ? Math.round((current / badge.threshold) * 100) : 0
                        const missing = badge.threshold - current
                        return (
                          <div
                            key={badge.id}
                            className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start gap-3"
                          >
                            <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm border border-gray-100 grayscale opacity-60">
                              {badge.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-bold text-gray-700">{badge.name}</p>
                                <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-medium">
                                  {current}/{badge.threshold}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5">{badge.desc}</p>
                              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-gray-300 to-gray-400 rounded-full transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-gray-400 font-medium mt-1">
                                Mancano {missing} — {pct}%
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </TabsContent>

        {/* ── Challenges ── */}
        <TabsContent value="challenges">
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
            ) : challenges.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <Swords className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">Nessuna sfida ancora</p>
                <p className="text-sm text-gray-400">Vai alla classifica e sfida un utente!</p>
              </CardContent></Card>
            ) : (
              challenges.map(c => {
                const isChallenger = c.challenger_id === user?.id
                const opponent = isChallenger ? c.challenged : c.challenger
                const myScore = isChallenger ? c.challenger_score : c.challenged_score
                const theirScore = isChallenger ? c.challenged_score : c.challenger_score
                const status = STATUS_LABELS[c.status] ?? { label: c.status, color: 'bg-gray-100 text-gray-600' }
                const initials = (opponent?.username ?? 'XX').slice(0, 2).toUpperCase()
                const isWinner = c.winner_id === user?.id

                return (
                  <Card key={c.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-10 h-10 flex-shrink-0">
                          {opponent?.avatar_url && <img src={opponent.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />}
                          <AvatarFallback className="text-xs bg-gray-100">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900">
                              {isChallenger ? 'Sfida vs ' : 'Sfidato da '}
                              {opponent?.full_name ?? opponent?.username ?? 'Utente'}
                            </p>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${status.color}`}>
                              {status.label}
                            </span>
                            {c.status === 'completed' && isWinner && (
                              <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5"><Trophy className="w-3 h-3" /> Hai vinto!</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {CHALLENGE_METRIC_LABELS[c.metric]} · {c.duration_days} giorni
                          </p>
                          {c.status === 'active' && (
                            <div className="flex items-center gap-3 mt-1.5 text-xs">
                              <span className="font-bold text-eco-green">{myScore.toFixed(1)} tu</span>
                              <span className="text-gray-300">vs</span>
                              <span className="font-bold text-gray-600">{theirScore.toFixed(1)} loro</span>
                              <span className="text-gray-400">· fino al {formatDate(c.end_date)}</span>
                            </div>
                          )}
                        </div>
                        {/* Accept/reject for pending challenges where we're challenged */}
                        {c.status === 'pending' && !isChallenger && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => handleChallengeResponse(c.id, true)} className="p-1.5 bg-eco-green text-white rounded-lg hover:bg-eco-teal">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleChallengeResponse(c.id, false)} className="p-1.5 bg-red-50 text-red-500 rounded-lg hover:bg-red-100">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </TabsContent>

        {/* ── Amici ── */}
        <TabsContent value="friends" className="space-y-4">
          {friends.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center space-y-3">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
                  <Users className="w-8 h-8 text-blue-400" />
                </div>
                <p className="font-semibold text-gray-900">Nessun amico ancora</p>
                <p className="text-sm text-gray-500">Vai in Classifica e premi il pulsante <UserPlus className="inline w-4 h-4" /> accanto agli utenti per aggiungere amici!</p>
                <button
                  onClick={() => navigate('/leaderboard')}
                  className="mt-2 px-4 py-2 bg-eco-green text-white text-sm font-semibold rounded-xl hover:bg-eco-teal transition-colors flex items-center gap-1.5 mx-auto"
                >
                  <Trophy className="w-4 h-4" /> Vai alla Classifica
                </button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Banner ranking tra amici */}
              {(() => {
                const sorted = [...friends].sort((a, b) => b.profile.eco_score - a.profile.eco_score)
                const myScore = profile?.eco_score ?? 0
                const myRank = sorted.filter(f => f.profile.eco_score > myScore).length + 1
                const total = friends.length + 1
                const topFriend = sorted[0]
                const diff = topFriend ? Math.abs(myScore - topFriend.profile.eco_score) : 0
                return (
                  <div className={`rounded-2xl p-4 border ${myRank === 1 ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200' : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${myRank === 1 ? 'bg-amber-100' : 'bg-blue-100'}`}>
                        {myRank === 1 ? <Trophy className="w-6 h-6 text-amber-500" /> : myRank === 2 ? <span className="text-lg font-bold text-gray-500">2°</span> : myRank === 3 ? <span className="text-lg font-bold text-amber-700">3°</span> : <BarChart2 className="w-6 h-6 text-blue-500" />}
                      </div>
                      <div>
                        <p className={`font-bold text-sm ${myRank === 1 ? 'text-amber-800' : 'text-blue-900'}`}>
                          {myRank === 1
                            ? <span className="flex items-center gap-1">Sei il migliore tra i tuoi amici! <Sparkles className="w-4 h-4 text-amber-500" /></span>
                            : `Sei #${myRank} su ${total} tra i tuoi amici`}
                        </p>
                        <p className={`text-xs mt-0.5 ${myRank === 1 ? 'text-amber-600' : 'text-blue-600'}`}>
                          {myRank === 1
                            ? `${diff > 0 ? `Sei avanti di ${diff} punti su ${topFriend?.profile.full_name ?? topFriend?.profile.username}` : 'Continua così!'}`
                            : `Mancano ${diff} punti per superare ${topFriend?.profile.full_name ?? topFriend?.profile.username}`}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Lista amici ordinata per eco_score — include l'utente corrente */}
              <div className="space-y-2">
                {(() => {
                  const myScore = profile?.eco_score ?? 0
                  type FriendEntry = { friendId: string; isMe?: boolean; profile: { full_name: string | null; username: string; avatar_url: string | null; eco_score: number } }
                  const meEntry: FriendEntry = {
                    friendId: user?.id ?? '__me__',
                    isMe: true,
                    profile: {
                      full_name: profile?.full_name ?? null,
                      username: profile?.username ?? 'Tu',
                      avatar_url: profile?.avatar_url ?? null,
                      eco_score: myScore,
                    },
                  }
                  const combined: FriendEntry[] = [...friends, meEntry].sort((a, b) => b.profile.eco_score - a.profile.eco_score)
                  return combined.map((f, i) => {
                    const isMe = f.isMe === true
                    const init = f.profile.username.slice(0, 2).toUpperCase()
                    const diff = isMe ? 0 : f.profile.eco_score - myScore
                    const isAhead = diff > 0
                    const medal = i === 0 ? '1°' : i === 1 ? '2°' : i === 2 ? '3°' : null
                    return (
                      <Card key={f.friendId} className={`hover:shadow-sm transition-shadow ${isMe ? 'ring-2 ring-eco-green ring-offset-1' : ''}`}>
                        <CardContent className="p-3 flex items-center gap-3">
                          {/* Rank badge */}
                          <span className="w-7 text-center text-sm font-bold text-gray-600 flex-shrink-0">
                            {medal ?? <span className="text-xs text-gray-400">#{i + 1}</span>}
                          </span>

                          {/* Avatar */}
                          <Avatar className={`w-10 h-10 flex-shrink-0 border-2 ${isMe ? 'border-eco-green' : 'border-blue-100'}`}>
                            {f.profile.avatar_url && <AvatarImage src={f.profile.avatar_url} />}
                            <AvatarFallback className={`text-xs font-bold ${isMe ? 'bg-eco-green-light text-eco-green' : 'bg-blue-50 text-blue-600'}`}>{init}</AvatarFallback>
                          </Avatar>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-gray-900 truncate">
                                {f.profile.full_name ?? f.profile.username}
                              </p>
                              {isMe && (
                                <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-eco-green text-white">TU</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="flex items-center gap-0.5 text-xs font-bold text-eco-green">
                                <Leaf className="w-3 h-3" />{f.profile.eco_score.toLocaleString()} pts
                              </span>
                              {!isMe && diff !== 0 && (
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${isAhead ? 'bg-red-50 text-red-500' : 'bg-eco-green-light text-eco-teal'}`}>
                                  {isAhead ? `+${diff} su di te` : `-${Math.abs(diff)} da te`}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions — solo per gli amici, non per "TU" */}
                          {isMe ? (
                            <div className="flex-shrink-0 w-[4.25rem]" />
                          ) : (
                            <div className="flex gap-1.5 flex-shrink-0">
                              <button
                                onClick={async () => {
                                  if (!user || chattingWith === f.friendId) return
                                  setChattingWith(f.friendId)
                                  try {
                                    const convId = await createOrGetPrivateConversation(user.id, f.friendId)
                                    navigate(`/chat/${convId}`)
                                  } finally {
                                    setChattingWith(null)
                                  }
                                }}
                                disabled={chattingWith === f.friendId}
                                title="Scrivi"
                                className="w-8 h-8 rounded-xl bg-eco-green-light text-eco-green hover:bg-eco-green hover:text-white transition-colors flex items-center justify-center disabled:opacity-50"
                              >
                                {chattingWith === f.friendId
                                  ? <span className="w-3 h-3 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
                                  : <MessageCircle className="w-4 h-4" />}
                              </button>
                              <button
                                title="Classifica"
                                onClick={() => navigate('/leaderboard')}
                                className="w-8 h-8 rounded-xl bg-amber-50 text-amber-500 hover:bg-amber-500 hover:text-white transition-colors flex items-center justify-center"
                              >
                                <Trophy className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })
                })()}
              </div>

              <p className="text-center text-xs text-gray-400 pt-1">
                {friends.length} {friends.length === 1 ? 'amico' : 'amici'} · Vai in{' '}
                <button onClick={() => navigate('/leaderboard')} className="text-eco-green underline">Classifica</button>{' '}
                per aggiungerne altri
              </p>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
