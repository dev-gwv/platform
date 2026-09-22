import { useState } from 'react'
import { Pencil, Sparkles, Trash2 } from 'lucide-react'
import { templateVariables } from '@ipc/domain'
import type { CrmTemplate, TemplateKind } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useCreateTemplate, useSeedTemplates, useUpdateTemplate, useDeleteTemplate, useTemplates } from '../api'

const KNOWN = new Set(['name', 'phone', 'email', 'studio'])

/**
 * Message templates. They are sent from the lead drawer: WhatsApp opens with
 * the text filled in, email opens the mail client. Anything in {{braces}} is
 * filled from the lead — name, phone, email — and {{studio}} from the company.
 */
export function TemplatesTab() {
  const { data, isLoading, isError, error, refetch } = useTemplates()
  const create = useCreateTemplate()
  const seed = useSeedTemplates()
  const update = useUpdateTemplate()
  const del = useDeleteTemplate()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const canDelete = access.hasAction('crm', 'delete')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<TemplateKind>('whatsapp')

  const unknown = templateVariables(body).filter((v) => !KNOWN.has(v))

  if (isLoading) return <SkeletonCards count={3} />
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />

  function startEdit(t: CrmTemplate) {
    setEditingId(t.id)
    setName(t.name)
    setBody(t.body)
    setKind(t.kind)
  }

  function cancelEdit() {
    setEditingId(null)
    setName('')
    setBody('')
    setKind('whatsapp')
  }

  async function onDelete(id: string, label: string) {
    if (await confirm({ title: `Delete "${label}"?`, confirmLabel: 'Delete', destructive: true })) del.mutate(id)
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
              <p className="font-medium">{editingId ? 'Edit template' : 'New template'}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Use <code className="rounded bg-muted px-1">{'{{name}}'}</code>, <code className="rounded bg-muted px-1">{'{{phone}}'}</code>,{' '}
                <code className="rounded bg-muted px-1">{'{{email}}'}</code> and <code className="rounded bg-muted px-1">{'{{studio}}'}</code>; they are filled in per lead.
              </p>
              </div>
              {/* An empty template list is why most studios end up retyping the
                  same WhatsApp message all season. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={seed.isPending}
                onClick={() => seed.mutate(undefined)}
              >
                <Sparkles /> {seed.isPending ? 'Adding…' : 'Add starter templates'}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="flex flex-col gap-1">
                <Label htmlFor="tpl-name">Name</Label>
                <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. First follow-up" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tpl-kind">Channel</Label>
                <Select id="tpl-kind" value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="note">Note</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="tpl-body">Message</Label>
              <textarea
                id="tpl-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hi {{name}}, thanks for reaching out to {{studio}}…"
                rows={3}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {unknown.length > 0 && (
                <p className="text-xs text-warning">
                  {unknown.map((v) => `{{${v}}}`).join(', ')} will be left blank — only name, phone, email and studio are filled.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {editingId && (
                <Button variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
              <Button
                disabled={name.trim().length < 2 || body.trim().length < 2 || create.isPending || update.isPending}
                onClick={() => {
                  const patch = { name: name.trim(), body: body.trim(), kind }
                  if (editingId) update.mutate({ id: editingId, patch }, { onSuccess: cancelEdit })
                  else create.mutate(patch, { onSuccess: cancelEdit })
                }}
              >
                {editingId ? 'Save changes' : 'Save template'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!data || data.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No templates yet" description="Save a follow-up you send every day, then send it from any lead in one tap." />
          </CardContent>
        </Card>
      ) : (
        data.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {t.name} <StatusBadge tone="neutral">{t.kind}</StatusBadge>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
              </div>
              <span className="flex gap-1">
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>
                    <Pencil />
                    <span className="sr-only">Edit {t.name}</span>
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => void onDelete(t.id, t.name)}>
                    <Trash2 />
                    <span className="sr-only">Delete {t.name}</span>
                  </Button>
                )}
              </span>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
