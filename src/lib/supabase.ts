import { createClient } from '@supabase/supabase-js'
import type { Profile, Trip, Badge, UserBadge, LeaderboardEntry, Challenge, ChallengeMetric, AppNotification, ClubJoinRequest } from '@/types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',        // allows OTP verify + magic-link hash redirect
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,    // picks up #access_token from magic-link clicks
  },
})

// ── Typed query helpers ──────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) return null
  return data as Profile
}

export async function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile, 'username' | 'full_name' | 'avatar_url' | 'city' | 'bio' | 'preferred_transport' | 'weekly_goal_km' | 'active_title'>>
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data as Profile
}

export async function getTrips(userId: string, limit = 20): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Trip[]
}

export async function insertTrip(
  trip: Omit<Trip, 'id'> & { recorded_at?: string }
): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .insert(trip)
    .select()
    .single()
  if (error) throw error

  // Aggiorna eco_score e total_co2_saved nel profilo
  const ecoPoints   = Number(trip.eco_points)   || 0
  const co2Saved    = Number(trip.co2_saved_kg) || 0
  if (ecoPoints > 0 || co2Saved > 0) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('eco_score, total_co2_saved')
      .eq('id', trip.user_id)
      .single()
    await supabase.from('profiles').update({
      eco_score:       (Number(prof?.eco_score)       || 0) + ecoPoints,
      total_co2_saved: (Number(prof?.total_co2_saved) || 0) + co2Saved,
    }).eq('id', trip.user_id)
  }

  return data as Trip
}

export async function deleteTrip(tripId: string): Promise<void> {
  // Prima leggi il viaggio per sapere quanti punti/co2 togliere dal profilo
  const { data: trip } = await supabase
    .from('trips')
    .select('user_id, eco_points, co2_saved_kg')
    .eq('id', tripId)
    .single()

  const { error } = await supabase.from('trips').delete().eq('id', tripId)
  if (error) throw error

  // Decrementa eco_score e total_co2_saved nel profilo
  if (trip) {
    const ecoPoints = Number(trip.eco_points)   || 0
    const co2Saved  = Number(trip.co2_saved_kg) || 0
    if (ecoPoints > 0 || co2Saved > 0) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('eco_score, total_co2_saved')
        .eq('id', trip.user_id)
        .single()
      await supabase.from('profiles').update({
        eco_score:       Math.max(0, (Number(prof?.eco_score)       || 0) - ecoPoints),
        total_co2_saved: Math.max(0, (Number(prof?.total_co2_saved) || 0) - co2Saved),
      }).eq('id', trip.user_id)
    }
  }
}

export async function updateTrip(
  tripId: string,
  updates: Partial<Pick<Trip, 'transport_mode' | 'distance_km' | 'co2_saved_kg' | 'eco_points' | 'duration_minutes' | 'notes' | 'recorded_at'>>
): Promise<void> {
  const { error } = await supabase.from('trips').update(updates).eq('id', tripId)
  if (error) throw error
}

export async function getUserBadges(userId: string): Promise<UserBadge[]> {
  const { data, error } = await supabase
    .from('user_badges')
    .select('*, badge:badges(*)')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as UserBadge[]
}

export async function getAllBadges(): Promise<Badge[]> {
  const { data, error } = await supabase.from('badges').select('*')
  if (error) throw error
  return (data ?? []) as Badge[]
}

export async function getWeeklyLeaderboard(weekStart: string): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from('leaderboard_weekly')
    .select('*, profile:profiles(username, full_name, avatar_url, city)')
    .eq('week_start', weekStart)
    .order('total_points', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as LeaderboardEntry[]
}

export async function getAllTimeLeaderboard(): Promise<
  { user_id: string; total_points: number; total_co2_saved: number; profile: Pick<Profile, 'username' | 'full_name' | 'avatar_url' | 'city'> }[]
> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, eco_score, total_co2_saved, username, full_name, avatar_url, city')
    .order('eco_score', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map((p) => ({
    user_id: p.id as string,
    total_points: (p.eco_score as number) ?? 0,
    total_co2_saved: Number(p.total_co2_saved) ?? 0,
    profile: {
      username: p.username as string,
      full_name: p.full_name as string | null,
      avatar_url: p.avatar_url as string | null,
      city: p.city as string | null,
    },
  }))
}

export async function getMonthlyLeaderboard(periodStart: string): Promise<
  { user_id: string; total_points: number; total_co2_saved: number; profile: Pick<Profile, 'username' | 'full_name' | 'avatar_url' | 'city'> }[]
