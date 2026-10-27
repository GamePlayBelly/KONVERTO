import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { TransportMode } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── CO₂ & Points calculation ─────────────────────────────────────────────────

// kg CO₂ per km for each transport mode
export const CO2_PER_KM: Record<TransportMode, number> = {
  walking:           0,
  cycling:           0,
  ebike:             0.011,   // E-bike (ricarica)
  escooter:          0.022,   // Monopattino condiviso
  public_transport:  0.021,   // Bus urbano
  tram_metro:        0.029,   // Tram / Metro
  train:             0.041,   // Treno regionale
  electric_vehicle:  0.053,   // Auto elettrica
  motorcycle:        0.103,   // Moto/Scooter termico
  carpooling:        0.043,   // Carpooling (media occupanti)
  car:               0.171,   // Auto benzina (pari al baseline → risparmio 0)
  airplane:          0.255,   // Aereo corto raggio per passeggero
}

// Baseline: average petrol car
const CO2_AUTO_MEDIA = 0.171

export function calcCO2Saved(mode: TransportMode, km: number): number {
  return Math.max(0, (CO2_AUTO_MEDIA - (CO2_PER_KM[mode] ?? 0)) * km)
}

export function calcEcoPoints(co2Saved: number, km: number): number {
  return Math.round(co2Saved * 100 + km * 2)
}

// ── Transport metadata ────────────────────────────────────────────────────────

export const TRANSPORT_META: Record<
  TransportMode,
  { label: string; emoji: string; color: string; bgColor: string; co2Label: string }
> = {
  walking:           { label: 'A piedi',        emoji: '🚶', color: 'text-emerald-700', bgColor: 'bg-emerald-50',  co2Label: '0 g/km'   },
  cycling:           { label: 'Bici',           emoji: '🚴', color: 'text-blue-700',    bgColor: 'bg-blue-50',     co2Label: '0 g/km'   },
  ebike:             { label: 'E-Bike',         emoji: '⚡🚲', color: 'text-cyan-700',  bgColor: 'bg-cyan-50',     co2Label: '11 g/km'  },
  escooter:          { label: 'Monopattino',    emoji: '🛴', color: 'text-teal-700',    bgColor: 'bg-teal-50',     co2Label: '22 g/km'  },
  public_transport:  { label: 'Bus',            emoji: '🚌', color: 'text-violet-700',  bgColor: 'bg-violet-50',   co2Label: '21 g/km'  },
  tram_metro:        { label: 'Metro/Tram',     emoji: '🚇', color: 'text-indigo-700',  bgColor: 'bg-indigo-50',   co2Label: '29 g/km'  },
  train:             { label: 'Treno',          emoji: '🚂', color: 'text-sky-700',     bgColor: 'bg-sky-50',      co2Label: '41 g/km'  },
  electric_vehicle:  { label: 'Auto Elettrica', emoji: '🔋', color: 'text-yellow-700',  bgColor: 'bg-yellow-50',   co2Label: '53 g/km'  },
  motorcycle:        { label: 'Moto',           emoji: '🏍️', color: 'text-orange-700', bgColor: 'bg-orange-50',   co2Label: '103 g/km' },
  carpooling:        { label: 'Carpooling',     emoji: '🚗', color: 'text-rose-700',    bgColor: 'bg-rose-50',     co2Label: '43 g/km'  },
  car:               { label: 'Auto',           emoji: '🚙', color: 'text-gray-700',    bgColor: 'bg-gray-50',     co2Label: '171 g/km' },
  airplane:          { label: 'Aereo',          emoji: '✈️', color: 'text-sky-600',     bgColor: 'bg-sky-50',      co2Label: '255 g/km' },
}

// Distanza massima plausibile per UN viaggio, per mezzo (km). Senza un tetto bastava
// scrivere "238623 km a piedi" per ottenere milioni di punti e falsare ogni classifica.
export const MAX_TRIP_KM: Record<TransportMode, number> = {
  walking:           100,
  cycling:           400,
  ebike:             300,
  escooter:          80,
  public_transport:  500,
  tram_metro:        300,
  train:             2500,
  electric_vehicle:  2000,
  motorcycle:        2000,
  carpooling:        1500,
  car:               2000,
  airplane:          12000,
}

