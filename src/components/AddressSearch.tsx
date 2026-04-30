import { useState, useRef, useEffect, useCallback } from 'react'
import { MapPin, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface PlaceResult {
  label: string
  lat: number
  lng: number
}

interface Props {
  value: string
  placeholder?: string
  icon?: React.ReactNode
  onSelect: (place: PlaceResult) => void
  onChange?: (value: string) => void
  className?: string
  disabled?: boolean
}

async function nominatimSearch(q: string): Promise<PlaceResult[]> {
  if (q.length < 3) return []
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1&accept-language=it`
  const res = await fetch(url, { headers: { 'Accept-Language': 'it' } })
  if (!res.ok) return []
  const data = await res.json() as {
    display_name: string; lat: string; lon: string;
    address?: { city?: string; town?: string; village?: string; country?: string }
  }[]
  return data.map(d => {
    const parts = d.display_name.split(', ')
    const label = parts.slice(0, 3).join(', ')
    return { label, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }
  })
}

export function AddressSearch({ value, placeholder, icon, onSelect, onChange, className, disabled }: Props) {
  const [query, setQuery] = useState(value)
  const [suggestions, setSuggestions] = useState<PlaceResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external value change
  useEffect(() => { setQuery(value) }, [value])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleInput = useCallback((val: string) => {
    setQuery(val)
    onChange?.(val)
    setActiveIdx(-1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 3) { setSuggestions([]); setOpen(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const results = await nominatimSearch(val)
      setSuggestions(results)
      setOpen(results.length > 0)
      setLoading(false)
    }, 400)
  }, [onChange])

  const select = useCallback((place: PlaceResult) => {
    setQuery(place.label)
    setSuggestions([])
    setOpen(false)
    onSelect(place)
  }, [onSelect])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); select(suggestions[activeIdx]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10 text-gray-400">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (icon ?? <MapPin className="w-4 h-4" />)}
        </div>
        <Input
          value={query}
          onChange={e => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
          placeholder={placeholder}
          className="pl-9"
          autoComplete="off"
          disabled={disabled}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden animate-fade-in">
          {suggestions.map((place, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={() => select(place)}
              onMouseEnter={() => setActiveIdx(i)}
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm flex items-start gap-2.5 transition-colors border-b border-gray-50 last:border-0',
                i === activeIdx ? 'bg-eco-green-light text-eco-green' : 'hover:bg-gray-50 text-gray-700'
              )}
            >
              <MapPin className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', i === activeIdx ? 'text-eco-green' : 'text-gray-300')} />
              <span className="truncate">{place.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