> {
  // Fetch trips in period (for ranking by activity) + ALL profiles (for display scores)
  const [tripsResult, profilesResult] = await Promise.all([
    supabase
      .from('trips')
      .select('user_id, eco_points, co2_saved_kg')
      .gte('recorded_at', periodStart),
    supabase
      .from('profiles')
      .select('id, eco_score, total_co2_saved, username, full_name, avatar_url, city')
      .limit(200),
  ])

  // Aggregate trips this period — used only for SORTING (most active this period first)
  const periodActivity: Record<string, { pts: number; co2: number }> = {}
  for (const t of tripsResult.data ?? []) {
    const uid = t.user_id as string
    if (!periodActivity[uid]) periodActivity[uid] = { pts: 0, co2: 0 }
    periodActivity[uid].pts += (t.eco_points as number) ?? 0
    periodActivity[uid].co2 += Number(t.co2_saved_kg) ?? 0
  }

  // Build a quick map of eco_score for tie-break without refetching
  const profileEcoScore: Record<string, number> = {}
  for (const p of profilesResult.data ?? []) {
    profileEcoScore[p.id as string] = (p.eco_score as number) ?? 0
  }

  return (profilesResult.data ?? [])
    .map(p => ({
      user_id: p.id as string,
      // Points earned THIS period only (not all-time) — this is the correct 30-day score
      total_points:    periodActivity[p.id as string]?.pts ?? 0,
      // CO₂ saved THIS period
      total_co2_saved: periodActivity[p.id as string]?.co2 ?? 0,
      profile: {
        username:   p.username   as string,
        full_name:  p.full_name  as string | null,
        avatar_url: p.avatar_url as string | null,
        city:       p.city       as string | null,
        // Keep all-time eco_score so eco level badge shows correctly
        eco_score:  (p.eco_score as number) ?? 0,
      },
    }))
    .sort((a, b) => {
      // Sort by period points
      if (b.total_points !== a.total_points) return b.total_points - a.total_points
      // Tie-break: all-time eco_score
      return (profileEcoScore[b.user_id] ?? 0) - (profileEcoScore[a.user_id] ?? 0)
    })
    .slice(0, 100)
}

export async function deleteRide(rideId: string): Promise<void> {
  const { error } = await supabase.from('carpooling_rides').delete().eq('id', rideId)
  if (error) throw error
}

// ── Club helpers ─────────────────────────────────────────────────────────────

export interface ClubDetails {
  id: string; name: string; description: string | null; avatar_url: string | null
  city: string | null; company: string | null; is_public: boolean
  eco_score_total: number; member_count: number; created_by: string
}

export interface ClubMember {
  user_id: string; role: string; joined_at: string
  profile: Pick<Profile, 'username' | 'full_name' | 'avatar_url' | 'city' | 'eco_score'>
}

export async function getClubDetails(clubId: string): Promise<ClubDetails | null> {
  const { data, error } = await supabase.from('clubs').select('*').eq('id', clubId).single()
  if (error) return null
  return data as ClubDetails
}

export async function getClubMembers(clubId: string): Promise<ClubMember[]> {
  const { data, error } = await supabase
    .from('club_members')
    .select('user_id, role, joined_at, profile:profiles(username, full_name, avatar_url, city, eco_score)')
    .eq('club_id', clubId)
    .order('joined_at', { ascending: true })
  if (error) return []
  return (data ?? []) as unknown as ClubMember[]
}

export async function updateClub(clubId: string, updates: Partial<Pick<ClubDetails, 'name' | 'description' | 'city' | 'avatar_url'>>): Promise<void> {
  const { error } = await supabase.from('clubs').update(updates).eq('id', clubId)
  if (error) throw error
}

export async function searchUsersForInvite(
  query: string,
  excludeUserIds: string[]
): Promise<Pick<Profile, 'id' | 'username' | 'full_name' | 'avatar_url'>[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .ilike('username', `%${query}%`)
    .not('id', 'in', `(${excludeUserIds.join(',')})`)
    .limit(6)
  return (data ?? []) as Pick<Profile, 'id' | 'username' | 'full_name' | 'avatar_url'>[]
}

export async function addMemberToClub(clubId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('club_members')
    .insert({ club_id: clubId, user_id: userId, role: 'member' })
  if (error) throw error
}

type PurchasedTitleItem = { name: string; description: string | null; category: string }

export async function getUserPurchasedTitles(
  userId: string
): Promise<{ id: string; name: string; description: string | null }[]> {
  const { data } = await supabase
    .from('shop_purchases')
    .select('id, item:shop_items(name, description, category)')
    .eq('user_id', userId)
  if (!data) return []
  return data
    .filter((p) => (p.item as unknown as PurchasedTitleItem | null)?.category === 'title')
    .map((p) => {
      const item = p.item as unknown as PurchasedTitleItem
      return { id: p.id as string, name: item.name, description: item.description }
    })
}

export async function deleteClub(clubId: string): Promise<void> {
  const { error } = await supabase.from('clubs').delete().eq('id', clubId)
  if (error) throw error
}

export async function removeClubMember(clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('club_members').delete().eq('club_id', clubId).eq('user_id', userId)
  if (error) throw error
}

// ── Club Prizes ───────────────────────────────────────────────────────────────

export interface ClubPrize {
  id: string
  club_id: string
  created_by: string
  name: string
  description: string | null
  points_cost: number
  stock: number | null
  emoji: string
  expires_at: string | null
  is_active: boolean
  created_at: string
}

