import { useState, type FormEvent } from 'react'
import { Archive, Copy, FileText, Pencil, Plus, RotateCcw, Trash2, Users } from 'lucide-react'
import type { SaveTeamTermsTemplateRequest, TeamTermsCategory, TeamTermsTemplate } from '@ipc/contracts'
import { TEAM_TERMS_VARIABLES, teamTermsVariablesUsed } from '@ipc/domain'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { useFormDraft, DraftRestoredBanner } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { useEmployeeRoles } from '@/features/team/api'
import {
  useArchiveTeamTermsTemplate,
  useDeleteTeamTermsTemplate,
  useSaveTeamTermsTemplate,
  useTeamTermsTemplates,
} from '@/features/team-terms/api'
import { CATEGORY_LABELS, TEMPLATE_LIBRARY } from '@/features/team-terms/library'

const CATEGORY_ORDER: TeamTermsCategory[] = [
  'pre_production',
  'production',
  'post_production',
  'general',
  'business_protection',
]

export function TeamTermsPage() {
  return (
    <AuthedPage module="team_terms">
      <TeamTerms />
    </AuthedPage>
  )
}

/**
 * The agreements a studio puts in front of the people it books.
 *
 * Two halves: what this studio has written, and the starter library to copy
 * from. The library is static and stays that way — using one writes a copy the
 * studio owns, so the draft they edited last month cannot change under them
 * when this app updates.
 */
