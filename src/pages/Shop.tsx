import { useEffect, useState, useCallback } from 'react'
import {
  ShoppingBag, Zap, Medal, Package, CheckCircle2, Heart,
  Crown, Leaf, Trophy, Sprout, Bike, Route, Mountain, Globe,
  Flame, Star, Car, UserCheck, Layers, Plus, Trash2, Edit3,
  Users, Building2, X, Check, AlertTriangle, Gift, Clock,
  ChevronDown, ChevronUp, Sparkles, Coffee, Music, Camera,
  Ticket, Rocket, Smile, Sun, Pizza, Wine, UtensilsCrossed,
  Dumbbell, BookOpen, Gamepad2, Palmtree, Shirt, type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  supabase,
  getClubPrizes, createClubPrize, updateClubPrize, deleteClubPrize,
  redeemClubPrize, getUserClubPrizeRedemptions, getUserAdminClubs,
} from '@/lib/supabase'
import type { ClubPrize } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

// ── Badge definitions ────────────────────────────────────────────────────────

type BadgeMetric = 'trips' | 'km' | 'co2' | 'streak' | 'points' | 'carpool'

interface ActivityBadge {
  id: string; icon: React.ReactNode; name: string; desc: string
  threshold: number; metric: BadgeMetric; color?: string
}

const ACTIVITY_BADGES: ActivityBadge[] = [
  { id: 'first_trip',  icon: <Sprout    className="w-6 h-6 text-eco-green" />,    name: 'Primo passo',          desc: 'Registra il tuo primo viaggio',          threshold: 1,     metric: 'trips',   color: 'from-green-50 to-emerald-100' },
  { id: 'trips_5',     icon: <Bike      className="w-6 h-6 text-blue-400" />,      name: 'Pendolare',            desc: '5 viaggi registrati',                    threshold: 5,     metric: 'trips',   color: 'from-blue-50 to-sky-100' },
  { id: 'trips_10',    icon: <Route     className="w-6 h-6 text-indigo-500" />,    name: 'Habitué Verde',        desc: '10 viaggi registrati',                   threshold: 10,    metric: 'trips',   color: 'from-indigo-50 to-blue-100' },
  { id: 'trips_50',    icon: <Layers    className="w-6 h-6 text-violet-500" />,    name: 'Veterano Eco',         desc: '50 viaggi registrati',                   threshold: 50,    metric: 'trips',   color: 'from-violet-50 to-purple-100' },
  { id: 'km_20',       icon: <Bike      className="w-6 h-6 text-blue-500" />,      name: 'Ciclista',             desc: 'Percorri 20 km totali',                  threshold: 20,    metric: 'km',      color: 'from-blue-50 to-cyan-100' },
  { id: 'km_100',      icon: <Route     className="w-6 h-6 text-indigo-500" />,    name: 'Esploratore',          desc: 'Percorri 100 km totali',                 threshold: 100,   metric: 'km',      color: 'from-indigo-50 to-blue-100' },
  { id: 'km_500',      icon: <Mountain  className="w-6 h-6 text-purple-500" />,    name: 'Maratoneta Verde',     desc: 'Percorri 500 km totali',                 threshold: 500,   metric: 'km',      color: 'from-purple-50 to-violet-100' },
  { id: 'km_1000',     icon: <Globe     className="w-6 h-6 text-teal-600" />,      name: 'Giro del Mondo',       desc: 'Percorri 1 000 km totali',               threshold: 1000,  metric: 'km',      color: 'from-teal-50 to-cyan-100' },
  { id: 'co2_5',       icon: <Leaf      className="w-6 h-6 text-eco-green" />,     name: 'Primo respiro',        desc: 'Risparmia 5 kg CO₂',                     threshold: 5,     metric: 'co2',     color: 'from-green-50 to-lime-100' },
  { id: 'co2_25',      icon: <Leaf      className="w-6 h-6 text-emerald-500" />,   name: 'Eco Warrior',          desc: 'Risparmia 25 kg CO₂',                    threshold: 25,    metric: 'co2',     color: 'from-emerald-50 to-green-100' },
  { id: 'co2_100',     icon: <Globe     className="w-6 h-6 text-teal-500" />,      name: 'Custode del Clima',    desc: 'Risparmia 100 kg CO₂',                   threshold: 100,   metric: 'co2',     color: 'from-teal-50 to-emerald-100' },
  { id: 'co2_500',     icon: <Mountain  className="w-6 h-6 text-cyan-600" />,      name: 'Salvatore del Pianeta',desc: 'Risparmia 500 kg CO₂',                   threshold: 500,   metric: 'co2',     color: 'from-cyan-50 to-teal-100' },
  { id: 'streak_3',    icon: <Flame     className="w-6 h-6 text-orange-400" />,    name: 'Tre di fila',          desc: '3 giorni consecutivi di viaggio',        threshold: 3,     metric: 'streak',  color: 'from-orange-50 to-amber-100' },
  { id: 'streak_7',    icon: <Flame     className="w-6 h-6 text-orange-500" />,    name: 'Settimana Verde',      desc: '7 giorni di streak',                     threshold: 7,     metric: 'streak',  color: 'from-orange-50 to-red-100' },
  { id: 'streak_14',   icon: <Zap       className="w-6 h-6 text-yellow-500" />,    name: 'Fortnight Eco',        desc: '14 giorni consecutivi',                  threshold: 14,    metric: 'streak',  color: 'from-yellow-50 to-amber-100' },
  { id: 'streak_30',   icon: <Zap       className="w-6 h-6 text-amber-500" />,     name: 'Mese Sostenibile',     desc: '30 giorni di streak',                    threshold: 30,    metric: 'streak',  color: 'from-amber-50 to-yellow-100' },
  { id: 'pts_200',     icon: <Star      className="w-6 h-6 text-yellow-400" />,    name: 'Eco Starter',          desc: 'Raggiungi 200 punti totali',             threshold: 200,   metric: 'points',  color: 'from-yellow-50 to-lime-100' },
  { id: 'pts_1000',    icon: <Star      className="w-6 h-6 text-yellow-500" />,    name: 'Eco Star',             desc: 'Raggiungi 1 000 punti',                  threshold: 1000,  metric: 'points',  color: 'from-amber-50 to-yellow-100' },
  { id: 'pts_5000',    icon: <Trophy    className="w-6 h-6 text-amber-500" />,     name: 'Eco Campione',         desc: 'Raggiungi 5 000 punti',                  threshold: 5000,  metric: 'points',  color: 'from-amber-50 to-orange-100' },
  { id: 'pts_20000',   icon: <Trophy    className="w-6 h-6 text-orange-600" />,    name: 'Eco Leggenda',         desc: 'Raggiungi 20 000 punti',                 threshold: 20000, metric: 'points',  color: 'from-orange-50 to-red-100' },
  { id: 'carpool_1',   icon: <Car       className="w-6 h-6 text-sky-500" />,       name: 'Primo Carpool',        desc: 'Completa il tuo primo carpool',          threshold: 1,     metric: 'carpool', color: 'from-sky-50 to-blue-100' },
  { id: 'carpool_5',   icon: <UserCheck className="w-6 h-6 text-blue-600" />,      name: 'Carpooler',            desc: '5 viaggi in carpool completati',         threshold: 5,     metric: 'carpool', color: 'from-blue-50 to-indigo-100' },
  { id: 'carpool_20',  icon: <Users     className="w-6 h-6 text-indigo-600" />,    name: 'Re del Carpool',       desc: '20 viaggi in carpool completati',        threshold: 20,    metric: 'carpool', color: 'from-indigo-50 to-violet-100' },
]

