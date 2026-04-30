import { useEffect, useState, useCallback } from 'react'
import { Car, Plus, MapPin, Clock, Users, Leaf, Search, Calendar, Navigation, Trash2, Ruler } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, processExpiredCarpoolRides } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'

interface CarpoolRide {
  id: string
  driver_id: string
  origin_label: string
  destination_label: string
  departure_time: string
  available_seats: number
  booked_seats: number
  distance_km: number | null
  price_per_seat: number
  notes: string | null
  status: string
  driver?: {
    username: string
    full_name: string | null
    avatar_url: string | null
    eco_score: number
  }
}

interface Passenger {
  passenger_id: string
  booked_at: string
  profile?: { username: string; full_name: string | null; avatar_url: string | null }
}

export default function Carpooling() {
  const { user } = useAuth()
  const [rides, setRides] = useState<CarpoolRide[]>([])
  const [myRides, setMyRides] = useState<CarpoolRide[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [booking, setBooking] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [bookedIds, setBookedIds] = useState<string[]>([])
  const [expandedRide, setExpandedRide] = useState<string | null>(null)
  const [passengers, setPassengers] = useState<Record<string, Passenger[]>>({})
  const [form, setForm] = useState({
    origin_label: '', destination_label: '',
    departure_time: '', available_seats: '3',
    distance_km: '', price_per_seat: '0', notes: ''
  })

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: activeData }, { data: myCompletedData }, { data: bookings }] = await Promise.all([
      // Active future rides (visible to everyone)
      supabase.from('carpooling_rides')
        .select('*, driver:profiles(username,full_name,avatar_url,eco_score)')
        .eq('status', 'active')
        .gte('departure_time', new Date().toISOString())
        .order('departure_time'),
      // Driver's completed rides (last 10)
      user ? supabase.from('carpooling_rides')
        .select('*, driver:profiles(username,full_name,avatar_url,eco_score)')
        .eq('driver_id', user.id)
        .eq('status', 'completed')
        .order('departure_time', { ascending: false })
        .limit(10) : { data: [] },
      user ? supabase.from('carpooling_bookings').select('ride_id').eq('passenger_id', user.id) : { data: [] },
    ])
    const bIds = (bookings ?? []).map((b: { ride_id: string }) => b.ride_id)
    setBookedIds(bIds)
    const allActive = (activeData ?? []) as CarpoolRide[]
    const completed = (myCompletedData ?? []) as CarpoolRide[]
    setRides(allActive.filter(r => r.driver_id !== user?.id))
    setMyRides([...allActive.filter(r => r.driver_id === user?.id), ...completed])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // Process expired rides once per session (awards points + marks completed)
  useEffect(() => {
    const KEY = 'ecotrack_carpool_processed'
    const last = parseInt(sessionStorage.getItem(KEY) ?? '0', 10)
    if (Date.now() - last > 5 * 60 * 1000) {
      sessionStorage.setItem(KEY, String(Date.now()))
      processExpiredCarpoolRides().then(() => load()).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPassengers = async (rideId: string) => {
    if (passengers[rideId]) return
    const { data } = await supabase
      .from('carpooling_bookings')
      .select('passenger_id, booked_at')
      .eq('ride_id', rideId)
    if (!data || data.length === 0) { setPassengers(p => ({ ...p, [rideId]: [] })); return }
    const ids = data.map((b: { passenger_id: string }) => b.passenger_id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .in('id', ids)
    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
    const enriched = data.map((b: { passenger_id: string; booked_at: string }) => ({
      ...b,
      profile: profileMap[b.passenger_id],
    }))
    setPassengers(p => ({ ...p, [rideId]: enriched as Passenger[] }))
  }

  const handleBook = async (rideId: string) => {
    if (!user) return
    setBooking(rideId)
    try {
      if (bookedIds.includes(rideId)) {
        await supabase.from('carpooling_bookings').delete().eq('ride_id', rideId).eq('passenger_id', user.id)
        setBookedIds(prev => prev.filter(id => id !== rideId))
      } else {
        await supabase.from('carpooling_bookings').insert({ ride_id: rideId, passenger_id: user.id })
        setBookedIds(prev => [...prev, rideId])
      }
      load()
    } finally {
      setBooking(null)
    }
  }

  const handleCreate = async () => {
    if (!user || !form.origin_label || !form.destination_label || !form.departure_time) return
    setCreating(true)
    try {
      await supabase.from('carpooling_rides').insert({
        driver_id: user.id,
        origin_label: form.origin_label,
        destination_label: form.destination_label,
        departure_time: new Date(form.departure_time).toISOString(),
        available_seats: parseInt(form.available_seats),
        distance_km: form.distance_km ? parseFloat(form.distance_km) : null,
        price_per_seat: parseFloat(form.price_per_seat),
        notes: form.notes || null,
      })
      setShowCreate(false)
      setForm({ origin_label: '', destination_label: '', departure_time: '', available_seats: '3', distance_km: '', price_per_seat: '0', notes: '' })
      load()
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteRide = async (rideId: string) => {
    setDeleting(rideId)
    try {
      await supabase.from('carpooling_rides').delete().eq('id', rideId)
      load()
    } finally {
      setDeleting(null)
    }
  }

  const filtered = rides.filter(r =>
    r.origin_label.toLowerCase().includes(search.toLowerCase()) ||
    r.destination_label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-24 lg:pb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Car className="w-7 h-7 text-eco-green" /> Carpooling
          </h1>
          <p className="text-sm text-gray-500 mt-1">Condividi il viaggio, dimezza le emissioni</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4" /> Offri passaggio
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="border-eco-green/30 animate-fade-in">
          <CardHeader className="pb-3"><CardTitle className="text-base">Offri un passaggio</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Partenza *</Label>
                <Input placeholder="Es. Milano Centro" value={form.origin_label} onChange={e => setForm(p => ({...p, origin_label: e.target.value}))} />
              </div>
              <div className="space-y-1.5">
                <Label>Destinazione *</Label>
                <Input placeholder="Es. Roma Termini" value={form.destination_label} onChange={e => setForm(p => ({...p, destination_label: e.target.value}))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data e ora *</Label>
                <Input type="datetime-local" value={form.departure_time} onChange={e => setForm(p => ({...p, departure_time: e.target.value}))} />
              </div>
              <div className="space-y-1.5">
                <Label>Posti disponibili</Label>
                <Input type="number" min="1" max="8" value={form.available_seats} onChange={e => setForm(p => ({...p, available_seats: e.target.value}))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Distanza km (opz.)</Label>
                <Input type="number" placeholder="Es. 120" value={form.distance_km} onChange={e => setForm(p => ({...p, distance_km: e.target.value}))} />
              </div>
              <div className="space-y-1.5">
                <Label>Prezzo/posto (€)</Label>
                <Input type="number" min="0" step="0.5" value={form.price_per_seat} onChange={e => setForm(p => ({...p, price_per_seat: e.target.value}))} />
              </div>
            </div>
            <Input placeholder="Note opzionali..." value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} />
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={creating || !form.origin_label || !form.destination_label || !form.departure_time} className="flex-1">
                {creating ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Pubblica passaggio'}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Annulla</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="search">
        <TabsList className="w-full">
          <TabsTrigger value="search" className="flex-1 flex items-center gap-1.5"><Search className="w-3.5 h-3.5" /> Cerca passaggi</TabsTrigger>
          <TabsTrigger value="mine" className="flex-1 flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> I miei passaggi ({myRides.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Cerca per città o destinazione..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>

          {loading ? (
            <div className="space-y-3">{Array.from({length: 4}).map((_,i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Car className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500">Nessun passaggio disponibile</p>
              <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>Sii il primo a offrire</Button>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {filtered.map(ride => {
                const isBooked = bookedIds.includes(ride.id)
                const freeSeats = ride.available_seats - ride.booked_seats
                const initials = ride.driver?.username?.slice(0, 2).toUpperCase() ?? '??'
                return (
                  <Card key={ride.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="w-10 h-10 flex-shrink-0 mt-1">
                          {ride.driver?.avatar_url && <AvatarImage src={ride.driver.avatar_url} />}
                          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <p className="text-sm font-bold text-gray-900">{ride.driver?.full_name ?? ride.driver?.username}</p>
                            <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                              <Leaf className="w-2.5 h-2.5" /> {ride.driver?.eco_score ?? 0} pts
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                            <MapPin className="w-4 h-4 text-eco-green flex-shrink-0" />
                            <span className="font-medium truncate">{ride.origin_label}</span>
                            <Navigation className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <span className="font-medium truncate">{ride.destination_label}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(ride.departure_time).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {freeSeats} posti liberi</span>
                            {ride.distance_km && <span className="flex items-center gap-1"><Ruler className="w-3 h-3" /> {ride.distance_km} km</span>}
                            <span className="font-semibold text-eco-green">
                              {ride.price_per_seat === 0 ? '🆓 Gratis' : `€${ride.price_per_seat}/posto`}
                            </span>
                          </div>
                          {ride.notes && <p className="text-xs text-gray-400 mt-1 italic">{ride.notes}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant={isBooked ? 'outline' : 'default'}
                          onClick={() => handleBook(ride.id)}
                          disabled={booking === ride.id || (!isBooked && freeSeats === 0)}
                          className="flex-shrink-0"
                        >
                          {booking === ride.id
                            ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            : isBooked ? 'Annulla' : freeSeats === 0 ? 'Pieno' : 'Prenota'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="mine">
          {myRides.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Car className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500">Non hai ancora offerto passaggi</p>
              <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>Offri un passaggio</Button>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {myRides.map(ride => {
                const isExpanded = expandedRide === ride.id
                const ridePassengers = passengers[ride.id] ?? []
                return (
                  <Card key={ride.id} className={`overflow-hidden ${ride.status === 'completed' ? 'opacity-75' : ''}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <MapPin className="w-4 h-4 text-eco-green flex-shrink-0" />
                            <span className="text-sm font-semibold truncate">{ride.origin_label} → {ride.destination_label}</span>
                            {ride.status === 'completed' && (
                              <Badge className="text-[10px] bg-eco-green/10 text-eco-green border-eco-green/20">✓ Completato</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                            <span><Clock className="w-3 h-3 inline mr-1" />{new Date(ride.departure_time).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            <span><Users className="w-3 h-3 inline mr-1" />{ride.booked_seats}/{ride.available_seats} prenotati</span>
                            {ride.price_per_seat > 0 && <span>€{ride.price_per_seat}/posto</span>}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {ride.status !== 'completed' && (
                            <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!isExpanded) loadPassengers(ride.id)
                              setExpandedRide(isExpanded ? null : ride.id)
                            }}
                          >
                            <Users className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-500 border-red-200 hover:bg-red-50"
                            onClick={() => handleDeleteRide(ride.id)}
                            disabled={deleting === ride.id}
                          >
                            {deleting === ride.id
                              ? <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                              : <Trash2 className="w-3 h-3" />}
                          </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Passengers list */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <p className="text-xs font-semibold text-gray-500 mb-2">Passeggeri prenotati</p>
                          {ridePassengers.length === 0 ? (
                            <p className="text-xs text-gray-400">Nessun passeggero ancora</p>
                          ) : (
                            <div className="space-y-2">
                              {ridePassengers.map(p => (
                                <div key={p.passenger_id} className="flex items-center gap-2">
                                  <Avatar className="w-7 h-7">
                                    {p.profile?.avatar_url && <AvatarImage src={p.profile.avatar_url} />}
                                    <AvatarFallback className="text-[10px]">{p.profile?.username?.slice(0,2).toUpperCase() ?? '??'}</AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <p className="text-xs font-medium text-gray-800">{p.profile?.full_name ?? p.profile?.username ?? 'Utente'}</p>
                                    <p className="text-[10px] text-gray-400">Prenotato {new Date(p.booked_at).toLocaleDateString('it-IT')}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
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
