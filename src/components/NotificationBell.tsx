import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, Check, X, UserPlus, Building2, Users, Swords, PartyPopper, MessageCircle, Zap, Leaf, Route, Flame, Crown, ShieldOff, Settings } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  getNotifications, markAllNotificationsRead, deleteNotification,
  respondToFriendRequest, respondToClubRequest, respondToChallenge,
  createOrGetPrivateConversation, supabase,
} from '@/lib/supabase'
import type { AppNotification } from '@/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ora'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}g`
}

export function NotificationBell() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const unread = notifications.filter(n => !n.read).length

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await getNotifications(user.id)
      setNotifications(data)
    } catch {
      // Table not yet created — show empty bell
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  // Realtime: new notifications appear instantly
  // Uses a unique channel name to avoid the Supabase "cannot add after subscribe" error
  // (also gracefully handles missing table before SQL is run)
  useEffect(() => {
    if (!user) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(`notif-${user.id}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          (payload) => {
            setNotifications(prev => [payload.new as AppNotification, ...prev])
          }
        )
        .subscribe()
    } catch {
      // Table not yet created or realtime not enabled — ignore
    }
    return () => {
      if (channel) supabase.removeChannel(channel).catch(() => {})
    }
  }, [user])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0 && user) {
      markAllNotificationsRead(user.id).then(() => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      })
    }
  }

  const handleFriendResponse = async (n: AppNotification, accept: boolean) => {
    if (!n.data.request_id || !n.data.sender_id || !profile || !user) return
    setActing(n.id)
    try {
      await respondToFriendRequest(n.data.request_id, accept, n.data.sender_id, {
        id: user.id,
        username: profile.username,
        avatar_url: profile.avatar_url,
      })
      await deleteNotification(n.id)
      setNotifications(prev => prev.filter(x => x.id !== n.id))
      if (accept) {
        // Auto-create the conversation and navigate there
        const convId = await createOrGetPrivateConversation(user.id, n.data.sender_id)
        setOpen(false)
        navigate(`/chat/${convId}`)
      }
    } catch {
      // silent
    } finally {
      setActing(null)
    }
  }

  const handleChallengeResponse = async (n: AppNotification, accept: boolean) => {
    if (!n.data.challenge_id || !user || !profile) return
    setActing(n.id)
    try {
      await respondToChallenge(
        n.data.challenge_id,
        accept,
        n.data.sender_id,
        profile.username,
      )
      await deleteNotification(n.id)
      setNotifications(prev => prev.filter(x => x.id !== n.id))
      if (accept) {
        setOpen(false)
        navigate('/profile')
      }
    } catch {
      // silent
    } finally {
      setActing(null)
    }
  }

  const handleGroupResponse = async (n: AppNotification, accept: boolean) => {
    if (!n.data.conv_id || !user) return
    setActing(n.id)
    try {
      if (!accept) {
        // Rifiuta: rimuovi l'utente dal gruppo
        await supabase
          .from('conversation_members')
          .delete()
          .eq('conversation_id', n.data.conv_id)
          .eq('user_id', user.id)
      }
      await deleteNotification(n.id)
      setNotifications(prev => prev.filter(x => x.id !== n.id))
      if (accept) {
        setOpen(false)
        navigate(`/chat/${n.data.conv_id}`)
      }
    } catch {
      // silent
    } finally {
      setActing(null)
    }
  }

  const handleClubResponse = async (n: AppNotification, accept: boolean) => {
    if (!n.data.request_id) return
    setActing(n.id)
    try {
      await respondToClubRequest(n.data.request_id, accept, n)
      await deleteNotification(n.id)
      setNotifications(prev => prev.filter(x => x.id !== n.id))
    } catch {
      // silent
    } finally {
      setActing(null)
    }
  }

  const handleDismiss = async (id: string) => {
    await deleteNotification(id)
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  if (!user) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2.5 rounded-xl text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors"
        aria-label="Notifiche"
      >
        {unread > 0
          ? <BellRing className="w-6 h-6 text-eco-green animate-[wiggle_0.5s_ease-in-out]" />
          : <Bell className="w-6 h-6 text-gray-500" />}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center leading-none shadow-sm">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 lg:left-0 lg:right-auto top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-bold text-sm text-gray-900">
              Notifiche {unread > 0 && <span className="ml-1 text-xs text-red-500 font-normal">({unread} nuove)</span>}
            </h3>
            {notifications.some(n => !n.read) && (
              <button
                onClick={() => {
                  if (!user) return
                  markAllNotificationsRead(user.id).then(() =>
                    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
                  )
                }}
                className="text-xs text-eco-green hover:underline"
              >
                Segna lette
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-50">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <span className="w-5 h-5 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-25" />
                <p className="text-sm">Nessuna notifica</p>
              </div>
            ) : (
              notifications.map(n => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  acting={acting === n.id}
                  onFriendResponse={handleFriendResponse}
                  onClubResponse={handleClubResponse}
                  onGroupResponse={handleGroupResponse}
                  onChallengeResponse={handleChallengeResponse}
                  onDismiss={handleDismiss}
                  onNavigate={(path) => { setOpen(false); navigate(path) }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Single notification item ────────────────────────────────────────────────

type HandlerFn = (n: AppNotification, accept: boolean) => void

function NotificationItem({
  n, acting, onFriendResponse, onClubResponse, onGroupResponse, onChallengeResponse, onDismiss, onNavigate,
}: {
  n: AppNotification
  acting: boolean
  onFriendResponse: HandlerFn
  onClubResponse: HandlerFn
  onGroupResponse: HandlerFn
  onChallengeResponse: HandlerFn
  onDismiss: (id: string) => void
  onNavigate: (path: string) => void
}) {
  const avatarSrc = n.data.sender_avatar ?? n.data.avatar ?? null
  const fallbackName = n.data.sender_username ?? n.data.username ?? n.data.added_by ?? n.data.by_username ?? '?'
  const initials = fallbackName.slice(0, 2).toUpperCase()

  const config = (() => {
    switch (n.type) {
      case 'friend_request':
        return {
          icon: <UserPlus className="w-3.5 h-3.5 text-blue-500" />,
          text: <><strong>{n.data.sender_username}</strong> vuole diventare tuo amico</>,
          actions: true as const,
          handler: onFriendResponse,
        }
      case 'friend_accepted':
        return {
          icon: <UserPlus className="w-3.5 h-3.5 text-eco-green" />,
          text: <><strong>{n.data.sender_username}</strong> ha accettato la tua richiesta di amicizia <PartyPopper className="w-3.5 h-3.5 inline text-eco-green" /></>,
          actions: false as const,
        }
      case 'club_join_request':
        return {
          icon: <Users className="w-3.5 h-3.5 text-amber-500" />,
          text: <><strong>{n.data.username}</strong> vuole entrare in <strong>{n.data.club_name}</strong></>,
          actions: true as const,
          handler: onClubResponse,
        }
      case 'club_invite':
        return {
          icon: <Building2 className="w-3.5 h-3.5 text-eco-green" />,
          text: <>Sei stato invitato a unirti a <strong>{n.data.club_name}</strong></>,
          actions: true as const,
          handler: onClubResponse,
        }
      case 'club_join_accepted':
        return {
          icon: <Building2 className="w-3.5 h-3.5 text-eco-green" />,
          text: <>La tua richiesta per <strong>{n.data.club_name}</strong> è stata accettata! <PartyPopper className="w-3.5 h-3.5 inline text-eco-green" /></>,
          actions: false as const,
        }
      case 'club_join_rejected':
        return {
          icon: <Building2 className="w-3.5 h-3.5 text-gray-400" />,
          text: <>La tua richiesta per <strong>{n.data.club_name}</strong> è stata rifiutata.</>,
          actions: false as const,
        }
      case 'group_added':
        return {
          icon: <Users className="w-3.5 h-3.5 text-purple-500" />,
          text: <><strong>{n.data.added_by}</strong> ti ha invitato nel gruppo <strong>{n.data.group_name}</strong> <MessageCircle className="w-3.5 h-3.5 inline text-purple-500" /></>,
          actions: true as const,
          handler: onGroupResponse,
        }
      case 'challenge_received': {
        const metricLabel: Record<string, React.ReactElement> = {
          eco_points: <><Zap className="w-3 h-3 inline text-yellow-500" /> punti eco</>,
          co2_saved:  <><Leaf className="w-3 h-3 inline text-eco-green" /> CO₂ risparmiata</>,
          distance_km: <><Route className="w-3 h-3 inline text-indigo-500" /> km percorsi</>,
        }
        return {
          icon: <Swords className="w-3.5 h-3.5 text-orange-500" />,
          text: (
            <>
              <strong>{n.data.challenger_username}</strong> ti sfida su{' '}
              <strong>{metricLabel[n.data.metric ?? ''] ?? n.data.metric}</strong>{' '}
              per <strong>{n.data.duration_days} giorni</strong> <Swords className="w-3 h-3 inline text-orange-400" />
            </>
          ),
          actions: true as const,
          handler: onChallengeResponse,
        }
      }
      case 'challenge_accepted':
        return {
          icon: <Swords className="w-3.5 h-3.5 text-eco-green" />,
          text: <><strong>{n.data.challenger_username ?? n.data.sender_username}</strong> ha accettato la tua sfida! La partita è iniziata <Flame className="w-3.5 h-3.5 inline text-orange-500" /></>,
          actions: false as const,
        }
      case 'group_update': {
        // Determina se è una promozione o rimozione admin dal campo message
        const isPromo = (n.data.message ?? '').toLowerCase().includes('diventato admin') || (n.data.message ?? '').toLowerCase().includes('admin')
        const isRevoke = (n.data.message ?? '').toLowerCase().includes('rimosso')
        const icon = isPromo && !isRevoke
          ? <Crown className="w-3.5 h-3.5 text-amber-500" />
          : isRevoke
            ? <ShieldOff className="w-3.5 h-3.5 text-gray-400" />
            : <Settings className="w-3.5 h-3.5 text-blue-500" />
        const groupName = n.data.conv_name ?? n.data.group_name ?? 'gruppo'
        const byUser = n.data.by_username
        const textNode = isPromo && !isRevoke
          ? <><Crown className="w-3 h-3 inline text-amber-500 mr-0.5" />Sei diventato <strong>admin</strong> di <strong>{groupName}</strong>{byUser ? <> (da {byUser})</> : null}</>
          : isRevoke
            ? <><ShieldOff className="w-3 h-3 inline text-gray-400 mr-0.5" />Sei stato rimosso da admin di <strong>{groupName}</strong></>
            : <><Settings className="w-3 h-3 inline text-blue-500 mr-0.5" />Aggiornamento nel gruppo <strong>{groupName}</strong></>
        return { icon, text: textNode, actions: false as const }
      }
      default:
        return {
          icon: <Bell className="w-3.5 h-3.5 text-gray-400" />,
          text: <>{n.data.message ?? 'Nuova notifica'}</>,
          actions: false as const,
        }
    }
  })()

  const isClickable = !!((!config.actions) && 'convId' in config && config.convId)

  return (
    <div
      className={cn('px-4 py-3 hover:bg-gray-50 transition-colors', !n.read && 'bg-blue-50/40', isClickable && 'cursor-pointer')}
      onClick={isClickable ? () => { onNavigate(`/chat/${(config as { convId: string }).convId}`); onDismiss(n.id) } : undefined}
    >
      <div className="flex items-start gap-3">
        {/* Avatar + type icon */}
        <div className="relative flex-shrink-0">
          <Avatar className="w-9 h-9">
            {avatarSrc && <AvatarImage src={avatarSrc} />}
            <AvatarFallback className="text-xs bg-gray-100">{initials}</AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-100">
            {config.icon}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-700 leading-snug">{config.text}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>

          {config.actions && (
            <div className="flex gap-2 mt-2">
              <button
                disabled={acting}
                onClick={() => config.handler!(n, true)}
                className="flex items-center gap-1 text-xs bg-eco-green text-white px-2.5 py-1 rounded-lg hover:bg-eco-teal transition-colors disabled:opacity-50"
              >
                {acting
                  ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><Check className="w-3 h-3" /> Accetta</>}
              </button>
              <button
                disabled={acting}
                onClick={() => config.handler!(n, false)}
                className="flex items-center gap-1 text-xs border border-gray-200 text-gray-500 px-2.5 py-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <X className="w-3 h-3" /> Rifiuta
              </button>
            </div>
          )}
        </div>

        {/* Dismiss button for info-only notifications */}
        {!config.actions && (
          <button
            onClick={() => onDismiss(n.id)}
            className="flex-shrink-0 p-0.5 text-gray-300 hover:text-gray-500 rounded transition-colors"
            aria-label="Rimuovi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