// ── Prize icon picker ─────────────────────────────────────────────────────────

interface PrizeIcon { id: string; Icon: LucideIcon; color: string; label: string }

const PRIZE_ICONS: PrizeIcon[] = [
  { id: 'gift',      Icon: Gift,            color: 'text-eco-green',   label: 'Regalo'      },
  { id: 'trophy',    Icon: Trophy,          color: 'text-amber-500',   label: 'Trofeo'      },
  { id: 'star',      Icon: Star,            color: 'text-yellow-500',  label: 'Stella'      },
  { id: 'crown',     Icon: Crown,           color: 'text-amber-600',   label: 'Corona'      },
  { id: 'medal',     Icon: Medal,           color: 'text-orange-500',  label: 'Medaglia'    },
  { id: 'heart',     Icon: Heart,           color: 'text-red-500',     label: 'Cuore'       },
  { id: 'leaf',      Icon: Leaf,            color: 'text-eco-green',   label: 'Foglia'      },
  { id: 'flame',     Icon: Flame,           color: 'text-orange-500',  label: 'Fuoco'       },
  { id: 'zap',       Icon: Zap,             color: 'text-yellow-500',  label: 'Fulmine'     },
  { id: 'coffee',    Icon: Coffee,          color: 'text-amber-700',   label: 'Caffè'       },
  { id: 'pizza',     Icon: Pizza,           color: 'text-orange-400',  label: 'Pizza'       },
  { id: 'food',      Icon: UtensilsCrossed, color: 'text-red-400',     label: 'Pranzo'      },
  { id: 'wine',      Icon: Wine,            color: 'text-purple-500',  label: 'Vino'        },
  { id: 'music',     Icon: Music,           color: 'text-indigo-500',  label: 'Musica'      },
  { id: 'ticket',    Icon: Ticket,          color: 'text-blue-500',    label: 'Biglietto'   },
  { id: 'camera',    Icon: Camera,          color: 'text-slate-500',   label: 'Foto'        },
  { id: 'gamepad',   Icon: Gamepad2,        color: 'text-violet-500',  label: 'Giochi'      },
  { id: 'dumbbell',  Icon: Dumbbell,        color: 'text-blue-600',    label: 'Sport'       },
  { id: 'bike',      Icon: Bike,            color: 'text-sky-500',     label: 'Bici'        },
  { id: 'mountain',  Icon: Mountain,        color: 'text-teal-600',    label: 'Montagna'    },
  { id: 'globe',     Icon: Globe,           color: 'text-cyan-600',    label: 'Viaggio'     },
  { id: 'palmtree',  Icon: Palmtree,        color: 'text-emerald-600', label: 'Vacanza'     },
  { id: 'sun',       Icon: Sun,             color: 'text-yellow-400',  label: 'Sole'        },
  { id: 'book',      Icon: BookOpen,        color: 'text-indigo-400',  label: 'Libro'       },
  { id: 'rocket',    Icon: Rocket,          color: 'text-purple-600',  label: 'Razzo'       },
  { id: 'shirt',     Icon: Shirt,           color: 'text-blue-400',    label: 'Abbigliamento'},
  { id: 'smile',     Icon: Smile,           color: 'text-yellow-500',  label: 'Benessere'   },
  { id: 'package',   Icon: Package,         color: 'text-gray-500',    label: 'Pacco'       },
]

