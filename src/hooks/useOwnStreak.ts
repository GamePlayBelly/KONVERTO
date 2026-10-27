import { useEffect, useState } from 'react'
import { getOwnStreak } from '@/lib/supabase'
import { addDaysToDateStr, getStreakStatus, toLocalDateStr, type StreakStatus } from '@/lib/utils'
import type { Profile } from '@/types'

/** Streak of the logged-in user, shown correctly:
 *  starts from the stored counter (judged by its last activity date, so an expired streak
 *  is not shown) and then replaces it with the one derived from the user's real trips
 *  (carpool and scheduled trips included, local days). Read-only: nothing is written.
 *  Re-reads when the score changes, i.e. right after a new trip is credited. */
export function useOwnStreak(
  userId: string | undefined,
  profile: Pick<Profile, 'streak_days' | 'last_activity_date' | 'eco_score'> | null | undefined,
): { days: number; status: StreakStatus } {
  const [derived, setDerived] = useState<{ streak: number; lastDay: string | null } | null>(null)
  const score = profile?.eco_score

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getOwnStreak(userId)
      .then(r => { if (!cancelled && r) setDerived(r) })
      .catch(() => { /* keep the stored value */ })
    return () => { cancelled = true }
  }, [userId, score])

  if (!derived) return getStreakStatus(profile)
  const today = toLocalDateStr()
  if (derived.streak <= 0 || !derived.lastDay) return { days: 0, status: derived.lastDay ? 'lost' : 'none' }
  if (derived.lastDay >= today) return { days: derived.streak, status: 'active' }
  if (derived.lastDay === addDaysToDateStr(today, -1)) return { days: derived.streak, status: 'at_risk' }
  return { days: 0, status: 'lost' }
}
