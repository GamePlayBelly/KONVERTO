import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MessageCircle, Plus, Search, Users, Lock, UserPlus,
  Check, X, Building2, ChevronRight, BellOff,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  supabase, sendFriendRequest,
  createOrGetPrivateConversation,
  createGroupConversation,
  sendGroupAddedNotifications,
} from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

interface Conversation {
  id: string
  type: 'private' | 'group' | 'club'
  name: string | null
  avatar_url: string | null
  last_message: string | null
  last_message_at: string
  unread_count?: number
  muted?: boolean
  otherUser?: { username: string; full_name: string | null; avatar_url: string | null }
}

interface UserResult {
  id: string
  username: string
  full_name: string | null
  avatar_url: string | null
}

// ─── helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ora'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}g`
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Chat() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  // ── New private chat ──
  const [showNewPrivate, setShowNewPrivate] = useState(false)
  const [privateSearch, setPrivateSearch] = useState('')
  const [privateResults, setPrivateResults] = useState<UserResult[]>([])
  const [privateSearching, setPrivateSearching] = useState(false)
  const [creatingPrivate, setCreatingPrivate] = useState(false)
  const [friendSent, setFriendSent] = useState<Set<string>>(new Set())

  // ── New group chat ──
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [groupResults, setGroupResults] = useState<UserResult[]>([])
  const [groupSearching, setGroupSearching] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<UserResult[]>([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')

  // ── Load conversations ──
  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)

    try {
      // Legge conversation_members (RLS OK) con i dati della conversazione in embed
      // Se l'RLS su conversations è bloccante, i campi conversations arriveranno come null
      // e useremo i dati parziali disponibili
      type MemberWithConv = {
        conversation_id: string
        muted: boolean
        conversations: Record<string, unknown> | null
      }

      const { data: memberRows, error: memberErr } = await supabase
        .from('conversation_members')
        .select('conversation_id, muted, conversations(*)')
        .eq('user_id', user.id)

      if (memberErr) console.error('[Chat] memberRows error:', memberErr)

      const rows = (memberRows ?? []) as unknown as MemberWithConv[]

      // Ordina per last_message_at decrescente
      const sorted = rows
        .filter(r => r.conversations !== null)
        .sort((a, b) => {
          const at = (a.conversations?.last_message_at as string | null | undefined) ?? '1970-01-01'
          const bt = (b.conversations?.last_message_at as string | null | undefined) ?? '1970-01-01'
          return bt.localeCompare(at)
        })

      // Arricchisci le chat private con il profilo dell'altro utente
      const enriched = await Promise.all(
        sorted.map(async (row) => {
          const c = row.conversations!
          const muted = row.muted ?? false

          if (c.type === 'private') {
            const { data: members } = await supabase
              .from('conversation_members')
              .select('user_id')
              .eq('conversation_id', row.conversation_id)
            const otherId = (members ?? []).find(
              (m: { user_id: string }) => m.user_id !== user.id
            )?.user_id
            if (otherId) {
              const { data: p } = await supabase
                .from('profiles')
                .select('username,full_name,avatar_url')
                .eq('id', otherId)
                .single()
              return { ...c, muted, otherUser: p ?? undefined }
            }
          }
          return { ...c, muted }
        })
      )

      setConversations(enriched as Conversation[])
    } catch (err) {
      console.error('[Chat] load error:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Realtime: ricarica lista quando vieni aggiunto a un gruppo o arriva un nuovo messaggio
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`chat-list-${user.id}-${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${user.id}`,
      }, () => { load() })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel).catch(() => {}) }
  }, [user, load])

  // ── Private chat: search users ──
  const handlePrivateSearch = async (q: string) => {
    setPrivateSearch(q)
    if (q.length < 2) { setPrivateResults([]); return }
    setPrivateSearching(true)
    const { data } = await supabase
      .from('profiles')
      .select('id,username,full_name,avatar_url')
      .neq('id', user?.id ?? '')
      .ilike('username', `%${q}%`)
      .limit(8)
    setPrivateResults((data ?? []) as UserResult[])
    setPrivateSearching(false)
  }

  const handleFriendRequest = async (u: UserResult) => {
    if (!user || !profile || friendSent.has(u.id)) return
    try {
      await sendFriendRequest(user.id, u.id, { username: profile.username, avatar_url: profile.avatar_url })
    } catch { /* already sent */ } finally {
      setFriendSent(prev => new Set([...prev, u.id]))
    }
  }

  const handleOpenPrivate = async (u: UserResult) => {
    if (!user) return
    setCreatingPrivate(true)
    try {
      const convId = await createOrGetPrivateConversation(user.id, u.id)
      navigate(`/chat/${convId}`)
    } catch (err) {
      console.error(err)
    } finally {
      setCreatingPrivate(false)
    }
  }

  // ── Group chat: search + select members ──
  const handleGroupSearch = async (q: string) => {
    setGroupSearch(q)
    if (q.length < 2) { setGroupResults([]); return }
    setGroupSearching(true)
    const excludeIds = [user?.id ?? '', ...selectedMembers.map(m => m.id)]
    const { data } = await supabase
      .from('profiles')
      .select('id,username,full_name,avatar_url')
      .not('id', 'in', `(${excludeIds.join(',')})`)
      .ilike('username', `%${q}%`)
      .limit(8)
    setGroupResults((data ?? []) as UserResult[])
    setGroupSearching(false)
  }

  const addMember = (u: UserResult) => {
    setSelectedMembers(prev => [...prev, u])
    setGroupResults(prev => prev.filter(r => r.id !== u.id))
    setGroupSearch('')
  }

  const removeMember = (id: string) => {
    setSelectedMembers(prev => prev.filter(m => m.id !== id))
  }

  const handleCreateGroup = async () => {
    if (!user || !profile) return
    const name = groupName.trim()
    if (!name) { setGroupError('Inserisci un nome per il gruppo'); return }
    if (selectedMembers.length === 0) { setGroupError('Aggiungi almeno un membro'); return }
    setGroupError('')
    setCreatingGroup(true)
    try {
      const memberIds = selectedMembers.map(m => m.id)
      const convId = await createGroupConversation(name, memberIds)
      // Notify all added members
      await sendGroupAddedNotifications(convId, name, memberIds, profile.username)
      navigate(`/chat/${convId}`)
    } catch (err) {
      console.error(err)
      setGroupError('Errore durante la creazione del gruppo')
    } finally {
      setCreatingGroup(false)
    }
  }

  const resetNewGroup = () => {
    setShowNewGroup(false)
    setGroupName('')
    setGroupSearch('')
    setGroupResults([])
    setSelectedMembers([])
    setGroupError('')
  }

  // ── Split conversations ──
  const privateConvs  = conversations.filter(c => c.type === 'private')
  const groupConvs    = conversations.filter(c => c.type === 'group' || c.type === 'club')

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24 lg:pb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageCircle className="w-7 h-7 text-eco-green" /> Chat
        </h1>
        <p className="text-sm text-gray-500 mt-1">Messaggi privati e di gruppo</p>
      </div>

      <Tabs defaultValue="private">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="private" className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Privati
            {privateConvs.length > 0 && (
              <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full inline-flex items-center justify-center">
                {privateConvs.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="groups" className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Gruppi
            {groupConvs.length > 0 && (
              <span className="ml-1 min-w-[18px] h-[18px] px-1 bg-gray-200 text-gray-600 text-[10px] font-bold rounded-full inline-flex items-center justify-center">
                {groupConvs.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── CHAT PRIVATE ───────────────────────────────────────────── */}
        <TabsContent value="private" className="space-y-3 mt-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Chat private</p>
            <Button
              size="sm"
              variant={showNewPrivate ? 'outline' : 'default'}
              onClick={() => { setShowNewPrivate(v => !v); setPrivateSearch(''); setPrivateResults([]) }}
            >
              {showNewPrivate ? <><X className="w-3.5 h-3.5" /> Chiudi</> : <><Plus className="w-3.5 h-3.5" /> Nuova chat</>}
            </Button>
          </div>

          {/* Cerca utente per nuova chat privata */}
          {showNewPrivate && (
            <Card className="border-eco-green/30 animate-fade-in">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs text-gray-500">Cerca un utente per username per iniziare a chattare</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Cerca username..."
                    value={privateSearch}
                    onChange={e => handlePrivateSearch(e.target.value)}
                    className="pl-10"
                    autoFocus
                  />
                </div>
                {privateSearching && (
                  <div className="space-y-2">
                    {[0,1,2].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
                  </div>
                )}
                {privateResults.map(u => (
                  <div key={u.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-colors">
                    <Avatar className="w-9 h-9 flex-shrink-0">
                      {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                      <AvatarFallback className="text-xs">{u.username.slice(0,2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{u.full_name ?? u.username}</p>
                      <p className="text-xs text-gray-400">@{u.username}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleFriendRequest(u)}
                        disabled={friendSent.has(u.id)}
                        title={friendSent.has(u.id) ? 'Richiesta inviata' : 'Aggiungi amico'}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                          friendSent.has(u.id)
                            ? 'bg-gray-100 text-gray-400 cursor-default'
                            : 'bg-blue-50 text-blue-500 hover:bg-blue-500 hover:text-white'
                        }`}
                      >
                        {friendSent.has(u.id) ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-eco-green text-eco-green hover:bg-eco-green-light"
                        disabled={creatingPrivate}
                        onClick={() => handleOpenPrivate(u)}
                      >
                        {creatingPrivate
                          ? <span className="w-3 h-3 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
                          : 'Scrivi'}
                      </Button>
                    </div>
                  </div>
                ))}
                {!privateSearching && privateSearch.length >= 2 && privateResults.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-2">Nessun utente trovato</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Lista chat private */}
          <ConvList
            convs={privateConvs}
            loading={loading}
            userId={user?.id}
            onOpen={id => navigate(`/chat/${id}`)}
            emptyIcon={
              <MessageCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            }
            emptyText="Nessuna chat privata ancora"
            emptySubtext="Cerca un amico e inizia a chattare!"
            emptyAction={<Button size="sm" className="mt-3" onClick={() => setShowNewPrivate(true)}>Inizia una chat</Button>}
          />
        </TabsContent>

        {/* ── CHAT DI GRUPPO ─────────────────────────────────────────── */}
        <TabsContent value="groups" className="space-y-3 mt-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Chat di gruppo</p>
            <Button
              size="sm"
              variant={showNewGroup ? 'outline' : 'default'}
              onClick={() => { if (showNewGroup) resetNewGroup(); else setShowNewGroup(true) }}
            >
              {showNewGroup ? <><X className="w-3.5 h-3.5" /> Annulla</> : <><Plus className="w-3.5 h-3.5" /> Crea gruppo</>}
            </Button>
          </div>

          {/* Form crea gruppo */}
          {showNewGroup && (
            <Card className="border-eco-green/30 animate-fade-in">
              <CardContent className="p-4 space-y-4">
                <p className="text-xs font-semibold text-gray-700">Nuovo gruppo</p>

                {/* Nome */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Nome del gruppo *</label>
                  <Input
                    placeholder="Es. Team sostenibile, Amici ciclisti..."
                    value={groupName}
                    onChange={e => { setGroupName(e.target.value); setGroupError('') }}
                    autoFocus
                  />
                </div>

                {/* Membri selezionati */}
                {selectedMembers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedMembers.map(m => (
                      <span key={m.id} className="flex items-center gap-1.5 bg-eco-green-light text-eco-teal text-xs font-medium px-2.5 py-1 rounded-full">
                        {m.full_name ?? m.username}
                        <button onClick={() => removeMember(m.id)} className="hover:text-eco-green transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Cerca utenti */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Aggiungi partecipanti *</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Cerca username..."
                      value={groupSearch}
                      onChange={e => handleGroupSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {groupSearching && <Skeleton className="h-10 rounded-xl" />}
                  {groupResults.map(u => (
                    <button
                      key={u.id}
                      onClick={() => addMember(u)}
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-colors text-left"
                    >
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                        <AvatarFallback className="text-xs">{u.username.slice(0,2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{u.full_name ?? u.username}</p>
                        <p className="text-xs text-gray-400">@{u.username}</p>
                      </div>
                      <Plus className="w-4 h-4 text-eco-green flex-shrink-0" />
                    </button>
                  ))}
                  {!groupSearching && groupSearch.length >= 2 && groupResults.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-1">Nessun utente trovato</p>
                  )}
                </div>

                {groupError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{groupError}</p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    className="flex-1"
                    disabled={creatingGroup || !groupName.trim() || selectedMembers.length === 0}
                    onClick={handleCreateGroup}
                  >
                    {creatingGroup
                      ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Creazione...</>
                      : <><Users className="w-4 h-4" /> Crea gruppo ({selectedMembers.length + 1})</>}
                  </Button>
                </div>

                <p className="text-[11px] text-gray-400 text-center">
                  Tu + {selectedMembers.length} partecipant{selectedMembers.length === 1 ? 'e' : 'i'} · Riceveranno una notifica
                </p>
              </CardContent>
            </Card>
          )}

          {/* Lista gruppi */}
          <ConvList
            convs={groupConvs}
            loading={loading}
            userId={user?.id}
            onOpen={id => navigate(`/chat/${id}`)}
            emptyIcon={
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            }
            emptyText="Nessun gruppo ancora"
            emptySubtext="Crea un gruppo o unisciti a un club per chattare con più persone!"
            emptyAction={
              <div className="space-y-1 mt-3 text-center">
                <Button size="sm" onClick={() => setShowNewGroup(true)}>Crea un gruppo</Button>
                <p className="text-xs text-gray-400 mt-2">Le chat dei club appaiono automaticamente qui</p>
              </div>
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── ConvList ────────────────────────────────────────────────────────────────

function ConvList({
  convs, loading, userId: _userId, onOpen, emptyIcon, emptyText, emptySubtext, emptyAction,
}: {
  convs: Conversation[]
  loading: boolean
  userId?: string
  onOpen: (id: string) => void
  emptyIcon: React.ReactNode
  emptyText: string
  emptySubtext?: string
  emptyAction?: React.ReactNode
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0,1,2].map(i => <Skeleton key={i} className="h-16 rounded-2xl" />)}
      </div>
    )
  }

  if (convs.length === 0) {
    return (
      <Card>
        <CardContent className="py-14 text-center">
          {emptyIcon}
          <p className="text-gray-600 font-semibold text-base">{emptyText}</p>
          {emptySubtext && <p className="text-gray-400 text-sm mt-1.5">{emptySubtext}</p>}
          {emptyAction}
        </CardContent>
      </Card>
    )
  }

  // Separate group types for visual separator (only relevant in groups tab)
  const hasClubs  = convs.some(c => c.type === 'club')
  const hasGroups = convs.some(c => c.type === 'group')
  const showSeparator = hasClubs && hasGroups

  const clubConvs  = convs.filter(c => c.type === 'club')
  const groupConvs = convs.filter(c => c.type === 'group')
  // For private tab convs won't have clubs/groups so this just renders them all
  const orderedConvs = showSeparator ? [...groupConvs, ...clubConvs] : convs

  return (
    <div className="space-y-2">
      {orderedConvs.map((c, idx) => {
        const isPrivate = c.type === 'private'
        const isClub    = c.type === 'club'
        const isGroup   = c.type === 'group'
        const name      = isPrivate
          ? (c.otherUser?.full_name ?? c.otherUser?.username ?? 'Chat privata')
          : (c.name ?? 'Gruppo')
        const initials  = isPrivate
          ? (c.otherUser?.username ?? 'CH').slice(0, 2).toUpperCase()
          : name.slice(0, 2).toUpperCase()
        const avatar    = isPrivate ? (c.otherUser?.avatar_url ?? null) : c.avatar_url
        const truncatedMsg = c.last_message
          ? (c.last_message.length > 40 ? c.last_message.slice(0, 40) + '…' : c.last_message)
          : null
        const hasUnread = (c.unread_count ?? 0) > 0

        // Separator before first club when both groups and clubs exist
        const showClubSeparator = showSeparator && isClub && idx === groupConvs.length

        return (
          <div key={c.id}>
            {showClubSeparator && (
              <div className="flex items-center gap-2 my-1 px-1">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-[11px] text-gray-400 font-medium flex items-center gap-1"><Building2 className="w-3 h-3" /> Club</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
            )}
            {showSeparator && isGroup && idx === 0 && (
              <div className="flex items-center gap-2 mb-1 px-1">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-[11px] text-gray-400 font-medium flex items-center gap-1"><Users className="w-3 h-3" /> Gruppi</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
            )}
            <Card
              className={`hover:shadow-md transition-all cursor-pointer ${hasUnread ? 'border-eco-green/30 bg-eco-green-light/10' : ''}`}
              onClick={() => onOpen(c.id)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <Avatar className="w-12 h-12">
                    {avatar && <AvatarImage src={avatar} />}
                    <AvatarFallback className={`font-bold text-sm ${isClub ? 'bg-eco-green-light text-eco-teal' : isGroup ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  {/* Type badge */}
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white flex items-center justify-center border border-gray-100 shadow-sm">
                    {isPrivate ? <Lock className="w-3 h-3 text-gray-500" /> : isClub ? <Building2 className="w-3 h-3 text-eco-teal" /> : <Users className="w-3 h-3 text-purple-500" />}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className={`text-sm truncate ${hasUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>{name}</p>
                    {c.muted && (
                      <BellOff className="w-3 h-3 text-gray-400 flex-shrink-0" aria-label="Chat silenziata" />
                    )}
                    {!isPrivate && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 flex items-center gap-0.5 ${isClub ? 'bg-eco-green-light text-eco-teal' : 'bg-purple-50 text-purple-600'}`}>
                        {isClub ? <><Building2 className="w-2.5 h-2.5" /> Club</> : <><Users className="w-2.5 h-2.5" /> Gruppo</>}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${hasUnread ? 'text-gray-600 font-medium' : 'text-gray-400'}`}>
                    {truncatedMsg ?? <span className="italic">Nessun messaggio ancora</span>}
                  </p>
                </div>

                {/* Time + unread badge */}
                <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                  <span className="text-[10px] text-gray-400">{timeAgo(c.last_message_at)}</span>
                  {hasUnread ? (
                    <span className="min-w-[18px] h-[18px] px-1 bg-eco-green text-white text-[10px] font-bold rounded-full inline-flex items-center justify-center">
                      {c.unread_count! > 99 ? '99+' : c.unread_count}
                    </span>
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-200" />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )
      })}
    </div>
  )
}