/** Tetto km per un viaggio fatto con uno o più mezzi (multi-mezzo → vale il più alto). */
export function maxTripKm(modes: TransportMode[]): number {
  return Math.max(...modes.map(m => MAX_TRIP_KM[m] ?? 0))
}

// Suggest best modes for a given distance (eco-first)
export function suggestModes(km: number): TransportMode[] {
  if (km <= 0)   return ['cycling', 'walking', 'escooter']
  if (km < 1.5)  return ['walking', 'cycling', 'escooter']
  if (km < 5)    return ['cycling', 'escooter', 'ebike']
  if (km < 15)   return ['cycling', 'ebike', 'tram_metro']
  if (km < 30)   return ['tram_metro', 'train', 'ebike']
  if (km < 100)  return ['train', 'tram_metro', 'carpooling']
  if (km < 500)  return ['train', 'carpooling', 'electric_vehicle']
  return ['train', 'electric_vehicle', 'carpooling'] // aereo/auto mai suggeriti
}

// ── Date utilities ────────────────────────────────────────────────────────────

export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

// ── Streak (giorni di calendario nel fuso orario del dispositivo) ─────────────

/** 'YYYY-MM-DD' nel fuso locale. toISOString() darebbe la data UTC, che di notte
 *  (00:00–02:00 in Italia) è ancora "ieri" e spezzava le serie. */
export function toLocalDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Somma `n` giorni di calendario a 'YYYY-MM-DD' (sicuro anche col cambio ora legale). */
export function addDaysToDateStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return toLocalDateStr(new Date(y, m - 1, d + n))
}

/** Streak = giorni consecutivi con almeno un viaggio, che arrivano a oggi o a ieri.
 *  `lastDay` è l'ultimo giorno con attività (anche se la serie è ormai spezzata). */
export function computeStreak(
  days: Iterable<string>,
  today: string = toLocalDateStr(),
): { streak: number; lastDay: string | null } {
  const set = new Set(days)
  let lastDay: string | null = null
  for (const d of set) if (d <= today && (lastDay === null || d > lastDay)) lastDay = d
  if (lastDay === null) return { streak: 0, lastDay: null }
  if (lastDay < addDaysToDateStr(today, -1)) return { streak: 0, lastDay }
  let streak = 0
  for (let d = lastDay; set.has(d); d = addDaysToDateStr(d, -1)) streak++
  return { streak, lastDay }
}

export type StreakStatus = 'none' | 'active' | 'at_risk' | 'lost'

/** Streak "vera" da mostrare: il valore salvato nel profilo non scade da solo, quindi
 *  se l'ultima attività è più vecchia di ieri la serie è già persa (0 giorni).
 *   none    = nessuna serie   · active = hai già registrato oggi
 *   at_risk = ultima attività ieri, oggi non ancora → registra per non perderla
 *   lost    = serie spezzata (nessun avviso: meglio ripartire che mostrare un vecchio 1) */
