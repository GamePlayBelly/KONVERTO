import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Users, Leaf, MapPin, Trophy, Settings,
  Crown, Edit2, Trash2, Save, X, Globe, Lock, Building2,
  Camera, UserPlus, Search, UserMinus, Check, CheckCircle2, MessageCircle,
  BarChart2, Calendar, Star, Swords, Clock, Flag,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getClubDetails, getClubMembers, updateClub, deleteClub, removeClubMember, updateClubMemberRole, searchUsersForInvite, inviteToClub, getPendingClubRequests, createClubConversation, getClubConversation, sendGroupAddedNotifications, getClubChallenges, createChallenge, supabase } from '@/lib/supabase'
import type { ClubDetails, ClubMember } from '@/lib/supabase'
import type { ClubJoinRequest, Challenge, ChallengeMetric } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

const METRIC_LABELS: Record<ChallengeMetric, string> = {
  eco_points: 'Punti eco',
  co2_saved: 'CO₂ risparmiata',
  distance_km: 'Km percorsi',
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  active:    'bg-eco-green-light text-eco-teal',
  completed: 'bg-gray-100 text-gray-600',
  rejected:  'bg-red-50 text-red-400',
}

function ClubChallengeCard({ c, currentUserId }: { c: Challenge; currentUserId?: string }) {
  const isChallenger = c.challenger_id === currentUserId
  const me = isChallenger ? c.challenger : c.challenged
  const them = isChallenger ? c.challenged : c.challenger
  const myScore = isChallenger ? c.challenger_score : c.challenged_score
  const theirScore = isChallenger ? c.challenged_score : c.challenger_score
  const isWinner = c.winner_id === currentUserId

  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Avatar className="w-8 h-8">
              {me?.avatar_url && <AvatarImage src={me.avatar_url} />}
              <AvatarFallback className="text-[10px] bg-eco-green-light text-eco-teal font-bold">
                {(me?.username ?? 'IO').slice(0,2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Swords className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <Avatar className="w-8 h-8">
              {them?.avatar_url && <AvatarImage src={them.avatar_url} />}
              <AvatarFallback className="text-[10px] bg-gray-100 font-bold">
                {(them?.username ?? '??').slice(0,2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-gray-900 truncate">
                {me?.full_name ?? me?.username ?? 'Tu'} vs {them?.full_name ?? them?.username ?? '?'}
              </span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {c.status === 'active' ? 'In corso' : c.status === 'pending' ? 'In attesa' : c.status === 'completed' ? 'Conclusa' : 'Rifiutata'}
              </span>
              {isWinner && <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5"><Trophy className="w-3 h-3" /> Hai vinto!</span>}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">{METRIC_LABELS[c.metric]} · {c.duration_days} giorni</p>
            {c.status === 'active' && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-bold text-eco-green">{myScore.toFixed(1)} tu</span>
                <span className="text-gray-300 text-xs">vs</span>
                <span className="text-xs font-bold text-gray-600">{theirScore.toFixed(1)} loro</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ClubChallengeModal({ target, challengerId, challengerUsername, challengerAvatar, onClose, onSent }: {
  target: ClubMember
  challengerId: string
  challengerUsername: string
  challengerAvatar: string | null
  onClose: () => void
  onSent: () => void
}) {
  const [metric, setMetric] = useState<ChallengeMetric>('eco_points')
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    setLoading(true)
    try {
      await createChallenge({
        challenger_id: challengerId,
        challenged_id: target.user_id,
        metric,
        duration_days: days,
        challenger_username: challengerUsername,
        challenger_avatar: challengerAvatar,
      })
      setSent(true)
      setTimeout(onSent, 1500)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4 space-y-3">
            <div className="w-16 h-16 bg-orange-400 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-white" />
            </div>
            <p className="font-bold text-gray-900 flex items-center justify-center gap-2">Sfida inviata! <Swords className="w-4 h-4 text-orange-500" /></p>
            <p className="text-sm text-gray-500">{target.profile.full_name ?? target.profile.username} riceverà la notifica</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar className="w-8 h-8">
                  {target.profile.avatar_url && <AvatarImage src={target.profile.avatar_url} />}
                  <AvatarFallback className="text-xs bg-gray-100">{target.profile.username.slice(0,2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-bold text-gray-900">Sfida</p>
                  <p className="text-xs text-gray-500">{target.profile.full_name ?? target.profile.username}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Metrica</p>
              {(Object.keys(METRIC_LABELS) as ChallengeMetric[]).map(m => (
                <button key={m} onClick={() => setMetric(m)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                    metric === m ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-orange-200'
                  }`}
                >
                  {METRIC_LABELS[m]}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Durata</p>
              <div className="flex gap-2">
                {[7, 14, 30].map(d => (
                  <button key={d} onClick={() => setDays(d)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      days === d ? 'border-orange-400 bg-orange-400 text-white' : 'border-gray-200 text-gray-600 hover:border-orange-200'
                    }`}
                  >
                    {d}gg
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={handleSend} disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
              {loading
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><Swords className="w-4 h-4" /> Invia sfida</>}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default function ClubDetail() {
  const { id } = useParams<{ id: string }>()
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [club, setClub] = useState<ClubDetails | null>(null)
  const [members, setMembers] = useState<ClubMember[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [makingAdminId, setMakingAdminId] = useState<string | null>(null)
  const [adminToast, setAdminToast] = useState<{ text: string; ok: boolean } | null>(null)

  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCity, setEditCity] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarUploadError, setAvatarUploadError] = useState('')
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteResults, setInviteResults] = useState<{ id: string; username: string; full_name: string | null; avatar_url: string | null }[]>([])
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [inviteSearching, setInviteSearching] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [pendingRequests, setPendingRequests] = useState<ClubJoinRequest[]>([])
  const [respondingRequest, setRespondingRequest] = useState<string | null>(null)
  const [clubConvId, setClubConvId] = useState<string | null>(null)
  const [creatingChat, setCreatingChat] = useState(false)
  const [clubChallenges, setClubChallenges] = useState<Challenge[]>([])
  const [challengeTarget, setChallengeTarget] = useState<ClubMember | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [c, m, pr, convId, challenges] = await Promise.all([
      getClubDetails(id),
      getClubMembers(id),
      getPendingClubRequests(id),
      getClubConversation(id),
      getClubChallenges(id),
    ])
    setClub(c)
    setMembers(m)
    setPendingRequests(pr)
    setClubConvId(convId)
    setClubChallenges(challenges)
    if (c) { setEditName(c.name); setEditDesc(c.description ?? ''); setEditCity(c.city ?? '') }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const isAdmin = club?.created_by === user?.id
    || members.find(m => m.user_id === user?.id)?.role === 'admin'

  const handleSave = async () => {
    if (!id) return
    setSaving(true)
    try {
      await updateClub(id, { name: editName.trim(), description: editDesc.trim() || undefined, city: editCity.trim() || undefined })
      setEditMode(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!id || !confirm(`Eliminare il club "${club?.name}"? Azione irreversibile.`)) return
    setDeleting(true)
    try {
      await deleteClub(id)
      navigate('/clubs')
    } finally {
      setDeleting(false)
    }
  }

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!id || !confirm(`Rimuovere ${memberName} dal club?`)) return
    setRemovingId(memberId)
    try {
      await removeClubMember(id, memberId)
      setMembers(prev => prev.filter(m => m.user_id !== memberId))
    } finally {
      setRemovingId(null)
    }
  }

  const handleToggleAdmin = async (memberId: string, memberName: string, currentRole: string) => {
    if (!id) return
    const toAdmin = currentRole !== 'admin'
    const msg = toAdmin
      ? `Rendere admin ${memberName}? Potrà gestire il club.`
      : `Rimuovere i privilegi admin a ${memberName}?`
    if (!confirm(msg)) return
    setMakingAdminId(memberId)
    try {
      await updateClubMemberRole(id, memberId, toAdmin ? 'admin' : 'member')
      setMembers(prev => prev.map(m => m.user_id === memberId ? { ...m, role: toAdmin ? 'admin' : 'member' } : m))
      setAdminToast({ text: toAdmin ? `${memberName} è ora admin` : `${memberName} non è più admin`, ok: true })
      // Notifica all'utente promosso/rimosso
      await supabase.from('notifications').insert({
        user_id: memberId,
        type: 'group_update',
        data: {
          conv_id: id,
          conv_name: club?.name ?? 'club',
          message: toAdmin
            ? `Sei diventato admin del club "${club?.name ?? 'club'}"`
            : `Sei stato rimosso dal ruolo di admin nel club "${club?.name ?? 'club'}"`,
          by_username: profile?.username ?? 'Admin',
        },
      })
    } catch (err: unknown) {
      const msg2 = (err as { message?: string })?.message ?? 'Errore sconosciuto'
      setAdminToast({ text: msg2, ok: false })
    } finally {
      setMakingAdminId(null)
      setTimeout(() => setAdminToast(null), 3500)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return
    setUploadingAvatar(true)
    setAvatarUploadError('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage.from('club-avatars').upload(path, file, { upsert: true })
      if (uploadErr) {
        if (uploadErr.message?.includes('Bucket not found') || uploadErr.message?.includes('bucket')) {
          throw new Error('Bucket "club-avatars" non trovato. Esegui il file supabase_storage_setup.sql nel tuo progetto Supabase.')
        }
        throw uploadErr
      }
      const { data: { publicUrl } } = supabase.storage.from('club-avatars').getPublicUrl(path)
      await updateClub(id, { avatar_url: publicUrl })
      load()
    } catch (err: unknown) {
      setAvatarUploadError(err instanceof Error ? err.message : 'Errore nel caricamento immagine')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleInviteSearch = async (q: string) => {
    setInviteQuery(q)
    if (q.trim().length < 2) { setInviteResults([]); return }
    setInviteSearching(true)
    const excludeIds = members.map(m => m.user_id)
    const results = await searchUsersForInvite(q.trim(), excludeIds)
    setInviteResults(results)
    setInviteSearching(false)
  }

  const handleInvite = async (targetUser: { id: string; username: string; avatar_url: string | null }) => {
    if (!id || !club || !profile) return
    setInvitingId(targetUser.id)
    setInviteError('')
    try {
      await inviteToClub(id, targetUser.id, { username: profile.username }, club.name, club.avatar_url)
      setInviteResults(prev => prev.filter(u => u.id !== targetUser.id))
      setInviteQuery('')
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Errore durante l\'invito')
    } finally {
      setInvitingId(null)
    }
  }

  const handleRequestResponse = async (req: ClubJoinRequest, accept: boolean) => {
    if (!req.profile) return
    setRespondingRequest(req.id)
    try {
      if (accept) {
        const { error } = await supabase.rpc('accept_club_join_request', { p_request_id: req.id })
        if (error) throw error
        // Notify user their request was accepted
        await supabase.from('notifications').insert({
          user_id: req.user_id,
          type: 'club_join_accepted',
          data: { club_id: req.club_id, club_name: club?.name },
        })
      } else {
        const { error } = await supabase.rpc('reject_club_join_request', { p_request_id: req.id })
        if (error) throw error
        // Notify user their request was rejected
        await supabase.from('notifications').insert({
          user_id: req.user_id,
          type: 'club_join_rejected',
          data: { club_id: req.club_id, club_name: club?.name },
        })
      }
      setPendingRequests(prev => prev.filter(r => r.id !== req.id))
      if (accept) load() // Reload to update members list
    } catch {
      // silent
    } finally {
      setRespondingRequest(null)
    }
  }

  const handleCreateOrOpenClubChat = async () => {
    if (!id || !club || !profile) return
    setCreatingChat(true)
    try {
      const convId = await createClubConversation(id, club.name)
      setClubConvId(convId)
      // Notifica tutti i membri tranne l'admin
      const otherMemberIds = members
        .filter(m => m.user_id !== user?.id)
        .map(m => m.user_id)
      if (otherMemberIds.length > 0) {
        await sendGroupAddedNotifications(convId, `${club.name} — Chat`, otherMemberIds, profile.username)
      }
      navigate(`/chat/${convId}`)
    } catch (err) {
      console.error('Errore chat club:', err)
    } finally {
      setCreatingChat(false)
    }
  }

  const leaderboard = [...members].sort((a, b) => (b.profile.eco_score ?? 0) - (a.profile.eco_score ?? 0))

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 pb-20">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (!club) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <Building2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
        <p className="text-gray-500">Club non trovato</p>
        <Button size="sm" className="mt-4" onClick={() => navigate('/clubs')}>← Torna ai club</Button>
      </div>
    )
  }

  const initials = club.name.slice(0, 2).toUpperCase()

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 lg:pb-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/clubs')}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-xl font-bold text-gray-900 truncate flex-1">{club.name}</h1>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setEditMode(!editMode)}>
            {editMode ? <X className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
            {editMode ? 'Annulla' : 'Modifica'}
          </Button>
        )}
      </div>

      {/* Club header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <Avatar className="w-16 h-16 flex-shrink-0 border-4 border-eco-green/20">
              {club.avatar_url && <AvatarImage src={club.avatar_url} />}
              <AvatarFallback className="bg-eco-green-light text-eco-teal font-bold text-xl">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              {editMode ? (
                <div className="space-y-2.5">
                  <div><Label>Nome club</Label>
                    <Input value={editName} onChange={e => setEditName(e.target.value)} className="mt-1" />
                  </div>
                  <div><Label>Città</Label>
                    <Input value={editCity} onChange={e => setEditCity(e.target.value)} placeholder="Es. Milano" className="mt-1" />
                  </div>
                  <div><Label>Descrizione</Label>
                    <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={2} className="mt-1 resize-none" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSave} disabled={saving || !editName.trim()}>
                      {saving ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Save className="w-3 h-3" /> Salva</>}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                      <Trash2 className="w-3 h-3" /> Elimina club
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-gray-900">{club.name}</h2>
                    {club.is_public
                      ? <Globe className="w-4 h-4 text-gray-400" aria-label="Pubblico" />
                      : <Lock className="w-4 h-4 text-gray-400" aria-label="Privato" />}
                    {isAdmin && <Badge variant="secondary" className="text-[10px]"><Crown className="w-2.5 h-2.5 mr-0.5" />Admin</Badge>}
                  </div>
                  {club.description && <p className="text-sm text-gray-600 mt-1.5">{club.description}</p>}
                  <div className="flex gap-4 mt-3 text-xs text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{club.member_count} membri</span>
                    <span className="flex items-center gap-1"><Leaf className="w-3.5 h-3.5 text-eco-green" />{club.eco_score_total.toLocaleString()} pts</span>
                    {club.city && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{club.city}</span>}
                    {club.company && <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{club.company}</span>}
                  </div>

                  {/* Chat del club — prominent CTA */}
                  <div className="mt-4">
                    {clubConvId ? (
                      <button
                        onClick={() => navigate(`/chat/${clubConvId}`)}
                        className="w-full flex items-center justify-center gap-2 bg-eco-green text-white font-semibold text-sm px-4 py-2.5 rounded-2xl hover:bg-eco-teal active:scale-[0.98] transition-all shadow-sm shadow-eco-green/30"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Chat del Club
                      </button>
                    ) : isAdmin ? (
                      <button
                        onClick={handleCreateOrOpenClubChat}
                        disabled={creatingChat}
                        className="w-full flex items-center justify-center gap-2 border-2 border-eco-green text-eco-green font-semibold text-sm px-4 py-2.5 rounded-2xl hover:bg-eco-green hover:text-white active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {creatingChat
                          ? <span className="w-4 h-4 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
                          : <MessageCircle className="w-4 h-4" />}
                        {creatingChat ? 'Creazione chat...' : 'Crea Chat del Club'}
                      </button>
                    ) : (
                      <p className="text-xs text-gray-400 italic text-center py-1">Chat del club non ancora creata dall'admin</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin action toast */}
      {adminToast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold text-white transition-all ${adminToast.ok ? 'bg-eco-green' : 'bg-red-500'}`}>
          {adminToast.ok
            ? (adminToast.text.includes('non è più') ? <ShieldOff className="w-4 h-4 flex-shrink-0" /> : <Crown className="w-4 h-4 flex-shrink-0" />)
            : <X className="w-4 h-4 flex-shrink-0" />}
          {adminToast.text}
        </div>
      )}

      <Tabs defaultValue="leaderboard">
        <TabsList className={`w-full grid ${isAdmin ? 'grid-cols-5' : 'grid-cols-4'}`}>
          <TabsTrigger value="leaderboard" className="text-xs px-1">
            <Trophy className="w-3 h-3 sm:mr-0.5" /><span className="hidden sm:inline">Classifica</span>
          </TabsTrigger>
          <TabsTrigger value="members" className="text-xs px-1">
            <Users className="w-3 h-3 sm:mr-0.5" /><span className="hidden sm:inline">Membri ({members.length})</span>
            <span className="sm:hidden text-[9px]">({members.length})</span>
          </TabsTrigger>
          <TabsTrigger value="challenges" className="text-xs px-1 relative">
            <Swords className="w-3 h-3 sm:mr-0.5" /><span className="hidden sm:inline">Sfide</span>
            {clubChallenges.filter(c => c.status === 'active').length > 0 && (
              <span className="absolute -top-1 -right-0.5 w-3.5 h-3.5 bg-orange-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {clubChallenges.filter(c => c.status === 'active').length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-xs px-1">
            <BarChart2 className="w-3 h-3 sm:mr-0.5" /><span className="hidden sm:inline">Stats</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="text-xs px-1 relative">
              <Settings className="w-3 h-3 sm:mr-0.5" /><span className="hidden sm:inline">Admin</span>
              {pendingRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {pendingRequests.length}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        {/* Leaderboard */}
        <TabsContent value="leaderboard">
          <Card>
            <CardContent className="p-4 space-y-1">
              {leaderboard.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Nessun membro</p>
              ) : (
                leaderboard.map((member, i) => {
                  const init = member.profile.username.slice(0, 2).toUpperCase()
                  const isMe = member.user_id === user?.id
                  const medal = i === 0 ? '1°' : i === 1 ? '2°' : i === 2 ? '3°' : `#${i + 1}`
                  return (
                    <div key={member.user_id} className={`flex items-center gap-3 py-2.5 px-3 rounded-xl ${isMe ? 'bg-eco-green-light border border-eco-green/20' : 'hover:bg-gray-50'}`}>
                      <span className="w-7 text-center text-sm font-bold flex-shrink-0">{medal}</span>
                      <Avatar
                        className={`w-9 h-9 flex-shrink-0 ${!isMe ? 'cursor-pointer hover:opacity-80' : ''}`}
                        onClick={!isMe ? () => navigate(`/user/${member.user_id}`) : undefined}
                      >
                        {member.profile.avatar_url && <AvatarImage src={member.profile.avatar_url} />}
                        <AvatarFallback className="text-xs bg-gray-100">{init}</AvatarFallback>
                      </Avatar>
                      <div
                        className={`flex-1 min-w-0 ${!isMe ? 'cursor-pointer' : ''}`}
                        onClick={!isMe ? () => navigate(`/user/${member.user_id}`) : undefined}
                      >
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {member.profile.full_name ?? member.profile.username}
                          {isMe && <span className="ml-1 text-[10px] text-eco-green font-bold">(tu)</span>}
                          {(member.role === 'admin' || member.user_id === club.created_by) && <Crown className="inline w-3 h-3 text-amber-500 ml-1" />}
                        </p>
                        {member.profile.city && <p className="text-xs text-gray-400">{member.profile.city}</p>}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Leaf className="w-3.5 h-3.5 text-eco-green" />
                        <span className="text-sm font-bold text-eco-green">{(member.profile.eco_score ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sfide ── */}
        <TabsContent value="challenges">
          <div className="space-y-4 mt-1">
            {/* CTA - sfida un membro */}
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/60 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Swords className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">Sfida un membro del club</p>
                  <p className="text-xs text-gray-500 mt-0.5 mb-3">Seleziona un avversario dalla lista qui sotto, scegli la metrica e la durata.</p>
                  <div className="flex flex-wrap gap-2">
                    {members.filter(m => m.user_id !== user?.id).slice(0, 6).map(m => (
                      <button
                        key={m.user_id}
                        onClick={() => setChallengeTarget(m)}
                        className="flex items-center gap-1.5 bg-white border border-orange-200 text-xs font-medium px-2.5 py-1.5 rounded-xl hover:bg-orange-50 hover:border-orange-400 transition-all"
                      >
                        <Avatar className="w-5 h-5 flex-shrink-0">
                          {m.profile.avatar_url && <AvatarImage src={m.profile.avatar_url} />}
                          <AvatarFallback className="text-[8px] bg-gray-100">{m.profile.username.slice(0,2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {m.profile.full_name ?? m.profile.username}
                      </button>
                    ))}
                    {members.filter(m => m.user_id !== user?.id).length === 0 && (
                      <p className="text-xs text-gray-400">Nessun altro membro da sfidare</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Elenco sfide */}
            {clubChallenges.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Swords className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">Nessuna sfida nel club</p>
                  <p className="text-xs text-gray-400 mt-1">Sfida un membro per iniziare!</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Active */}
                {clubChallenges.filter(c => c.status === 'active').length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                      <span className="w-2 h-2 bg-eco-green rounded-full animate-pulse" /> In corso
                    </p>
                    {clubChallenges.filter(c => c.status === 'active').map(c => (
                      <ClubChallengeCard key={c.id} c={c} currentUserId={user?.id} />
                    ))}
                  </div>
                )}
                {/* Pending */}
                {clubChallenges.filter(c => c.status === 'pending').length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1"><Clock className="w-3 h-3" /> In attesa</p>
                    {clubChallenges.filter(c => c.status === 'pending').map(c => (
                      <ClubChallengeCard key={c.id} c={c} currentUserId={user?.id} />
                    ))}
                  </div>
                )}
                {/* Completed */}
                {clubChallenges.filter(c => c.status === 'completed').length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1"><Flag className="w-3 h-3" /> Concluse</p>
                    {clubChallenges.filter(c => c.status === 'completed').map(c => (
                      <ClubChallengeCard key={c.id} c={c} currentUserId={user?.id} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Challenge modal */}
          {challengeTarget && user && profile && (
            <ClubChallengeModal
              target={challengeTarget}
              challengerId={user.id}
              challengerUsername={profile.username}
              challengerAvatar={profile.avatar_url}
              onClose={() => setChallengeTarget(null)}
              onSent={() => { setChallengeTarget(null); load() }}
            />
          )}
        </TabsContent>

        {/* Members */}
        <TabsContent value="members">
          <Card>
            <CardContent className="p-4 space-y-1">
              {members.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Nessun membro</p>
              ) : members.map(member => {
                const init = member.profile.username.slice(0, 2).toUpperCase()
                const memberIsAdmin = member.role === 'admin' || member.user_id === club.created_by
                const isMe = member.user_id === user?.id
                return (
                  <div key={member.user_id} className={`flex items-center gap-3 py-2.5 px-2 rounded-xl border-b border-gray-50 last:border-0 ${isMe ? 'bg-eco-green-light/30' : 'hover:bg-gray-50'} transition-colors`}>
                    <Avatar
                      className={`w-10 h-10 flex-shrink-0 ${member.user_id !== user?.id ? 'cursor-pointer hover:opacity-80' : ''}`}
                      onClick={member.user_id !== user?.id ? () => navigate(`/user/${member.user_id}`) : undefined}
                    >
                      {member.profile.avatar_url && <AvatarImage src={member.profile.avatar_url} />}
                      <AvatarFallback className="text-xs bg-gray-100 font-semibold">{init}</AvatarFallback>
                    </Avatar>
                    <div
                      className={`flex-1 min-w-0 ${member.user_id !== user?.id ? 'cursor-pointer' : ''}`}
                      onClick={member.user_id !== user?.id ? () => navigate(`/user/${member.user_id}`) : undefined}
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {member.profile.full_name ?? member.profile.username}
                          {isMe && <span className="ml-1 text-[10px] text-eco-green font-bold">(tu)</span>}
                        </p>
                        {memberIsAdmin && (
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200">
                            <Crown className="w-2.5 h-2.5 mr-0.5 inline" />Admin
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">@{member.profile.username}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Leaf className="w-3 h-3 text-eco-green" />
                        <span className="text-xs font-semibold text-eco-green">{(member.profile.eco_score ?? 0).toLocaleString()} pts</span>
                      </div>
                    </div>
                    {isAdmin && !isMe && member.user_id !== club.created_by && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {/* Make/revoke admin — cannot demote creator */}
                        {member.user_id !== club.created_by && (
                          <button
                            onClick={() => handleToggleAdmin(member.user_id, member.profile.full_name ?? member.profile.username, member.role)}
                            disabled={makingAdminId === member.user_id}
                            title={member.role === 'admin' ? 'Rimuovi admin' : 'Rendi admin'}
                            className={`p-1.5 rounded-lg transition-colors border ${member.role === 'admin' ? 'text-amber-500 border-amber-200 bg-amber-50 hover:bg-amber-100' : 'text-gray-400 border-transparent hover:text-amber-500 hover:bg-amber-50 hover:border-amber-200'}`}
                          >
                            {makingAdminId === member.user_id
                              ? <span className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin block" />
                              : <Crown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveMember(member.user_id, member.profile.full_name ?? member.profile.username)}
                          disabled={removingId === member.user_id}
                          title="Rimuovi membro"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
                        >
                          {removingId === member.user_id
                            ? <span className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin block" />
                            : <UserMinus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stats */}
        <TabsContent value="stats">
          {(() => {
            const totalEco = members.reduce((sum, m) => sum + (m.profile.eco_score ?? 0), 0)
            const topMember = [...members].sort((a, b) => (b.profile.eco_score ?? 0) - (a.profile.eco_score ?? 0))[0]
            const createdAt = (club as unknown as { created_at?: string }).created_at
            const formattedDate = createdAt
              ? new Date(createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
              : '—'
            // Proxy: assume 1 eco point ≈ 0.1 kg CO₂ saved
            const co2Saved = (totalEco * 0.1).toFixed(1)
            return (
              <div className="space-y-3 mt-1">
                {/* KPI cards */}
                <div className="grid grid-cols-2 gap-3">
                  <Card className="border-eco-green/20">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-black text-eco-green">{co2Saved}</p>
                      <p className="text-xs text-gray-500 mt-1 font-medium">kg CO₂ risparmiata</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">dal club (stima)</p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-100">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-black text-blue-600">{members.length}</p>
                      <p className="text-xs text-gray-500 mt-1 font-medium">Membri totali</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">nel club</p>
                    </CardContent>
                  </Card>
                  <Card className="border-amber-100">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-black text-amber-600">{totalEco.toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1 font-medium">Eco score totale</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">somma membri</p>
                    </CardContent>
                  </Card>
                  <Card className="border-purple-100">
                    <CardContent className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Calendar className="w-3.5 h-3.5 text-purple-400" />
                      </div>
                      <p className="text-sm font-bold text-purple-600 leading-tight">{formattedDate}</p>
                      <p className="text-xs text-gray-500 mt-1 font-medium">Data creazione</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Top member */}
                {topMember && (
                  <Card className="border-amber-200/60 bg-amber-50/30">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-gray-600 mb-3 flex items-center gap-1.5">
                        <Star className="w-3.5 h-3.5 text-amber-500" /> Membro più attivo
                      </p>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-12 h-12 border-2 border-amber-200">
                          {topMember.profile.avatar_url && <AvatarImage src={topMember.profile.avatar_url} />}
                          <AvatarFallback className="bg-amber-100 text-amber-700 font-bold text-sm">
                            {topMember.profile.username.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">
                            {topMember.profile.full_name ?? topMember.profile.username}
                          </p>
                          <p className="text-xs text-gray-400">@{topMember.profile.username}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Leaf className="w-3.5 h-3.5 text-eco-green" />
                            <span className="text-sm font-bold text-eco-green">{(topMember.profile.eco_score ?? 0).toLocaleString()} pts</span>
                          </div>
                        </div>
                        <Trophy className="w-8 h-8 text-amber-500 flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Eco score distribution bar */}
                {members.length > 0 && totalEco > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-gray-600 mb-3 flex items-center gap-1.5">
                        <BarChart2 className="w-3.5 h-3.5 text-eco-green" /> Contributo per membro
                      </p>
                      <div className="space-y-2">
                        {[...members]
                          .sort((a, b) => (b.profile.eco_score ?? 0) - (a.profile.eco_score ?? 0))
                          .slice(0, 5)
                          .map(m => {
                            const pct = totalEco > 0 ? Math.round(((m.profile.eco_score ?? 0) / totalEco) * 100) : 0
                            const isMe = m.user_id === user?.id
                            return (
                              <div key={m.user_id} className="flex items-center gap-2">
                                <p className={`text-xs truncate w-24 flex-shrink-0 ${isMe ? 'font-bold text-eco-green' : 'text-gray-600'}`}>
                                  {m.profile.full_name ?? m.profile.username}
                                  {isMe && ' (tu)'}
                                </p>
                                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-eco-green to-eco-teal rounded-full transition-all duration-700"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-400 w-8 text-right flex-shrink-0">{pct}%</span>
                              </div>
                            )
                          })}
                        {members.length > 5 && (
                          <p className="text-[11px] text-gray-400 text-center pt-1">
                            + altri {members.length - 5} membri
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )
          })()}
        </TabsContent>

        {/* Admin */}
        {isAdmin && (
          <TabsContent value="admin">
            <div className="space-y-4">

              {/* Club chat */}
              <Card className={clubConvId ? 'border-eco-green/30' : ''}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-eco-green" /> Chat del club
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  {clubConvId ? (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm text-gray-700 font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-eco-green flex-shrink-0" /> La chat del club è attiva
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">Tutti i membri possono chattare qui</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => navigate(`/chat/${clubConvId}`)}
                        className="flex-shrink-0"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Apri
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm text-gray-700">Nessuna chat del club ancora</p>
                        <p className="text-xs text-gray-400 mt-0.5">Crea una chat di gruppo per tutti i {members.length} membri</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-eco-green text-eco-green hover:bg-eco-green-light flex-shrink-0"
                        onClick={handleCreateOrOpenClubChat}
                        disabled={creatingChat}
                      >
                        {creatingChat
                          ? <span className="w-3.5 h-3.5 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
                          : <><MessageCircle className="w-3.5 h-3.5" /> Crea</>}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Club avatar upload */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Camera className="w-4 h-4 text-eco-green" /> Immagine del club</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="w-16 h-16 border-4 border-eco-green/20">
                      {club.avatar_url && <AvatarImage src={club.avatar_url} />}
                      <AvatarFallback className="bg-eco-green-light text-eco-teal font-bold text-xl">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm text-gray-600 mb-2">Carica una nuova immagine per il club</p>
                      <label className="cursor-pointer">
                        <span className={`inline-flex items-center gap-2 text-xs px-3 py-2 rounded-xl border-2 border-eco-green/30 text-eco-green font-medium hover:bg-eco-green-light transition-colors ${uploadingAvatar ? 'opacity-50 pointer-events-none' : ''}`}>
                          {uploadingAvatar
                            ? <><span className="w-3 h-3 border-2 border-eco-green border-t-transparent rounded-full animate-spin" /> Upload...</>
                            : <><Camera className="w-3.5 h-3.5" /> Cambia foto</>}
                        </span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
                      </label>
                    </div>
                  </div>
                  {avatarUploadError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1 mt-2">{avatarUploadError}</p>
                  )}
                </CardContent>
              </Card>

              {/* Invite users */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><UserPlus className="w-4 h-4 text-eco-green" /> Aggiungi membri</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs text-gray-400">Cerca utenti per username e invia loro un invito. Dovranno accettarlo dalla campanella.</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Cerca username..."
                      value={inviteQuery}
                      onChange={e => handleInviteSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-eco-green"
                    />
                    {inviteSearching && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  {inviteResults.length > 0 && (
                    <div className="space-y-1.5">
                      {inviteResults.map(u => (
                        <div key={u.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-xl">
                          <Avatar className="w-8 h-8 flex-shrink-0">
                            {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                            <AvatarFallback className="text-xs bg-gray-100">{u.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{u.full_name ?? u.username}</p>
                            <p className="text-xs text-gray-400">@{u.username}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs border-eco-green text-eco-green hover:bg-eco-green-light flex-shrink-0"
                            onClick={() => handleInvite(u)}
                            disabled={invitingId === u.id}
                          >
                            {invitingId === u.id
                              ? <span className="w-3 h-3 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
                              : <><UserPlus className="w-3 h-3" /> Invita</>}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {inviteQuery.length >= 2 && inviteResults.length === 0 && !inviteSearching && (
                    <p className="text-xs text-gray-400 text-center py-2">Nessun utente trovato</p>
                  )}
                  {inviteError && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">{inviteError}</p>
                  )}
                </CardContent>
              </Card>

              {/* Pending join requests */}
              {pendingRequests.length > 0 && (
                <Card className="border-amber-200/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                      <Users className="w-4 h-4" /> Richieste di accesso ({pendingRequests.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-2">
                    <p className="text-xs text-gray-400 mb-2">Utenti che vogliono entrare nel club.</p>
                    {pendingRequests.map(req => {
                      const p = req.profile!
                      const init = p.username.slice(0, 2).toUpperCase()
                      return (
                        <div key={req.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                          <Avatar className="w-8 h-8 flex-shrink-0">
                            {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                            <AvatarFallback className="text-xs bg-gray-100">{init}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{p.full_name ?? p.username}</p>
                            <p className="text-xs text-gray-400">@{p.username}</p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => handleRequestResponse(req, true)}
                              disabled={respondingRequest === req.id}
                              className="flex items-center gap-1 text-xs bg-eco-green text-white px-2.5 py-1.5 rounded-lg hover:bg-eco-teal disabled:opacity-50 transition-colors"
                            >
                              {respondingRequest === req.id
                                ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                : <><Check className="w-3 h-3" /> Accetta</>}
                            </button>
                            <button
                              onClick={() => handleRequestResponse(req, false)}
                              disabled={respondingRequest === req.id}
                              className="flex items-center gap-1 text-xs border border-gray-200 text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              <X className="w-3 h-3" /> Rifiuta
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Manage members */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-gray-500" /> Gestione membri</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-2">
                  <p className="text-xs text-gray-400 mb-2">Promuovi admin o espelli membri. Non puoi modificare te stesso.</p>
                  {members.filter(m => m.user_id !== user?.id).map(member => {
                    const init = member.profile.username.slice(0, 2).toUpperCase()
                    const memberIsAdmin = member.role === 'admin' || member.user_id === club.created_by
                    return (
                      <div key={member.user_id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          {member.profile.avatar_url && <AvatarImage src={member.profile.avatar_url} />}
                          <AvatarFallback className="text-xs bg-gray-100">{init}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-gray-900 truncate">{member.profile.full_name ?? member.profile.username}</p>
                            {memberIsAdmin && <Crown className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                          </div>
                          <p className="text-xs text-gray-400">@{member.profile.username}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* Make/revoke admin — creator cannot be demoted */}
                          {member.user_id !== club.created_by && (
                            <button
                              onClick={() => handleToggleAdmin(member.user_id, member.profile.full_name ?? member.profile.username, member.role)}
                              disabled={makingAdminId === member.user_id}
                              title={memberIsAdmin ? 'Rimuovi admin' : 'Rendi admin'}
                              className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors border ${memberIsAdmin ? 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' : 'text-gray-500 border-gray-200 hover:text-amber-600 hover:bg-amber-50 hover:border-amber-200'}`}
                            >
                              {makingAdminId === member.user_id
                                ? <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin block" />
                                : <><Crown className="w-3.5 h-3.5" />{memberIsAdmin ? 'Revoca' : 'Admin'}</>}
                            </button>
                          )}
                          {/* Espelli — il creatore non può essere espulso */}
                          {member.user_id !== club.created_by && (
                            <button
                              onClick={() => handleRemoveMember(member.user_id, member.profile.full_name ?? member.profile.username)}
                              disabled={removingId === member.user_id}
                              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors border border-transparent hover:border-red-100"
                            >
                              {removingId === member.user_id
                                ? <span className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin block" />
                                : <><UserMinus className="w-3.5 h-3.5" /> Espelli</>}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {members.filter(m => m.user_id !== user?.id).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-3">Sei l'unico membro del club</p>
                  )}
                </CardContent>
              </Card>

              {/* Danger zone */}
              <Card className="border-red-100">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-red-600 mb-1">Zona pericolosa</p>
                  <p className="text-xs text-gray-400 mb-3">Elimina il club permanentemente. Tutti i dati verranno persi.</p>
                  <Button variant="destructive" size="sm" className="w-full" onClick={handleDelete} disabled={deleting}>
                    <Trash2 className="w-4 h-4" /> Elimina club definitivamente
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
