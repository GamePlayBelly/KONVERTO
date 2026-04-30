import { useEffect, useRef } from 'react'
import type { Trip, GeoLocation } from '@/types'
import { TRANSPORT_META } from '@/lib/utils'

interface Props {
  trips?: Trip[]
  height?: string
  interactive?: boolean
  onLocationSelect?: (lat: number, lng: number, type: 'start' | 'end') => void
  startMarker?: GeoLocation | null
  endMarker?: GeoLocation | null
  routeCoords?: [number, number][] | null
  /** Posizione GPS live (si aggiorna senza ricreare la mappa) */
  livePosition?: GeoLocation | null
  /** Tracciato GPS percorso finora */
  liveTrail?: [number, number][]
}

const MODE_COLORS: Record<string, string> = {
  walking:           '#10b981',
  cycling:           '#3b82f6',
  ebike:             '#06b6d4',
  escooter:          '#14b8a6',
  public_transport:  '#8b5cf6',
  tram_metro:        '#6366f1',
  train:             '#0ea5e9',
  electric_vehicle:  '#f59e0b',
  motorcycle:        '#f97316',
  carpooling:        '#ef4444',
}

export default function EcoMap({
  trips = [],
  height = '300px',
  interactive = false,
  onLocationSelect,
  startMarker,
  endMarker,
  routeCoords,
  livePosition,
  liveTrail,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<unknown>(null)
  // Refs for live-update layers (no map rebuild needed)
  const liveMarkerRef = useRef<unknown>(null)
  const liveTrailLayerRef = useRef<unknown>(null)

  useEffect(() => {
    if (!mapRef.current) return

    import('leaflet').then((L) => {
      if (mapInstanceRef.current) {
        ;(mapInstanceRef.current as ReturnType<typeof L.map>).remove()
      }

      const tripsWithCoords = trips.filter(t => t.start_location?.lat && t.start_location?.lng)

      let defaultCenter: [number, number] = [41.9028, 12.4964] // Roma
      if (startMarker) {
        defaultCenter = [startMarker.lat, startMarker.lng]
      } else if (tripsWithCoords.length > 0) {
        defaultCenter = [tripsWithCoords[0].start_location!.lat, tripsWithCoords[0].start_location!.lng]
      }

      const zoom = (startMarker && endMarker) ? 12 : tripsWithCoords.length > 0 ? 13 : 6

      const map = L.map(mapRef.current!, {
        center: defaultCenter,
        zoom,
        zoomControl: true,
        scrollWheelZoom: interactive,
      })

      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      // ── Route line (OSRM geometry or straight line) ──
      if (routeCoords && routeCoords.length > 1) {
        L.polyline(routeCoords, {
          color: '#1D9E75',
          weight: 5,
          opacity: 0.85,
        }).addTo(map)
      } else if (startMarker && endMarker) {
        L.polyline(
          [[startMarker.lat, startMarker.lng], [endMarker.lat, endMarker.lng]],
          { color: '#1D9E75', weight: 3, opacity: 0.5, dashArray: '8 6' }
        ).addTo(map)
      }

      // ── Start / end markers ──
      const makePin = (color: string, symbol: string) => L.divIcon({
        html: `<div style="
          background:${color};
          width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
          border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,.25);
          display:flex;align-items:center;justify-content:center;
        "><span style="transform:rotate(45deg);font-size:15px;line-height:1;">${symbol}</span></div>`,
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      })

      if (startMarker) {
        L.marker([startMarker.lat, startMarker.lng], { icon: makePin('#1D9E75', '🟢') })
          .addTo(map)
          .bindPopup(`<b>Partenza</b>${startMarker.label ? `<br/>${startMarker.label}` : ''}`)
      }

      if (endMarker) {
        L.marker([endMarker.lat, endMarker.lng], { icon: makePin('#ef4444', '🔴') })
          .addTo(map)
          .bindPopup(`<b>Destinazione</b>${endMarker.label ? `<br/>${endMarker.label}` : ''}`)
      }

      // Fit bounds to show both markers
      if (startMarker && endMarker) {
        map.fitBounds(
          [[startMarker.lat, startMarker.lng], [endMarker.lat, endMarker.lng]],
          { padding: [40, 40] }
        )
      }

      // ── Trip history markers ──
      tripsWithCoords.forEach((trip) => {
        const color = MODE_COLORS[trip.transport_mode] ?? '#1D9E75'
        const meta = TRANSPORT_META[trip.transport_mode]
        const popupContent = `<div style="font-family:sans-serif;min-width:150px;line-height:1.6">
          <b style="font-size:13px">${meta.emoji} ${meta.label}</b><br/>
          📏 ${Number(trip.distance_km).toFixed(1)} km &nbsp;·&nbsp; ⚡ +${trip.eco_points} pts<br/>
          🌿 ${Number(trip.co2_saved_kg).toFixed(2)} kg CO₂ risparmiata
        </div>`

        if (trip.start_location) {
          // Start marker — colored teardrop with emoji
          const startIcon = L.divIcon({
            html: `<div style="background:${color};width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;">
              <span style="transform:rotate(45deg);font-size:13px;line-height:1">${meta.emoji}</span>
            </div>`,
            className: '',
            iconSize: [30, 30],
            iconAnchor: [15, 30],
          })
          L.marker([trip.start_location.lat, trip.start_location.lng], { icon: startIcon })
            .addTo(map)
            .bindPopup(popupContent)
        }

        if (trip.start_location && trip.end_location) {
          // Route line
          L.polyline(
            [[trip.start_location.lat, trip.start_location.lng], [trip.end_location.lat, trip.end_location.lng]],
            { color, weight: 4, opacity: 0.7, dashArray: '10 5' }
          ).addTo(map)

          // End marker — small circle dot
          const endIcon = L.divIcon({
            html: `<div style="background:white;width:14px;height:14px;border-radius:50%;border:3px solid ${color};box-shadow:0 1px 4px rgba(0,0,0,.25);"></div>`,
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          })
          L.marker([trip.end_location.lat, trip.end_location.lng], { icon: endIcon })
            .addTo(map)
            .bindPopup(popupContent)
        }
      })

      // Click handler
      if (interactive && onLocationSelect) {
        let clickCount = 0
        map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          const type = clickCount % 2 === 0 ? 'start' : 'end'
          onLocationSelect(e.latlng.lat, e.latlng.lng, type)
          clickCount++
        })
      }

      // Fit bounds to all trip markers
      if (tripsWithCoords.length > 1 && !startMarker) {
        const bounds = tripsWithCoords
          .filter(t => t.start_location)
          .map(t => [t.start_location!.lat, t.start_location!.lng] as [number, number])
        map.fitBounds(bounds, { padding: [30, 30] })
      }
    })

    return () => {
      if (mapInstanceRef.current) {
        ;(mapInstanceRef.current as { remove: () => void }).remove()
        mapInstanceRef.current = null
        liveMarkerRef.current = null
        liveTrailLayerRef.current = null
      }
    }
  }, [trips, interactive, onLocationSelect, startMarker, endMarker, routeCoords])

  // ── Live GPS position update (no map rebuild) ──
  useEffect(() => {
    if (!mapInstanceRef.current) return
    import('leaflet').then((L) => {
      const map = mapInstanceRef.current as ReturnType<typeof L.map>

      // Update trail polyline
      if (liveTrailLayerRef.current) {
        ;(liveTrailLayerRef.current as ReturnType<typeof L.polyline>).remove()
      }
      if (liveTrail && liveTrail.length > 1) {
        liveTrailLayerRef.current = L.polyline(liveTrail, {
          color: '#1D9E75',
          weight: 4,
          opacity: 0.8,
          dashArray: '6 4',
        }).addTo(map)
      }

      // Update live position marker
      if (liveMarkerRef.current) {
        ;(liveMarkerRef.current as ReturnType<typeof L.marker>).remove()
      }
      if (livePosition) {
        const pulseIcon = L.divIcon({
          html: `<div style="position:relative;width:24px;height:24px;">
            <div style="
              position:absolute;inset:0;border-radius:50%;
              background:rgba(29,158,117,0.25);
              animation:gpsPulse 1.6s ease-out infinite;
            "></div>
            <div style="
              position:absolute;top:4px;left:4px;
              width:16px;height:16px;border-radius:50%;
              background:#1D9E75;border:3px solid white;
              box-shadow:0 2px 8px rgba(29,158,117,0.6);
            "></div>
          </div>
          <style>
            @keyframes gpsPulse {
              0%  { transform:scale(1);   opacity:.7 }
              70% { transform:scale(2.5); opacity:0  }
              100%{ transform:scale(1);   opacity:0  }
            }
          </style>`,
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        })
        liveMarkerRef.current = L.marker([livePosition.lat, livePosition.lng], { icon: pulseIcon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup('📍 La tua posizione attuale')
        // Pan map to follow position
        map.panTo([livePosition.lat, livePosition.lng], { animate: true, duration: 0.8 })
      }
    })
  }, [livePosition, liveTrail])

  return (
    <div
      ref={mapRef}
      style={{ height, width: '100%' }}
      className="z-0"
      aria-label="Mappa percorsi"
    />
  )
}
