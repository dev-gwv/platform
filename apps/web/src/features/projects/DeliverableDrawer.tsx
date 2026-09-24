import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FolderOpen, Camera, Pencil, Send, Trash2, X } from 'lucide-react'
import type { Deliverable, DeliverableNote } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Input, Textarea } from '@/shared/ui/input'
import { Sheet, SheetContent } from '@/shared/ui/sheet'
import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { useSetDeliverableStage, useUpdateDeliverable } from '@/features/projects/api'
import { STAGE_LABEL, stageOf } from './deliverable-stage'
import { DueChip, DueEditor, EditorName, EditorPicker, KindTile, NextStageButton } from './DeliverableCard'
import { StageStepper } from './StageStepper'
import { VoiceNotePlayer } from './VoiceNotePlayer'
import { VoiceNoteRecorder } from './VoiceNoteRecorder'
import { useAddDeliverableNote, useDeleteDeliverableNote, useDeliverableNotes, useSendVoiceNote } from './notes-api'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * Everything about one deliverable, in a panel beside the list: where it
 * stands and who is on it, the brief, the link that went out, and the
 * conversation about it -- written notes, voice notes, and every stage change,
 * in order. The editor hears about each note; so does the owner when the
 * editor replies.
 */
export function DeliverableDrawer({
  deliverable: d,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  deliverable: Deliverable | null
  canEdit: boolean
  onClose: () => void
  onEdit: (d: Deliverable) => void
  onDelete: (d: Deliverable) => void
}) {
  return (
    <Sheet open={!!d} onOpenChange={(open) => !open && onClose()}>
      {d && (
        <SheetContent title={d.title} description={`${STAGE_LABEL[stageOf(d.status)]} · ${d.shoot_name ?? 'Whole project'}`}>
          <DrawerBody d={d} canEdit={canEdit} onEdit={() => onEdit(d)} onDelete={() => onDelete(d)} />
        </SheetContent>
      )}
    </Sheet>
  )
}

function DrawerBody({ d, canEdit, onEdit, onDelete }: { d: Deliverable; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const { session } = useAuth()
  const access = useAccess()
  const me = session?.user_id ?? null
  // The editor on it can talk about it and move it, even without project rights.
  const canWrite = canEdit || (!!me && d.assignee_id === me)
  const stage = stageOf(d.status)
  const dropped = stage === 'cancelled'
  const move = useSetDeliverableStage()

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── What and where it stands ─────────────────────────── */}
      <header className="border-b border-border bg-card px-5 pb-4 pt-5">
        <div className="flex items-start gap-3 pr-8">
          <KindTile title={d.title} status={d.status} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight">{d.title}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {d.shoot_id ? <Camera className="size-3.5" aria-hidden /> : <FolderOpen className="size-3.5" aria-hidden />}
              {d.shoot_name ?? 'Whole project'}
              {d.visibility_scope === 'internal' && <span className="font-semibold text-tone-violet">· Team only</span>}
              {d.is_additional_charge && d.additional_charge_amount > 0 && (
                <span className="font-semibold text-tone-green">· +{formatINR(d.additional_charge_amount)}</span>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <StageStepper status={d.status} size="lg" />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Editor</dt>
            <dd className="mt-1">{canEdit && !dropped && stage !== 'completed' ? <EditorPicker d={d} /> : <EditorName name={d.assignee_name} />}</dd>
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Due</dt>
            <dd className="mt-1">
              {canEdit && !dropped ? (
                <DueEditor d={d} />
              ) : d.estimated_date || d.delivered_at ? (
                <DueChip d={d} />
              ) : (
                <span className="text-xs text-muted-foreground">No date</span>
              )}
            </dd>
          </div>
        </dl>

        {canWrite && !dropped && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <NextStageButton id={d.id} status={d.status} link={d.delivery_link} size="default" />
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                <Pencil /> Edit details
              </Button>
            )}
          </div>
        )}
      </header>

      {/* ── Brief, link, conversation ────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <Brief d={d} canEdit={canEdit} />
        <DeliveryLink d={d} canEdit={canWrite} />
        <Timeline d={d} me={me} canModerate={access.hasAction('projects', 'edit')} />

        {canEdit && (
          <div className="mt-8 flex flex-wrap gap-2 border-t border-border pt-4">
            {dropped ? (
              <Button variant="outline" size="sm" onClick={() => move.mutate({ deliverableId: d.id, status: 'pending' })}>
                Restore
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => move.mutate({ deliverableId: d.id, status: 'cancelled' })}>
                Client no longer wants it
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
              <Trash2 /> Delete
            </Button>
          </div>
        )}
      </div>

      {canWrite && <Composer deliverableId={d.id} editorName={d.assignee_id === me ? null : d.assignee_name} />}
    </div>
  )
}

/** The editor's brief, edited in place and saved when you click away. */
function Brief({ d, canEdit }: { d: Deliverable; canEdit: boolean }) {
  const update = useUpdateDeliverable(d.project_id)
  const [text, setText] = useState(d.description ?? '')
  useEffect(() => setText(d.description ?? ''), [d.description])
  const save = () => {
    const next = text.trim()
    if (next !== (d.description ?? '').trim()) update.mutate({ deliverableId: d.id, patch: { description: next || null } })
  }
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brief for the editor</h3>
      {canEdit ? (
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          placeholder="What should the edit feel like? Songs, must-have moments, length…"
          className="mt-1.5 resize-y bg-card text-sm"
        />
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-sm">{d.description || <span className="text-muted-foreground">No brief.</span>}</p>
      )}
    </section>
  )
}

