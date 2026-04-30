import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Send, Loader2, MoreVertical,
  Search, BellOff, Bell, Pin, PinOff, Edit3, Trash2,
  Image, Map, Crown, UserMinus, Settings, Target, Trophy,
  X, Check, UserPlus, AlertTriangle, LogOut, ShieldOff,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  supabase, getTrips,
  editMessage as editMsg,
  deleteMessage as deleteMsg,
  pinMessage as pinMsg,
  toggleReaction as toggleReact,
  updateGroupSettings,
  addGroupMember,
  removeGroupMember,
  promoteToAdmin,
  demoteFromAdmin,
  leaveGroup,
  toggleMute,
  uploadChatImage,
  sendGroupAddedNotifications,
} from '@/lib/supabase'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { Trip } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface ReactionGroup { emoji: string; count: number; byMe: boolean }

interface Msg {
  id: string
  conversation_id: string
  sender_id: string | null
  content: string
  message_type: 'text' | 'image' | 'trip_share'
  image_url?: string | null
  trip_id?: string | null
  created_at: string
  edited_at?: string | null
  is_deleted?: boolean
  sender?: { id: string; username: string; full_name: string | null; avatar_url: string | null }
  reactions: ReactionGroup[]
}

interface Member {
  user_id: string
  is_admin: boolean
  muted: boolean
  profile: { username: string; full_name: string | null; avatar_url: string | null; eco_score: number }
}

interface ConvInfo {
  id: string
  type: 'private' | 'group' | 'club'
  name: string | null
  avatar_url: string | null
  pinned_message_id: string | null
  group_goal_km: number | null
  group_goal_deadline: string | null
  created_by: string | null
  otherUser?: { username: string; full_name: string | null; avatar_url: string | null }
}

type RawReaction = { message_id: string; user_id: string; emoji: string }

// ── Constants ────────────────────────────────────────────────────────────────

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '🌿', '✅', '😮', '😢']

// ── Profanity filter ─────────────────────────────────────────────────────────

const PROFANITY_WORDS = [
  'cazzo','cazz','vaffanculo','fanculo','minchia',
  'stronzo','stronza','coglione','cogliona',
  'figlio di puttana','puttana','troia','merda',
  'bastardo','bastarda','porco dio','porcodio',
  'porco cane','porco giuda','dio cane','dioc',
  'mannaggia','incul','rompicazzo','vaffa',
  'idiota','deficiente','ritardato','imbecille',
  'dick','fuck','shit','bitch','asshole','bastard','damn',
]

// Phrases with spaces need a simple includes(); single words use word-boundary regex
const PHRASE_LIST = PROFANITY_WORDS.filter(w => w.includes(' '))
const WORD_LIST   = PROFANITY_WORDS.filter(w => !w.includes(' '))

// Blasphemy combos: sacred word + profanity within 3 words
const SACRED = ['dio', 'gesu', 'gesù', 'madonna', 'cristo', 'signore']
const SACRED_REGEX = new RegExp(
  `(${SACRED.join('|')})\\W{0,20}(${WORD_LIST.join('|')})|` +
  `(${WORD_LIST.join('|')})\\W{0,20}(${SACRED.join('|')})`,
  'i'
)

