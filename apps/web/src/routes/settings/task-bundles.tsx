import { useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { useBundles, useCreateBundle, useUpdateBundle, useDeleteBundle } from '@/features/tasks/api'

export function TaskBundlesPage() {
  return (
    <AuthedPage module="settings">
      <Bundles />
    </AuthedPage>
  )
}

/**
 * Lovable parity (/settings/task-bundles): reusable task templates that can
 * be applied to projects. Wired to the existing bundles API — no new
 * endpoints, just the settings-surface entry point.
 */
function Bundles() {
  const q = useBundles()
  const del = useDeleteBundle()
  const confirm = useConfirm()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function onDelete(id: string, name: string) {
    const yes = await confirm({
      title: `Delete bundle "${name}"?`,
      description: 'This bundle and its items will be removed. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!yes) return
    try {
      await del.mutateAsync(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete.')
    }
  }

  return (
    <>
      <PageHeader
        title="Task Bundles"
        description="Reusable task templates that can be applied to projects."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New bundle
          </Button>
        }
      />
      <SettingsTabs />
      {q.isLoading ? (
        <SkeletonCards count={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState title="No bundles yet" description="Create reusable task templates to apply to projects." />
      ) : (
        <div className="grid gap-3">
          {q.data.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(b.items?.length ?? 0)} task{(b.items?.length ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingId(b.id)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onDelete(b.id, b.name)}>
                  <Trash2 />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {(creating || editingId) && (
        <BundleDialog
          bundleId={editingId}
          onClose={() => {
            setCreating(false)
            setEditingId(null)
          }}
        />
      )}
    </>
  )
}

function BundleDialog({ bundleId, onClose }: { bundleId: string | null; onClose: () => void }) {
  const isEdit = !!bundleId
  const { data } = useBundles()
  const existing = data?.find((b) => b.id === bundleId)
  const create = useCreateBundle()
  const update = useUpdateBundle()
  const [name, setName] = useState(existing?.name ?? '')
  const [itemsText, setItemsText] = useState((existing?.items ?? []).map((i) => i.title).join('\n'))
  // What was typed survives a refresh or a closed tab until it is saved.
  // Mounted only while open, so the key is always on.
  const draft = useFormDraft(`bundle:${bundleId ?? 'new'}`, { name, itemsText }, (v) => {
    setName(v.name)
    setItemsText(v.itemsText)
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Name is required.')
      return
    }
    const items = itemsText
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((title) => ({ title, priority: 'medium' as const }))
    if (items.length === 0) {
      toast.error('Add at least one task.')
      return
    }
    try {
      if (isEdit && bundleId) {
        await update.mutateAsync({ id: bundleId, input: { name: name.trim(), items } })
      } else {
        await create.mutateAsync({ name: name.trim(), items })
      }
      draft.clear()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogTrigger asChild><span className="hidden" /></DialogTrigger>
      <DialogContent title={isEdit ? 'Edit bundle' : 'New bundle'} description="One task per line. Applied to projects from the Tasks page.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <DraftRestoredBanner
            at={draft.restoredAt}
            onDismiss={draft.dismissRestored}
            onDiscard={() => {
              draft.clear()
              setName(existing?.name ?? '')
              setItemsText((existing?.items ?? []).map((i) => i.title).join('\n'))
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wedding checklist" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tasks (one per line)</Label>
            <textarea
              value={itemsText}
              onChange={(e) => setItemsText(e.target.value)}
              rows={6}
              placeholder={'Book venue\nConfirm dates\nSend advance invoice'}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create bundle'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
