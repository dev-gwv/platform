import { useMemo, useState, type FormEvent } from 'react'
import { Check, Copy, FileSignature, Send, Undo2 } from 'lucide-react'
import type { ShootListItem, TeamTermsSend, TeamTermsStatus } from '@ipc/contracts'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { humanize } from '@/shared/ui/format'
import { useDirectory, useEmployeeRoles } from '@/features/team/api'
import {
  useRevokeTeamTerms,
  useSendTeamTerms,
  useTeamTermsSends,
  useTeamTermsTemplates,
} from './api'

const TONE: Record<TeamTermsStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  sent: 'info',
  viewed: 'info',
  acknowledged: 'success',
  expired: 'warning',
  revoked: 'danger',
}

/** Where a send has got to, for a shoot card or a list row. */
export function TeamTermsStatusBadge({ send }: { send: TeamTermsSend }) {
  return <StatusBadge tone={TONE[send.status]}>{humanize(send.status)}</StatusBadge>
}

/**
 * Put terms in front of somebody booked on this shoot.
 *
 * The dialog is one screen because the decision is small: who, which terms,
 * and whether to email them. Everything else — the names and dates inside the
 * document — is filled in by the server at send time.
 */
export function SendTermsDialog({ shoot }: { shoot: ShootListItem }) {
  const [open, setOpen] = useState(false)
  const templates = useTeamTermsTemplates()
  const roles = useEmployeeRoles()
  const directory = useDirectory()
  const existing = useTeamTermsSends(open ? shoot.id : null)
  const send = useSendTeamTerms()
  const revoke = useRevokeTeamTerms()

  const [memberId, setMemberId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [byEmail, setByEmail] = useState(true)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open && !link ? `team-terms-send:${shoot.id}` : null,
    { memberId, name, email, roleId, templateId, byEmail },
    (v) => {
      setMemberId(v.memberId)
      setName(v.name)
      setEmail(v.email)
      setRoleId(v.roleId)
      setTemplateId(v.templateId)
      setByEmail(v.byEmail)
    },
  )

  const active = useMemo(
    () => (templates.data ?? []).filter((t) => t.is_active),
    [templates.data],
  )

  /**
   * Terms tagged with the chosen role come first: a studio with fifteen sets
   * of terms should not have to remember which one the drone operator signs.
   */
  const ordered = useMemo(() => {
    if (!roleId) return active
    const matching = active.filter((t) => t.role_ids.includes(roleId))
    return [...matching, ...active.filter((t) => !matching.includes(t))]
  }, [active, roleId])

  const chosen = ordered.find((t) => t.id === templateId) ?? ordered[0]

  function pickMember(userId: string) {
    setMemberId(userId)
    const member = (directory.data ?? []).find((m) => m.user_id === userId)
    if (!member) return
    setName(member.name)
    setEmail(member.email ?? '')
    // Their first job role is the usual guess; the picker below can override.
    const first = (roles.data ?? []).find((r) => member.role_ids.includes(r.id))
    if (first) setRoleId(first.id)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!chosen) return
    const role = (roles.data ?? []).find((r) => r.id === roleId)
    send.mutate(
      {
        shoot_id: shoot.id,
        template_id: chosen.id,
        recipient_name: name.trim(),
        recipient_email: email.trim() || null,
        user_id: memberId || null,
        role_id: roleId || null,
        role_name: role?.type_name ?? null,
        send_email: byEmail && !!email.trim(),
      },
      {
        onSuccess: (r) => {
          draft.clear()
          setLink(r.link)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setLink(null)
          setCopied(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileSignature /> Terms
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Terms for ${shoot.name}`}
        description="Send the agreement to someone booked on this shoot."
      >
        {existing.data && existing.data.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            <p className="text-sm font-medium">Already sent</p>
            {existing.data.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {s.recipient_name}
                  {s.role_name ? ` · ${s.role_name}` : ''}
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.template_title ?? 'Terms'}
                    {s.template_version ? ` v${s.template_version}` : ''}
                    {s.acknowledged_by_name ? ` · signed by ${s.acknowledged_by_name}` : ''}
                  </span>
                </span>
                <TeamTermsStatusBadge send={s} />
                {/* Withdrawing is only offered while it still means something:
                    an acknowledged set of terms is evidence, not a draft. */}
                {s.status !== 'acknowledged' && s.status !== 'revoked' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    <Undo2 />
                    <span className="sr-only">Withdraw the terms sent to {s.recipient_name}</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {send.data?.email === 'sent'
                ? 'Emailed. The link is here too, in case they ask for it on WhatsApp.'
                : 'Ready. Send them this link — it opens without an account.'}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(link)
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <Button variant="outline" onClick={() => setLink(null)}>
              Send another
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Who</Label>
              <Select value={memberId} onChange={(e) => pickMember(e.target.value)}>
                <option value="">Someone not on the team…</option>
                {(directory.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul Sharma" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="rahul@example.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Booked as</Label>
              <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">No particular role</option>
                {(roles.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.type_name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Terms</Label>
              {ordered.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No terms written yet — add some under Settings → Team Terms.
                </p>
              ) : (
                <Select value={chosen?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
                  {ordered.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {roleId && t.role_ids.includes(roleId) ? ' — for this role' : ''}
                    </option>
                  ))}
                </Select>
              )}
              {chosen && (
                <p className="text-xs text-muted-foreground">
                  {chosen.mode === 'acknowledgement_required'
                    ? 'They will be asked to type their name to agree.'
                    : 'A briefing — there is nothing for them to sign.'}
                </p>
              )}
            </div>

            <Switch
              className="w-auto"
              checked={byEmail}
              onChange={setByEmail}
              label="Email it to them"
            />

            <Button
              type="submit"
              disabled={send.isPending || !chosen || name.trim().length < 2}
            >
              <Send /> {send.isPending ? 'Sending…' : 'Send terms'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