export async function getClubPrizes(clubId: string): Promise<ClubPrize[]> {
  const { data } = await supabase
    .from('club_prizes')
    .select('*')
    .eq('club_id', clubId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  return (data ?? []) as ClubPrize[]
}

export async function createClubPrize(prize: Omit<ClubPrize, 'id' | 'created_at'>): Promise<ClubPrize> {
  const { data, error } = await supabase
    .from('club_prizes')
    .insert(prize)
    .select()
    .single()
  if (error) throw error
  return data as ClubPrize
}

export async function updateClubPrize(
  prizeId: string,
  updates: Partial<Pick<ClubPrize, 'name' | 'description' | 'points_cost' | 'stock' | 'emoji' | 'expires_at'>>
): Promise<void> {
  const { error } = await supabase.from('club_prizes').update(updates).eq('id', prizeId)
  if (error) throw error
}

export async function deleteClubPrize(prizeId: string): Promise<void> {
  const { error } = await supabase
    .from('club_prizes')
    .update({ is_active: false })
    .eq('id', prizeId)
  if (error) throw error
}

export async function redeemClubPrize(
  prizeId: string,
  userId: string,
  clubId: string,
  pointsCost: number
): Promise<void> {
  // Check stock
  const { data: prize } = await supabase
    .from('club_prizes')
    .select('stock')
    .eq('id', prizeId)
    .single()
  if (prize && prize.stock !== null && (prize.stock as number) <= 0) throw new Error('Premio esaurito')

  // Insert redemption record
  const { error: rErr } = await supabase
    .from('club_prize_redemptions')
    .insert({ prize_id: prizeId, user_id: userId, club_id: clubId, status: 'confirmed' })
  if (rErr) throw rErr

  // Deduct points from profile
  const p = await getProfile(userId)
  if (!p) throw new Error('Profilo non trovato')
  if ((p.eco_score ?? 0) < pointsCost) throw new Error('Punti insufficienti')
  await supabase.from('profiles').update({ eco_score: (p.eco_score ?? 0) - pointsCost }).eq('id', userId)

  // Decrement stock if finite
  if (prize && prize.stock !== null) {
    await supabase
      .from('club_prizes')
      .update({ stock: (prize.stock as number) - 1 })
      .eq('id', prizeId)
  }
}

export async function getUserClubPrizeRedemptions(userId: string): Promise<{ prize_id: string; redeemed_at: string; club_prize: ClubPrize | null }[]> {
  const { data } = await supabase
    .from('club_prize_redemptions')
    .select('prize_id, redeemed_at, club_prize:club_prizes(id,name,emoji,points_cost,club_id)')
    .eq('user_id', userId)
    .order('redeemed_at', { ascending: false })
  return (data ?? []) as unknown as { prize_id: string; redeemed_at: string; club_prize: ClubPrize | null }[]
}

export async function getUserAdminClubs(userId: string): Promise<{ club_id: string; role: string }[]> {
  const { data } = await supabase
    .from('club_members')
    .select('club_id, role')
    .eq('user_id', userId)
  return (data ?? []) as { club_id: string; role: string }[]
}

export async function updateClubMemberRole(clubId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
  const { error } = await supabase
    .from('club_members')
    .update({ role })
    .eq('club_id', clubId)
    .eq('user_id', userId)
  if (error) throw error
}

// ── Leaderboard period bonus awards ──────────────────────────────────────────

/** Award bonus eco_points to the top 10 users of a completed 30-day period.
 *  Called client-side when the period rolls over (localStorage guard prevents double-award).
 */
export async function awardPeriodBonuses(periodStart: string, periodEnd: string): Promise<void> {
  // Fetch all trips in the period
  const { data: trips } = await supabase
    .from('trips')
    .select('user_id, eco_points')
    .gte('recorded_at', periodStart)
    .lt('recorded_at', periodEnd)
  if (!trips?.length) return

  // Aggregate points per user
  const byUser: Record<string, number> = {}
  for (const t of trips) {
    byUser[t.user_id as string] = (byUser[t.user_id as string] ?? 0) + (t.eco_points as number ?? 0)
  }

  // Sort descending and take top 10
  const BONUS_TABLE = [500, 250, 100, 50, 50, 50, 50, 50, 50, 50]
  const ranked = Object.entries(byUser)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)

  if (!ranked.length) return

  // Fetch current eco_score for each winner
  const winnerIds = ranked.map(([uid]) => uid)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, eco_score')
    .in('id', winnerIds)
  if (!profiles?.length) return

  // Apply bonuses
  const updates = ranked.map(([uid], i) => {
    const p = profiles.find(x => x.id === uid)
    if (!p) return null
    return supabase.from('profiles')
      .update({ eco_score: ((p.eco_score as number) ?? 0) + BONUS_TABLE[i] })
      .eq('id', uid)
  }).filter(Boolean)

  await Promise.all(updates as unknown as Promise<unknown>[])
}

// ── Challenge helpers ─────────────────────────────────────────────────────────

