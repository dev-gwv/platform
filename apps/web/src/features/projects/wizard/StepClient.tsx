import { useState } from 'react'
import { CheckCircle2, ClipboardList, Search, UserPlus, Users } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { useClients } from '@/features/clients/api'
import type { ProjectDraft } from '@/features/projects/wizard'
import type { Patch } from './wizard-state'
import { Field } from './wizard-ui'

export function ClientStep({ draft, patch, onSendForm }: { draft: ProjectDraft; patch: Patch; onSendForm?: (() => void) | undefined }) {
  const { data: clients } = useClients()
  const [mode, setMode] = useState<'existing' | 'new'>(draft.new_client_name ? 'new' : 'existing')
  const [q, setQ] = useState('')

  const matches = (Array.isArray(clients) ? clients : []).filter((c) =>
    [c.name, c.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q.trim().toLowerCase())),
  )

  return (
    <div className="flex flex-col gap-4">
      <Field label="Project name" required>
        <Input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. Aanya & Rahul Wedding"
          autoFocus
        />
      </Field>

      <Switch
        checked={draft.show_quotation}
        onChange={(v) => patch({ show_quotation: v })}
        label="Show quotation to client"
        description="Client-visible deliverables and prices appear on their quotation link."
      />

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Client</Label>
          {onSendForm && (draft.client_id || (draft.new_client_name.trim() && draft.new_client_phone.trim())) && (
            <Button type="button" size="sm" variant="outline" onClick={onSendForm}>
              <ClipboardList className="size-4" /> Send them a form
            </Button>
          )}
        </div>
        <div className="mt-2 inline-flex gap-1 rounded-lg bg-muted p-1">
          {(['existing', 'new'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                patch(m === 'new' ? { client_id: '' } : { new_client_name: '', new_client_phone: '' })
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'existing' ? <Search className="size-3.5" /> : <UserPlus className="size-3.5" />}
              {m === 'existing' ? 'Existing client' : 'New client'}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or phone…"
                className="pl-9"
                aria-label="Search clients"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              {matches.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No clients match. Switch to “New client” to add one.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => patch({ client_id: c.id })}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          draft.client_id === c.id ? 'bg-primary/5' : 'hover:bg-accent',
                        )}
                      >
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.phone ?? '—'}
                          </span>
                        </span>
                        {draft.client_id === c.id && <CheckCircle2 className="size-4 text-primary" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Client name" required>
              <Input
                value={draft.new_client_name}
                onChange={(e) => patch({ new_client_name: e.target.value })}
                placeholder="Sharma Family"
              />
            </Field>
            <Field label="Phone" required hint="Required — used for duplicate checks and lookups.">
              <Input
                value={draft.new_client_phone}
                onChange={(e) => patch({ new_client_phone: e.target.value })}
                placeholder="9876543210"
              />
            </Field>
            <Field label="Email">
              <Input
                value={draft.new_client_email}
                onChange={(e) => patch({ new_client_email: e.target.value })}
                placeholder="client@example.com"
              />
            </Field>
            <Field label="Relation" hint="Referral, Repeat, Vendor…">
              <Input
                value={draft.new_client_relation}
                onChange={(e) => patch({ new_client_relation: e.target.value })}
                placeholder="Referral"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <Input
                  value={draft.new_client_address}
                  onChange={(e) => patch({ new_client_address: e.target.value })}
                  placeholder="Street, area, city"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea
                  value={draft.new_client_notes}
                  onChange={(e) => patch({ new_client_notes: e.target.value })}
                  rows={2}
                  placeholder="Anything the studio should remember about this client"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
