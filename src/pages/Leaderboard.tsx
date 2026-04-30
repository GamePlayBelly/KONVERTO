import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Trophy, Crown, Medal, Swords, UserPlus, Check, X,
  Leaf, Zap, MapPin, Flame, TrendingUp, ChevronUp,
  Users, Globe, ArrowUp, Clock, Gift, RefreshCw,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getMonthlyLeaderboard, getAllTimeLeaderboard, createChallenge, sendFriendRequest, awardPeriodBonuses } from '@/lib/supabase'
import { formatCO2, formatPoints, getEcoLevel } from '@/lib/utils'
import type { ChallengeMetric } from '@/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileShape = {
  username: string
  full_name: string | null
  avatar_url: string | null
  city: string | null
  eco_score?: number
  streak_days?: number
}

type RankedEntry = {
  user_id: string
  total_points: number
  total_co2_saved?: number
  profile: ProfileShape
}

type Period = 'monthly' | 'alltime'

const METRIC_LABELS: Record<ChallengeMetric, { label: string; icon: React.ReactNode }> = {
  eco_points:  { label: 'Punti eco',       icon: <Zap  className="w-4 h-4 text-yellow-500" /> },
  co2_saved:   { label: 'CO₂ risparmiata', icon: <Leaf className="w-4 h-4 text-eco-green"  /> },
  distance_km: { label: 'Km percorsi',     icon: <TrendingUp className="w-4 h-4 text-blue-500" /> },
}

// ── Rolling 30-day period helpers ────────────────────────────────────────────

const PERIOD_MS   = 30 * 24 * 60 * 60 * 1000            // 30 days in ms
const PERIOD_EPOCH = new Date('2025-01-01T00:00:00Z')    // fixed reference point

function getCurrentPeriodIdx(): number {
  return Math.floor((Date.now() - PERIOD_EPOCH.getTime()) / PERIOD_MS)
}

function getPeriodStart(idx?: number): Date {
  const n = idx ?? getCurrentPeriodIdx()
  return new Date(PERIOD_EPOCH.getTime() + n * PERIOD_MS)
}

function getPeriodEnd(idx?: number): Date {
  const n = idx ?? getCurrentPeriodIdx()
  return new Date(PERIOD_EPOCH.getTime() + (n + 1) * PERIOD_MS)
}

function formatPeriodDeadline(): string {
  const end = getPeriodEnd()
  return end.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })
}

function getDaysLeft(): number {
  const diffMs = getPeriodEnd().getTime() - Date.now()
  return Math.max(0, Math.ceil(diffMs / 86400000))
}

function getHoursLeft(): number {
  const diffMs = getPeriodEnd().getTime() - Date.now()
  return Math.max(0, Math.floor(diffMs / 3600000))
}

// ── Challenge Modal ───────────────────────────────────────────────────────────

