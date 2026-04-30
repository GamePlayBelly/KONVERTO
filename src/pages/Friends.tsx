import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Search, MessageCircle, UserPlus, Check,
  Leaf, MapPin, Loader2, UserX, Hand,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  supabase, getFriends, sendFriendRequest, createOrGetPrivateConversation,
} from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

interface Friend {
  friendId: string
  profile: {
    username: string
    full_name: string | null
    avatar_url: string | null
    city: string | null
    eco_score: number
  }
  convId?: string  // preloaded conversation ID
}

interface UserResult {
  id: string
  username: string
  full_name: string | null
  avatar_url: string | null
  eco_score: number
}

export default function Friends() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [friends, setFriends] = useState<Friend[]>([])
  const [loadingFriends, setLoadingFriends] = useState(true)
  const [chattingId, setChattingId] = useState<string | null>(null)

  // Search
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set())

  // ── Carica amici e crea automaticamente le chat mancanti ──
  const loadFriends = useCallback(async () => {
    if (!user) return
    setLoadingFriends(true)
    try {
      const data = await getFriends(user.id)
      setFriendIds(new Set(data.map(f => f.friendId)))

      // Per ogni amico, assicura che esista una conversazione (crea se mancante)
      const enriched = await Promise.all(
        data.map(async (f) => {
          try {
            const convId = await createOrGetPrivateConversation(user.id, f.friendId)
            return { ...f, convId }
          } catch {
            return { ...f }
          }
        })
      )
      setFriends(enriched)
    } catch (err) {
      console.error('[Friends] load error:', err)
    } finally {
      setLoadingFriends(false)
    }
  }, [user])

  useEffect(() => { loadFriends() }, [loadFriends])

  // ── Apri chat con amico ──
  const openChat = async (f: Friend) => {
    if (!user) return
    setChattingId(f.friendId)
    try {
      const convId = f.convId ?? await createOrGetPrivateConversation(user.id, f.friendId)
      navigate(`/chat/${convId}`)
    } catch {
      // silenzioso
    } finally {
      setChattingId(null)
    }
  }

  // ── Cerca nuovi utenti ──
  const handleSearch = async (q: string) => {
    setQuery(q)
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    const { data } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, eco_score')
      .neq('id', user?.id ?? '')
      .ilike('username', `%${q}%`)
      .limit(10)
    setResults((data ?? []) as UserResult[])
    setSearching(false)
  }

  const handleAddFriend = async (u: UserResult) => {
    if (!user || !profile || sentTo.has(u.id)) return
    try {
      await sendFriendRequest(user.id, u.id, {
        username: profile.username,
        avatar_url: profile.avatar_url,
      })
      setSentTo(prev => new Set([...prev, u.id]))
    } catch { /* già inviata */ }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 lg:pb-8">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-sm">
          <Users className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Amici</h1>
          <p className="text-sm text-gray-500">
            {loadingFriends ? '...' : `${friends.length} amici · Chat create automaticamente`}
          </p>
        </div>
      </div>

      <Tabs defaultValue="friends">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="friends" className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> I miei amici
            {friends.length > 0 && (
              <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full inline-flex items-center justify-center">
                {friends.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="search" className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" /> Trova amici
          </TabsTrigger>
        </TabsList>

        {/* ── LISTA AMICI ── */}
        <TabsContent value="friends" className="mt-4">
          {loadingFriends ? (
            <div className="space-y-3">
              {[0,1,2].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
          ) : friends.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Hand className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-700 font-semibold text-base">Nessun amico ancora</p>
                <p className="text-gray-400 text-sm mt-1">Cerca qualcuno nella tab "Trova amici"</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Banner info */}
              <div className="bg-eco-green-light border border-eco-green/20 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
                <MessageCircle className="w-4 h-4 text-eco-green flex-shrink-0" />
                <p className="text-xs text-eco-teal font-medium">
                  Le chat con i tuoi amici sono create automaticamente — clicca su un amico per scrivergli!
                </p>
              </div>

              {friends.map(f => (
                <Card
                  key={f.friendId}
                  className="hover:shadow-md transition-all cursor-pointer"
                  onClick={() => openChat(f)}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <Avatar
                      className="w-12 h-12 flex-shrink-0 cursor-pointer hover:opacity-80"
                      onClick={(e) => { e.stopPropagation(); navigate(`/user/${f.friendId}`) }}
                    >
                      {f.profile.avatar_url && <AvatarImage src={f.profile.avatar_url} />}
                      <AvatarFallback className="font-bold text-sm bg-blue-50 text-blue-600">
                        {f.profile.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); navigate(`/user/${f.friendId}`) }}
                    >
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {f.profile.full_name ?? f.profile.username}
                      </p>
                      <p className="text-xs text-gray-400">@{f.profile.username}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-xs text-eco-green font-medium">
                          <Leaf className="w-3 h-3" /> {f.profile.eco_score ?? 0} pts
                        </span>
                        {f.profile.city && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <MapPin className="w-3 h-3" /> {f.profile.city}
                          </span>
                        )}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      className="flex-shrink-0 gap-1.5"
                      disabled={chattingId === f.friendId}
                      onClick={e => { e.stopPropagation(); openChat(f) }}
                    >
                      {chattingId === f.friendId
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <MessageCircle className="w-3.5 h-3.5" />}
                      Chatta
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── CERCA AMICI ── */}
        <TabsContent value="search" className="mt-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Cerca per username..."
              value={query}
              onChange={e => handleSearch(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>

          {searching && (
            <div className="space-y-2">
              {[0,1,2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="space-y-2">
              {results.map(u => {
                const isAlreadyFriend = friendIds.has(u.id)
                const alreadySent = sentTo.has(u.id)

                return (
                  <Card key={u.id}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <Avatar
                        className="w-10 h-10 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => navigate(`/user/${u.id}`)}
                      >
                        {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                        <AvatarFallback className="text-xs bg-gray-100">
                          {u.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => navigate(`/user/${u.id}`)}
                      >
                        <p className="text-sm font-semibold text-gray-900 truncate hover:text-eco-green transition-colors">
                          {u.full_name ?? u.username}
                        </p>
                        <p className="text-xs text-gray-400">@{u.username}</p>
                        <span className="text-xs text-eco-green font-medium flex items-center gap-1 mt-0.5">
                          <Leaf className="w-3 h-3" /> {u.eco_score} pts
                        </span>
                      </div>

                      <div className="flex-shrink-0 flex flex-col gap-1.5 items-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-gray-500 hover:text-eco-green px-2 py-1 h-auto"
                          onClick={() => navigate(`/user/${u.id}`)}
                        >
                          Vedi profilo
                        </Button>
                        {isAlreadyFriend ? (
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-eco-green bg-eco-green-light px-3 py-1.5 rounded-full">
                            <Check className="w-3.5 h-3.5" /> Amici
                          </span>
                        ) : alreadySent ? (
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full">
                            <Check className="w-3.5 h-3.5" /> Richiesta inviata
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-blue-300 text-blue-600 hover:bg-blue-50 gap-1.5"
                            onClick={() => handleAddFriend(u)}
                          >
                            <UserPlus className="w-3.5 h-3.5" /> Aggiungi
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {!searching && query.length >= 2 && results.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center">
                <UserX className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Nessun utente trovato per "<strong>{query}</strong>"</p>
              </CardContent>
            </Card>
          )}

          {query.length < 2 && (
            <div className="text-center py-8 text-gray-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Scrivi almeno 2 caratteri per cercare</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
