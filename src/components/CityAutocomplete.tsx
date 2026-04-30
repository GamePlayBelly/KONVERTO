import { useState, useRef, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { searchCities } from '@/lib/cities'
import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
}

export function CityAutocomplete({ value, onChange, placeholder, className, id }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const results = searchCities(value)
    setSuggestions(results)
    setOpen(results.length > 0 && value.length > 0)
    setActiveIndex(-1)
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = useCallback((city: string) => {
    onChange(city)
    setOpen(false)
    setActiveIndex(-1)
  }, [onChange])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      select(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
      <Input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('pl-9', className)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden animate-fade-in">
          {suggestions.map((city, i) => (
            <button
              key={city}
              type="button"
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors',
                i === activeIndex ? 'bg-eco-green-light text-eco-green font-medium' : 'hover:bg-gray-50 text-gray-700'
              )}
              onMouseDown={() => select(city)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <MapPin className={cn('w-3.5 h-3.5 flex-shrink-0', i === activeIndex ? 'text-eco-green' : 'text-gray-300')} />
              <span>{city}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
