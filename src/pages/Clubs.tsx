import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Users, Plus, Leaf, Search, MapPin, Lock, Globe, Crown, Trophy, Clock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, requestJoinClub, cancelJoinRequest, getUserPendingRequests } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CityAutocomplete } from '@/components/CityAutocomplete'

interface Club {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  city: string | null
  company: string | null
  is_public: boolean
  eco_score_total: number
  member_count: number
  created_by: string
}

export default function Clubs() {
  const { user, profile: userProfile } = useAuth()
  const navigate = useNavigate()
  const [clubs, setClubs] = useState<Club[]>([])
  const [myClubs, setMyClubs] = useState<string[]>([])
  const [adminClubs, setAdminClubs] = useState<string[]>([])
  const [pendingClubs, setPendingClubs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [joining, setJoining] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newClub, setNewClub] = useState({ name: '', description: '', company: '', city: '' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: clubsData }, { data: memberships }, { data: allMembers }, pending] = await Promise.all([
      supabase.from('clubs').select('*').order('eco_score_total', { ascending: false }),
      user ? supabase.from('club_members').select('club_id, role').eq('user_id', user.id) : { data: [] },
      // Fetch member counts + eco_score to compute live eco_score_total per club
      supabase.from('club_members').select('club_id, profile:profiles(eco_score)'),
      user ? getUserPendingRequests(user.id) : Promise.resolve([]),
    ])

    // Compute real member counts + eco_score_total client-side
    const memberCountMap: Record<string, number> = {}
    const ecoScoreMap:   Record<string, number> = {}
    for (const row of (allMembers ?? []) as unknown as { club_id: string; profile: { eco_score: number } | null }[]) {
      memberCountMap[row.club_id] = (memberCountMap[row.club_id] ?? 0) + 1
      ecoScoreMap[row.club_id]   = (ecoScoreMap[row.club_id]   ?? 0) + (row.profile?.eco_score ?? 0)
    }
    const clubs = ((clubsData ?? []) as Club[]).map(c => ({
      ...c,
      member_count:    memberCountMap[c.id] ?? 0,
      eco_score_total: ecoScoreMap[c.id]   ?? 0,
    }))

    const myIds = (memberships ?? []).map((m: { club_id: string }) => m.club_id)
    const adminIds = (memberships ?? []).filter((m: { role: string }) => m.role === 'admin').map((m: { club_id: string }) => m.club_id)
    setMyClubs(myIds)
    setAdminClubs(adminIds)
    setPendingClubs(pending)
    setClubs(clubs)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  const handleJoin = async (club: Club, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user || !userProfile) return
    const clubId = club.id
    setJoining(clubId)
    try {
      if (myClubs.includes(clubId)) {
        // Leave club
        await supabase.from('club_members').delete().eq('club_id', clubId).eq('user_id', user.id)
        setMyClubs(prev => prev.filter(id => id !== clubId))
        load()
      } else if (pendingClubs.includes(clubId)) {
        // Cancel pending request
        await cancelJoinRequest(clubId, user.id)
        setPendingClubs(prev => prev.filter(id => id !== clubId))
      } else {
        // Send join request
        const adminId = club.created_by
        await requestJoinClub(clubId, user.id, { username: userProfile.username, avatar_url: userProfile.avatar_url }, club.name, adminId)
        setPendingClubs(prev => [...prev, clubId])
      }
    } catch {
      // silent
    } finally {
      setJoining(null)
    }
  }

  const handleCreate = async () => {
    if (!user || !newClub.name.trim()) return
    setCreating(true)
    try {
      const { data, error } = await supabase.from('clubs').insert({
        name: newClub.name.trim(),
        description: newClub.description.trim() || null,
        company: newClub.company.trim() || null,
        city: newClub.city.trim() || null,
        created_by: user.id,
      }).select().single()
      if (error) throw error
      await supabase.from('club_members').insert({ club_id: (data as Club).id, user_id: user.id, role: 'admin' })
      setShowCreate(false)
      setNewClub({ name: '', description: '', company: '', city: '' })
      load()
    } finally {
      setCreating(false)
    }
  }

  const filtered = clubs.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.company ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.city ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const myClubList = filtered.filter(c => myClubs.includes(c.id))
  const otherClubs = filtered.filter(c => !myClubs.includes(c.id))
  const ranking = [...clubs].sort((a, b) => (b.eco_score_total ?? 0) - (a.eco_score_total ?? 0)).slice(0, 20)

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-24 lg:pb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-7 h-7 text-eco-green" /> Club Aziendali
          </h1>
          <p className="text-sm text-gray-500 mt-1">Unisciti alla community eco della tua azienda</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4" /> Crea club
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="border-eco-green/30 bg-eco-green-light/30 animate-fade-in">
          <CardContent className="p-5 space-y-3">
            <h3 className="font-bold text-gray-900">Nuovo club</h3>
            <Input placeholder="Nome club *" value={newClub.name} onChange={e => setNewClub(p => ({ ...p, name: e.target.value }))} />
            <Input placeholder="Azienda" value={newClub.company} onChange={e => setNewClub(p => ({ ...p, company: e.target.value }))} />
            <CityAutocomplete
              value={newClub.city}
              onChange={v => setNewClub(p => ({ ...p, city: v }))}
              placeholder="Città"
            />
            <Input placeholder="Descrizione" value={newClub.description} onChange={e => setNewClub(p => ({ ...p, description: e.target.value }))} />
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={creating || !newClub.name.trim()} className="flex-1">
                {creating ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Crea'}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Annulla</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="explore">
        <TabsList className="w-full">
          <TabsTrigger value="explore" className="flex-1">
            <Building2 className="w-3.5 h-3.5 mr-1" /> Esplora
          </TabsTrigger>
          <TabsTrigger value="ranking" className="flex-1">
            <Trophy className="w-3.5 h-3.5 mr-1" /> Classifica
          </TabsTrigger>
        </TabsList>

        <TabsContent value="explore" className="space-y-5">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Cerca club, azienda o città..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
          </div>

          {/* My clubs */}
          {myClubList.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">I tuoi club</h2>
              <div className="space-y-3">
                {myClubList.map(club => (
                  <ClubCard
                    key={club.id}
                    club={club}
                    isMember={true}
                    isAdmin={adminClubs.includes(club.id)}
                    isPending={false}
                    onJoin={handleJoin}
                    joining={joining === club.id}
                    onClick={() => navigate(`/clubs/${club.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All clubs */}
          <div>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
              {myClubList.length > 0 ? 'Scopri altri club' : 'Tutti i club'}
            </h2>
            {loading ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
            ) : otherClubs.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">Nessun club trovato</p>
                <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>Crea il primo club</Button>
              </CardContent></Card>
            ) : (
              <div className="space-y-3">
                {otherClubs.map(club => (
                  <ClubCard
                    key={club.id}
                    club={club}
                    isMember={false}
                    isAdmin={false}
                    isPending={pendingClubs.includes(club.id)}
                    onJoin={handleJoin}
                    joining={joining === club.id}
                    onClick={() => navigate(`/clubs/${club.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="ranking">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-400 mb-4">Club classificati per punteggio ecologico totale</p>
              {loading ? (
                <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
              ) : (
                <div className="space-y-2">
                  {ranking.map((club, i) => {
                    const initials = club.name.slice(0, 2).toUpperCase()
                    const rankBadge = i < 3 ? ['1°', '2°', '3°'][i] : `#${i + 1}`
                    return (
                      <div
                        key={club.id}
                        className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => navigate(`/clubs/${club.id}`)}
                      >
                        <span className="w-8 text-center text-sm font-bold text-gray-500 flex-shrink-0">{rankBadge}</span>
                        <Avatar className="w-9 h-9 flex-shrink-0">
                          {club.avatar_url && <AvatarImage src={club.avatar_url} />}
                          <AvatarFallback className="bg-eco-green-light text-eco-teal text-xs font-bold">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{club.name}</p>
                          <p className="text-xs text-gray-400 flex items-center gap-2">
                            <span className="flex items-center gap-0.5"><Users className="w-3 h-3" /> {club.member_count}</span>
                            {club.city && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {club.city}</span>}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-eco-green flex items-center gap-1">
                            <Leaf className="w-3.5 h-3.5" /> {club.eco_score_total.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-gray-400">punti totali</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ClubCard({ club, isMember, isAdmin, isPending, onJoin, joining, onClick }: {
  club: Club; isMember: boolean; isAdmin: boolean; isPending: boolean
  onJoin: (club: Club, e: React.MouseEvent) => void; joining: boolean; onClick: () => void
}) {
  const initials = club.name.slice(0, 2).toUpperCase()
  return (
    <Card
      className={`hover:shadow-md transition-all cursor-pointer ${isMember ? 'border-eco-green/30' : isPending ? 'border-amber-200' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <Avatar className="w-12 h-12 flex-shrink-0">
          {club.avatar_url && <AvatarImage src={club.avatar_url} />}
          <AvatarFallback className="bg-eco-green-light text-eco-teal font-bold">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900 truncate">{club.name}</p>
            {isAdmin && (
              <span title="Admin" className="inline-flex items-center">
                <Crown className="w-3.5 h-3.5 text-amber-500" />
              </span>
            )}
            {isMember && <Badge variant="secondary" className="text-[10px]">✓ Membro</Badge>}
            {isPending && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600"><Clock className="w-2.5 h-2.5 mr-0.5" />In attesa</Badge>}
            {club.is_public ? <Globe className="w-3 h-3 text-gray-400" /> : <Lock className="w-3 h-3 text-gray-400" />}
          </div>
          {club.company && <p className="text-xs text-gray-500">{club.company}</p>}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
            <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {club.member_count} membri</span>
            <span className="flex items-center gap-1"><Leaf className="w-3 h-3 text-eco-green" /> {club.eco_score_total} pts</span>
            {club.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {club.city}</span>}
          </div>
        </div>
        <Button
          size="sm"
          variant={isMember ? 'outline' : isPending ? 'outline' : 'default'}
          className={isPending ? 'border-amber-300 text-amber-600 hover:bg-amber-50' : ''}
          onClick={e => onJoin(club, e)}
          disabled={joining}
        >
          {joining
            ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            : isMember
              ? 'Lascia'
              : isPending
                ? <><Clock className="w-3 h-3" /> Annulla</>
                : 'Richiedi'}
        </Button>
      </CardContent>
    </Card>
  )
}