export async function getChallenges(userId: string): Promise<Challenge[]> {
  const { data, error } = await supabase
    .from('challenges')
    .select(`
      *,
      challenger:profiles!challenges_challenger_id_fkey(username, full_name, avatar_url),
      challenged:profiles!challenges_challenged_id_fkey(username, full_name, avatar_url)
    `)
    .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []) as Challenge[]
}

export async function createChallenge(data: {
  challenger_id: string
  challenged_id: string
  metric: ChallengeMetric
  duration_days: number
  challenger_username?: string
  challenger_avatar?: string | null
}): Promise<Challenge> {
  const { challenger_username, challenger_avatar, ...insertData } = data
  const startDate = new Date().toISOString().split('T')[0]
  const endDate = new Date(Date.now() + data.duration_days * 86400000).toISOString().split('T')[0]
  const { data: result, error } = await supabase
    .from('challenges')
    .insert({ ...insertData, start_date: startDate, end_date: endDate, status: 'pending' })
    .select()
    .single()
  if (error) throw error

  // Notify the challenged user
  await supabase.from('notifications').insert({
    user_id: data.challenged_id,
    type: 'challenge_received',
    data: {
      challenge_id: (result as Challenge).id,
      sender_id: data.challenger_id,
      challenger_username: challenger_username ?? 'Utente',
      challenger_avatar: challenger_avatar ?? null,
      metric: data.metric,
      duration_days: data.duration_days,
    },
  }).then(() => {}) // fire and forget

  return result as Challenge
}

export async function respondToChallenge(
  challengeId: string,
  accept: boolean,
  challengerId?: string,
  responderUsername?: string,
): Promise<void> {
  // Reset start/end dates from today so the match window is fair
  const today = new Date()
  const updates: Record<string, unknown> = { status: accept ? 'active' : 'rejected' }
  if (accept) {
    const startDate = today.toISOString().split('T')[0]
    // Fetch duration to compute new end_date
    const { data: challenge } = await supabase
      .from('challenges')
      .select('duration_days')
      .eq('id', challengeId)
      .single()
    if (challenge) {
      const endDate = new Date(today.getTime() + challenge.duration_days * 86400000)
        .toISOString().split('T')[0]
      updates.start_date = startDate
      updates.end_date = endDate
    }
  }
  const { error } = await supabase
    .from('challenges')
    .update(updates)
    .eq('id', challengeId)
  if (error) throw error

  // Notify challenger of acceptance
  if (accept && challengerId && responderUsername) {
    await supabase.from('notifications').insert({
      user_id: challengerId,
      type: 'challenge_accepted',
      data: {
        challenge_id: challengeId,
        challenger_username: responderUsername,
      },
    }).then(() => {})
  }
}

export async function getClubChallenges(clubId: string): Promise<Challenge[]> {
  // Get all user IDs in this club
  const { data: members } = await supabase
    .from('club_members')
    .select('user_id')
    .eq('club_id', clubId)
  if (!members || members.length === 0) return []

  const memberIds = members.map(m => m.user_id)
  // Challenges where both participants are club members
  const { data } = await supabase
    .from('challenges')
    .select(`
      *,
      challenger:profiles!challenges_challenger_id_fkey(username, full_name, avatar_url),
      challenged:profiles!challenges_challenged_id_fkey(username, full_name, avatar_url)
    `)
    .in('challenger_id', memberIds)
    .in('challenged_id', memberIds)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data ?? []) as Challenge[]
}

// ── Notification helpers ─────────────────────────────────────────────────────

export async function getNotifications(userId: string): Promise<AppNotification[]> {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data ?? []) as AppNotification[]
}

export async function markNotificationRead(id: string): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('id', id)
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
}

export async function deleteNotification(id: string): Promise<void> {
  await supabase.from('notifications').delete().eq('id', id)
}

// ── Friend request helpers ───────────────────────────────────────────────────

export async function sendFriendRequest(
  senderId: string,
  receiverId: string,
  senderProfile: Pick<Profile, 'username' | 'avatar_url'>
): Promise<void> {
  // Check if request already exists in either direction
  const { data: existing } = await supabase
    .from('friend_requests')
    .select('id, status')
    .or(`and(sender_id.eq.${senderId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${senderId})`)
    .maybeSingle()

  if (existing?.status === 'pending') throw new Error('Richiesta già inviata')
  if (existing?.status === 'accepted') throw new Error('Siete già amici')

  const { data, error } = await supabase
    .from('friend_requests')
    .insert({ sender_id: senderId, receiver_id: receiverId, status: 'pending' })
    .select()
    .single()
  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: receiverId,
    type: 'friend_request',
    data: {
      request_id: data.id,
      sender_id: senderId,
      sender_username: senderProfile.username,
      sender_avatar: senderProfile.avatar_url,
    },
  })
}

export async function respondToFriendRequest(
  requestId: string,
  accept: boolean,
  senderId: string,
  receiver: { id: string; username: string; avatar_url: string | null }
): Promise<void> {
  const { error } = await supabase
    .from('friend_requests')
    .update({ status: accept ? 'accepted' : 'rejected' })
    .eq('id', requestId)
  if (error) throw error

  if (accept) {
    await supabase.from('notifications').insert({
      user_id: senderId,
      type: 'friend_accepted',
      data: {
        sender_id: receiver.id,
        sender_username: receiver.username,
        sender_avatar: receiver.avatar_url,
      },
    })
  }
}