function getPrizeIcon(id: string): PrizeIcon {
  return PRIZE_ICONS.find(p => p.id === id) ?? PRIZE_ICONS[0]
}

function PrizeIconDisplay({ iconId, className = 'w-7 h-7' }: { iconId: string; className?: string }) {
  const { Icon, color } = getPrizeIcon(iconId)
  return <Icon className={`${className} ${color}`} />
}

// ── SQL setup instructions ───────────────────────────────────────────────────

const SETUP_SQL = `-- Run this in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS club_prizes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL DEFAULT 100,
  stock INTEGER,
  emoji TEXT DEFAULT '🎁',
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS club_prize_redemptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prize_id UUID NOT NULL REFERENCES club_prizes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  club_id UUID NOT NULL REFERENCES clubs(id),
  status TEXT DEFAULT 'confirmed',
  redeemed_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE club_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_prize_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prizes_select" ON club_prizes FOR SELECT USING (is_active = true);
CREATE POLICY "prizes_insert" ON club_prizes FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "prizes_update" ON club_prizes FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "redemptions_select" ON club_prize_redemptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "redemptions_insert" ON club_prize_redemptions FOR INSERT WITH CHECK (user_id = auth.uid());`

// ── CreatePrizeForm ──────────────────────────────────────────────────────────

