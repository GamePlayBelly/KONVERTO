// Activity badges are derived from the user's own stats (nothing is awarded server-side:
// the user_badges table is empty). Keep thresholds in sync with the Badge tab of Profile.
export type BadgeMetric = 'trips' | 'km' | 'co2' | 'streak' | 'points'

export interface ActivityBadgeDef {
  id: string
  emoji: string
  name: string
  threshold: number
  metric: BadgeMetric
}

export const ACTIVITY_BADGES: ActivityBadgeDef[] = [
  { id: 'first_trip', emoji: '🌱', name: 'Primo passo',       threshold: 1,    metric: 'trips'  },
  { id: 'km_50',      emoji: '🚴', name: 'Ciclista',          threshold: 50,   metric: 'km'     },
  { id: 'km_100',     emoji: '🧭', name: 'Esploratore',       threshold: 100,  metric: 'km'     },
  { id: 'km_500',     emoji: '🏔️', name: 'Maratoneta Verde',  threshold: 500,  metric: 'km'     },
  { id: 'co2_10',     emoji: '🍃', name: 'Eco Warrior',       threshold: 10,   metric: 'co2'    },
  { id: 'co2_50',     emoji: '🌍', name: 'Custode del Clima', threshold: 50,   metric: 'co2'    },
  { id: 'streak_7',   emoji: '🔥', name: 'Settimana Verde',   threshold: 7,    metric: 'streak' },
  { id: 'streak_30',  emoji: '⚡', name: 'Mese Sostenibile',  threshold: 30,   metric: 'streak' },
  { id: 'pts_1000',   emoji: '⭐', name: 'Eco Star',          threshold: 1000, metric: 'points' },
  { id: 'pts_5000',   emoji: '🏆', name: 'Eco Leggenda',      threshold: 5000, metric: 'points' },
]

export type BadgeValues = Record<BadgeMetric, number>

export function getUnlockedBadges(values: BadgeValues): ActivityBadgeDef[] {
  return ACTIVITY_BADGES.filter(b => values[b.metric] >= b.threshold)
}