export async function getFriendStatus(
  userId: string,
  otherUserId: string
): Promise<'none' | 'pending_sent' | 'pending_received' | 'friends'> {
  const { data } = await supabase
    .from('friend_requests')
    .select('id, sender_id, status')
    .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`)
    .maybeSingle()

  if (!data) return 'none'
  if (data.status === 'accepted') return 'friends'
  if (data.status === 'pending') {
    return (data.sender_id as string) === userId ? 'pending_sent' : 'pending_received'
  }
  return 'none'
}

// ── Club join request helpers ─────────────────────────────────────────────────

export async function requestJoinClub(
  clubId: string,
  userId: string,
  userProfile: Pick<Profile, 'username' | 'avatar_url'>,
  clubName: string,
  adminId: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('club_join_requests')
    .select('id, status')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.status === 'pending') throw new Error('Richiesta già inviata')
  if (existing?.status === 'accepted') throw new Error('Sei già membro')

  // Remove rejected record so upsert can re-create
  if (existing?.status === 'rejected') {
    await supabase.from('club_join_requests').delete().eq('id', existing.id)
  }

  const { data, error } = await supabase
    .from('club_join_requests')
    .insert({ club_id: clubId, user_id: userId, direction: 'join_request', status: 'pending' })
    .select()
    .single()
  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: adminId,
    type: 'club_join_request',
    data: {
      request_id: data.id,
      club_id: clubId,
      club_name: clubName,
      user_id: userId,
      username: userProfile.username,
      avatar: userProfile.avatar_url,
    },
  })
}

export async function cancelJoinRequest(clubId: string, userId: string): Promise<void> {
  await supabase
    .from('club_join_requests')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .eq('status', 'pending')
}

export async function inviteToClub(
  clubId: string,
  targetUserId: string,
  adminProfile: Pick<Profile, 'username'>,
  clubName: string,
  clubAvatar: string | null
): Promise<void> {
  // Check if already a member
  const { data: member } = await supabase
    .from('club_members')
    .select('user_id')
    .eq('club_id', clubId)
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (member) throw new Error('Utente già membro del club')

  // Check for pending request
  const { data: existing } = await supabase
    .from('club_join_requests')
    .select('id, status, direction')
    .eq('club_id', clubId)
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (existing?.status === 'pending') {
    if (existing.direction === 'invite') throw new Error('Invito già inviato. L\'utente deve ancora rispondere.')
    // User already sent a join_request → accept it directly on their behalf would be weird
    // Instead, inform admin there's a pending request
    throw new Error('L\'utente ha già richiesto di entrare. Accetta la richiesta dalla campanella.')
  }

  // Remove old rejected record if any
  if (existing) {
    await supabase.from('club_join_requests').delete().eq('id', existing.id)
  }

  const { data, error } = await supabase
    .from('club_join_requests')
    .insert({ club_id: clubId, user_id: targetUserId, direction: 'invite', status: 'pending' })
    .select()
    .single()
  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: targetUserId,
    type: 'club_invite',
    data: {
      request_id: data.id,
      club_id: clubId,
      club_name: clubName,
      club_avatar: clubAvatar,
      sender_username: adminProfile.username,
    },
  })
}

export async function respondToClubRequest(
  requestId: string,
  accept: boolean,
  notif: AppNotification
): Promise<void> {
  if (accept) {
    const { error } = await supabase.rpc('accept_club_join_request', { p_request_id: requestId })
    if (error) throw error
  } else {
    const { error } = await supabase.rpc('reject_club_join_request', { p_request_id: requestId })
    if (error) throw error
  }

  // If admin responded to a user's join_request → notify the user
  if (notif.type === 'club_join_request' && notif.data.user_id) {
    await supabase.from('notifications').insert({
      user_id: notif.data.user_id,
      type: accept ? 'club_join_accepted' : 'club_join_rejected',
      data: { club_id: notif.data.club_id, club_name: notif.data.club_name },
    })
  }
}

export async function getPendingClubRequests(clubId: string): Promise<ClubJoinRequest[]> {
  const { data } = await supabase
    .from('club_join_requests')
    .select('*, profile:profiles(username, full_name, avatar_url)')
    .eq('club_id', clubId)
    .eq('status', 'pending')
    .eq('direction', 'join_request')
    .order('created_at', { ascending: true })
  return (data ?? []) as ClubJoinRequest[]
}

export async function getFriends(userId: string): Promise<{
  friendId: string
  profile: Pick<Profile, 'username' | 'full_name' | 'avatar_url' | 'city'> & { eco_score: number }
}[]> {
  const { data } = await supabase
    .from('friend_requests')
    .select('id, sender_id, receiver_id')
    .eq('status', 'accepted')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
  if (!data || data.length === 0) return []

  const friendIds = data.map(r => (r.sender_id as string) === userId ? r.receiver_id as string : r.sender_id as string)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url, city, eco_score')
    .in('id', friendIds)

  return (profiles ?? []).map(p => ({
    friendId: p.id as string,
    profile: {
      username: p.username as string,
      full_name: p.full_name as string | null,
      avatar_url: p.avatar_url as string | null,
      city: p.city as string | null,
      eco_score: p.eco_score as number,
    },
  }))
}

// Uses SECURITY DEFINER RPC to bypass RLS and safely create/find a private conversation
export async function createOrGetPrivateConversation(_userId: string, otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_or_get_private_conversation', {
    other_user_id: otherId,
  })
  if (error) throw error
  return data as string
}

// Create (or reopen) the group chat for a club — admin only
export async function createClubConversation(clubId: string, clubName: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_club_conversation', {
    p_club_id: clubId,
    p_name: `${clubName} — Chat`,
  })
  if (error) throw error
  return data as string
}

// Get the existing club conversation id (or null)
export async function getClubConversation(clubId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('club_id', clubId)
    .eq('type', 'club')
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// Create a custom group conversation with chosen members
export async function createGroupConversation(name: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_conversation', {
    p_name: name,
    p_member_ids: memberIds,
  })
  if (error) throw error
  return data as string
}

// Send a "group_added" notification to each new member (except the creator)
export async function sendGroupAddedNotifications(
  convId: string,
  groupName: string,
  memberIds: string[],
  addedByUsername: string,
): Promise<void> {
  if (memberIds.length === 0) return
  const rows = memberIds.map(uid => ({
    user_id: uid,
    type: 'group_added',
    data: { group_name: groupName, conv_id: convId, added_by: addedByUsername },
  }))
  await supabase.from('notifications').insert(rows)
}

// ── Chat features ────────────────────────────────────────────────────────────

export async function editMessage(messageId: string, content: string): Promise<void> {
  const { error } = await supabase.rpc('edit_message', { p_message_id: messageId, p_content: content })
  if (error) throw error
}

export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_message', { p_message_id: messageId })
  if (error) throw error
}

export async function pinMessage(convId: string, messageId: string | null): Promise<void> {
  const { error } = await supabase.rpc('pin_message', { p_conv_id: convId, p_message_id: messageId })
  if (error) throw error
}

export async function toggleReaction(messageId: string, convId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('toggle_reaction', { p_message_id: messageId, p_conv_id: convId, p_emoji: emoji })
  if (error) throw error
}

export async function updateGroupSettings(convId: string, name: string, goalKm: number | null, goalDeadline: string | null): Promise<void> {
  // Use direct table update: bypasses the RPC admin check (which only looks at is_admin column,
  // not created_by). RLS on conversations allows the creator/admin to update their own rows.
  const { error } = await supabase.from('conversations').update({
    name,
    group_goal_km: goalKm,
    group_goal_deadline: goalDeadline,
  }).eq('id', convId)
  if (error) throw error
}

export async function addGroupMember(convId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_group_member', { p_conv_id: convId, p_user_id: userId })
  if (error) throw error
}

export async function removeGroupMember(convId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_group_member', { p_conv_id: convId, p_user_id: userId })
  if (error) throw error
}

export async function promoteToAdmin(convId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('conversation_members')
    .update({ is_admin: true })
    .eq('conversation_id', convId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function demoteFromAdmin(convId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('conversation_members')
    .update({ is_admin: false })
    .eq('conversation_id', convId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function leaveGroup(convId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_group', { p_conv_id: convId })
  if (error) throw error
}

export async function toggleMute(convId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_mute', { p_conv_id: convId })
  if (error) throw error
  return data as boolean
}

export async function uploadChatImage(file: File, convId: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${convId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('chat-media').upload(path, file, { upsert: false })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(path)
  return publicUrl
}

export async function getUserPendingRequests(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('club_join_requests')
    .select('club_id')
    .eq('user_id', userId)
    .eq('status', 'pending')
  return (data ?? []).map((r: { club_id: string }) => r.club_id)
}

// Increments eco_score and total_co2_saved on the profile after a new trip
export async function incrementProfileStats(
  userId: string,
  ecoPoints: number,
  co2Saved: number
): Promise<void> {
  // Always fetch profile first so we can compute streak
  const profile = await getProfile(userId)
  if (!profile) return

  const today     = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]
  const lastDate  = (profile as unknown as Record<string, unknown>).last_activity_date as string | null ?? null

  let newStreak = (profile as unknown as Record<string, unknown>).streak_days as number ?? 0
  if (lastDate === today) {
    // Already logged today — streak unchanged
  } else if (lastDate === yesterday) {
    newStreak = newStreak + 1          // consecutive day → extend
  } else {
    newStreak = 1                      // gap → reset to 1
  }

  // Try the RPC for points/co2 (atomic increment)
  const { error } = await supabase.rpc('increment_profile_stats', {
    p_user_id: userId,
    p_points: ecoPoints,
    p_co2: co2Saved,
  })

  if (error) {
    // RPC unavailable — update everything manually
    await supabase.from('profiles').update({
      eco_score:          (profile.eco_score ?? 0) + ecoPoints,
      total_co2_saved:    Number(profile.total_co2_saved ?? 0) + co2Saved,
      streak_days:        newStreak,
      last_activity_date: today,
      updated_at:         new Date().toISOString(),
    }).eq('id', userId)
  } else {
    // RPC handled points/co2 — patch streak separately
    await supabase.from('profiles').update({
      streak_days:        newStreak,
      last_activity_date: today,
      updated_at:         new Date().toISOString(),
    }).eq('id', userId)
  }
}

// ── Carpool expiry & auto-award ───────────────────────────────────────────────

/** Called on the Carpooling page load. Finds rides whose departure_time has
 *  passed, marks them 'completed', awards eco points + inserts trip records
 *  for the driver and every passenger. */
export async function processExpiredCarpoolRides(): Promise<void> {
  const now = new Date().toISOString()

  const { data: expired } = await supabase
    .from('carpooling_rides')
    .select('id, driver_id, distance_km, booked_seats')
    .eq('status', 'active')
    .lt('departure_time', now)

  if (!expired?.length) return

  for (const ride of expired) {
    // Mark completed first → prevents double-processing on concurrent loads
    const { error: completeErr } = await supabase
      .from('carpooling_rides')
      .update({ status: 'completed' })
      .eq('id', ride.id)
    if (completeErr) continue

    const distKm    = Number(ride.distance_km) || 15
    const co2PerSeat = distKm * 0.05  // ~50 g/km saved vs solo car

    const { data: bookings } = await supabase
      .from('carpooling_bookings')
      .select('passenger_id')
      .eq('ride_id', ride.id)

    const passCount = bookings?.length ?? 0
    const driverPts = Math.round(distKm * 2 + passCount * 10 + 20)
    const passPts   = Math.round(distKm * 1.5 + 15)

    // ── Award driver ──
    const { data: driverP } = await supabase
      .from('profiles').select('eco_score, total_co2_saved').eq('id', ride.driver_id).single()
    if (driverP) {
      const driverCo2 = co2PerSeat * (passCount + 1)
      await supabase.from('profiles').update({
        eco_score:       (driverP.eco_score as number ?? 0) + driverPts,
        total_co2_saved: Number(driverP.total_co2_saved ?? 0) + driverCo2,
      }).eq('id', ride.driver_id)
      await supabase.from('trips').insert({
        user_id: ride.driver_id, transport_mode: 'carpooling',
        distance_km: distKm, co2_saved_kg: driverCo2, eco_points: driverPts,
        notes: `Carpool completato — ${passCount} passeggero${passCount !== 1 ? 'i' : ''}`,
        recorded_at: now,
      })
    }

    // ── Award passengers ──
    for (const b of (bookings ?? [])) {
      const { data: passP } = await supabase
        .from('profiles').select('eco_score, total_co2_saved').eq('id', b.passenger_id).single()
      if (passP) {
        await supabase.from('profiles').update({
          eco_score:       (passP.eco_score as number ?? 0) + passPts,
          total_co2_saved: Number(passP.total_co2_saved ?? 0) + co2PerSeat,
        }).eq('id', b.passenger_id)
        await supabase.from('trips').insert({
          user_id: b.passenger_id, transport_mode: 'carpooling',
          distance_km: distKm, co2_saved_kg: co2PerSeat, eco_points: passPts,
          notes: 'Carpool completato (passeggero)',
          recorded_at: now,
        })
      }
    }
  }
}

// ── Shop seed ─────────────────────────────────────────────────────────────────

const SHOP_SEED_ITEMS = [
  { name: 'Caffè bio gratuito',           description: '1 caffè gratuito in un bar partner sostenibile',                  category: 'voucher',    points_cost: 150,  stock: 100, partner_name: 'GreenCafé',       is_active: true },
  { name: 'Sconto 20% negozio bio',        description: 'Coupon sconto 20% su tutto il catalogo di un negozio bio partner', category: 'voucher',    points_cost: 200,  stock: 200, partner_name: 'BioShop',          is_active: true },
  { name: 'Noleggio monopattino 1 giorno', description: 'Giornata intera di noleggio monopattino elettrico certificato',   category: 'voucher',    points_cost: 350,  stock: 60,  partner_name: 'ScootGreen',       is_active: true },
  { name: 'Colazione vegan per 2',         description: 'Colazione completa 100% vegan e km0 per te e un amico',           category: 'voucher',    points_cost: 450,  stock: 40,  partner_name: 'VegMorning',       is_active: true },
  { name: 'Car sharing elettrico 1 mese',  description: 'Accesso illimitato alla flotta di auto elettriche condivise',      category: 'voucher',    points_cost: 1800, stock: 10,  partner_name: 'ElettriCar',       is_active: true },
  { name: 'Abbonamento mensile bus',        description: 'Un mese di trasporto pubblico gratuito nella tua città',          category: 'voucher',    points_cost: 2000, stock: 20,  partner_name: 'ATM Milano',       is_active: true },
  { name: 'Borraccia EcoTrack',            description: 'Borraccia in acciaio inox 750ml con logo EcoTrack',              category: 'gadget',     points_cost: 500,  stock: 50,  partner_name: 'EcoTrack',         is_active: true },
  { name: 'Kit sementi autoctone',         description: '12 varietà di piante autoctone italiane da coltivare',            category: 'gadget',     points_cost: 250,  stock: 80,  partner_name: 'SementiVive',      is_active: true },
  { name: 'Kit riparazione bici',          description: 'Tutto il necessario per riparare una foratura in autonomia',      category: 'gadget',     points_cost: 400,  stock: 45,  partner_name: 'BikeRepair',       is_active: true },
  { name: 'Powerbank solare 10000mAh',     description: 'Caricatore portatile con pannello solare integrato',              category: 'gadget',     points_cost: 900,  stock: 30,  partner_name: 'SolarTech',        is_active: true },
  { name: 'Zaino in materiale riciclato',  description: 'Zaino 25L realizzato al 100% da plastica riciclata dall\'oceano', category: 'gadget',     points_cost: 1200, stock: 25,  partner_name: 'OceanGear',        is_active: true },
  { name: 'Tour e-bike guidato 2h',        description: 'Tour di 2 ore in e-bike con guida esperta in città',             category: 'experience', points_cost: 800,  stock: 30,  partner_name: 'BikeCity',         is_active: true },
  { name: 'Corso urban gardening',         description: 'Workshop pratico di 3 ore per coltivare in spazi urbani',        category: 'experience', points_cost: 600,  stock: 20,  partner_name: 'CittàVerde',       is_active: true },
  { name: 'Pranzo da chef km0 per 2',      description: 'Menu degustazione 5 portate con ingredienti locali per 2',       category: 'experience', points_cost: 1000, stock: 12,  partner_name: 'ChefTerritorio',   is_active: true },
  { name: 'Visita azienda agricola bio',   description: 'Mezza giornata in un\'azienda agricola biologica certificata',    category: 'experience', points_cost: 550,  stock: 25,  partner_name: 'AgriToscana',      is_active: true },
  { name: 'Pianta un albero in Italia',    description: 'Piantiamo un albero autoctono a tuo nome in area certificata',   category: 'donation',   points_cost: 300,  stock: null, partner_name: 'TreeItaly',       is_active: true },
  { name: 'Proteggi foresta amazzonica',   description: 'Proteggi 100 m² di foresta amazzonica primaria per 10 anni',     category: 'donation',   points_cost: 400,  stock: null, partner_name: 'RainForest',      is_active: true },
  { name: 'Adotta un alveare',             description: 'Sostieni un apicoltore locale e ricevi aggiornamenti sull\'alveare', category: 'donation', points_cost: 500, stock: null, partner_name: 'SaveBees',        is_active: true },
  { name: 'Certificato CO₂ compensata',    description: 'Certifica la compensazione di 500 kg di CO₂ — standard Gold Standard', category: 'donation', points_cost: 350, stock: null, partner_name: 'ClimateNow', is_active: true },
  { name: 'Eco Novizio',                   description: 'Il primo passo verso la mobilità sostenibile.',                   category: 'title',      points_cost: 100,  stock: null, partner_name: null,               is_active: true },
  { name: 'Ciclista Urbano',               description: 'Per chi percorre almeno 50 km in bici in città.',                 category: 'title',      points_cost: 300,  stock: null, partner_name: null,               is_active: true },
  { name: 'Guerriero Verde',               description: 'Titolo per i campioni della mobilità a zero emissioni.',          category: 'title',      points_cost: 600,  stock: null, partner_name: null,               is_active: true },
  { name: 'Custode del Pianeta',           description: 'Hai risparmiato oltre 50 kg di CO₂. Il pianeta ti ringrazia.',   category: 'title',      points_cost: 1000, stock: null, partner_name: null,               is_active: true },
  { name: 'Pendolare Sostenibile',         description: 'Per chi usa quotidianamente treni e trasporti pubblici.',         category: 'title',      points_cost: 450,  stock: null, partner_name: null,               is_active: true },
  { name: 'Solar Rider',                   description: 'Per chi usa energie rinnovabili nei suoi spostamenti.',           category: 'title',      points_cost: 750,  stock: null, partner_name: null,               is_active: true },
  { name: 'Eco Leggenda',                  description: 'Il titolo più prestigioso. Solo per i più dedicati.',             category: 'title',      points_cost: 2500, stock: null, partner_name: null,               is_active: true },
]

/** Seeds the shop_items table with realistic items. Safe to call multiple times — uses upsert by name. */
export async function seedShopItems(): Promise<{ seeded: number; error: string | null }> {
  const { data, error } = await supabase
    .from('shop_items')
    .upsert(SHOP_SEED_ITEMS, { onConflict: 'name', ignoreDuplicates: true })
    .select('id')
  if (error) return { seeded: 0, error: error.message }
  return { seeded: data?.length ?? SHOP_SEED_ITEMS.length, error: null }
}