function TeamTerms() {
  const [showArchived, setShowArchived] = useState(false)
  const templates = useTeamTermsTemplates(showArchived)
  const archive = useArchiveTeamTermsTemplate()

  return (
    <>
      <PageHeader
        title="Team Terms"
        description="What the crew agrees to when you book them."
        actions={<TemplateDialog allTemplates={templates.data ?? []} />}
      />
      <SettingsTabs />

      <HowToUse
        title="Agreements for the people you book"
        description="A template is written once and sent per shoot, with the names and dates filled in."
        steps={[
          'Start from the library, or write your own.',
          'Tag it with the job roles it covers.',
          'Send it from a shoot — they read it and agree on a link.',
        ]}
      />

      <Card className="mt-6">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-4">
          <div>
            <CardTitle>{showArchived ? 'Archived terms' : 'Your terms'}</CardTitle>
            <CardDescription>
              {showArchived
                ? 'Kept because sends still point at them.'
                : 'Grouped by the stage of work they cover.'}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Back to active' : 'Show archived'}
          </Button>
        </CardHeader>
        <CardContent>
          {templates.isLoading ? (
            <SkeletonCards count={3} />
          ) : templates.isError ? (
            <ErrorState onRetry={() => void templates.refetch()} />
          ) : !templates.data || templates.data.length === 0 ? (
            <EmptyState
              title={showArchived ? 'Nothing archived' : 'No terms yet'}
              description={
                showArchived
                  ? 'Terms you archive will be kept here.'
                  : 'Copy one from the library below, or write your own.'
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {CATEGORY_ORDER.map((category) => {
                const inCategory = templates.data.filter((t) => (t.category ?? 'general') === category)
                if (inCategory.length === 0) return null
                return (
                  <div key={category}>
                    <p className="mb-2 text-sm font-medium">{CATEGORY_LABELS[category]}</p>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {inCategory.map((t) => (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          archived={showArchived}
                          allTemplates={templates.data ?? []}
                          onArchive={() => archive.mutate({ id: t.id, restore: showArchived })}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {!showArchived && <StarterLibrary owned={templates.data ?? []} />}
    </>
  )
}

function TemplateCard({
  template,
  archived,
  allTemplates,
  onArchive,
}: {
  template: TeamTermsTemplate
  archived: boolean
  allTemplates: readonly TeamTermsTemplate[]
  onArchive: () => void
}) {
  const save = useSaveTeamTermsTemplate()
  const del = useDeleteTeamTermsTemplate()
  const used = template.send_count > 0
  const canDelete = !used && !archived

  function duplicate() {
    save.mutate({
      body: {
        title: `${template.title} (copy)`,
        description: template.description,
        body: template.body,
        mode: template.mode,
        validity_days: template.validity_days,
        category: template.category,
        is_active: false,
        role_ids: [],
      },
    })
  }

  function toggleActive() {
    save.mutate({
      id: template.id,
      body: {
        title: template.title,
        description: template.description,
        body: template.body,
        mode: template.mode,
        validity_days: template.validity_days,
        category: template.category,
        is_active: !template.is_active,
        role_ids: template.role_ids,
      },
    })
  }

  return (
    <div className="flex flex-col rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-medium">{template.title}</p>
        <div className="flex items-center gap-1.5">
          {!template.is_active && !archived && <StatusBadge>Inactive</StatusBadge>}
          <StatusBadge tone={template.mode === 'acknowledgement_required' ? 'info' : 'neutral'}>
            {template.mode === 'acknowledgement_required' ? 'Signed' : 'Briefing'}
          </StatusBadge>
        </div>
      </div>
      {template.description ? (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{template.description}</p>
      ) : (
        <p className="mt-1 text-xs italic text-muted-foreground">No description — add one so the next manager knows what this covers.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>v{template.version}</span>
        <span>
          {template.role_ids.length
            ? `${template.role_ids.length} role${template.role_ids.length === 1 ? '' : 's'}`
            : 'No roles tagged'}
        </span>
        <span>
          {template.send_count} sent
          {template.validity_days ? ` · ${template.validity_days}-day link` : ''}
        </span>
      </div>
      {!archived && (
        <Switch
          className="mt-3 w-auto"
          checked={template.is_active}
          onChange={() => toggleActive()}
          label={template.is_active ? 'Active' : 'Inactive'}
          description="Inactive terms are kept but no longer offered when sending."
        />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {!archived && <TemplateDialog template={template} allTemplates={allTemplates} />}
        <Button size="sm" variant="ghost" onClick={onArchive}>
          {archived ? <RotateCcw /> : <Archive />}
          {archived ? 'Restore' : 'Archive'}
        </Button>
        {!archived && (
          <Button size="sm" variant="ghost" onClick={duplicate} disabled={save.isPending}>
            <Copy /> Duplicate
          </Button>
        )}
        {!archived && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={!canDelete || del.isPending}
            title={used ? 'Used templates cannot be deleted. Archive instead.' : 'Delete permanently'}
            onClick={() => {
              if (window.confirm(`Delete "${template.title}" permanently? This cannot be undone.`)) {
                del.mutate(template.id)
              }
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
      </div>
      {used && !archived && (
        <p className="mt-2 text-xs text-muted-foreground">
          Sent {template.send_count}× — deletion is locked to protect acknowledgement history.
        </p>
      )}
    </div>
  )
}

/**
 * The drafts every studio starts from. Copying rather than referencing is the
 * point: the moment it is theirs, they can rewrite a clause and nothing here
 * touches it again.
 */
function StarterLibrary({ owned }: { owned: readonly TeamTermsTemplate[] }) {
  const save = useSaveTeamTermsTemplate()
  const taken = new Set(owned.map((t) => t.title.trim().toLowerCase()))
  const offer = TEMPLATE_LIBRARY.filter((t) => !taken.has(t.title.trim().toLowerCase()))
  if (offer.length === 0) return null

  return (
    <Card className="mt-6">
      <CardHeader className="pb-4">
        <CardTitle>Starter library</CardTitle>
        <CardDescription>
          Drafts to copy and make your own. Have a legal advisor read one before you send it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-2">
          {offer.map((t) => (
            <div key={t.key} className="flex flex-col rounded-lg border border-dashed border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-medium">{t.title}</p>
                <StatusBadge>{CATEGORY_LABELS[t.category]}</StatusBadge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
              <p className="mt-2 text-xs text-muted-foreground">Best for: {t.best_for.join(', ')}</p>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      body: {
                        title: t.title,
                        description: t.description,
                        body: t.body,
                        mode: t.mode,
                        validity_days: t.validity_days,
                        category: t.category,
                        is_active: true,
                        role_ids: [],
                      },
                    })
                  }
                >
                  <Plus /> Use this template
                </Button>
                <PreviewDialog title={t.title} body={t.body} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function PreviewDialog({ title, body }: { title: string; body: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <FileText /> Read
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description="The draft as it stands, before you make it yours.">
        <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {body}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

/** Write or edit a set of terms, and say which job roles they cover. */
function TemplateDialog({
  template,
  allTemplates,
}: {
  template?: TeamTermsTemplate
  allTemplates: readonly TeamTermsTemplate[]
}) {
  const save = useSaveTeamTermsTemplate()
  const { data: roles } = useEmployeeRoles()
  const editing = !!template
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SaveTeamTermsTemplateRequest>(() => fromTemplate(template))
  // What was typed survives a refresh or a closed tab until it is saved.
  // Opening resets the form to the saved terms, so those are the blank baseline.
  const saved = useFormDraft(open ? `team-terms-template:${template?.id ?? 'new'}` : null, draft, setDraft, {
    isBlank: (v) => JSON.stringify(v) === JSON.stringify(fromTemplate(template)),
  })

  const used = teamTermsVariablesUsed(draft.body)
  // Roles already defaulting to another template — selecting one here moves
  // the default, so say so before the save.
  const coveredElsewhere = new Map<string, string>()
  for (const t of allTemplates) {
    if (template && t.id === template.id) continue
    for (const roleId of t.role_ids) {
      if (!coveredElsewhere.has(roleId)) coveredElsewhere.set(roleId, t.title)
    }
  }
  const conflicts = draft.role_ids
    .map((id) => ({ id, name: (roles ?? []).find((r) => r.id === id)?.type_name ?? 'Role', other: coveredElsewhere.get(id) }))
    .filter((r) => r.other)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      { ...(editing ? { id: template.id } : {}), body: draft },
      {
        onSuccess: () => {
          saved.clear()
          setOpen(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setDraft(fromTemplate(template))
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button size="sm" variant="ghost">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New terms
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={editing ? `Edit ${template.title}` : 'New team terms'}
        description="Write it once. Names, dates and roles fill in when you send it."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <DraftRestoredBanner
            at={saved.restoredAt}
            onDismiss={saved.dismissRestored}
            onDiscard={() => {
              saved.clear()
              setDraft(fromTemplate(template))
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Photographer undertaking"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Input
              value={draft.description ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || null }))}
              placeholder="Short internal note — what this covers, when to send it"
            />
          </div>

          <Switch
            className="w-auto"
            checked={draft.is_active}
            onChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
            label={draft.is_active ? 'Active' : 'Inactive'}
            description="Inactive terms are kept but no longer offered when sending."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Covers</Label>
              <Select
                value={draft.category ?? 'general'}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value as TeamTermsCategory }))
                }
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Link expires after</Label>
              <Input
                inputMode="numeric"
                value={draft.validity_days ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    validity_days: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                placeholder="60 days"
              />
            </div>
          </div>

          <Switch
            className="w-auto"
            checked={draft.mode === 'acknowledgement_required'}
            onChange={(v) =>
              setDraft((d) => ({ ...d, mode: v ? 'acknowledgement_required' : 'send_only' }))
            }
            label="They must agree before the shoot"
          />

          <div className="flex flex-col gap-1.5">
            <Label>The terms</Label>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              rows={12}
              placeholder="The Team Member agrees to…"
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              {used.length
                ? `Fills in on send: ${used.map((v) => `{{${v}}}`).join(', ')}`
                : 'Use {{team_member_name}}, {{role}}, {{shoot_name}}, {{shoot_date}} and friends.'}
            </p>
            <div className="flex flex-wrap gap-1">
              {TEAM_TERMS_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, body: `${d.body}{{${v}}}` }))}
                  title={`Insert {{${v}}}`}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted/70"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {roles && roles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>
                <Users className="mr-1 inline size-3.5" aria-hidden />
                Job roles it covers
              </Label>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => {
                  const on = draft.role_ids.includes(r.id)
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          role_ids: on
                            ? d.role_ids.filter((x) => x !== r.id)
                            : [...d.role_ids, r.id],
                        }))
                      }
                      aria-pressed={on}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm transition-colors',
                        on
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {r.type_name}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Tagged terms are offered first when you send to someone in that role.
              </p>
              {conflicts.length > 0 && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  Already the default elsewhere: {conflicts.map((c) => `${c.name} → ${c.other}`).join('; ')}.
                  Saving here moves {conflicts.length === 1 ? 'that default' : 'those defaults'} to these terms.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={save.isPending || draft.title.trim().length < 2 || draft.body.trim().length < 20}
            >
              {save.isPending ? 'Saving…' : editing ? 'Save terms' : 'Create terms'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const fromTemplate = (t?: TeamTermsTemplate): SaveTeamTermsTemplateRequest => ({
  title: t?.title ?? '',
  description: t?.description ?? null,
  body: t?.body ?? '',
  mode: t?.mode ?? 'acknowledgement_required',
  validity_days: t?.validity_days ?? null,
  category: t?.category ?? 'general',
  is_active: t?.is_active ?? true,
  role_ids: t ? [...t.role_ids] : [],
})
