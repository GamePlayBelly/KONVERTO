import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check, MapPin, Clock, FileText, ChevronLeft, Zap, Leaf,
  Navigation, Square, CalendarClock, RotateCcw, ArrowRight, Sparkles, Hand,
  LocateFixed,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { insertTrip, incrementProfileStats } from '@/lib/supabase'
import {
  calcCO2Saved, calcEcoPoints, TRANSPORT_META, getBestEquivalent,
  suggestModes, formatDistance,
} from '@/lib/utils'
import type { TransportMode, GeoLocation } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AddressSearch } from '@/components/AddressSearch'
import type { PlaceResult } from '@/components/AddressSearch'
import EcoMap from '@/components/EcoMap'

const ALL_MODES: TransportMode[] = [
  'walking','cycling','ebike','escooter',
  'public_transport','tram_metro','train',
  'electric_vehicle','motorcycle','carpooling',
  'car','airplane',
]

function haversineKm(a: GeoLocation, b: GeoLocation) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function nowLocal() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

interface RouteResult {
  distanceKm: number
  durationMin: number
  routeCoords: [number, number][]
}

async function calcRoute(start: GeoLocation, end: GeoLocation): Promise<RouteResult | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`
    const res = await fetch(url)
    if (!res.ok) throw new Error()
    const data = await res.json() as {
      routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[]
    }
    const route = data.routes[0]
    if (!route) throw new Error()
    const coords: [number, number][] = route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    return {
      distanceKm: route.distance / 1000,
      durationMin: Math.round(route.duration / 60),
      routeCoords: coords,
    }
  } catch {
    // Fallback: straight line
    const d = haversineKm(start, end)
    return { distanceKm: d, durationMin: Math.round((d / 15) * 60), routeCoords: [] }
  }
}

export default function TripNew() {
  const navigate = useNavigate()
  const { user, refreshProfile } = useAuth()

  const [isSmartWorking, setIsSmartWorking] = useState(false)
  const SMART_WORKING_PTS = 50

  const [mode, setMode] = useState<TransportMode>('cycling')
  const [distanceKm, setDistanceKm] = useState('')
  const [durationMin, setDurationMin] = useState('')
  const [notes, setNotes] = useState('')
  const [startLoc, setStartLoc] = useState<GeoLocation | null>(null)
  const [endLoc, setEndLoc] = useState<GeoLocation | null>(null)
  const [startLabel, setStartLabel] = useState('')
  const [endLabel, setEndLabel] = useState('')
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<TransportMode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [earnedPts, setEarnedPts] = useState(0)

  // Scheduling
  const [isScheduled, setIsScheduled] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')

  // Posizione attuale (one-shot, senza avviare tracking)
  const [locating, setLocating] = useState(false)

  const fillCurrentPosition = useCallback(() => {
    if (!navigator.geolocation) { setError('GPS non disponibile sul dispositivo'); return }
    setLocating(true); setError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc: GeoLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'La mia posizione',
        }
        setStartLoc(loc)
        setStartLabel('La mia posizione')
        setRouteCoords(null)
        setSuggestions([])
        setLocating(false)
      },
      () => { setError('Impossibile ottenere la posizione. Controlla i permessi GPS.'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    )
  }, [])

  // GPS
  const [gpsActive, setGpsActive] = useState(false)
  const [gpsKm, setGpsKm] = useState(0)
  const [livePos, setLivePos] = useState<GeoLocation | null>(null)
  const [liveTrail, setLiveTrail] = useState<[number, number][]>([])
  const watchRef = useRef<number | null>(null)
  const lastPosRef = useRef<GeoLocation | null>(null)
  const accRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)

  // Multi-mezzo
  interface TripSegment {
    mode: TransportMode
    distanceKm: number
    startTime: number
    endTime?: number
  }
  const [segments, setSegments] = useState<TripSegment[]>([])
  const [showModePicker, setShowModePicker] = useState(false)

  useEffect(() => () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
  }, [])

  const startGPS = useCallback(() => {
    if (!navigator.geolocation) { setError('GPS non disponibile'); return }
    setGpsActive(true); setGpsKm(0); accRef.current = 0
    lastPosRef.current = null; startTimeRef.current = Date.now(); setError('')
    setLivePos(null); setLiveTrail([])

    // Imposta subito la posizione di partenza con getCurrentPosition (risposta rapida)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const cur: GeoLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: '📍 La tua posizione',
        }
        setStartLoc(cur)
        setStartLabel('📍 La tua posizione')
        lastPosRef.current = cur
        setLivePos(cur)
        setLiveTrail([[cur.lat, cur.lng]])
      },
      () => { /* silenzioso: watchPosition raccoglierà la pos dopo */ },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    )

    // watchPosition continua a tracciare il percorso
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const cur: GeoLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setLivePos(cur)
        setLiveTrail(prev => {
          const newPoint: [number, number] = [cur.lat, cur.lng]
          const last = prev[prev.length - 1]
          if (last && last[0] === newPoint[0] && last[1] === newPoint[1]) return prev
          return [...prev, newPoint]
        })
        // Imposta partenza se non ancora impostata (fallback)
        if (!lastPosRef.current) {
          const startCur: GeoLocation = { ...cur, label: '📍 La tua posizione' }
          setStartLoc(startCur)
          setStartLabel('📍 La tua posizione')
        }
        if (lastPosRef.current) {
          const d = haversineKm(lastPosRef.current, cur)
          if (d > 0.005) { accRef.current += d; setGpsKm(accRef.current) }
        }
        lastPosRef.current = cur
      },
      err => { setError(`GPS: ${err.message}`); setGpsActive(false) },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    )
  }, [])

  const stopGPS = useCallback(() => {
    if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null }
    setGpsActive(false)
    setLivePos(null)
    if (lastPosRef.current) {
      const endCur: GeoLocation = { ...lastPosRef.current, label: '📍 Destinazione rilevata' }
      setEndLoc(endCur)
      setEndLabel('📍 Destinazione rilevata')
    }
    if (accRef.current > 0) setDistanceKm(accRef.current.toFixed(2))
    if (startTimeRef.current) {
      const mins = Math.round((Date.now() - startTimeRef.current) / 60000)
      if (mins > 0) setDurationMin(String(mins))
    }
  }, [])

  // Calculate route when both locations are set
  const handleCalcRoute = useCallback(async () => {
    if (!startLoc || !endLoc) return
    setRouteLoading(true)
    const result = await calcRoute(startLoc, endLoc)
    if (result) {
      setDistanceKm(result.distanceKm.toFixed(2))
      if (!durationMin) setDurationMin(String(result.durationMin))
      setRouteCoords(result.routeCoords)
      setSuggestions(suggestModes(result.distanceKm))
    }
    setRouteLoading(false)
  }, [startLoc, endLoc, durationMin])

  const handleStartSelect = (place: PlaceResult) => {
    setStartLoc({ lat: place.lat, lng: place.lng, label: place.label })
    setStartLabel(place.label)
    setRouteCoords(null); setSuggestions([])
  }

  const handleEndSelect = (place: PlaceResult) => {
    setEndLoc({ lat: place.lat, lng: place.lng, label: place.label })
    setEndLabel(place.label)
    setRouteCoords(null); setSuggestions([])
  }

  const handleMapClick = useCallback((lat: number, lng: number, type: 'start' | 'end') => {
    const loc = { lat, lng }
    if (type === 'start') { setStartLoc(loc); setStartLabel(`${lat.toFixed(4)}, ${lng.toFixed(4)}`) }
    else { setEndLoc(loc); setEndLabel(`${lat.toFixed(4)}, ${lng.toFixed(4)}`) }
    setRouteCoords(null); setSuggestions([])
  }, [])

  const resetRoute = () => {
    setStartLoc(null); setEndLoc(null)
    setStartLabel(''); setEndLabel('')
    setRouteCoords(null); setSuggestions([])
    setDistanceKm(''); setDurationMin('')
  }

  // Normalizza virgola → punto per supportare tastiere IT (es. "5,5" → 5.5)
  const normKm = distanceKm.replace(',', '.')
  const km = parseFloat(normKm) || (gpsActive ? gpsKm : 0)
  const co2 = calcCO2Saved(mode, km)
  const pts = calcEcoPoints(co2, km)
  const equiv = km > 0 ? getBestEquivalent(co2) : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    const finalKm = parseFloat(distanceKm.replace(',', '.')) || 0
    if (!isSmartWorking) {
      if (finalKm <= 0) { setError('Inserisci una distanza valida'); return }
    }
    if (isScheduled && !scheduledFor) { setError('Scegli la data del viaggio programmato'); return }
    setLoading(true); setError('')
    try {
      // ── Smart working shortcut ──
      if (isSmartWorking) {
        await insertTrip({
          user_id: user.id,
          transport_mode: 'walking',
          distance_km: 0,
          duration_minutes: null,
          co2_saved_kg: 0,
          eco_points: SMART_WORKING_PTS,
          start_location: null,
          end_location: null,
          notes: 'Smart Working — giornata da casa',
          recorded_at: new Date().toISOString(),
        })
        await incrementProfileStats(user.id, SMART_WORKING_PTS, 0)
        await refreshProfile()
        setEarnedPts(SMART_WORKING_PTS)
        setSuccess(true)
        setTimeout(() => navigate('/dashboard'), 2200)
        return
      }

      const recordedAt = isScheduled ? new Date(scheduledFor).toISOString() : new Date().toISOString()

      // Build multi-mezzo log if there are segments
      let finalNotes = notes.trim() || null
      if (segments.length > 0) {
        const allSegments = [
          ...segments,
          { mode, distanceKm: accRef.current > 0 ? accRef.current : finalKm - segments.reduce((s, seg) => s + seg.distanceKm, 0) },
        ]
        const log = allSegments
          .filter(seg => seg.distanceKm > 0)
          .map(seg => `${TRANSPORT_META[seg.mode].emoji} ${seg.distanceKm.toFixed(1)}km`)
          .join(', ')
        const multiMezzoTag = `[Multi-mezzo: ${log}]`
        finalNotes = finalNotes ? `${finalNotes}\n${multiMezzoTag}` : multiMezzoTag
      }

      await insertTrip({
        user_id: user.id,
        transport_mode: mode,
        distance_km: finalKm,
        duration_minutes: durationMin ? parseInt(durationMin) : null,
        co2_saved_kg: co2,
        eco_points: pts,
        start_location: startLoc,
        end_location: endLoc,
        notes: finalNotes,
        recorded_at: recordedAt,
      })
      if (!isScheduled) {
        await incrementProfileStats(user.id, pts, co2)
        await refreshProfile()
      }
      setEarnedPts(pts)
      setSuccess(true)
      setTimeout(() => navigate('/dashboard'), 2200)
    } catch (err: unknown) {
      // Supabase errors have a .message property but aren't Error instances
      const supaErr = err as { message?: string; details?: string; code?: string } | null
      const msg = supaErr?.message ?? (err instanceof Error ? err.message : null)
      if (msg?.includes('transport_mode') || supaErr?.code === '23514') {
        setError('Mezzo non supportato dal DB. Esegui in Supabase SQL Editor:\nALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_transport_mode_check;\nALTER TABLE trips ADD CONSTRAINT trips_transport_mode_check CHECK (transport_mode IN (\'walking\',\'cycling\',\'ebike\',\'escooter\',\'public_transport\',\'tram_metro\',\'train\',\'electric_vehicle\',\'motorcycle\',\'carpooling\',\'car\',\'airplane\'));')
      } else if (msg?.includes('column') || supaErr?.code === '42703') {
        setError('Colonna mancante nel database. Esegui supabase_complete_schema.sql per aggiornare lo schema.')
      } else {
        setError(msg ?? 'Errore durante il salvataggio. Controlla la console per dettagli.')
      }
      console.error('[TripNew] save error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center space-y-4 animate-fade-in">
          <div className="w-24 h-24 bg-eco-green rounded-full flex items-center justify-center mx-auto shadow-xl shadow-eco-green/30">
            <Check className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center justify-center gap-2">
            {isSmartWorking
              ? <><Hand className="w-6 h-6 text-blue-500" /> Smart working registrato!</>
              : isScheduled
                ? <><CalendarClock className="w-6 h-6" /> Viaggio programmato!</>
                : <><Sparkles className="w-6 h-6" /> Viaggio salvato!</>}
          </h2>
          {!isScheduled && (
            <>
              <p className="text-gray-500">Hai guadagnato <span className="text-eco-green font-bold text-lg">+{isSmartWorking ? earnedPts : pts} punti</span></p>
              {!isSmartWorking && <p className="text-gray-500">Risparmiato <span className="text-eco-green font-bold">{co2.toFixed(2)} kg CO₂</span></p>}
              {equiv && (
                <div className="inline-flex items-center gap-2 bg-eco-green-light text-eco-teal rounded-full px-4 py-1.5 text-sm font-medium">
                  <span>{equiv.emoji}</span> {equiv.text}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 lg:pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Registra un viaggio</h1>
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">Ogni spostamento sostenibile conta <Leaf className="w-3.5 h-3.5 text-eco-green" /></p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── PERCORSO ── */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-2 bg-gray-50/60">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                <MapPin className="w-4 h-4 text-eco-green" /> Percorso
              </CardTitle>
              {(startLoc || endLoc) && (
                <button type="button" onClick={resetRoute} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {/* Address inputs */}
            <div className="space-y-2">
              <div className="space-y-1.5">
                <AddressSearch
                  value={startLabel}
                  placeholder="🟢 Cerca partenza..."
                  onSelect={handleStartSelect}
                  onChange={setStartLabel}
                />
                {/* Bottone posizione attuale */}
                <button
                  type="button"
                  onClick={fillCurrentPosition}
                  disabled={locating || gpsActive}
                  className="flex items-center gap-1.5 text-xs font-semibold text-eco-teal bg-eco-green-light hover:bg-eco-green/20 disabled:opacity-50 px-3 py-1.5 rounded-xl transition-colors border border-eco-green/20 w-full justify-center"
                >
                  {locating
                    ? <><span className="w-3 h-3 border-2 border-eco-green border-t-transparent rounded-full animate-spin" /> Ricerca posizione...</>
                    : <><LocateFixed className="w-3.5 h-3.5" /> Usa la mia posizione attuale</>
                  }
                </button>
              </div>
              <AddressSearch
                value={endLabel}
                placeholder="🔴 Cerca destinazione..."
                onSelect={handleEndSelect}
                onChange={setEndLabel}
              />
            </div>

            {/* Calc route button */}
            {startLoc && endLoc && !gpsActive && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-eco-green/40 text-eco-green hover:bg-eco-green-light"
                onClick={handleCalcRoute}
                disabled={routeLoading}
              >
                {routeLoading
                  ? <><span className="w-3 h-3 border-2 border-eco-green border-t-transparent rounded-full animate-spin mr-2" />Calcolo percorso...</>
                  : <><Sparkles className="w-4 h-4 mr-2" />Calcola percorso e suggerisci mezzo</>
                }
              </Button>
            )}

            {/* Mode suggestions from route */}
            {suggestions.length > 0 && (
              <div className="bg-eco-green-light/60 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-eco-teal flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Mezzi consigliati per {formatDistance(parseFloat(distanceKm))}
                </p>
                <div className="flex gap-2 flex-wrap">
                  {suggestions.map((m, i) => {
                    const meta = TRANSPORT_META[m]
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all ${
                          mode === m ? 'border-eco-green bg-eco-green text-white' : 'border-eco-green/30 bg-white text-gray-700 hover:border-eco-green'
                        }`}
                      >
                        {i === 0 && <span className="text-[10px]">★</span>}
                        {meta.emoji} {meta.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Map con GPS button flottante */}
            <div className={`relative rounded-xl overflow-hidden border transition-all ${gpsActive ? 'border-eco-green/40 ring-2 ring-eco-green/20' : 'border-gray-100'}`}>
              <EcoMap
                trips={[]}
                height={gpsActive ? '260px' : '220px'}
                interactive
                onLocationSelect={handleMapClick}
                startMarker={startLoc}
                endMarker={endLoc}
                routeCoords={routeCoords}
                livePosition={livePos}
                liveTrail={liveTrail}
              />

              {/* GPS floating button — bottom right of map */}
              {!gpsActive ? (
                <button
                  type="button"
                  onClick={startGPS}
                  title="Registra con GPS"
                  className="absolute bottom-3 right-3 z-[1000] flex items-center gap-2 bg-white border-2 border-eco-green text-eco-green text-xs font-bold px-3 py-2 rounded-xl shadow-lg hover:bg-eco-green hover:text-white transition-all"
                >
                  <Navigation className="w-4 h-4" />
                  GPS live
                </button>
              ) : (
                <div className="absolute bottom-3 left-3 right-3 z-[1000] flex items-center justify-between gap-2 bg-white/95 backdrop-blur-sm border border-eco-green/30 rounded-xl shadow-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-eco-green animate-pulse flex-shrink-0" />
                    <span className="text-xs font-bold text-eco-green">GPS attivo</span>
                    <span className="text-sm font-mono font-bold text-gray-800">{gpsKm.toFixed(2)} km</span>
                  </div>
                  <button
                    type="button"
                    onClick={stopGPS}
                    className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-red-600 transition-colors"
                  >
                    <Square className="w-3 h-3" />
                    Ferma
                  </button>
                </div>
              )}
            </div>

            <p className="text-[11px] text-gray-400 text-center">
              {gpsActive
                ? 'La mappa segue la tua posizione in tempo reale'
                : 'Clicca sulla mappa per impostare partenza/destinazione · oppure usa il GPS'}
            </p>
          </CardContent>
        </Card>

        {/* ── MEZZO DI TRASPORTO ── */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-2 bg-gray-50/60">
            <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Mezzo di trasporto
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {ALL_MODES.map(m => {
                const meta = TRANSPORT_META[m]
                const active = mode === m
                const isSuggested = suggestions.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-2xl border-2 transition-all duration-200 ${
                      active
                        ? 'border-eco-green bg-eco-green-light shadow-sm scale-105'
                        : isSuggested
                          ? 'border-eco-green/30 bg-eco-green-light/40 hover:border-eco-green/60'
                          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                    }`}
                    title={`${meta.label} — ${meta.co2Label}`}
                  >
                    {isSuggested && !active && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-eco-green rounded-full border-2 border-white" />
                    )}
                    <span className="text-xl">{meta.emoji}</span>
                    <span className={`text-[9px] font-bold text-center leading-tight ${active ? 'text-eco-teal' : 'text-gray-400'}`}>
                      {meta.label.split(' ')[0]}
                    </span>
                    <span className={`text-[8px] ${active ? 'text-eco-green/70' : 'text-gray-300'}`}>
                      {meta.co2Label}
                    </span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── DETTAGLI ── */}
        <Card>
          <CardHeader className="pb-2 bg-gray-50/60">
            <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Dettagli viaggio
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="distance">Distanza (km) *</Label>
                <Input
                  id="distance"
                  type="text"
                  inputMode="decimal"
                  placeholder="es. 5.5"
                  value={gpsActive ? gpsKm.toFixed(2) : distanceKm}
                  onChange={e => {
                    if (!gpsActive) {
                      // Accetta sia "." che "," come separatore decimale
                      const v = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')
                      setDistanceKm(v)
                      setError('')
                    }
                  }}
                  readOnly={gpsActive}
                  className={gpsActive ? 'bg-eco-green-light border-eco-green font-mono text-eco-green font-semibold' : ''}
                />
                {gpsActive && (
                  <div className="space-y-2">
                    {/* Cambia mezzo button */}
                    <button
                      type="button"
                      onClick={() => setShowModePicker(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-eco-teal font-semibold bg-eco-green-light hover:bg-eco-green/20 px-3 py-1.5 rounded-xl transition-colors border border-eco-green/20"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Cambia mezzo durante il viaggio
                    </button>

                    {/* Mode picker (shown when toggled) */}
                    {showModePicker && (
                      <div className="bg-white border border-eco-green/20 rounded-xl p-3 shadow-sm space-y-2">
                        <p className="text-[11px] font-semibold text-gray-500">Seleziona il nuovo mezzo:</p>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                          {ALL_MODES.map(m => {
                            const meta = TRANSPORT_META[m]
                            return (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  // Save current segment
                                  const now = Date.now()
                                  setSegments(prev => [
                                    ...prev,
                                    {
                                      mode,
                                      distanceKm: accRef.current,
                                      startTime: prev.length > 0
                                        ? prev[prev.length - 1].endTime ?? now
                                        : startTimeRef.current ?? now,
                                      endTime: now,
                                    },
                                  ])
                                  // Reset accumulator but keep GPS running
                                  accRef.current = 0
                                  setGpsKm(0)
                                  // Switch mode
                                  setMode(m)
                                  setShowModePicker(false)
                                }}
                                className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                                  mode === m
                                    ? 'border-eco-green bg-eco-green-light'
                                    : 'border-gray-100 bg-white hover:border-eco-green/40'
                                }`}
                                title={meta.label}
                              >
                                <span className="text-lg">{meta.emoji}</span>
                                <span className="text-[8px] font-bold text-gray-500 leading-tight text-center">
                                  {meta.label.split(' ')[0]}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Segment history */}
                    {segments.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
                        {segments.map((seg, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <span>{TRANSPORT_META[seg.mode].emoji}</span>
                            <span className="font-semibold text-gray-700">{seg.distanceKm.toFixed(1)} km</span>
                            {i < segments.length - 1 && <span className="text-gray-300 mx-0.5">→</span>}
                          </span>
                        ))}
                        <span className="text-gray-300 mx-0.5">→</span>
                        <span className="flex items-center gap-1 text-eco-green font-semibold">
                          {TRANSPORT_META[mode].emoji} in corso…
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="duration"><Clock className="inline w-3 h-3 mr-1" />Durata (min)</Label>
                <Input id="duration" type="number" min="1" placeholder="es. 30" value={durationMin} onChange={e => setDurationMin(e.target.value)} />
              </div>
            </div>

            {/* CO₂ preview */}
            {km > 0 && (
              <div className="bg-gradient-to-r from-eco-green-light to-emerald-50 rounded-2xl p-4 flex items-center justify-between border border-eco-green/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-eco-green rounded-xl flex items-center justify-center">
                    <Leaf className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-eco-teal font-medium">CO₂ risparmiata</p>
                    <p className="text-xl font-bold text-eco-green">{co2.toFixed(2)} kg</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-eco-green" />
                    <span className="text-xl font-bold text-eco-green">+{pts}</span>
                    <span className="text-xs text-gray-400">pts</span>
                  </div>
                  {equiv && (
                    <Badge variant="secondary" className="text-[10px] font-medium">
                      {equiv.emoji} {equiv.text}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="notes"><FileText className="inline w-3 h-3 mr-1" />Note</Label>
              <Textarea
                id="notes"
                placeholder="Aggiungi note..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {/* ── SMART WORKING ── */}
        <Card className={isSmartWorking ? 'border-blue-300 bg-blue-50/40' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Hand className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700">Oggi smart working</p>
                  <p className="text-xs text-gray-400">Lavori da casa? Guadagna +{SMART_WORKING_PTS} pts per le emissioni zero</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSmartWorking(!isSmartWorking)}
                className={`w-12 h-6 rounded-full transition-all relative flex-shrink-0 ${isSmartWorking ? 'bg-blue-500' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isSmartWorking ? 'left-6' : 'left-0.5'}`} />
              </button>
            </div>
            {isSmartWorking && (
              <div className="mt-3 bg-blue-100 rounded-xl px-4 py-3 flex items-center gap-3">
                <Zap className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-blue-800">+{SMART_WORKING_PTS} punti eco</p>
                  <p className="text-xs text-blue-600">Il viaggio verrà registrato con 0 km e 0 emissioni. Clicca "Salva" per confermare.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── PROGRAMMATO ── */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-eco-green" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">Viaggio programmato</p>
                  <p className="text-xs text-gray-400">Pianifica per il futuro, appare nello storico</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsScheduled(!isScheduled)}
                className={`w-12 h-6 rounded-full transition-all relative ${isScheduled ? 'bg-eco-green' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isScheduled ? 'left-6' : 'left-0.5'}`} />
              </button>
            </div>
            {isScheduled && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="scheduledFor" className="flex items-center gap-1.5">
                  <ArrowRight className="w-3 h-3 text-eco-green" /> Data e ora del viaggio
                </Label>
                <Input
                  id="scheduledFor"
                  type="datetime-local"
                  min={nowLocal()}
                  value={scheduledFor}
                  onChange={e => setScheduledFor(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          className="w-full shadow-lg shadow-eco-green/20"
          disabled={loading || gpsActive}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Salvataggio...
            </span>
          ) : gpsActive ? (
            'Ferma prima il GPS...'
          ) : isScheduled ? (
            <><CalendarClock className="w-5 h-5" /> Programma viaggio</>
          ) : (
            <><Check className="w-5 h-5" /> Salva viaggio</>
          )}
        </Button>
      </form>
    </div>
  )
}