function ChallengeModal({ target, userId, userProfile, onClose }: {
  target: RankedEntry
  userId: string
  userProfile?: { username: string; avatar_url: string | null } | null
  onClose: () => void
}) {
  const [metric, setMetric] = useState<ChallengeMetric>('eco_points')
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    setLoading(true)
    try {
      await createChallenge({
        challenger_id: userId,
        challenged_id: target.user_id,
        metric,
        duration_days: days,
        challenger_username: userProfile?.username,
        challenger_avatar: userProfile?.avatar_url,
      })
      setSent(true)
      setTimeout(onClose, 1800)
    } catch { /* silent */ } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-6 space-y-3">
            <div className="w-16 h-16 bg-gradient-to-br from-eco-green to-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-eco-green/30">
              <Check className="w-8 h-8 text-white" />
            </div>
            <p className="font-bold text-gray-900 text-lg">Sfida lanciata!</p>
            <p className="text-sm text-gray-500">{target.profile.full_name ?? target.profile.username} riceverà la notifica</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10 border-2 border-orange-200">
                {target.profile.avatar_url && <AvatarImage src={target.profile.avatar_url} />}
                <AvatarFallback className="bg-orange-50 text-orange-600 font-bold text-sm">
                  {target.profile.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-bold text-gray-900">Sfida {target.profile.full_name ?? target.profile.username}</p>
                <p className="text-xs text-gray-400">{formatPoints(target.total_points)} pts questo mese</p>
              </div>
              <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Scegli la metrica</p>
              <div className="space-y-2">
                {(Object.entries(METRIC_LABELS) as [ChallengeMetric, typeof METRIC_LABELS[ChallengeMetric]][]).map(([m, meta]) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all text-left ${
                      metric === m
                        ? 'border-eco-green bg-eco-green-light'
                        : 'border-gray-100 bg-gray-50 hover:border-eco-green/30'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center">{meta.icon}</div>
                    <span className={`text-sm font-semibold ${metric === m ? 'text-eco-teal' : 'text-gray-700'}`}>{meta.label}</span>
                    {metric === m && <Check className="w-4 h-4 text-eco-green ml-auto" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Durata</p>
              <div className="grid grid-cols-3 gap-2">
                {[7, 14, 30].map(d => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`py-2.5 rounded-2xl text-sm font-bold border-2 transition-all ${
                      days === d
                        ? 'border-orange-400 bg-gradient-to-b from-orange-400 to-orange-500 text-white shadow-md shadow-orange-200'
                        : 'border-gray-200 text-gray-600 hover:border-orange-300'
                    }`}
                  >
                    {d} giorni
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleSend}
              disabled={loading}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 shadow-lg shadow-orange-200 h-12 text-base font-bold"
            >
              {loading
                ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><Swords className="w-5 h-5" /> Lancia la sfida</>}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Top-3 Hero Cards ──────────────────────────────────────────────────────────

function TopThreeSection({ entries, userId, onChallenge, onFriendRequest, friendSent }: {
  entries: RankedEntry[]
  userId?: string
  onChallenge: (e: RankedEntry) => void
  onFriendRequest: (e: RankedEntry) => void
  friendSent: Set<string>
}) {
  const navigate = useNavigate()
  if (entries.length === 0) return null

  // Visual display: left=2nd, centre=1st, right=3rd
  // All style arrays indexed by RANK: [0]=1st/gold  [1]=2nd/silver  [2]=3rd/bronze
  const ORDER  = entries.length >= 3 ? [1, 0, 2] : entries.map((_, i) => i)
  const RING   = ['ring-amber-400', 'ring-gray-300',  'ring-amber-700']
  const SHADOW = ['shadow-amber-200','shadow-gray-200','shadow-amber-700/30']
  const BG     = ['from-amber-50 to-yellow-100','from-gray-50 to-slate-100','from-orange-50 to-amber-100']
  const BADGE  = [
    <Crown  key="c" className="w-5 h-5 text-amber-500 drop-shadow-sm" />,
    <Medal  key="m" className="w-4 h-4 text-gray-400" />,
    <Trophy key="t" className="w-4 h-4 text-amber-700" />,
  ]
  const HEIGHT = ['h-32', 'h-24', 'h-20']
  const LABEL  = ['1°', '2°', '3°']

  return (
    <div className="flex items-end gap-2 justify-center pt-2 pb-0">
      {ORDER.map((idx) => {
        const e = entries[idx]
        if (!e) return null
        const isMe = e.user_id === userId
        const lvl  = getEcoLevel(e.profile.eco_score ?? e.total_points)

        return (
          <div key={e.user_id} className="flex flex-col items-center gap-1 flex-1 max-w-[115px]">
            <div className="relative mb-1">
              <Avatar
                className={`ring-4 ${RING[idx]} shadow-xl ${SHADOW[idx]} cursor-pointer transition-transform hover:scale-105 ${
                  idx === 0 ? 'w-14 h-14' : 'w-12 h-12'
                }`}
                onClick={() => !isMe && navigate(`/user/${e.user_id}`)}
              >
                {e.profile.avatar_url && <AvatarImage src={e.profile.avatar_url} />}
                <AvatarFallback className={`font-bold text-sm ${idx === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                  {e.profile.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className={`absolute -top-2 -right-1 w-6 h-6 rounded-full flex items-center justify-center ${
                idx === 0 ? 'bg-amber-400' : idx === 1 ? 'bg-gray-300' : 'bg-amber-700'
              } shadow-sm`}>
                {BADGE[idx]}
              </div>
              {isMe && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-eco-green text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  TU
                </div>
              )}
            </div>

            <p
              className="text-[11px] font-bold text-gray-900 truncate max-w-full text-center cursor-pointer hover:text-eco-green transition-colors"
              onClick={() => !isMe && navigate(`/user/${e.user_id}`)}
            >
              {e.profile.full_name ?? e.profile.username}
            </p>
            <p className="text-[10px] text-gray-500 font-medium flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5 text-eco-green" />
              {formatPoints(e.total_points)}
            </p>
            <p className={`text-[9px] font-semibold ${lvl.color} px-1.5 py-0.5 rounded-full ${lvl.bg}`}>
              {lvl.name}
            </p>

            {!isMe && (
              <div className="flex gap-1 mt-0.5">
                <button
                  onClick={() => onFriendRequest(e)}
                  disabled={friendSent.has(e.user_id)}
                  className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                    friendSent.has(e.user_id)
                      ? 'bg-gray-100 text-gray-400'
                      : 'bg-blue-50 hover:bg-blue-500 hover:text-white text-blue-500'
                  }`}
                >
                  {friendSent.has(e.user_id) ? <Check className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => onChallenge(e)}
                  className="w-6 h-6 rounded-lg bg-orange-50 hover:bg-orange-500 hover:text-white text-orange-500 flex items-center justify-center transition-all"
                >
                  <Swords className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className={`w-full ${HEIGHT[idx]} bg-gradient-to-t ${BG[idx]} rounded-t-2xl flex items-start justify-center pt-2 border border-b-0 ${
              idx === 0 ? 'border-amber-200' : idx === 1 ? 'border-gray-200' : 'border-amber-300/50'
            }`}>
              <span className="text-sm font-black text-gray-400">{LABEL[idx]}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Ranked Row ────────────────────────────────────────────────────────────────

function RankedRow({ entry, rank, isMe, leaderPts, prevPts, onChallenge, onFriendRequest, friendSent }: {
  entry: RankedEntry
  rank: number
  isMe: boolean
  leaderPts: number
  prevPts: number
  onChallenge: () => void
  onFriendRequest: () => void
  friendSent: boolean
}) {
  const navigate = useNavigate()
  const pct  = leaderPts > 0 ? Math.max(4, Math.round((entry.total_points / leaderPts) * 100)) : 100
  const gap  = Math.max(0, prevPts - entry.total_points)
  const lvl  = getEcoLevel(entry.profile.eco_score ?? entry.total_points)

  return (
    <div className={`relative rounded-2xl overflow-hidden transition-all ${
      isMe ? 'ring-2 ring-eco-green shadow-md shadow-eco-green/10' : 'hover:shadow-sm'
    }`}>
      <div
        className={`absolute left-0 top-0 bottom-0 ${isMe ? 'bg-eco-green/8' : 'bg-gray-50'} transition-all duration-700 rounded-2xl`}
        style={{ width: `${pct}%` }}
      />
      <div className="relative flex items-center gap-3 px-4 py-3">
        <span className="w-7 text-center text-sm font-black text-gray-400 flex-shrink-0">#{rank}</span>

        <Avatar
          className={`w-9 h-9 flex-shrink-0 ${!isMe ? 'cursor-pointer hover:opacity-80' : ''}`}
          onClick={!isMe ? () => navigate(`/user/${entry.user_id}`) : undefined}
        >
          {entry.profile.avatar_url && <AvatarImage src={entry.profile.avatar_url} />}
          <AvatarFallback className="text-xs font-bold bg-gray-100 text-gray-600">
            {entry.profile.username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div
          className={`flex-1 min-w-0 ${!isMe ? 'cursor-pointer' : ''}`}
          onClick={!isMe ? () => navigate(`/user/${entry.user_id}`) : undefined}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold text-gray-900 truncate">
              {entry.profile.full_name ?? entry.profile.username}
            </p>
            {isMe && <span className="text-[9px] bg-eco-green text-white font-bold px-1.5 py-0.5 rounded-full">TU</span>}
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${lvl.bg} ${lvl.color}`}>
              {lvl.name}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {entry.profile.city && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" /> {entry.profile.city}
              </span>
            )}
            {(entry.total_co2_saved ?? 0) > 0 && (
              <span className="text-[10px] text-eco-green flex items-center gap-0.5 font-medium">
                <Leaf className="w-2.5 h-2.5" /> {formatCO2(entry.total_co2_saved!)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0 mr-1">
          <p className="text-sm font-black text-eco-green flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" /> {formatPoints(entry.total_points)}
          </p>
          {gap > 0 && !isMe && (
            <p className="text-[9px] text-gray-400 flex items-center gap-0.5">
              <ChevronUp className="w-2.5 h-2.5 text-red-400" /> -{formatPoints(gap)}
            </p>
          )}
          {gap > 0 && isMe && (
            <p className="text-[9px] text-orange-500 font-semibold flex items-center gap-0.5 whitespace-nowrap">
              <ArrowUp className="w-2.5 h-2.5" /> +{formatPoints(gap)} per salire
            </p>
          )}
          {gap === 0 && rank === 1 && (
            <p className="text-[9px] text-amber-500 font-semibold flex items-center gap-0.5">
              <Crown className="w-2.5 h-2.5" /> Leader
            </p>
          )}
        </div>

        {!isMe && (
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={onFriendRequest}
              disabled={friendSent}
              title={friendSent ? 'Richiesta inviata' : 'Aggiungi amico'}
              className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all ${
                friendSent ? 'bg-gray-100 text-gray-400 cursor-default' : 'bg-blue-50 hover:bg-blue-500 hover:text-white text-blue-500'
              }`}
            >
              {friendSent ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onChallenge}
              title="Sfida"
              className="w-7 h-7 rounded-xl bg-orange-50 hover:bg-orange-500 hover:text-white text-orange-500 flex items-center justify-center transition-all"
            >
              <Swords className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Monthly Deadline Banner ───────────────────────────────────────────────────

function MonthlyDeadlineBanner() {
  const daysLeft  = getDaysLeft()
  const hoursLeft = getHoursLeft()
  const deadline  = formatPeriodDeadline()
  const isUrgent  = daysLeft <= 3

  return (
    <div className={`mx-3 mb-3 rounded-2xl border px-4 py-3 flex items-center gap-3 ${
      isUrgent
        ? 'bg-red-50 border-red-200'
        : 'bg-amber-50 border-amber-200'
    }`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
        isUrgent ? 'bg-red-100' : 'bg-amber-100'
      }`}>
        {isUrgent
          ? <Flame className={`w-5 h-5 ${isUrgent ? 'text-red-500' : 'text-amber-500'}`} />
          : <Clock className="w-5 h-5 text-amber-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold ${isUrgent ? 'text-red-700' : 'text-amber-800'}`}>
          {isUrgent
            ? daysLeft === 0
              ? `Scade oggi — mancano ${hoursLeft}h!`
              : `Scade tra ${daysLeft} giorn${daysLeft === 1 ? 'o' : 'i'}!`
            : `Scadenza: ${deadline} · ${daysLeft} giorni rimasti`}
        </p>
        <p className={`text-[10px] mt-0.5 ${isUrgent ? 'text-red-500' : 'text-amber-600'}`}>
          I top 10 riceveranno punti bonus allo scadere dei 30 giorni — scala la classifica!
        </p>
      </div>
      <div className="flex flex-col items-center flex-shrink-0">
        <Gift className={`w-4 h-4 ${isUrgent ? 'text-red-400' : 'text-amber-500'}`} />
        <span className={`text-[9px] font-bold mt-0.5 ${isUrgent ? 'text-red-500' : 'text-amber-600'}`}>
          bonus
        </span>
      </div>
    </div>
  )
}

// ── Prizes Strip ─────────────────────────────────────────────────────────────

function PrizesStrip({ period }: { period: Period }) {
  if (period === 'alltime') {
    return (
      <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 flex items-center gap-3">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-6 h-6 bg-purple-500 rounded-lg flex items-center justify-center">
            <Trophy className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-xs font-bold text-purple-800">Hall of Fame</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto text-[10px] text-purple-700 font-semibold flex-1 min-w-0">
          <span className="flex items-center gap-1 bg-purple-100 rounded-full px-2 py-0.5 whitespace-nowrap">
            <Crown className="w-2.5 h-2.5" /> 1° → Eco Leggenda
          </span>
          <span className="flex items-center gap-1 bg-purple-100 rounded-full px-2 py-0.5 whitespace-nowrap">
            <Medal className="w-2.5 h-2.5" /> Top 3 → badge esclusivo
          </span>
          <span className="flex items-center gap-1 bg-purple-100 rounded-full px-2 py-0.5 whitespace-nowrap">
            <Leaf className="w-2.5 h-2.5" /> Top 10 → +100 pts
          </span>
        </div>
      </div>
    )
  }

  // monthly
  return (
    <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100 flex items-center gap-3">
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="w-6 h-6 bg-amber-400 rounded-lg flex items-center justify-center">
          <Gift className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-xs font-bold text-amber-800">Premi mensili</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto text-[10px] text-amber-700 font-semibold flex-1 min-w-0">
        <span className="flex items-center gap-1 bg-amber-100 rounded-full px-2 py-0.5 whitespace-nowrap">
          <Crown className="w-2.5 h-2.5" /> 1° → +500 pts
        </span>
        <span className="flex items-center gap-1 bg-amber-100 rounded-full px-2 py-0.5 whitespace-nowrap">
          <Medal className="w-2.5 h-2.5" /> 2° → +250 pts
        </span>
        <span className="flex items-center gap-1 bg-amber-100 rounded-full px-2 py-0.5 whitespace-nowrap">
          <Trophy className="w-2.5 h-2.5" /> 3° → +100 pts
        </span>
        <span className="flex items-center gap-1 bg-amber-100 rounded-full px-2 py-0.5 whitespace-nowrap">
          <Leaf className="w-2.5 h-2.5" /> Top 10 → +50 pts
        </span>
      </div>
    </div>
  )
}

// ── Full ranked list ──────────────────────────────────────────────────────────

function RankedList({ entries, loading, userId, period, onChallenge, onFriendRequest, friendSent }: {
  entries: RankedEntry[]
  loading: boolean
  userId?: string
  period: Period
  onChallenge: (e: RankedEntry) => void
  onFriendRequest: (e: RankedEntry) => void
  friendSent: Set<string>
}) {
  const [cityFilter, setCityFilter] = useState<string | null>(null)

  const cities    = [...new Set(entries.map(e => e.profile.city).filter(Boolean) as string[])].slice(0, 8)
  const filtered  = cityFilter ? entries.filter(e => e.profile.city === cityFilter) : entries
  const userRank  = entries.findIndex(e => e.user_id === userId) + 1
  const userEntry = entries.find(e => e.user_id === userId)
  const leaderPts = filtered[0]?.total_points ?? 1
  const top3      = filtered.slice(0, 3)
  const rest      = filtered.slice(3)
  const totalCO2  = entries.reduce((s, e) => s + (e.total_co2_saved ?? 0), 0)

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className={`rounded-2xl ${i === 0 ? 'h-36' : 'h-14'}`} />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Trophy className="w-8 h-8 text-gray-300" />
        </div>
        <p className="text-gray-600 font-bold">Nessun dato disponibile</p>
        <p className="text-sm text-gray-400 mt-1">
          {period === 'monthly'
            ? 'Registra un viaggio questo mese per comparire qui!'
            : 'Inizia a registrare viaggi per comparire qui!'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-0">

      {/* Stats banner */}
      <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100 bg-gray-50/60">
        <div className="flex flex-col items-center py-3 px-2">
          <p className="text-base font-black text-eco-green">{entries.length}</p>
          <p className="text-[10px] text-gray-400 font-medium flex items-center gap-0.5"><Users className="w-2.5 h-2.5" /> partecipanti</p>
        </div>
        <div className="flex flex-col items-center py-3 px-2">
          <p className="text-base font-black text-eco-green">{totalCO2 > 0 ? formatCO2(totalCO2) : '—'}</p>
          <p className="text-[10px] text-gray-400 font-medium flex items-center gap-0.5"><Leaf className="w-2.5 h-2.5" /> CO₂ totale</p>
        </div>
        <div className="flex flex-col items-center py-3 px-2">
          <p className="text-base font-black text-eco-green">{userRank > 0 ? `#${userRank}` : '—'}</p>
          <p className="text-[10px] text-gray-400 font-medium">il tuo rank</p>
        </div>
      </div>

      {/* Monthly deadline banner */}
      {period === 'monthly' && (
        <div className="pt-3">
          <MonthlyDeadlineBanner />
        </div>
      )}

      {/* My position sticky bar (only if outside top3) */}
      {userEntry && userRank > 3 && (
        <div className="bg-eco-green/5 border-b border-eco-green/10 px-4 py-2.5 flex items-center gap-3">
          <div className="w-7 h-7 bg-eco-green rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-black text-white">#{userRank}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-eco-teal">La tua posizione — {formatPoints(userEntry.total_points)} pts</p>
              {userRank > 1 && (
                <p className="text-[10px] text-orange-500 font-semibold flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" />
                  +{formatPoints(Math.max(0, (filtered[userRank - 2]?.total_points ?? 0) - userEntry.total_points + 1))} per il {userRank - 1}° posto
                </p>
              )}
            </div>
            <div className="mt-1 h-1 bg-eco-green/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-eco-green to-emerald-400 rounded-full transition-all"
                style={{ width: `${leaderPts > 0 ? Math.min(100, Math.round((userEntry.total_points / leaderPts) * 100)) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* City filter */}
      {cities.length > 1 && (
        <div className="flex gap-2 flex-wrap px-4 py-3 border-b border-gray-100">
          <button
            onClick={() => setCityFilter(null)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all flex items-center gap-1 ${
              !cityFilter ? 'bg-eco-green text-white border-eco-green' : 'bg-white text-gray-600 border-gray-200 hover:border-eco-green'
            }`}
          >
            <Globe className="w-2.5 h-2.5" /> Tutti
          </button>
          {cities.map(city => (
            <button
              key={city}
              onClick={() => setCityFilter(cityFilter === city ? null : city)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all flex items-center gap-1 ${
                cityFilter === city ? 'bg-eco-green text-white border-eco-green' : 'bg-white text-gray-600 border-gray-200 hover:border-eco-green'
              }`}
            >
              <MapPin className="w-2.5 h-2.5" /> {city}
            </button>
          ))}
        </div>
      )}

      {/* Top 3 Podium — only when at least 2 entries and no city filter */}
      {top3.length >= 2 && !cityFilter && (
        <div className="px-4 pt-4 pb-0">
          <TopThreeSection
            entries={top3}
            userId={userId}
            onChallenge={onChallenge}
            onFriendRequest={onFriendRequest}
            friendSent={friendSent}
          />
        </div>
      )}

      {/* Rest of list — when < 2 entries skip podium and show all from rank 1 */}
      <div className="px-3 pt-3 pb-4 space-y-1.5">
        {(cityFilter ? filtered : (top3.length >= 2 ? rest : filtered)).map((e, i) => {
          const startRank = cityFilter ? 1 : (top3.length >= 2 ? 4 : 1)
          const rank    = startRank + i
          const prevPts = (filtered[rank - 2]?.total_points ?? e.total_points)
          return (
            <RankedRow
              key={e.user_id}
              entry={e}
              rank={rank}
              isMe={e.user_id === userId}
              leaderPts={leaderPts}
              prevPts={prevPts}
              onChallenge={() => onChallenge(e)}
              onFriendRequest={() => onFriendRequest(e)}
              friendSent={friendSent.has(e.user_id)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const PERIOD_META: Record<Period, { label: string; icon: React.ReactNode; sub: string }> = {
  monthly: {
    label: '30 giorni',
    icon: <TrendingUp className="w-3.5 h-3.5" />,
    sub: `scade tra ${getDaysLeft()} giorni`,
  },
  alltime: {
    label: 'Sempre',
    icon: <Trophy className="w-3.5 h-3.5" />,
    sub: 'tutti i tempi',
  },
}

export default function Leaderboard() {
  const { user, profile } = useAuth()
  const [period, setPeriod] = useState<Period>('monthly')
  const [monthly, setMonthly] = useState<RankedEntry[]>([])
  const [allTime, setAllTime] = useState<RankedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [challengeTarget, setChallengeTarget] = useState<RankedEntry | null>(null)
  const [friendSent, setFriendSent] = useState<Set<string>>(new Set())

  const handleFriendRequest = async (entry: RankedEntry) => {
    if (!user || !profile || friendSent.has(entry.user_id)) return
    try {
      await sendFriendRequest(user.id, entry.user_id, { username: profile.username, avatar_url: profile.avatar_url })
    } catch { /* already friends */ }
    setFriendSent(prev => new Set([...prev, entry.user_id]))
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Rolling 30-day period (not calendar-month)
      const periodIdx   = getCurrentPeriodIdx()
      const periodStart = getPeriodStart(periodIdx).toISOString()

      const [m, a] = await Promise.all([
        getMonthlyLeaderboard(periodStart),
        getAllTimeLeaderboard(),
      ])

      setMonthly(m.map(e => ({
        user_id:         e.user_id,
        total_points:    e.total_points,
        total_co2_saved: e.total_co2_saved,
        profile:         e.profile as ProfileShape,
      })))

      setAllTime(a.map(e => ({
        user_id:         e.user_id,
        total_points:    e.total_points,
        total_co2_saved: e.total_co2_saved,
        profile:         e.profile as ProfileShape,
      })))

      // ── Auto-award: if period just rolled over, award previous period's top 10 ──
      try {
        const AWARD_KEY   = 'ecotrack_last_awarded_period'
        const lastAwarded = parseInt(localStorage.getItem(AWARD_KEY) ?? '-1', 10)
        if (lastAwarded < 0) {
          // First visit — just mark current period so we award next time
          localStorage.setItem(AWARD_KEY, String(periodIdx))
        } else if (periodIdx > lastAwarded) {
          // Period rolled: award for each missed period
          for (let pi = lastAwarded; pi < periodIdx; pi++) {
            const prevStart = getPeriodStart(pi).toISOString()
            const prevEnd   = getPeriodStart(pi + 1).toISOString()
            await awardPeriodBonuses(prevStart, prevEnd)
          }
          localStorage.setItem(AWARD_KEY, String(periodIdx))
        }
      } catch { /* don't fail load on award errors */ }

    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const currentEntries = period === 'monthly' ? monthly : allTime

  // Stats for hero (based on active period)
  const totalParticipants = currentEntries.length
  const totalCO2          = currentEntries.reduce((s, e) => s + (e.total_co2_saved ?? 0), 0)
  const totalPts          = currentEntries.reduce((s, e) => s + e.total_points, 0)

  return (
    <div className="max-w-2xl mx-auto pb-24 lg:pb-8 space-y-0">

      {/* ── HERO HEADER ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-eco-green via-emerald-500 to-teal-600 shadow-xl shadow-eco-green/25 mb-4">
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full" />
        <div className="absolute -bottom-6 -left-6 w-28 h-28 bg-white/5 rounded-full" />

        <div className="relative p-5 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="w-5 h-5 text-amber-300" />
                <h1 className="text-xl font-black text-white tracking-tight">EcoRace</h1>
                <div className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5">
                  <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse" />
                  <span className="text-[10px] text-white font-bold">LIVE</span>
                </div>
              </div>
              <p className="text-white/70 text-xs">
                {period === 'monthly'
                  ? `Chi si muove più verde negli ultimi 30 giorni?`
                  : 'I campioni eco di tutti i tempi'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Refresh button */}
              <button
                onClick={load}
                disabled={loading}
                title="Aggiorna classifica"
                className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-white ${loading ? 'animate-spin' : ''}`} />
              </button>
              {user && profile && (
                <div className="flex items-center gap-2 bg-white/15 rounded-2xl px-3 py-2">
                  {(profile.streak_days ?? 0) > 0 && (
                    <div className="flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5 text-orange-300" />
                      <span className="text-xs font-bold text-white">{profile.streak_days}gg</span>
                    </div>
                  )}
                  <div className="w-px h-4 bg-white/30" />
                  <div className="flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-yellow-300" />
                    <span className="text-xs font-bold text-white">{formatPoints(profile.eco_score ?? 0)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Period stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: <Users className="w-3.5 h-3.5 text-white/80" />,   bold: String(totalParticipants), unit: 'atleti' },
              { icon: <Leaf  className="w-3.5 h-3.5 text-green-300" />,  bold: totalCO2 > 0 ? formatCO2(totalCO2) : '—', unit: 'kg CO₂ saved' },
              { icon: <Zap   className="w-3.5 h-3.5 text-yellow-300" />, bold: formatPoints(totalPts), unit: 'pts totali' },
            ].map(({ icon, unit, bold }) => (
              <div key={unit} className="bg-white/10 rounded-2xl px-3 py-2 text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">{icon}</div>
                <p className="text-sm font-black text-white">{bold}</p>
                <p className="text-[9px] text-white/60 font-medium">{unit}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── PERIOD TABS ── */}
      <div className="flex gap-2 mb-4">
        {(Object.entries(PERIOD_META) as [Period, typeof PERIOD_META[Period]][]).map(([p, meta]) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 px-2 rounded-2xl border-2 transition-all text-center ${
              period === p
                ? 'border-eco-green bg-eco-green-light shadow-sm'
                : 'border-gray-100 bg-white hover:border-eco-green/40'
            }`}
          >
            <div className={`flex items-center gap-1 ${period === p ? 'text-eco-teal' : 'text-gray-500'}`}>
              {meta.icon}
              <span className="text-xs font-bold">{meta.label}</span>
            </div>
            <span className={`text-[9px] font-medium ${period === p ? 'text-eco-teal/70' : 'text-gray-400'}`}>
              {meta.sub}
            </span>
          </button>
        ))}
      </div>

      {/* ── RANKED LIST ── */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <PrizesStrip period={period} />
        <RankedList
          entries={currentEntries}
          loading={loading}
          userId={user?.id}
          period={period}
          onChallenge={setChallengeTarget}
          onFriendRequest={handleFriendRequest}
          friendSent={friendSent}
        />
      </div>

      {/* ── Challenge Modal ── */}
      {challengeTarget && user && (
        <ChallengeModal
          target={challengeTarget}
          userId={user.id}
          userProfile={profile}
          onClose={() => setChallengeTarget(null)}
        />
      )}
    </div>
  )
}
