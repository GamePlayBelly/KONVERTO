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
  if (pts >= 1000) return `${(pts / 1000).toFixed(1)}k`
  return String(pts)
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