function CreatePrizeForm({
  clubId, userId, editingPrize, onSaved, onCancel,
}: {
  clubId: string; userId: string
  editingPrize?: ClubPrize | null
  onSaved: () => void; onCancel: () => void
}) {
  const [name,       setName]       = useState(editingPrize?.name ?? '')
  const [desc,       setDesc]       = useState(editingPrize?.description ?? '')
  const [pts,        setPts]        = useState(String(editingPrize?.points_cost ?? 100))
  const [stock,      setStock]      = useState(editingPrize?.stock != null ? String(editingPrize.stock) : '')
  const [iconId,     setIconId]     = useState(editingPrize?.emoji ?? 'gift')
  const [expires,    setExpires]    = useState(editingPrize?.expires_at ? editingPrize.expires_at.split('T')[0] : '')
  const [saving,     setSaving]     = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [error,      setError]      = useState('')

  const handleSave = async () => {
    if (!name.trim()) { setError('Inserisci un nome'); return }
    const cost = parseInt(pts)
    if (!cost || cost < 1) { setError('Costo punti non valido'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        club_id:     clubId,
        created_by:  userId,
        name:        name.trim(),
        description: desc.trim() || null,
        points_cost: cost,
        stock:       stock !== '' ? parseInt(stock) : null,
        emoji:       iconId,
        expires_at:  expires ? new Date(expires).toISOString() : null,
        is_active:   true,
      }
      if (editingPrize) {
        await updateClubPrize(editingPrize.id, { name: payload.name, description: payload.description, points_cost: cost, stock: payload.stock, emoji: iconId, expires_at: payload.expires_at })
      } else {
        await createClubPrize(payload)
      }
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? (e instanceof Error ? e.message : 'Errore salvataggio')
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('42P01')) {
        setError('⚠️ Tabella club_prizes mancante — esegui il SQL di setup qui sopra.')
        setShowPicker(false)
      } else if (msg.includes('row-level security') || msg.includes('policy')) {
        setError('Permesso negato. Assicurati di essere admin del club.')
      } else {
        setError(msg)
      }
    } finally { setSaving(false) }
  }

  const selectedPrizeIcon = getPrizeIcon(iconId)

  return (
    <div className="bg-white border border-eco-green/30 rounded-2xl p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Gift className="w-4 h-4 text-eco-green" />
          {editingPrize ? 'Modifica premio' : 'Nuovo premio'}
        </h3>
        <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Icon picker + Name */}
      <div className="flex gap-3 items-start">
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowPicker(v => !v)}
            className="w-14 h-14 rounded-2xl border-2 border-dashed border-gray-200 hover:border-eco-green flex items-center justify-center transition-colors bg-gray-50"
            title="Scegli icona"
          >
            <selectedPrizeIcon.Icon className={`w-7 h-7 ${selectedPrizeIcon.color}`} />
          </button>
          {showPicker && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-2xl shadow-xl p-3 w-72">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-2 px-1">Scegli icona</p>
              <div className="grid grid-cols-7 gap-1">
                {PRIZE_ICONS.map(pi => (
                  <button
                    key={pi.id}
                    onClick={() => { setIconId(pi.id); setShowPicker(false) }}
                    title={pi.label}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-eco-green-light transition-colors ${iconId === pi.id ? 'bg-eco-green-light ring-2 ring-eco-green' : ''}`}
                  >
                    <pi.Icon className={`w-5 h-5 ${pi.color}`} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 space-y-1.5">
          <label className="text-xs font-semibold text-gray-600">Nome premio *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Es. Pranzo di gruppo, Giornata libera..." maxLength={60} />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-600">Descrizione</label>
        <Textarea
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Spiega cosa include il premio e come riscattarlo..."
          rows={3}
          maxLength={300}
          className="resize-none text-sm"
        />
        {desc.length > 250 && <p className="text-[10px] text-gray-400 text-right">{desc.length}/300</p>}
      </div>

      {/* Points + Stock + Expiry */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
            <Zap className="w-3 h-3 text-eco-green" /> Punti costo *
          </label>
          <Input type="number" min="1" value={pts} onChange={e => setPts(e.target.value)} placeholder="100" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
            <Package className="w-3 h-3 text-blue-500" /> Quantità
          </label>
          <Input type="number" min="1" value={stock} onChange={e => setStock(e.target.value)} placeholder="∞" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" /> Scadenza
          </label>
          <Input type="date" value={expires} onChange={e => setExpires(e.target.value)} min={new Date().toISOString().split('T')[0]} />
        </div>
      </div>

      {/* Preview */}
      {name && (
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Anteprima</p>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-eco-green-light to-emerald-50 flex items-center justify-center border border-eco-green/20 flex-shrink-0">
              <PrizeIconDisplay iconId={iconId} className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-900">{name}</p>
              {desc && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{desc}</p>}
              <p className="text-xs text-eco-green font-bold mt-1 flex items-center gap-1">
                <Zap className="w-3 h-3" /> {pts || '—'} pts
                {stock && <span className="text-gray-400 font-normal ml-1">· {stock} disp.</span>}
                {expires && <span className="text-amber-500 font-normal ml-1">· scade {new Date(expires).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 bg-red-50 p-2 rounded-lg">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || !name.trim()} className="flex-1">
          {saving
            ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <><Check className="w-4 h-4" /> {editingPrize ? 'Salva modifiche' : 'Pubblica premio'}</>}
        </Button>
        <Button variant="outline" onClick={onCancel}>Annulla</Button>
      </div>
    </div>
  )
}

// ── PrizeCard ────────────────────────────────────────────────────────────────

function PrizeCard({
  prize, isAdmin, userPoints, redeemed, onRedeem, onEdit, onDelete, redeeming,
}: {
  prize: ClubPrize; isAdmin: boolean; userPoints: number; redeemed: boolean
  onRedeem: () => void; onEdit: () => void; onDelete: () => void; redeeming: boolean
}) {
  const canAfford  = userPoints >= prize.points_cost
  const outOfStock = prize.stock !== null && prize.stock <= 0
  const expired    = prize.expires_at ? new Date(prize.expires_at) < new Date() : false
  const blocked    = redeemed || outOfStock || expired || !canAfford

  return (
    <Card className={`transition-all duration-200 ${blocked && !isAdmin ? 'opacity-60' : 'hover:shadow-md hover:-translate-y-0.5'}`}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-eco-green-light to-emerald-50 flex items-center justify-center border border-eco-green/20 flex-shrink-0">
              <PrizeIconDisplay iconId={prize.emoji} className="w-7 h-7" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm leading-tight">{prize.name}</h3>
              <div className="flex flex-wrap gap-1 mt-1">
                {outOfStock && <Badge variant="outline" className="text-[9px] text-gray-400">Esaurito</Badge>}
                {expired    && <Badge variant="outline" className="text-[9px] text-red-400 border-red-200">Scaduto</Badge>}
                {prize.stock !== null && !outOfStock && prize.stock <= 5 && (
                  <Badge variant="destructive" className="text-[9px]">Ultimi {prize.stock}!</Badge>
                )}
                {redeemed && <Badge className="text-[9px] bg-eco-green/10 text-eco-green border-eco-green/20">✓ Riscattato</Badge>}
              </div>
            </div>
          </div>

          {/* Admin actions */}
          {isAdmin && (
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={onEdit} title="Modifica" className="p-1.5 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 transition-colors">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onDelete} title="Elimina" className="p-1.5 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Description */}
        {prize.description && (
          <p className="text-xs text-gray-500 leading-relaxed mb-3">{prize.description}</p>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap gap-2 text-[10px] text-gray-400 mb-3">
          {prize.stock !== null && !outOfStock && (
            <span className="flex items-center gap-0.5"><Package className="w-3 h-3" /> {prize.stock} rimasti</span>
          )}
          {prize.stock === null && (
            <span className="flex items-center gap-0.5"><Package className="w-3 h-3" /> Illimitati</span>
          )}
          {prize.expires_at && !expired && (
            <span className="flex items-center gap-0.5 text-amber-500"><Clock className="w-3 h-3" />
              Scade {new Date(prize.expires_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
            </span>
          )}
        </div>

        {/* Footer: points + button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-eco-green" />
            <span className="font-bold text-eco-green text-lg">{prize.points_cost.toLocaleString()}</span>
            <span className="text-xs text-gray-400">pts</span>
            {!canAfford && !redeemed && (
              <span className="text-[10px] text-red-400 ml-1">
                (mancano {(prize.points_cost - userPoints).toLocaleString()})
              </span>
            )}
          </div>
          <Button
            size="sm"
            disabled={blocked || redeeming}
            onClick={onRedeem}
            variant={redeemed || blocked ? 'outline' : 'default'}
            className={`text-xs ${redeemed ? 'text-eco-green border-eco-green/30' : ''}`}
          >
            {redeeming
              ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : redeemed ? <><CheckCircle2 className="w-3 h-3" /> Riscattato</>
              : outOfStock ? 'Esaurito'
              : expired   ? 'Scaduto'
              : !canAfford ? 'Punti insuff.'
              : <><Gift className="w-3 h-3" /> Riscatta</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── ClubPrizesTab ─────────────────────────────────────────────────────────────

interface UserClubInfo {
  club_id: string
  role: string
  club: { id: string; name: string; avatar_url: string | null }
}

function ClubPrizesTab({ userId, userPoints, onPointsChanged }: {
  userId: string; userPoints: number; onPointsChanged: () => void
}) {
  const [userClubs,      setUserClubs]      = useState<UserClubInfo[]>([])
  const [selectedClub,   setSelectedClub]   = useState<string | null>(null)
  const [prizes,         setPrizes]         = useState<ClubPrize[]>([])
  const [redeemed,       setRedeemed]       = useState<Set<string>>(new Set())
  const [loading,        setLoading]        = useState(true)
  const [showCreate,     setShowCreate]     = useState(false)
  const [editingPrize,   setEditingPrize]   = useState<ClubPrize | null>(null)
  const [redeemingId,    setRedeemingId]    = useState<string | null>(null)
  const [dbMissing,      setDbMissing]      = useState(false)
  const [showSetupSQL,   setShowSetupSQL]   = useState(false)
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadClubs = useCallback(async () => {
    setLoading(true)
    const memberships = await getUserAdminClubs(userId)
    if (!memberships.length) { setUserClubs([]); setLoading(false); return }

    const clubIds = memberships.map(m => m.club_id)
    const { data: clubsData } = await supabase
      .from('clubs').select('id, name, avatar_url').in('id', clubIds)
    const clubMap: Record<string, { id: string; name: string; avatar_url: string | null }> =
      Object.fromEntries((clubsData ?? []).map(c => [c.id, c as { id: string; name: string; avatar_url: string | null }]))

    const enriched: UserClubInfo[] = memberships.map(m => ({
      club_id: m.club_id,
      role:    m.role,
      club:    clubMap[m.club_id] ?? { id: m.club_id, name: 'Club', avatar_url: null },
    }))
    setUserClubs(enriched)

    const first = enriched[0]?.club_id ?? null
    setSelectedClub(prev => prev ?? first)
    setLoading(false)
  }, [userId])

  const loadPrizes = useCallback(async () => {
    if (!selectedClub) return
    const data = await getClubPrizes(selectedClub)
    // detect table missing by checking if we got empty on first real request
    setPrizes(data)
  }, [selectedClub])

  const loadRedeemed = useCallback(async () => {
    const data = await getUserClubPrizeRedemptions(userId)
    setRedeemed(new Set(data.map(r => r.prize_id)))
  }, [userId])

  useEffect(() => { loadClubs() }, [loadClubs])
  useEffect(() => {
    if (selectedClub) {
      loadPrizes()
      loadRedeemed()
    }
  }, [selectedClub, loadPrizes, loadRedeemed])

  const handleRedeem = async (prize: ClubPrize) => {
    if (!selectedClub) return
    setRedeemingId(prize.id)
    try {
      await redeemClubPrize(prize.id, userId, selectedClub, prize.points_cost)
      setRedeemed(prev => new Set([...prev, prize.id]))
      onPointsChanged()
      loadPrizes()
      showToast(`🎉 "${prize.name}" riscattato! -${prize.points_cost} pts`)
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? (e instanceof Error ? e.message : 'Errore')
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('42P01')) setDbMissing(true)
      showToast(msg, false)
    } finally { setRedeemingId(null) }
  }

  const handleDelete = async (prizeId: string) => {
    if (!confirm('Eliminare questo premio?')) return
    try {
      await deleteClubPrize(prizeId)
      loadPrizes()
      showToast('Premio eliminato')
    } catch { showToast('Errore eliminazione', false) }
  }

  const currentClubInfo = userClubs.find(c => c.club_id === selectedClub)
  const isAdmin = currentClubInfo?.role === 'admin'

  if (loading) return (
    <div className="space-y-3 pt-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
    </div>
  )

  if (!userClubs.length) return (
    <Card><CardContent className="py-16 text-center space-y-3">
      <Building2 className="w-14 h-14 text-gray-200 mx-auto" />
      <p className="text-gray-700 font-semibold text-base">Non sei in nessun club</p>
      <p className="text-sm text-gray-400">Unisciti a un club aziendale per accedere ai premi personalizzati creati dagli admin.</p>
      <Button size="sm" onClick={() => window.location.href = '/clubs'} className="mt-2">
        <Building2 className="w-4 h-4" /> Esplora Club
      </Button>
    </CardContent></Card>
  )

  return (
    <div className="space-y-4">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-lg flex items-center gap-2 text-sm font-semibold animate-fade-in ${toast.ok ? 'bg-eco-green text-white' : 'bg-red-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* DB missing warning */}
      {dbMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-800">Tabelle DB mancanti</p>
          </div>
          <p className="text-xs text-amber-600">Per attivare i premi del club, esegui il seguente SQL in Supabase.</p>
          <button
            onClick={() => setShowSetupSQL(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-amber-700 underline"
          >
            {showSetupSQL ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showSetupSQL ? 'Nascondi SQL' : 'Mostra SQL di setup'}
          </button>
          {showSetupSQL && (
            <pre className="text-[10px] bg-gray-900 text-green-300 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {SETUP_SQL}
            </pre>
          )}
        </div>
      )}

      {/* Club selector (if member of multiple clubs) */}
      {userClubs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {userClubs.map(c => {
            const initials = c.club.name.slice(0, 2).toUpperCase()
            return (
              <button
                key={c.club_id}
                onClick={() => { setSelectedClub(c.club_id); setShowCreate(false); setEditingPrize(null) }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold whitespace-nowrap transition-all flex-shrink-0 ${
                  selectedClub === c.club_id
                    ? 'border-eco-green bg-eco-green-light text-eco-teal'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-eco-green/40'
                }`}
              >
                <Avatar className="w-6 h-6">
                  {c.club.avatar_url && <AvatarImage src={c.club.avatar_url} />}
                  <AvatarFallback className="text-[9px] bg-eco-green-light text-eco-teal">{initials}</AvatarFallback>
                </Avatar>
                {c.club.name}
                {c.role === 'admin' && <Crown className="w-3 h-3 text-amber-500" />}
              </button>
            )
          })}
        </div>
      )}

      {/* Club header */}
      {currentClubInfo && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              {currentClubInfo.club.avatar_url && <AvatarImage src={currentClubInfo.club.avatar_url} />}
              <AvatarFallback className="bg-eco-green-light text-eco-teal font-bold text-xs">
                {currentClubInfo.club.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-bold text-gray-900 text-sm">{currentClubInfo.club.name}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                {isAdmin
                  ? <><Crown className="w-3 h-3 text-amber-500" /> Admin del club</>
                  : <><Users className="w-3 h-3" /> Membro</>}
              </p>
            </div>
          </div>
          {isAdmin && !showCreate && !editingPrize && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> Aggiungi premio
            </Button>
          )}
        </div>
      )}

      {/* Create form */}
      {(showCreate || editingPrize) && selectedClub && (
        <CreatePrizeForm
          clubId={selectedClub}
          userId={userId}
          editingPrize={editingPrize}
          onSaved={() => {
            setShowCreate(false); setEditingPrize(null)
            loadPrizes()
            showToast(editingPrize ? '✅ Premio aggiornato!' : '🎉 Premio pubblicato!')
          }}
          onCancel={() => { setShowCreate(false); setEditingPrize(null) }}
        />
      )}

      {/* Prizes list */}
      {prizes.length === 0 && !showCreate && !editingPrize ? (
        <Card><CardContent className="py-14 text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto"><Gift className="w-8 h-8 text-gray-300" /></div>
          <p className="font-semibold text-gray-700">Nessun premio disponibile</p>
          <p className="text-sm text-gray-400">
            {isAdmin
              ? 'Crea il primo premio per i tuoi membri!'
              : 'L\'admin del club non ha ancora creato premi.'}
          </p>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowCreate(true)} className="mt-1">
              <Plus className="w-4 h-4" /> Crea il primo premio
            </Button>
          )}
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {prizes.map(prize => (
            <PrizeCard
              key={prize.id}
              prize={prize}
              isAdmin={isAdmin}
              userPoints={userPoints}
              redeemed={redeemed.has(prize.id)}
              redeeming={redeemingId === prize.id}
              onRedeem={() => handleRedeem(prize)}
              onEdit={() => { setEditingPrize(prize); setShowCreate(false) }}
              onDelete={() => handleDelete(prize.id)}
            />
          ))}
        </div>
      )}

      {/* Info banner for members */}
      {!isAdmin && prizes.length > 0 && (
        <div className="bg-eco-green-light/50 border border-eco-green/20 rounded-xl p-3 flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-eco-green flex-shrink-0" />
          <p className="text-xs text-eco-teal">
            <span className="font-semibold">I tuoi punti: {userPoints.toLocaleString()}</span>
            {prizes.some(p => !redeemed.has(p.id) && userPoints >= p.points_cost) && ' · Hai abbastanza punti per riscattare dei premi!'}
          </p>
        </div>
      )}
    </div>
  )
}

