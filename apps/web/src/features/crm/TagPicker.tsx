import { useMemo } from 'react'
import { Plus, Tag as TagIcon } from 'lucide-react'
import type { LeadTag } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { useSetLeadTags } from './api'
import { LabelMenu } from './LabelMenu'
import { TagChip } from './TagChip'

/**
 * The labels on one lead -- as many as it needs -- and a way to change them.
 *
 * This replaced a free-text box called "Group / tag" that held one value and
 * could not be filtered. The picker sends the whole set rather than a diff, so
 * adding one label and removing another are the same request. The studio's own
 * labels are one list for everyone, grown from here with "+ Add new label".
 */
export function TagPicker({
  leadId,
  tags,
  canEdit,
}: {
  leadId: string
  tags: readonly LeadTag[]
  canEdit: boolean
}) {
  const save = useSetLeadTags()
  const on = useMemo(() => new Set(tags.map((t) => t.id)), [tags])
  const setTags = (ids: string[]) => save.mutate({ id: leadId, tag_ids: ids })
  const toggle = (id: string, next: boolean) => setTags(next ? [...on, id] : [...on].filter((x) => x !== id))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <TagIcon className="size-3.5 text-muted-foreground" aria-hidden />
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={canEdit ? () => toggle(t.id, false) : undefined} />
      ))}
      {canEdit ? (
        <LabelMenu
          selected={on}
          canCreate={canEdit}
          onToggle={(t, next) => toggle(t.id, next)}
          trigger={
            <Button
              size="sm"
              variant="outline"
              className={tags.length === 0 ? 'h-7 border-dashed border-tone-amber/60 bg-tone-amber-soft/30 text-tone-amber' : 'h-7'}
            >
              <Plus /> {tags.length === 0 ? 'Add a label' : 'Label'}
            </Button>
          }
        />
      ) : (
        tags.length === 0 && <span className="text-sm text-muted-foreground">No labels</span>
      )}
    </div>
  )
}