function containsProfanity(text: string): boolean {
  const lower = text.toLowerCase()
  // Check multi-word phrases first (exact substring)
  if (PHRASE_LIST.some(p => lower.includes(p))) return true
  // Check single words with word boundaries to reduce false positives
  const wordRegex = new RegExp(`\\b(${WORD_LIST.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i')
  if (wordRegex.test(lower)) return true
  // Check blasphemy combos
  if (SACRED_REGEX.test(lower)) return true
  return false
}

function timeLabel(d: string) {
  const date = new Date(d)
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Ieri'
  if (days < 7)  return date.toLocaleDateString('it-IT', { weekday: 'short' })
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
}

function buildReactions(raw: RawReaction[], msgId: string, myId: string): ReactionGroup[] {
  const map: Record<string, { count: number; byMe: boolean }> = {}
  for (const r of raw.filter(r => r.message_id === msgId)) {
    if (!map[r.emoji]) map[r.emoji] = { count: 0, byMe: false }
    map[r.emoji].count++
    if (r.user_id === myId) map[r.emoji].byMe = true
  }
  return Object.entries(map).map(([emoji, v]) => ({ emoji, ...v }))
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ChatRoom() {
  const { id } = useParams<{ id: string }>()
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [messages,     setMessages]     = useState<Msg[]>([])
  const [_rawReactions, setRawReactions] = useState<RawReaction[]>([])
  const [convInfo,     setConvInfo]     = useState<ConvInfo | null>(null)
  const [members,      setMembers]      = useState<Member[]>([])
  const [myMem,        setMyMem]        = useState<{ is_admin: boolean; muted: boolean } | null>(null)
  const [loading,      setLoading]      = useState(true)

  // input
  const [text,          setText]         = useState('')
  const [sending,       setSending]      = useState(false)
  const [uploadingImg,  setUploadingImg] = useState(false)
  const [error,         setError]        = useState('')

  // panels
  const [panel,         setPanel]        = useState<null | 'settings' | 'leaderboard' | 'goal'>(null)
  const [showMenu,      setShowMenu]     = useState(false)
  const [showSearch,    setShowSearch]   = useState(false)
  const [searchQuery,   setSearchQuery]  = useState('')

  // message actions
  const [actionId,      setActionId]     = useState<string | null>(null)
  const [editingId,     setEditingId]    = useState<string | null>(null)
  const [editText,      setEditText]     = useState('')

  // typing indicator
  const [othersTyping,  setOthersTyping] = useState<string | null>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // trip picker
  const [showTrips,     setShowTrips]    = useState(false)
  const [myTrips,       setMyTrips]      = useState<Trip[]>([])

  // settings panel
  const [settingsTab,   setSettingsTab]  = useState<'members' | 'goal'>('members')
  const [gName,         setGName]        = useState('')
  const [gGoalKm,       setGGoalKm]      = useState('')
  const [gGoalDate,     setGGoalDate]    = useState('')
  const [cfgMsg,        setCfgMsg]       = useState<{ text: string; ok: boolean } | null>(null)
  const [savingCfg,     setSavingCfg]    = useState(false)
  const [addQuery,      setAddQuery]     = useState('')
  const [addResults,    setAddResults]   = useState<{ id: string; username: string; full_name: string | null; avatar_url: string | null }[]>([])
  const [addingMem,     setAddingMem]    = useState(false)
  const [adminToast,    setAdminToast]   = useState<{ text: string; ok: boolean } | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const fileRef   = useRef<HTMLInputElement>(null)

  const scrollBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
  }, [])

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadMessages = useCallback(async () => {
    if (!id || !user) return
    const [{ data: msgData }, { data: reactData }] = await Promise.all([
      supabase.from('messages')
        .select('*, sender:profiles(id,username,full_name,avatar_url)')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(150),
      supabase.from('message_reactions')
        .select('message_id,user_id,emoji')
        .eq('conversation_id', id),
    ])
    const raw = (reactData ?? []) as RawReaction[]
    setRawReactions(raw)
    setMessages((msgData ?? []).map(m => ({ ...m, reactions: buildReactions(raw, m.id, user.id) })) as Msg[])
    scrollBottom()
  }, [id, user, scrollBottom])

  const loadConvInfo = useCallback(async () => {
    if (!id || !user) return
    const [{ data: conv }, { data: mems }, { data: myRow }] = await Promise.all([
      supabase.from('conversations').select('*').eq('id', id).single(),
      supabase.from('conversation_members')
        .select('user_id,is_admin,muted,profile:profiles(username,full_name,avatar_url,eco_score)')
        .eq('conversation_id', id),
      supabase.from('conversation_members')
        .select('is_admin,muted')
        .eq('conversation_id', id).eq('user_id', user.id).single(),
    ])
    if (conv) {
      const info: ConvInfo = {
        id: conv.id, type: conv.type, name: conv.name,
        avatar_url: conv.avatar_url ?? null,
        pinned_message_id: conv.pinned_message_id ?? null,
        group_goal_km: conv.group_goal_km ?? null,
        group_goal_deadline: conv.group_goal_deadline ?? null,
        created_by: conv.created_by ?? null,
      }
      if (conv.type === 'private') {
        const other = (mems ?? []).find((m: { user_id: string }) => m.user_id !== user.id)
        if (other) info.otherUser = (other as unknown as Member).profile
      }
      setConvInfo(info)
      setGName(conv.name ?? '')
      setGGoalKm(String(conv.group_goal_km ?? ''))
      setGGoalDate(conv.group_goal_deadline ?? '')
    }
    setMembers((mems ?? []) as unknown as Member[])
    setMyMem(myRow as { is_admin: boolean; muted: boolean } | null)
  }, [id, user])

  const load = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadConvInfo(), loadMessages()])
    setLoading(false)
  }, [loadConvInfo, loadMessages])

  useEffect(() => { load() }, [load])

  // ── Realtime ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id || !user) return
    let ch: ReturnType<typeof supabase.channel> | null = null
    try {
      ch = supabase.channel(`room-${id}-${Date.now()}`)
        // new message
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
          async (payload) => {
            const m = payload.new as Msg
            if (m.sender_id) {
              const { data: s } = await supabase.from('profiles').select('id,username,full_name,avatar_url').eq('id', m.sender_id).single()
              setMessages(prev => prev.find(x => x.id === m.id) ? prev : [...prev, { ...m, reactions: [], sender: s ?? undefined }])
            }
            scrollBottom()
          })
        // edit / delete
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
          (payload) => {
            const u = payload.new as Msg
            setMessages(prev => prev.map(m => m.id === u.id ? { ...m, content: u.content, edited_at: u.edited_at, is_deleted: u.is_deleted, image_url: u.image_url } : m))
          })
        // reaction added
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${id}` },
          (payload) => {
            const r = payload.new as RawReaction
            setRawReactions(prev => {
              const next = [...prev, r]
              setMessages(msgs => msgs.map(m => m.id === r.message_id ? { ...m, reactions: buildReactions(next, m.id, user.id) } : m))
              return next
            })
          })
        // reaction removed
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${id}` },
          (payload) => {
            const d = payload.old as RawReaction
            setRawReactions(prev => {
              const next = prev.filter(r => !(r.message_id === d.message_id && r.user_id === d.user_id && r.emoji === d.emoji))
              setMessages(msgs => msgs.map(m => m.id === d.message_id ? { ...m, reactions: buildReactions(next, m.id, user.id) } : m))
              return next
            })
          })
        // conv update (pin, goal, name…)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${id}` },
          (payload) => { setConvInfo(prev => prev ? { ...prev, ...payload.new } : prev) })
        .subscribe()
    } catch { /* realtime non disponibile */ }
    return () => { if (ch) supabase.removeChannel(ch).catch(() => {}) }
  }, [id, user, scrollBottom])

  // ── Typing channel ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id || !user) return
    const ch = supabase.channel(`typing-${id}`)
      .on('broadcast', { event: 'typing' }, (payload: { payload?: { username?: string; userId?: string } }) => {
        const senderUserId = payload.payload?.userId
        const senderUsername = payload.payload?.username
        if (senderUserId && senderUserId !== user.id && senderUsername) {
          setOthersTyping(senderUsername)
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = setTimeout(() => setOthersTyping(null), 3000)
        }
      })
      .subscribe()
    typingChannelRef.current = ch
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      supabase.removeChannel(ch).catch(() => {})
    }
  }, [id, user])

  // ── Handlers ───────────────────────────────────────────────────────────────

  const send = async () => {
    if (!user || !id || !text.trim() || sending) return
    const content = text.trim()
    if (containsProfanity(content)) {
      setError('Messaggio non inviato: linguaggio inappropriato non consentito.')
      setTimeout(() => setError(''), 3000)
      return
    }
    setText('')
    setSending(true)
    try {
      await supabase.from('messages').insert({ conversation_id: id, sender_id: user.id, content, message_type: 'text' })
      await supabase.from('conversations').update({ last_message: content, last_message_at: new Date().toISOString() }).eq('id', id)
    } finally { setSending(false); inputRef.current?.focus() }
  }

  const sendImage = async (file: File) => {
    if (!user || !id) return
    setUploadingImg(true)
    try {
      const url = await uploadChatImage(file, id)
      await supabase.from('messages').insert({ conversation_id: id, sender_id: user.id, content: '', message_type: 'image', image_url: url })
      await supabase.from('conversations').update({ last_message: '🖼️ Immagine', last_message_at: new Date().toISOString() }).eq('id', id)
    } catch (e) { console.error('Upload immagine:', e) } finally { setUploadingImg(false) }
  }

  const shareTrip = async (trip: Trip) => {
    if (!user || !id) return
    setShowTrips(false)
    const preview = `🚲 ${Number(trip.distance_km).toFixed(1)} km · 🌿 ${Number(trip.co2_saved_kg).toFixed(2)} kg CO₂`
    await supabase.from('messages').insert({ conversation_id: id, sender_id: user.id, content: preview, message_type: 'trip_share', trip_id: trip.id })
    await supabase.from('conversations').update({ last_message: preview, last_message_at: new Date().toISOString() }).eq('id', id)
  }

  const submitEdit = async (msgId: string) => {
    if (!editText.trim()) return
    await editMsg(msgId, editText.trim())
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: editText.trim(), edited_at: new Date().toISOString() } : m))
    setEditingId(null); setEditText('')
  }

  const doDelete = async (msgId: string) => {
    if (!confirm('Eliminare questo messaggio?')) return
    await deleteMsg(msgId)
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: true, content: '', image_url: null } : m))
    setActionId(null)
  }

  const doPin = async (msgId: string) => {
    if (!id) return
    const unpin = convInfo?.pinned_message_id === msgId
    await pinMsg(id, unpin ? null : msgId)
    setConvInfo(prev => prev ? { ...prev, pinned_message_id: unpin ? null : msgId } : prev)
    setActionId(null)
  }

  const doReact = async (msgId: string, emoji: string) => {
    if (!id) return
    setActionId(null)
    await toggleReact(msgId, id, emoji)
  }

  const doMute = async () => {
    if (!id) return
    const newMuted = await toggleMute(id)
    setMyMem(prev => prev ? { ...prev, muted: newMuted } : prev)
    setShowMenu(false)
  }

  const saveCfg = async () => {
    if (!id || !convInfo) return
    setSavingCfg(true); setCfgMsg(null)
    try {
      const newName = gName.trim() || convInfo.name || ''
      await updateGroupSettings(id, newName, gGoalKm ? parseFloat(gGoalKm) : null, gGoalDate || null)
      setConvInfo(prev => prev ? {
        ...prev,
        name: newName,
        group_goal_km: gGoalKm ? parseFloat(gGoalKm) : null,
        group_goal_deadline: gGoalDate || null,
      } : prev)
      setCfgMsg({ text: '✓ Impostazioni salvate!', ok: true })
      setTimeout(() => setCfgMsg(null), 3000)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Errore nel salvataggio'
      setCfgMsg({ text: msg, ok: false })
    } finally { setSavingCfg(false) }
  }

  const doAddMember = async (uid: string, _uname: string) => {
    if (!id || !profile) return
    setAddingMem(true)
    try {
      await addGroupMember(id, uid)
      await sendGroupAddedNotifications(id, convInfo?.name ?? 'gruppo', [uid], profile.username)
      await loadConvInfo()
      setAddQuery(''); setAddResults([])
    } finally { setAddingMem(false) }
  }

  const doRemoveMember = async (uid: string) => {
    if (!id || !confirm('Rimuovere questo membro?')) return
    await removeGroupMember(id, uid)
    setMembers(prev => prev.filter(m => m.user_id !== uid))
  }

  const doLeave = async () => {
    if (!id || !confirm('Uscire dal gruppo?')) return
    try { await leaveGroup(id); navigate('/chat') }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Errore') }
  }

  const searchMembers = async (q: string) => {
    setAddQuery(q)
    if (q.length < 2) { setAddResults([]); return }
    const ex = members.map(m => m.user_id)
    const { data } = await supabase.from('profiles').select('id,username,full_name,avatar_url')
      .not('id', 'in', `(${ex.join(',')})`)
      .ilike('username', `%${q}%`).limit(5)
    setAddResults((data ?? []) as typeof addResults)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const isGroup   = convInfo?.type !== 'private'
  const isAdmin   = (myMem?.is_admin ?? false) || (!!convInfo?.created_by && convInfo.created_by === user?.id)
  const isMuted   = myMem?.muted ?? false
  const pinnedMsg = convInfo?.pinned_message_id ? messages.find(m => m.id === convInfo.pinned_message_id) : null

  const displayName   = convInfo?.type === 'private' && convInfo.otherUser
    ? (convInfo.otherUser.full_name ?? convInfo.otherUser.username)
    : (convInfo?.name ?? 'Chat')
  const displayAvatar = convInfo?.type === 'private' ? convInfo.otherUser?.avatar_url ?? null : convInfo?.avatar_url ?? null
  const displayInit   = displayName.slice(0, 2).toUpperCase()

  const visibleMsgs = showSearch && searchQuery.length >= 2
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages

  const goalProgress = (() => {
    if (!convInfo?.group_goal_km) return null
    const total = members.reduce((s, m) => s + (m.profile.eco_score ?? 0), 0)
    return { pct: Math.min(100, (total / (convInfo.group_goal_km * 10)) * 100), total }
  })()

  // ── Skeleton ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex flex-col h-[calc(100vh-4rem)] lg:h-[calc(100vh-2rem)] max-w-2xl mx-auto -mt-4 lg:-mt-8 -mx-4 lg:mx-auto bg-white">
      <div className="border-b p-4 flex items-center gap-3 flex-shrink-0">
        <Skeleton className="w-8 h-8 rounded-full" />
        <Skeleton className="w-8 h-8 rounded-full" />
        <Skeleton className="h-4 w-36 rounded" />
      </div>
      <div className="flex-1 p-4 space-y-3">
        {[0,1,2,3,4].map(i => <Skeleton key={i} className={`h-10 rounded-2xl ${i%2===0?'w-2/3':'w-1/2 ml-auto'}`} />)}
      </div>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-[calc(100vh-4rem)] lg:h-[calc(100vh-2rem)] max-w-2xl mx-auto -mt-4 lg:-mt-8 -mx-4 lg:mx-auto lg:rounded-2xl lg:overflow-hidden lg:border border-gray-100 bg-white relative"
      onClick={() => { setActionId(null); setShowMenu(false) }}
    >

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-100 px-3 py-2.5 flex items-center gap-2 flex-shrink-0 bg-white z-10">
        <Button variant="ghost" size="icon" onClick={() => navigate('/chat')} className="w-8 h-8 flex-shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <Avatar className="w-9 h-9 flex-shrink-0 cursor-pointer" onClick={() => isGroup && setPanel('settings')}>
          {displayAvatar && <AvatarImage src={displayAvatar} />}
          <AvatarFallback className="bg-eco-green-light text-eco-teal font-bold text-xs">{displayInit}</AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => isGroup && setPanel('settings')}>
          <p className="text-sm font-semibold text-gray-900 truncate leading-tight flex items-center gap-1.5">
            {displayName}
            {isMuted && <BellOff className="w-3 h-3 text-gray-300 flex-shrink-0" />}
            {isAdmin && isGroup && <span className="text-[9px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full">ADMIN</span>}
          </p>
          <p className="text-[10px] text-gray-400">
            {convInfo?.type === 'private' ? '🔒 Chat privata' : convInfo?.type === 'club' ? `🏢 Club · ${members.length} membri` : `👥 Gruppo · ${members.length} membri`}
          </p>
        </div>

        <button onClick={() => { setShowSearch(v => !v); setSearchQuery('') }} className={cn('p-2 rounded-xl transition-colors flex-shrink-0', showSearch ? 'bg-eco-green text-white' : 'text-gray-400 hover:bg-gray-100')}>
          <Search className="w-4 h-4" />
        </button>

        <div className="relative flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); setShowMenu(v => !v) }} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors">
            <MoreVertical className="w-4 h-4" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 py-1 overflow-hidden" onClick={e => e.stopPropagation()}>
              <MenuItem icon={isMuted ? <Bell className="w-4 h-4 text-eco-green" /> : <BellOff className="w-4 h-4 text-gray-400" />} label={isMuted ? 'Riattiva notifiche' : 'Silenzia chat'} onClick={doMute} />
              {isGroup && <>
                <div className="h-px bg-gray-50 my-1" />
                <MenuItem icon={<Trophy className="w-4 h-4 text-amber-500" />}  label="Classifica eco"    onClick={() => { setPanel('leaderboard'); setShowMenu(false) }} />
                <MenuItem icon={<Target className="w-4 h-4 text-blue-500" />}   label="Obiettivo gruppo"  onClick={() => { setPanel('goal'); setShowMenu(false) }} />
                {isAdmin && <MenuItem icon={<Settings className="w-4 h-4 text-gray-500" />} label="Impostazioni" onClick={() => { setPanel('settings'); setShowMenu(false) }} />}
                <div className="h-px bg-gray-50 my-1" />
                <MenuItem icon={<LogOut className="w-4 h-4 text-red-400" />} label="Esci dal gruppo" onClick={() => { setShowMenu(false); doLeave() }} danger />
              </>}
            </div>
          )}
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      {showSearch && (
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input autoFocus placeholder="Cerca nei messaggi..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-eco-green" />
          </div>
          {searchQuery.length >= 2 && <p className="text-[11px] text-gray-400 mt-1 px-1">{visibleMsgs.length} trovato/i</p>}
        </div>
      )}

      {/* ── Pinned message ───────────────────────────────────────────────── */}
      {pinnedMsg && !showSearch && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 flex-shrink-0 cursor-pointer"
          onClick={() => document.getElementById(`msg-${pinnedMsg.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <Pin className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <p className="text-xs text-amber-800 truncate flex-1">
            <span className="font-semibold">Fissato: </span>
            {pinnedMsg.is_deleted ? '[Messaggio eliminato]' : pinnedMsg.message_type === 'image' ? '🖼️ Immagine' : pinnedMsg.content}
          </p>
          {isAdmin && <button onClick={e => { e.stopPropagation(); doPin(pinnedMsg.id) }} className="text-amber-400 hover:text-amber-600 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>}
        </div>
      )}

      {/* ── Goal progress bar ────────────────────────────────────────────── */}
      {goalProgress !== null && !showSearch && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex-shrink-0 cursor-pointer" onClick={() => setPanel('goal')}>
          <div className="flex justify-between text-[10px] text-blue-700 mb-1">
            <span className="font-semibold flex items-center gap-1"><Target className="w-3 h-3" /> Obiettivo: {convInfo?.group_goal_km} km eco</span>
            <span>{goalProgress.pct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-400 to-eco-green rounded-full transition-all duration-500" style={{ width: `${goalProgress.pct}%` }} />
          </div>
        </div>
      )}

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-3 space-y-0.5">
        {visibleMsgs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-400 text-sm">{showSearch ? 'Nessun risultato' : 'Nessun messaggio ancora'}</p>
              {!showSearch && <p className="text-gray-300 text-xs mt-1">Inizia la conversazione! 👋</p>}
            </div>
          </div>
        ) : visibleMsgs.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            prevMsg={visibleMsgs[idx - 1]}
            isMe={msg.sender_id === user?.id}
            isGroup={isGroup}
            isAdmin={isAdmin}
            userId={user?.id ?? ''}
            isActioned={actionId === msg.id}
            isEditing={editingId === msg.id}
            editText={editText}
            pinnedId={convInfo?.pinned_message_id ?? null}
            onAction={e => { e.stopPropagation(); setActionId(actionId === msg.id ? null : msg.id) }}
            onStartEdit={() => { setEditingId(msg.id); setEditText(msg.content); setActionId(null) }}
            onSubmitEdit={() => submitEdit(msg.id)}
            onCancelEdit={() => { setEditingId(null); setEditText('') }}
            onEditChange={setEditText}
            onDelete={() => doDelete(msg.id)}
            onPin={() => doPin(msg.id)}
            onReact={emoji => doReact(msg.id, emoji)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Typing indicator ─────────────────────────────────────────────── */}
      {othersTyping && (
        <div className="px-4 py-1.5 bg-white border-t border-gray-50 flex-shrink-0">
          <p className="text-[11px] text-gray-400 italic flex items-center gap-1">
            <span className="inline-flex gap-0.5 items-end">
              <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span className="font-medium text-gray-500">{othersTyping}</span> sta scrivendo...
          </p>
        </div>
      )}

      {/* ── Profanity error banner ───────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100 flex-shrink-0">
          <p className="text-xs text-red-600 font-medium">{error}</p>
        </div>
      )}

      {/* ── Input bar ────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 px-3 py-2.5 flex items-center gap-2 flex-shrink-0 bg-white">
        <button onClick={() => fileRef.current?.click()} disabled={uploadingImg}
          className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-eco-green transition-colors flex-shrink-0" title="Invia immagine">
          {uploadingImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Image className="w-4 h-4" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) sendImage(f); e.target.value = '' }} />

        <button onClick={async () => { const t = await getTrips(user!.id, 10); setMyTrips(t); setShowTrips(true) }}
          className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-eco-green transition-colors flex-shrink-0" title="Condividi viaggio">
          <Map className="w-4 h-4" />
        </button>

        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
          <Input ref={inputRef} placeholder="Scrivi un messaggio..." value={text}
            onChange={e => {
              const val = e.target.value
              setText(val)
              // broadcast typing event
              if (val.length > 0 && profile && typingChannelRef.current) {
                typingChannelRef.current.send({
                  type: 'broadcast',
                  event: 'typing',
                  payload: { username: profile.username, userId: user?.id },
                }).catch(() => {})
              }
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            maxLength={500}
            className={`rounded-full bg-gray-50 border-gray-200 focus:border-eco-green text-sm ${text.length > 480 ? 'border-orange-300 focus:border-orange-400' : ''}`} />
          {text.length > 400 && (
            <span className={`text-[10px] px-3 ${text.length >= 500 ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
              {text.length}/500
            </span>
          )}
        </div>

        <Button size="icon" onClick={send} disabled={!text.trim() || sending || text.length > 500} className="rounded-full w-9 h-9 flex-shrink-0">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>

      {/* ────────────────── PANNELLI OVERLAY ────────────────────────────── */}

      {/* Trip picker */}
      {showTrips && (
        <Overlay onClose={() => setShowTrips(false)} title="🗺️ Condividi un viaggio">
          {myTrips.length === 0
            ? <p className="text-sm text-gray-400 text-center py-6">Nessun viaggio disponibile</p>
            : myTrips.map(trip => (
              <button key={trip.id} onClick={() => shareTrip(trip)}
                className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-eco-green-light rounded-xl transition-colors text-left">
                <span className="text-2xl">🚲</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{Number(trip.distance_km).toFixed(1)} km</p>
                  <p className="text-xs text-gray-500">🌿 {Number(trip.co2_saved_kg).toFixed(2)} kg CO₂ · {new Date(trip.recorded_at).toLocaleDateString('it-IT')}</p>
                </div>
              </button>
            ))}
        </Overlay>
      )}

      {/* Leaderboard */}
      {panel === 'leaderboard' && (
        <Overlay onClose={() => setPanel(null)} title="🏆 Classifica eco del gruppo">
          <div className="space-y-2">
            {[...members].sort((a, b) => (b.profile.eco_score ?? 0) - (a.profile.eco_score ?? 0)).map((m, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`
              return (
                <div key={m.user_id} className={cn('flex items-center gap-3 p-3 rounded-xl', m.user_id === user?.id ? 'bg-eco-green-light border border-eco-green/20' : 'bg-gray-50')}>
                  <span className="w-8 text-center text-sm font-bold flex-shrink-0">{medal}</span>
                  <Avatar className="w-9 h-9 flex-shrink-0">
                    {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
                    <AvatarFallback className="text-xs bg-gray-200">{m.profile.username.slice(0,2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {m.profile.full_name ?? m.profile.username}
                      {m.user_id === user?.id && <span className="ml-1 text-[10px] text-eco-green">(tu)</span>}
                      {m.is_admin && <Crown className="inline w-3 h-3 text-amber-500 ml-1" />}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-eco-green flex-shrink-0">{(m.profile.eco_score ?? 0).toLocaleString()} pts</span>
                </div>
              )
            })}
          </div>
        </Overlay>
      )}

      {/* Goal */}
      {panel === 'goal' && (
        <Overlay onClose={() => setPanel(null)} title="🎯 Obiettivo del gruppo">
          {convInfo?.group_goal_km ? (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-2xl p-5 text-center">
                <p className="text-4xl font-black text-blue-700">{convInfo.group_goal_km} <span className="text-xl font-bold">km</span></p>
                <p className="text-sm text-blue-500 mt-0.5">obiettivo eco del gruppo</p>
                {convInfo.group_goal_deadline && (
                  <p className="text-xs text-blue-400 mt-1">
                    Scadenza: {new Date(convInfo.group_goal_deadline).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </p>
                )}
              </div>
              {goalProgress && (
                <>
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span>Progresso totale del gruppo</span><span className="font-bold text-eco-green">{goalProgress.pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-400 to-eco-green rounded-full transition-all duration-700" style={{ width: `${goalProgress.pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1 text-center">{goalProgress.total.toLocaleString()} punti accumulati dal gruppo</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-600">Contributo individuale</p>
                    {[...members].sort((a, b) => (b.profile.eco_score ?? 0) - (a.profile.eco_score ?? 0)).map(m => {
                      const pct = Math.min(100, ((m.profile.eco_score ?? 0) / (convInfo.group_goal_km! * 10)) * 100)
                      return (
                        <div key={m.user_id} className="flex items-center gap-2">
                          <p className="text-xs text-gray-700 flex-1 truncate">{m.profile.full_name ?? m.profile.username}</p>
                          <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-eco-green rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-gray-400 w-14 text-right">{m.profile.eco_score ?? 0} pts</span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {isAdmin && <button onClick={() => setPanel('settings')} className="w-full text-xs text-eco-green underline text-center pt-1">Modifica obiettivo</button>}
            </div>
          ) : (
            <div className="py-10 text-center space-y-3">
              <Target className="w-14 h-14 text-gray-200 mx-auto" />
              <p className="text-gray-500 font-semibold">Nessun obiettivo impostato</p>
              {isAdmin
                ? <button onClick={() => setPanel('settings')} className="px-5 py-2 bg-eco-green text-white text-sm font-semibold rounded-xl hover:bg-eco-teal transition-colors">Imposta obiettivo</button>
                : <p className="text-sm text-gray-400">L'admin può impostare un obiettivo condiviso</p>}
            </div>
          )}
        </Overlay>
      )}

      {/* Settings (admin) */}
      {panel === 'settings' && (
        <Overlay onClose={() => setPanel(null)} title="⚙️ Impostazioni gruppo">
          {/* Tab bar */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
            {(['members', 'goal'] as const).map(t => (
              <button key={t} onClick={() => setSettingsTab(t)}
                className={cn('flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all', settingsTab === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')}>
                {t === 'members' ? `👥 Membri (${members.length})` : '🎯 Sfida & Nome'}
              </button>
            ))}
          </div>

          {/* Admin action toast */}
          {adminToast && (
            <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl ${adminToast.ok ? 'bg-eco-green-light text-eco-teal' : 'bg-red-50 text-red-600'}`}>
              {adminToast.ok
                ? (adminToast.text.includes('non è più') ? <ShieldOff className="w-3.5 h-3.5 flex-shrink-0" /> : <Crown className="w-3.5 h-3.5 flex-shrink-0" />)
                : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
              {adminToast.text}
            </div>
          )}

          {/* Members tab */}
          {settingsTab === 'members' && (
            <div className="space-y-4">
              {/* Add member */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600">Aggiungi membro</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input placeholder="Cerca username..." value={addQuery} onChange={e => searchMembers(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-eco-green" />
                </div>
                {addResults.map(u => (
                  <div key={u.id} className="flex items-center gap-2.5 p-2 bg-gray-50 rounded-xl">
                    <Avatar className="w-8 h-8 flex-shrink-0">
                      {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                      <AvatarFallback className="text-[10px] bg-gray-200">{u.username.slice(0,2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <p className="text-sm flex-1 truncate">{u.full_name ?? u.username}</p>
                    <button onClick={() => doAddMember(u.id, u.username)} disabled={addingMem}
                      className="p-1.5 bg-eco-green text-white rounded-lg hover:bg-eco-teal transition-colors disabled:opacity-50">
                      <UserPlus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Member list */}
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {members.map(m => {
                  const isMe = m.user_id === user?.id
                  return (
                    <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-gray-50">
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
                        <AvatarFallback className="text-[10px] bg-gray-100">{m.profile.username.slice(0,2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">
                          {m.profile.full_name ?? m.profile.username}
                          {isMe && <span className="ml-1 text-eco-green text-[10px]">(tu)</span>}
                        </p>
                        <p className="text-[10px] text-gray-400 flex items-center gap-0.5">
                          {m.is_admin && <><Crown className="w-2.5 h-2.5 text-amber-500" /> Admin</>}
                          {!m.is_admin && 'Membro'}
                        </p>
                      </div>
                      {!isMe && isAdmin && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={async () => {
                              const displayName = m.profile.full_name ?? m.profile.username
                              try {
                                if (m.is_admin) {
                                  await demoteFromAdmin(id!, m.user_id)
                                  setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, is_admin: false } : x))
                                  setAdminToast({ text: `${displayName} non è più admin`, ok: true })
                                  // Notifica all'utente rimosso da admin
                                  await supabase.from('notifications').insert({
                                    user_id: m.user_id,
                                    type: 'group_update',
                                    data: {
                                      conv_id: id,
                                      conv_name: convInfo?.name ?? 'gruppo',
                                      message: `Sei stato rimosso dal ruolo di admin in "${convInfo?.name ?? 'gruppo'}"`,
                                      by_username: profile?.username ?? 'Admin',
                                    },
                                  })
                                } else {
                                  await promoteToAdmin(id!, m.user_id)
                                  setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, is_admin: true } : x))
                                  setAdminToast({ text: `${displayName} è ora admin`, ok: true })
                                  // Notifica all'utente promosso admin
                                  await supabase.from('notifications').insert({
                                    user_id: m.user_id,
                                    type: 'group_update',
                                    data: {
                                      conv_id: id,
                                      conv_name: convInfo?.name ?? 'gruppo',
                                      message: `Sei diventato admin di "${convInfo?.name ?? 'gruppo'}"`,
                                      by_username: profile?.username ?? 'Admin',
                                    },
                                  })
                                }
                                setTimeout(() => setAdminToast(null), 3000)
                              } catch (err: unknown) {
                                const msg = (err as { message?: string })?.message ?? 'Errore'
                                setAdminToast({ text: msg, ok: false })
                                setTimeout(() => setAdminToast(null), 4000)
                              }
                            }}
                            title={m.is_admin ? 'Rimuovi admin' : 'Promuovi ad admin'}
                            className={cn('p-1.5 rounded-lg transition-colors', m.is_admin ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'bg-gray-100 text-gray-400 hover:bg-amber-100 hover:text-amber-600')}>
                            <Crown className="w-3 h-3" />
                          </button>
                          <button onClick={() => doRemoveMember(m.user_id)} className="p-1.5 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition-colors">
                            <UserMinus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <button onClick={doLeave} className="w-full flex items-center justify-center gap-2 text-sm text-red-500 hover:bg-red-50 py-2.5 rounded-xl transition-colors border border-red-100">
                <AlertTriangle className="w-4 h-4" /> Esci dal gruppo
              </button>
            </div>
          )}

          {/* Goal/Sfida tab */}
          {settingsTab === 'goal' && (
            <div className="space-y-3">
              {!isAdmin ? (
                /* ── Visualizzazione sola lettura per non-admin ── */
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Nome gruppo</p>
                    <p className="text-sm font-semibold text-gray-800">{convInfo?.name ?? '—'}</p>
                  </div>
                  {convInfo?.group_goal_km && (
                    <div className="bg-blue-50 rounded-xl p-3">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Sfida del gruppo</p>
                      <p className="text-sm font-semibold text-blue-700">{convInfo.group_goal_km} km eco</p>
                      {convInfo.group_goal_deadline && (
                        <p className="text-xs text-blue-500 mt-0.5">Scadenza: {new Date(convInfo.group_goal_deadline).toLocaleDateString('it-IT')}</p>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400 text-center flex items-center justify-center gap-1">
                    <Crown className="w-3 h-3 text-amber-400" /> Solo gli admin possono modificare le impostazioni
                  </p>
                </div>
              ) : (
                /* ── Form modificabile per admin ── */
                <>
                  {/* Nome chat */}
                  <div>
                    <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                      <Settings className="w-3 h-3" /> Nome chat di gruppo
                    </label>
                    <Input value={gName} onChange={e => setGName(e.target.value)} className="mt-1" placeholder="Nome della chat" />
                  </div>

                  <div className="h-px bg-gray-100" />

                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                    <Target className="w-3.5 h-3.5 text-blue-500" /> Sfida del gruppo
                  </p>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Obiettivo km eco (punteggio × 10)</label>
                    <Input type="number" value={gGoalKm} onChange={e => setGGoalKm(e.target.value)} className="mt-1" placeholder="Es. 500" />
                    <p className="text-[11px] text-gray-400 mt-1">💡 1 km eco ≈ 10 punti accumulati dal gruppo</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Scadenza sfida</label>
                    <Input type="date" value={gGoalDate} onChange={e => setGGoalDate(e.target.value)} className="mt-1" />
                  </div>

                  {cfgMsg && (
                    <p className={`text-xs font-semibold px-3 py-2 rounded-xl ${cfgMsg.ok ? 'bg-eco-green-light text-eco-teal' : 'bg-red-50 text-red-600'}`}>
                      {cfgMsg.text}
                    </p>
                  )}

                  <Button onClick={saveCfg} disabled={savingCfg} className="w-full">
                    {savingCfg ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvo...</> : <><Check className="w-4 h-4" /> Salva impostazioni</>}
                  </Button>
                </>
              )}
            </div>
          )}
        </Overlay>
      )}

    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function MenuItem({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors', danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50')}>
      {icon} {label}
    </button>
  )
}

function Overlay({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 bg-black/40 z-40 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl max-h-[88%] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 text-base">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors"><X className="w-4 h-4 text-gray-500" /></button>
        </div>
        <div className="overflow-y-auto p-5 flex-1 space-y-3">{children}</div>
      </div>
    </div>
  )
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  msg, prevMsg, isMe, isGroup, isAdmin, userId: _userId,
  isActioned, isEditing, editText, pinnedId,
  onAction, onStartEdit, onSubmitEdit, onCancelEdit, onEditChange, onDelete, onPin, onReact,
}: {
  msg: Msg; prevMsg?: Msg; isMe: boolean; isGroup: boolean; isAdmin: boolean; userId: string
  isActioned: boolean; isEditing: boolean; editText: string; pinnedId: string | null
  onAction: (e: React.MouseEvent) => void
  onStartEdit: () => void; onSubmitEdit: () => void; onCancelEdit: () => void; onEditChange: (t: string) => void
  onDelete: () => void; onPin: () => void; onReact: (e: string) => void
}) {
  const showName  = isGroup && !isMe && msg.sender_id !== prevMsg?.sender_id
  const isPinned  = pinnedId === msg.id
  const canEdit   = isMe && !msg.is_deleted
  const canDelete = (isMe || isAdmin) && !msg.is_deleted
  const canPin    = isAdmin && !msg.is_deleted

  return (
    <div id={`msg-${msg.id}`} className={cn('flex items-end gap-1.5 py-0.5', isMe ? 'justify-end' : 'justify-start')}>
      {/* Avatar (group only, other's messages) */}
      {!isMe && isGroup && (
        <Avatar className="w-6 h-6 flex-shrink-0 mb-1">
          {showName
            ? <>{msg.sender?.avatar_url && <AvatarImage src={msg.sender.avatar_url} />}<AvatarFallback className="text-[9px] bg-gray-200">{msg.sender?.username?.slice(0,2).toUpperCase() ?? '?'}</AvatarFallback></>
            : <AvatarFallback className="bg-transparent" />}
        </Avatar>
      )}

      <div className={cn('max-w-[74%] flex flex-col gap-0.5', isMe ? 'items-end' : 'items-start')}>
        {showName && (
          <span className="text-xs font-medium text-gray-500 ml-1">
            {msg.sender?.full_name ?? msg.sender?.username}
          </span>
        )}

        {/* Bubble */}
        {isEditing ? (
          <div className="flex gap-1.5 items-center">
            <input autoFocus value={editText} onChange={e => onEditChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSubmitEdit(); if (e.key === 'Escape') onCancelEdit() }}
              className="text-sm px-3 py-2 rounded-2xl border-2 border-eco-green focus:outline-none bg-white min-w-[120px]" />
            <button onClick={onSubmitEdit} className="p-1.5 bg-eco-green text-white rounded-lg"><Check className="w-3.5 h-3.5" /></button>
            <button onClick={onCancelEdit} className="p-1.5 bg-gray-100 text-gray-500 rounded-lg"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <div className="relative">
            <div onClick={onAction} className={cn(
              'px-3 py-2 rounded-2xl text-sm break-words leading-relaxed cursor-pointer select-none transition-all',
              isMe ? 'bg-eco-green text-white rounded-br-sm' : 'bg-white text-gray-900 rounded-bl-sm shadow-sm border border-gray-100',
              msg.is_deleted && 'opacity-40 italic',
              isPinned && 'ring-2 ring-amber-300',
            )}>
              {msg.is_deleted ? (
                <span className="flex items-center gap-1 text-xs"><Trash2 className="w-3 h-3" /> Messaggio eliminato</span>
              ) : msg.message_type === 'image' && msg.image_url ? (
                <img src={msg.image_url} alt="" className="max-w-[220px] rounded-xl block" loading="lazy" />
              ) : msg.message_type === 'trip_share' ? (
                <div className="flex items-center gap-2.5 min-w-[160px]">
                  <span className="text-2xl">🚲</span>
                  <div><p className="text-xs font-bold">Viaggio condiviso</p><p className="text-[11px] opacity-80 mt-0.5">{msg.content}</p></div>
                </div>
              ) : (
                msg.content
              )}
              {msg.edited_at && !msg.is_deleted && (
                <span className={cn('text-[9px] ml-1', isMe ? 'text-white/60' : 'text-gray-300')}>(modificato)</span>
              )}
            </div>

            {/* Quick actions popup */}
            {isActioned && !msg.is_deleted && (
              <div onClick={e => e.stopPropagation()}
                className={cn('absolute top-0 flex items-center gap-0.5 bg-white rounded-2xl shadow-xl border border-gray-100 px-2 py-1.5 z-20 flex-wrap max-w-[220px]', isMe ? 'right-full mr-2' : 'left-full ml-2')}>
                {QUICK_EMOJIS.map(e => (
                  <button key={e} onClick={() => onReact(e)} className="text-base hover:scale-125 transition-transform w-7 h-7 flex items-center justify-center">{e}</button>
                ))}
                {(canEdit || canPin || canDelete) && <div className="w-px h-5 bg-gray-100 mx-1" />}
                {canEdit   && <button onClick={onStartEdit} title="Modifica"  className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>}
                {canPin    && <button onClick={onPin}       title={isPinned ? 'Rimuovi pin' : 'Fissa'} className={cn('p-1.5 rounded-lg transition-colors', isPinned ? 'text-amber-500 bg-amber-50 hover:bg-amber-100' : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50')}>{isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}</button>}
                {canDelete && <button onClick={onDelete}    title="Elimina"   className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            )}
          </div>
        )}

        {/* Reactions */}
        {msg.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 mt-0.5">
            {msg.reactions.map(r => (
              <button key={r.emoji} onClick={e => { e.stopPropagation(); onReact(r.emoji) }}
                className={cn('flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border transition-all active:scale-95',
                  r.byMe ? 'bg-eco-green-light border-eco-green/40 text-eco-teal' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')}>
                {r.emoji}<span className="text-[10px] font-semibold ml-0.5">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Timestamp + read receipt */}
        <div className={cn('flex items-center gap-1 px-1', isMe ? 'justify-end' : 'justify-start')}>
          <span className="text-[10px] text-gray-400">{timeLabel(msg.created_at)}</span>
          {isMe && !msg.is_deleted && (
            <span className="text-[10px] text-eco-green font-bold leading-none" title="Inviato">✓✓</span>
          )}
        </div>
      </div>

      {isMe && !isGroup && <div className="w-6 flex-shrink-0" />}
    </div>
  )
}