export function getStreakStatus(
  profile: { streak_days?: number | null; last_activity_date?: string | null } | null | undefined,
  today: string = toLocalDateStr(),
): { days: number; status: StreakStatus } {
  const stored = profile?.streak_days ?? 0
  const last = profile?.last_activity_date ?? null
  if (stored <= 0 || !last) return { days: 0, status: 'none' }
  if (last >= today) return { days: stored, status: 'active' }
  if (last === addDaysToDateStr(today, -1)) return { days: stored, status: 'at_risk' }
  return { days: 0, status: 'lost' }
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function formatRelative(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Adesso'
  if (diffMins < 60) return `${diffMins}m fa`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h fa`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}g fa`
  return formatDate(dateStr)
}

export function formatCountdown(dateStr: string): string {
  const target = new Date(dateStr)
  const now = new Date()
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return 'Scaduto'
  const days = Math.floor(diffMs / 86400000)
  const hours = Math.floor((diffMs % 86400000) / 3600000)
  if (days > 0) return `tra ${days}g ${hours}h`
  const mins = Math.floor((diffMs % 3600000) / 60000)
  if (hours > 0) return `tra ${hours}h ${mins}m`
  return `tra ${mins} min`
}

// ── Number formatting ─────────────────────────────────────────────────────────

export function formatCO2(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`
  return `${kg.toFixed(1)} kg`
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

export function formatPoints(pts: number): string {
  const n = Number(pts) || 0
  const abs = Math.abs(n)
  // Above ~1M the "k" suffix produces unreadable values (14808.9k instead of 14.8M).
  if (abs >= 999_950) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

// ── CO₂ equivalenti ──────────────────────────────────────────────────────────

export interface CO2Equivalents {
  kmCar: number
  trees: string
  coffees: number
  phones: number
  steaks: number
}

export function getCO2Equivalents(co2Kg: number): CO2Equivalents {
  return {
    kmCar:   Math.round(co2Kg / 0.171),
    trees:   (co2Kg / 22).toFixed(1),
    coffees: Math.round(co2Kg / 0.021),
    phones:  Math.round(co2Kg / 0.008),
    steaks:  parseFloat((co2Kg / 6.6).toFixed(1)),
  }
}

export function getBestEquivalent(co2Kg: number): { emoji: string; text: string } {
  const eq = getCO2Equivalents(co2Kg)
  if (co2Kg < 0.05) return { emoji: '☕', text: `${eq.coffees} caffè risparmiati` }
  if (co2Kg < 1)    return { emoji: '📱', text: `${eq.phones} cariche smartphone` }
  if (co2Kg < 5)    return { emoji: '🚗', text: `${eq.kmCar} km NON in auto` }
  if (co2Kg < 20)   return { emoji: '🌳', text: `${eq.trees} alberi piantati` }
  return { emoji: '🥩', text: `${eq.steaks} bistecche evitate` }
}

// ── Levels system ─────────────────────────────────────────────────────────────

export interface EcoLevel {
  level: number
  name: string
  minPts: number
  maxPts: number        // -1 = unlimited (max level)
  color: string         // Tailwind text color
  bg: string            // Tailwind bg color
  border: string        // Tailwind border color
  progressColor: string // Tailwind bg color for progress bar
}

export const ECO_LEVELS: EcoLevel[] = [
  { level: 1, name: 'Novizio',             minPts: 0,     maxPts: 499,   color: 'text-gray-600',   bg: 'bg-gray-100',   border: 'border-gray-200',   progressColor: 'bg-gray-400'    },
  { level: 2, name: 'Apprendista',         minPts: 500,   maxPts: 999,   color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200',  progressColor: 'bg-green-400'   },
  { level: 3, name: 'Eco Explorer',        minPts: 1000,  maxPts: 2499,  color: 'text-teal-700',   bg: 'bg-teal-50',    border: 'border-teal-200',   progressColor: 'bg-teal-500'    },
  { level: 4, name: 'Eco Guardian',        minPts: 2500,  maxPts: 4999,  color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200',   progressColor: 'bg-blue-500'    },
  { level: 5, name: 'Eco Champion',        minPts: 5000,  maxPts: 9999,  color: 'text-indigo-700', bg: 'bg-indigo-50',  border: 'border-indigo-200', progressColor: 'bg-indigo-500'  },
  { level: 6, name: 'Eco Master',          minPts: 10000, maxPts: 19999, color: 'text-purple-700', bg: 'bg-purple-50',  border: 'border-purple-200', progressColor: 'bg-purple-500'  },
  { level: 7, name: 'Eco Leggenda',        minPts: 20000, maxPts: -1,    color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-300',  progressColor: 'bg-amber-500'   },
]

export function getEcoLevel(pts: number): EcoLevel & { pct: number; ptsToNext: number } {
  const lvl = [...ECO_LEVELS].reverse().find((l: EcoLevel) => pts >= l.minPts) ?? ECO_LEVELS[0]
  const isMax = lvl.maxPts === -1
  const range = isMax ? 1 : lvl.maxPts - lvl.minPts + 1
  const progress = isMax ? 1 : (pts - lvl.minPts) / range
  const ptsToNext = isMax ? 0 : lvl.maxPts + 1 - pts
  return { ...lvl, pct: Math.min(100, Math.round(progress * 100)), ptsToNext }
}
