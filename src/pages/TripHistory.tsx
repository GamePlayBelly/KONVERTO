import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { PlusCircle, Trash2, MapPin, Clock, Calendar, TrendingUp, Filter, CalendarClock, Leaf, Edit2, X, Save } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getTrips, deleteTrip, updateTrip } from '@/lib/supabase'
import { TRANSPORT_META, formatCO2, formatDistance, formatDate, formatCountdown, calcCO2Saved, calcEcoPoints } from '@/lib/utils'
import type { Trip, TransportMode } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const ALL_MODES: TransportMode[] = [
  'walking','cycling','ebike','escooter',
  'public_transport','tram_metro','train',
  'electric_vehicle','motorcycle','carpooling',
]

function nowLocal(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function TripHistory() {
  const { user } = useAuth()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState<TransportMode | 'all'>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Edit state for scheduled trips
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null)
  const [editMode, setEditMode] = useState<TransportMode>('cycling')
  const [editDate, setEditDate] = useState('')
  const [editDistance, setEditDistance] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const now = new Date().toISOString()

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const data = await getTrips(user.id, 300)
    setTrips(data)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  const handleDelete = async (tripId: string) => {
    if (!confirm('Eliminare questo viaggio?')) return
    setDeletingId(tripId)
    try {
      await deleteTrip(tripId)
      setTrips(prev => prev.filter(t => t.id !== tripId))
    } finally {
      setDeletingId(null)
    }
  }

  const openEdit = (trip: Trip) => {
    setEditingTrip(trip)
    setEditMode(trip.transport_mode)
    setEditDate(nowLocal(trip.recorded_at))
    setEditDistance(String(trip.distance_km))
    setEditNotes(trip.notes ?? '')
  }

  const handleSaveEdit = async () => {
    if (!editingTrip) return
    setEditSaving(true)
    try {
      const km = parseFloat(editDistance) || 0
      const co2 = calcCO2Saved(editMode, km)
      const pts = calcEcoPoints(co2, km)
      await updateTrip(editingTrip.id, {
        transport_mode: editMode,
        distance_km: km,
        co2_saved_kg: co2,
        eco_points: pts,
        notes: editNotes.trim() || null,
        recorded_at: new Date(editDate).toISOString(),
      } as Parameters<typeof updateTrip>[1])
      setTrips(prev => prev.map(t =>
        t.id === editingTrip.id
          ? { ...t, transport_mode: editMode, distance_km: km, co2_saved_kg: co2, eco_points: pts, notes: editNotes.trim() || null, recorded_at: new Date(editDate).toISOString() }
          : t
      ))
      setEditingTrip(null)
    } catch {
      // silent
    } finally {
      setEditSaving(false)
    }
  }

  const pastTrips = trips.filter(t => t.recorded_at <= now)
  const futureTrips = trips.filter(t => t.recorded_at > now)

  const filteredPast = filterMode === 'all'
    ? pastTrips
    : pastTrips.filter(t => t.transport_mode === filterMode)

  const totalCO2 = filteredPast.reduce((s, t) => s + Number(t.co2_saved_kg), 0)
  const totalKm = filteredPast.reduce((s, t) => s + Number(t.distance_km), 0)
  const totalPts = filteredPast.reduce((s, t) => s + t.eco_points, 0)

  // Group past trips by month
  const byMonth: Record<string, Trip[]> = {}
  filteredPast.forEach(t => {
    const key = new Date(t.recorded_at).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(t)
  })

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-24 lg:pb-6">

      {/* ── Edit modal ── */}
      {editingTrip && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={() => setEditingTrip(null)}>
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">Modifica viaggio programmato</h3>
                <p className="text-xs text-gray-400 mt-0.5">Aggiorna i dettagli del viaggio</p>
              </div>
              <button onClick={() => setEditingTrip(null)} className="p-2 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mezzo */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mezzo di trasporto</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {ALL_MODES.map(m => {
                  const meta = TRANSPORT_META[m]
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setEditMode(m)}
                      className={`flex flex-col items-center gap-0.5 p-2 rounded-xl border-2 text-[10px] font-medium transition-all ${editMode === m ? 'border-eco-green bg-eco-green-light text-eco-teal' : 'border-gray-100 hover:border-eco-green/40 text-gray-500'}`}
                    >
                      <span className="text-lg">{meta.emoji}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Data e distanza */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="editDate" className="text-xs font-semibold text-gray-500">Data e ora</Label>
                <Input
                  id="editDate"
                  type="datetime-local"
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="editDist" className="text-xs font-semibold text-gray-500">Distanza (km)</Label>
                <Input
                  id="editDist"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={editDistance}
                  onChange={e => setEditDistance(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label htmlFor="editNotes" className="text-xs font-semibold text-gray-500">Note (opzionale)</Label>
              <Textarea
                id="editNotes"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                placeholder="Note sul viaggio..."
                className="text-xs resize-none h-16"
              />
            </div>

            <Button onClick={handleSaveEdit} disabled={editSaving} className="w-full gap-2">
              {editSaving
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Save className="w-4 h-4" />}
              Salva modifiche
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="w-7 h-7 text-eco-green" /> Storico viaggi
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {pastTrips.length} effettuati
            {futureTrips.length > 0 && ` · ${futureTrips.length} programmati`}
          </p>
        </div>
        <Button size="sm" asChild>
          <Link to="/trip/new"><PlusCircle className="w-4 h-4" /> Nuovo</Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4 text-center">
          <p className="text-lg font-bold text-eco-green">{formatCO2(totalCO2)}</p>
          <p className="text-xs text-gray-400">CO₂ risparmiata</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-lg font-bold text-eco-green">{formatDistance(totalKm)}</p>
          <p className="text-xs text-gray-400">Km percorsi</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-lg font-bold text-eco-green">{totalPts}</p>
          <p className="text-xs text-gray-400">Punti guadagnati</p>
        </CardContent></Card>
      </div>

      {/* ── Viaggi programmati ── */}
      {futureTrips.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-eco-green" /> Programmati
          </h2>
          <div className="space-y-2">
            {futureTrips.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).map(trip => {
              const meta = TRANSPORT_META[trip.transport_mode]
              const countdown = formatCountdown(trip.recorded_at)
              return (
                <Card key={trip.id} className="border-eco-green/20 bg-eco-green-light/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${meta.bgColor}`}>
                        {meta.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{meta.label}</p>
                          <Badge variant="outline" className="text-[10px] border-eco-green text-eco-green flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" /> {countdown}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> {formatDistance(trip.distance_km)}
                          </span>
                          <span className="flex items-center gap-1"><Leaf className="w-3 h-3 text-eco-green" /> {formatCO2(Number(trip.co2_saved_kg))}</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(trip.recorded_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {trip.notes && <p className="text-xs text-gray-400 mt-1 italic truncate">{trip.notes}</p>}
                      </div>
                      {/* Edit + Delete buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => openEdit(trip)}
                          className="p-2 text-gray-300 hover:text-eco-green transition-colors"
                          aria-label="Modifica viaggio programmato"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(trip.id)}
                          disabled={deletingId === trip.id}
                          className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                          aria-label="Elimina viaggio programmato"
                        >
                          {deletingId === trip.id
                            ? <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin block" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Filter ── */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterMode('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${filterMode === 'all' ? 'bg-eco-green text-white border-eco-green' : 'bg-white text-gray-600 border-gray-200 hover:border-eco-green'}`}
        >
          <Filter className="w-3 h-3" /> Tutti
        </button>
        {ALL_MODES.filter(m => pastTrips.some(t => t.transport_mode === m)).map(m => {
          const meta = TRANSPORT_META[m]
          return (
            <button
              key={m}
              onClick={() => setFilterMode(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${filterMode === m ? 'bg-eco-green text-white border-eco-green' : 'bg-white text-gray-600 border-gray-200 hover:border-eco-green'}`}
            >
              {meta.emoji} {meta.label.split(' ')[0]}
            </button>
          )
        })}
      </div>

      {/* ── Storico per mese ── */}
      {loading ? (
        <div className="space-y-3">{Array.from({length: 6}).map((_,i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : filteredPast.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <MapPin className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Nessun viaggio trovato</p>
          <Button size="sm" className="mt-4" asChild><Link to="/trip/new">Registra il primo</Link></Button>
        </CardContent></Card>
      ) : (
        Object.entries(byMonth).map(([month, monthTrips]) => (
          <div key={month}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide capitalize">{month}</h2>
              <span className="text-xs text-gray-400">{monthTrips.length} viaggi</span>
            </div>
            <div className="space-y-2">
              {monthTrips.map(trip => {
                const meta = TRANSPORT_META[trip.transport_mode]
                return (
                  <Card key={trip.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${meta.bgColor}`}>
                          {meta.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900">{meta.label}</p>
                            <Badge variant="secondary" className="text-[10px]">+{trip.eco_points} pts</Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                            <span className="flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" /> {formatDistance(trip.distance_km)}
                            </span>
                            <span className="flex items-center gap-1"><Leaf className="w-3 h-3 text-eco-green" /> {formatCO2(Number(trip.co2_saved_kg))}</span>
                            {trip.duration_minutes && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {trip.duration_minutes}min
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {formatDate(trip.recorded_at)}
                            </span>
                          </div>
                          {trip.notes && <p className="text-xs text-gray-400 mt-1 italic truncate">{trip.notes}</p>}
                          {trip.start_location && (
                            <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3" />
                              {trip.start_location.label ?? `${trip.start_location.lat.toFixed(3)}, ${trip.start_location.lng.toFixed(3)}`}
                              {trip.end_location && ` → ${trip.end_location.label ?? `${trip.end_location.lat.toFixed(3)}, ${trip.end_location.lng.toFixed(3)}`}`}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(trip.id)}
                          disabled={deletingId === trip.id}
                          className="p-2 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                          aria-label="Elimina viaggio"
                        >
                          {deletingId === trip.id
                            ? <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin block" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