// ── BadgesTab ────────────────────────────────────────────────────────────────

function BadgesTab({ tripCount, totalKm, carpoolCount }: { tripCount: number; totalKm: number; carpoolCount: number }) {
  const { profile } = useAuth()

  const getValue = (metric: BadgeMetric): number => {
    if (!profile) return 0
    switch (metric) {
      case 'trips':   return tripCount
      case 'km':      return totalKm
      case 'co2':     return Number(profile.total_co2_saved ?? 0)
      case 'streak':  return (profile as unknown as Record<string, unknown>).streak_days as number ?? 0
      case 'points':  return profile.eco_score ?? 0
      case 'carpool': return carpoolCount
    }
  }

  const unlocked = ACTIVITY_BADGES.filter(b => getValue(b.metric) >= b.threshold)
  const locked   = ACTIVITY_BADGES.filter(b => getValue(b.metric) <  b.threshold)
    .sort((a, b) => (getValue(b.metric) / b.threshold) - (getValue(a.metric) / a.threshold))

  const BadgeCard = ({ badge, done }: { badge: ActivityBadge; done: boolean }) => {
    const current = Math.min(getValue(badge.metric), badge.threshold)
    const pct = badge.threshold > 0 ? Math.round((current / badge.threshold) * 100) : 0
    return (
      <div className={`rounded-2xl p-4 flex items-start gap-3 border transition-all ${
        done
          ? `bg-gradient-to-br ${badge.color ?? 'from-eco-green-light to-emerald-50'} border-eco-green/30`
          : 'bg-white border-gray-100'
      }`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm border ${
          done ? 'bg-white border-eco-green/20' : 'bg-gray-50 border-gray-100 grayscale opacity-60'
        }`}>
          {badge.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-bold ${done ? 'text-gray-900' : 'text-gray-600'}`}>{badge.name}</p>
            {done
              ? <span className="text-[10px] bg-eco-green text-white rounded-full px-2 py-0.5 font-semibold flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> Sbloccato</span>
              : <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{current}/{badge.threshold}</span>
            }
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{badge.desc}</p>
          <div className="mt-2 h-1.5 bg-gray-200/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-eco-green w-full' : 'bg-gradient-to-r from-gray-300 to-gray-400'}`}
              style={!done ? { width: `${pct}%` } : undefined}
            />
          </div>
          {!done && <p className="text-[10px] text-gray-400 mt-1">Mancano {badge.threshold - current} — {pct}%</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-eco-green to-emerald-500 rounded-2xl p-4 flex items-center gap-4">
        <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <Medal className="w-8 h-8 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-white font-bold text-base">{unlocked.length} / {ACTIVITY_BADGES.length} badge sbloccati</p>
          <div className="mt-1.5 h-2 bg-white/30 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full" style={{ width: `${Math.round(unlocked.length / ACTIVITY_BADGES.length * 100)}%` }} />
          </div>
          <p className="text-white/70 text-[11px] mt-1">{ACTIVITY_BADGES.length - unlocked.length} ancora da sbloccare</p>
        </div>
      </div>

      {unlocked.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <span className="w-2 h-2 bg-eco-green rounded-full animate-pulse" /> Sbloccati ({unlocked.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {unlocked.map(b => <BadgeCard key={b.id} badge={b} done={true} />)}
          </div>
        </div>
      )}

      {locked.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <span className="w-2 h-2 bg-gray-300 rounded-full" /> In corso ({locked.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {locked.map(b => <BadgeCard key={b.id} badge={b} done={false} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Shop() {
  const { profile, refreshProfile } = useAuth()
  const [loading,      setLoading]      = useState(true)
  const [tripCount,    setTripCount]    = useState(0)
  const [totalKm,      setTotalKm]      = useState(0)
  const [carpoolCount, setCarpoolCount] = useState(0)
  const [purchases,    setPurchases]    = useState<{ id: string; prize_id: string; redeemed_at: string; club_prize: ClubPrize | null }[]>([])

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const [{ count: tc }, { data: kmData }, { count: carpoolC }, redemptions] = await Promise.all([
        supabase.from('trips').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
        supabase.from('trips').select('distance_km').eq('user_id', profile.id),
        supabase.from('trips').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('transport_mode', 'carpooling'),
        getUserClubPrizeRedemptions(profile.id),
      ])
      setTripCount(tc ?? 0)
      setCarpoolCount(carpoolC ?? 0)
      if (kmData) {
        setTotalKm((kmData as { distance_km: number }[]).reduce((s, t) => s + (t.distance_km ?? 0), 0))
      }
      setPurchases(redemptions as unknown as typeof purchases)
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { load() }, [load])

  const userPoints = profile?.eco_score ?? 0

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-24 lg:pb-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-eco-green" /> EcoShop
          </h1>
          <p className="text-sm text-gray-500 mt-1">Premi del club, badge e i tuoi acquisti</p>
        </div>
        <div className="bg-eco-green-light rounded-xl px-4 py-2 text-center">
          <p className="text-xs text-eco-teal font-medium">I tuoi punti</p>
          <p className="text-xl font-bold text-eco-green flex items-center gap-1">
            <Zap className="w-4 h-4" /> {userPoints.toLocaleString()}
          </p>
        </div>
      </div>

      <Tabs defaultValue="prizes">
        <TabsList className="w-full">
          <TabsTrigger value="prizes" className="flex-1">
            <Gift className="w-4 h-4 mr-1" /> Premi Club
          </TabsTrigger>
          <TabsTrigger value="badges" className="flex-1">
            <Medal className="w-4 h-4 mr-1" /> Badge
          </TabsTrigger>
          <TabsTrigger value="purchases" className="flex-1">
            <Package className="w-4 h-4 mr-1" /> Riscatti
            {purchases.length > 0 && (
              <span className="ml-1.5 bg-eco-green text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {purchases.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Premi Club */}
        <TabsContent value="prizes">
          {loading ? (
            <div className="space-y-3 pt-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
            </div>
          ) : !profile ? (
            <Card><CardContent className="py-12 text-center">
              <p className="text-gray-500">Accedi per vedere i premi del club</p>
            </CardContent></Card>
          ) : (
            <ClubPrizesTab
              userId={profile.id}
              userPoints={userPoints}
              onPointsChanged={() => { refreshProfile(); load() }}
            />
          )}
        </TabsContent>

        {/* Badge */}
        <TabsContent value="badges">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 pt-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
            </div>
          ) : (
            <BadgesTab tripCount={tripCount} totalKm={totalKm} carpoolCount={carpoolCount} />
          )}
        </TabsContent>

        {/* Riscatti */}
        <TabsContent value="purchases">
          {purchases.length === 0 ? (
            <Card><CardContent className="py-16 text-center">
              <Heart className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Nessun riscatto ancora</p>
              <p className="text-sm text-gray-400 mt-1">Guadagna punti con i tuoi viaggi e riscatta i premi del club!</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3 pt-1">
              {purchases.map(p => {
                const prize = p.club_prize
                return (
                  <Card key={p.id}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-eco-green-light flex items-center justify-center flex-shrink-0 border border-eco-green/20">
                        <PrizeIconDisplay iconId={prize?.emoji ?? 'gift'} className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{prize?.name ?? 'Premio'}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(p.redeemed_at).toLocaleDateString('it-IT')} · -{(prize?.points_cost ?? 0).toLocaleString()} pts
                        </p>
                      </div>
                      <Badge className="text-[10px] bg-eco-green/10 text-eco-green border-eco-green/20 flex-shrink-0">
                        ✓ Confermato
                      </Badge>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
