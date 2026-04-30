export type TransportMode =
  | 'walking'
  | 'cycling'
  | 'ebike'
  | 'escooter'
  | 'public_transport'
  | 'tram_metro'
  | 'train'
  | 'electric_vehicle'
  | 'motorcycle'
  | 'carpooling'
  | 'car'
  | 'airplane'

export type BadgeCategory = 'distance' | 'streak' | 'co2' | 'social' | 'special'

export type ChallengeMetric = 'eco_points' | 'co2_saved' | 'distance_km'
export type ChallengeStatus = 'pending' | 'active' | 'completed' | 'rejected'

export interface Profile {
  id: string
  username: string
  full_name: string | null
  avatar_url: string | null
  city: string | null
  bio: string | null
  preferred_transport: TransportMode | null
  weekly_goal_km: number | null
  eco_score: number
  total_co2_saved: number
  streak_days: number
  last_activity_date: string | null
  active_title: string | null
  created_at: string
  updated_at: string
}

export interface Trip {
  id: string
  user_id: string
  transport_mode: TransportMode
  distance_km: number
  duration_minutes: number | null
  co2_saved_kg: number
  eco_points: number
  start_location: GeoLocation | null
  end_location: GeoLocation | null
  notes: string | null
  recorded_at: string
  is_scheduled?: boolean
}

export interface GeoLocation {
  lat: number
  lng: number
  label?: string
}

export interface Badge {
  id: string
  name: string
  description: string | null
  icon_name: string | null
  category: BadgeCategory | null
  threshold_value: number | null
  points_reward: number
}

export interface UserBadge {
  id: string
  user_id: string
  badge_id: string
  earned_at: string
  badge?: Badge
}

export interface LeaderboardEntry {
  id: string
  user_id: string
  week_start: string
  total_points: number
  total_co2_saved: number
  total_distance_km: number
  rank: number | null
  profile?: Pick<Profile, 'username' | 'full_name' | 'avatar_url' | 'city'>
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  retryText?: string
  truncated?: boolean
}

export interface Challenge {
  id: string
  challenger_id: string
  challenged_id: string
  metric: ChallengeMetric
  duration_days: number
  start_date: string
  end_date: string
  challenger_score: number
  challenged_score: number
  status: ChallengeStatus
  winner_id: string | null
  created_at: string
  challenger?: Pick<Profile, 'username' | 'full_name' | 'avatar_url'>
  challenged?: Pick<Profile, 'username' | 'full_name' | 'avatar_url'>
}

export interface TripFormData {
  transport_mode: TransportMode
  distance_km: number
  duration_minutes: number | null
  start_location: GeoLocation | null
  end_location: GeoLocation | null
  notes: string
  recorded_at?: string
}

// ── Notification & Social types ──────────────────────────────────────────────

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'club_join_request'
  | 'club_invite'
  | 'club_join_accepted'
  | 'club_join_rejected'
  | 'group_added'
  | 'challenge_received'
  | 'challenge_accepted'

export interface NotificationData {
  request_id?: string
  sender_id?: string
  sender_username?: string
  sender_avatar?: string | null
  club_id?: string
  club_name?: string
  club_avatar?: string | null
  user_id?: string
  username?: string
  avatar?: string | null
  // group_added
  group_name?: string
  conv_id?: string
  added_by?: string
  // challenge
  challenge_id?: string
  challenger_username?: string
  challenger_avatar?: string | null
  metric?: string
  duration_days?: number
}

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  data: NotificationData
  read: boolean
  created_at: string
}

export interface FriendRequest {
  id: string
  sender_id: string
  receiver_id: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
}

export interface ClubJoinRequest {
  id: string
  club_id: string
  user_id: string
  direction: 'join_request' | 'invite'
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  profile?: Pick<Profile, 'username' | 'full_name' | 'avatar_url'>
}