/** The link that went to the client: open it, or change it. */
function DeliveryLink({ d, canEdit }: { d: Deliverable; canEdit: boolean }) {
  const update = useUpdateDeliverable(d.project_id)
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState(d.delivery_link ?? '')
  if (!d.delivery_link && !canEdit) return null
  return (
    <section className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link sent to the client</h3>
      {editing ? (
        <form
          className="mt-1.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            update.mutate({ deliverableId: d.id, patch: { delivery_link: url.trim() || null } }, { onSuccess: () => setEditing(false) })
          }}
        >
          <Input autoFocus type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" />
          <Button type="submit" size="sm" disabled={update.isPending}>
            Save
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel">
            <X />
          </Button>
        </form>
      ) : d.delivery_link ? (
        <div className="mt-1.5 flex items-center gap-2">
          <a href={d.delivery_link} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-primary hover:underline">
            <ExternalLink className="size-4 shrink-0" aria-hidden /> <span className="truncate">{d.delivery_link}</span>
          </a>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-1.5 text-sm font-medium text-primary hover:underline">
          + Add the link
        </button>
      )}
    </section>
  )
}

function Timeline({ d, me, canModerate }: { d: Deliverable; me: string | null; canModerate: boolean }) {
  const { data, isLoading, isError } = useDeliverableNotes(d.id)
  const del = useDeleteDeliverableNote(d.id)
  const confirm = useConfirm()
  const end = useRef<HTMLDivElement>(null)
  const notes = data ?? []
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [notes.length])

  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes &amp; history</h3>
      {isLoading ? (
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
        </div>
      ) : isError ? (
        <p className="mt-2 text-sm text-destructive">Could not load the notes.</p>
      ) : notes.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          No notes yet. Send the editor a voice note or a message — they’ll be notified.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {notes.map((n) => (
            <NoteItem
              key={n.id}
              n={n}
              mine={!!me && n.author_id === me}
              onDelete={
                n.kind !== 'event' && ((!!me && n.author_id === me) || canModerate)
                  ? async () => {
                      if (await confirm({ title: 'Delete this note?', destructive: true, confirmLabel: 'Delete' })) del.mutate(n.id)
                    }
                  : undefined
              }
            />
          ))}
        </ol>
      )}
      <div ref={end} />
    </section>
  )
}

function NoteItem({ n, mine, onDelete }: { n: DeliverableNote; mine: boolean; onDelete?: (() => void) | undefined }) {
  if (n.kind === 'event') {
    const to = stageOf((n.body ?? '').replace('moved:', ''))
    return (
      <li className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>
          <span className="font-medium text-foreground/80">{n.author_name ?? 'Someone'}</span> moved it to{' '}
          <span className="font-medium text-foreground/80">{STAGE_LABEL[to]}</span> · {when(n.created_at)}
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </li>
    )
  }
  return (
    <li className={cn('group flex items-end gap-2', mine && 'flex-row-reverse')}>
      {!mine && <Avatar name={n.author_name ?? '?'} size="sm" />}
      <div className={cn('flex max-w-[85%] flex-col gap-1', mine && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm',
            mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted',
          )}
        >
          {n.kind === 'voice' ? (
            <VoiceNotePlayer fileId={n.file_id} seconds={n.duration_seconds} tone={mine ? 'inverse' : 'default'} />
          ) : (
            <p className="whitespace-pre-wrap break-words">{n.body}</p>
          )}
        </div>
        <span className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          {!mine && <span className="font-medium">{n.author_name ?? 'Someone'}</span>}
          {when(n.created_at)}
          {onDelete && (
            <button type="button" onClick={onDelete} className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100" aria-label="Delete note">
              <Trash2 className="size-3" />
            </button>
          )}
        </span>
      </div>
    </li>
  )
}

/** Write a note or record a voice note. Enter sends; Shift+Enter is a new line. */
function Composer({ deliverableId, editorName }: { deliverableId: string; editorName: string | null | undefined }) {
  const add = useAddDeliverableNote(deliverableId)
  const voice = useSendVoiceNote(deliverableId)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)

  const send = () => {
    const body = text.trim()
    if (!body) return
    add.mutate({ kind: 'text', body }, { onSuccess: () => setText('') })
  }

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="flex items-end gap-2">
        {!recording && (
          <Textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={editorName ? `Message ${editorName.split(' ')[0]}…` : 'Write a note…'}
            aria-label="Write a note"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl bg-background py-2.5 text-sm"
          />
        )}
        {text.trim() && !recording ? (
          <Button size="icon" className="rounded-full" onClick={send} disabled={add.isPending} aria-label="Send note">
            <Send />
          </Button>
        ) : (
          <div className={cn(recording && 'flex-1')}>
            <VoiceNoteRecorder
              sending={voice.isPending}
              onBusyChange={setRecording}
              onSend={(blob, seconds) => voice.mutateAsync({ blob, seconds })}
            />
          </div>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        {editorName ? `${editorName} gets a notification.` : 'The project owner gets a notification.'} Tap the mic to send a voice note.
      </p>
    </div>
  )
}
