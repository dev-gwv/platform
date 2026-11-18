import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { CalendarDays, Check, FileUp, Loader2, ScanLine, UserRound } from 'lucide-react'
import {
  z,
  client as clientSchema,
  quotationImportState,
  quotationReading,
  quotationTasksResult,
  type QuotationReading,
  type QuotationTasksResult,
} from '@ipc/contracts'
import { ApiError, callApi, postForm } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import { quoteDay } from '@ipc/domain'
import { useDeliverableTypeList } from './api'
import { shootDeliverables, toNewClientRequest, toProjectRequest, toShootRequests } from './wizard'
import { readingToDraft } from './quotation-import'

const idOnly = z.object({ id: z.string() })

/** Is the upload on for this studio (0311: one studio first). */
export function useQuotationImport() {
  const access = useAccess()
  const can = access.hasAction('projects', 'create')
  const q = useQuery({
    queryKey: ['projects', 'quotation-import'],
    queryFn: () => callApi('/projects/quotation-import', { responseSchema: quotationImportState }),
    enabled: can,
    staleTime: 10 * 60_000,
  })
  return can && !!q.data?.enabled
}

type Stage =
  | { at: 'pick'; error?: string }
  | { at: 'reading'; file: string }
  | { at: 'making'; reading: QuotationReading; step: string }
  | { at: 'done'; projectId: string; name: string; reading: QuotationReading; tasks: QuotationTasksResult['tasks']; missed: string[] }

const TASK_WORDS: Record<QuotationTasksResult['tasks'][number]['kind'], string> = {
  edit: 'Video editor',
  data_copy: 'Admin',
  e_invite: 'Manager',
  event_timeline: 'Manager',
}

/**
 * Upload quotation (owner, 18 Nov; 0311): the sales team drops the studio's
 * quotation here and the project makes itself -- client, events with their
 * team, deliverables dated from the quotation's delivery times -- then the
 * team gets its tasks by role. No review screen: the project is made at once
 * and opens, and anything to change is changed there as usual.
 */
export function QuotationUploadButton() {
  const on = useQuotationImport()
  const [open, setOpen] = useState(false)
  if (!on) return null
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="border-primary/50 text-primary">
        <ScanLine /> Upload quotation
      </Button>
      {open && <QuotationUploadDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function QuotationUploadDialog({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<Stage>({ at: 'pick' })
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const types = useDeliverableTypeList()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const busy = stage.at === 'reading' || stage.at === 'making'

  async function start(file: File) {
    setStage({ at: 'reading', file: file.name })
    let reading: QuotationReading
    try {
      reading = quotationReading.parse(
        await postForm('/projects/quotation/read', () => {
          const f = new FormData()
          f.append('file', file)
          return f
        }),
      )
    } catch (e) {
      setStage({ at: 'pick', error: e instanceof Error ? e.message : 'The quotation could not be read.' })
      return
    }
    if (reading.events.length === 0 && reading.deliverables.length === 0) {
      setStage({ at: 'pick', error: 'No events or deliverables were found in this file. Is it the quotation?' })
      return
    }
    await make(reading)
  }

  /** The same calls Create project makes, in the same order. */
  async function make(reading: QuotationReading) {
    const draft = readingToDraft(reading, types)
    const missed: string[] = []
    try {
      setStage({ at: 'making', reading, step: 'Adding the client' })
      const newClient = toNewClientRequest(draft)
      let clientId: string
      try {
        clientId = (await callApi('/clients', { method: 'POST', body: newClient, responseSchema: clientSchema })).id
      } catch (e) {
        // The same phone is already a client: the project goes to them.
        const existing = e instanceof ApiError && e.status === 409 ? existingClientId(e.message) : null
        if (!existing) throw e
        clientId = existing
      }

      setStage({ at: 'making', reading, step: 'Making the project' })
      const { id } = await callApi('/projects', { method: 'POST', body: toProjectRequest(draft, clientId), responseSchema: idOnly })

      setStage({ at: 'making', reading, step: 'Adding the events and their team' })
      const perShoot = shootDeliverables(draft)
      for (const { draftIndex, ...shoot } of toShootRequests(draft, id)) {
        try {
          const made = await callApi('/shoots', { method: 'POST', body: shoot, responseSchema: idOnly })
          for (const d of perShoot.get(draftIndex) ?? []) {
            await callApi(`/projects/${id}/deliverables`, { method: 'POST', body: { ...d, shoot_id: made.id }, responseSchema: idOnly }).catch(() =>
              missed.push(d.title),
            )
          }
        } catch {
          missed.push(shoot.name)
        }
      }

      setStage({ at: 'making', reading, step: 'Giving the team their tasks' })
      let tasks: QuotationTasksResult['tasks'] = []
      try {
        tasks = (await callApi(`/projects/${id}/quotation-tasks`, { method: 'POST', responseSchema: quotationTasksResult })).tasks
      } catch {
        missed.push('the team’s tasks')
      }
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['shoots'] })
      setStage({ at: 'done', projectId: id, name: draft.name, reading, tasks, missed })
    } catch (e) {
      setStage({ at: 'pick', error: e instanceof Error ? e.message : 'The project could not be made.' })
    }
  }

  const pickFile = (files: FileList | null) => {
    const f = files?.[0]
    if (f) void start(f)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={stage.at === 'done' ? `${stage.name} is ready` : 'Upload quotation'}
        description={
          stage.at === 'done'
            ? 'The project, its events and deliverables are made, and the team has its tasks.'
            : 'The project, its events, deliverables and the team’s tasks are made from it.'
        }
        className="max-w-xl"
        data-testid="quotation-upload"
      >
        {stage.at === 'pick' && (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                pickFile(e.dataTransfer.files)
              }}
              className={cn(
                'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors',
                dragging ? 'border-primary bg-primary/10' : 'border-tone-amber bg-tone-amber-soft hover:bg-tone-amber-soft/70',
              )}
            >
              <FileUp className="size-8 text-primary" aria-hidden />
              <span className="font-semibold">Choose the quotation</span>
              <span className="text-sm text-muted-foreground">PDF or a photo of it · drop it here</span>
            </button>
            <input
              ref={input}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => pickFile(e.target.files)}
              data-testid="quotation-file"
            />
            {stage.error && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{stage.error}</p>}
          </>
        )}

        {(stage.at === 'reading' || stage.at === 'making') && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="font-semibold">{stage.at === 'reading' ? 'Reading the quotation…' : stage.step + '…'}</p>
            <p className="text-sm text-muted-foreground">
              {stage.at === 'reading' ? 'This takes up to a minute for a long PDF.' : `${stage.reading.client_name ?? 'The client'} · ${stage.reading.events.length} events · ${stage.reading.deliverables.length} deliverables`}
            </p>
          </div>
        )}

        {stage.at === 'done' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              <span className="font-semibold">{stage.reading.events.length} events</span>, <span className="font-semibold">{stage.reading.deliverables.length} deliverables</span>
              {stage.tasks.length > 0 && (
                <>
                  {' '}and <span className="font-semibold">{stage.tasks.length} tasks</span> given out:
                </>
              )}
            </p>
            {stage.tasks.length > 0 && (
              <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto" data-testid="quotation-tasks">
                {[...stage.tasks].sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9')).map((t) => (
                  <li key={t.id} className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.title}</p>
                      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="size-3" aria-hidden />
                          {t.who.length ? t.who.join(', ') : <span className="text-tone-amber">{TASK_WORDS[t.kind]} · nobody yet</span>}
                        </span>
                        {t.due_date && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="size-3" aria-hidden /> {quoteDay(t.due_date)}
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {stage.missed.length > 0 && (
              <p className="rounded-md border border-tone-amber bg-tone-amber-soft px-3 py-2 text-sm">
                Not saved: {stage.missed.join(', ')}. Add {stage.missed.length === 1 ? 'it' : 'them'} on the project.
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  onClose()
                  void navigate({ to: '/projects/$id', params: { id: stage.projectId } })
                }}
              >
                Open the project
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The client a 409 "already a client" names, when it does. */
function existingClientId(message: string): string | null {
  try {
    const body = JSON.parse(message) as { existing_client?: { id?: unknown } }
    return typeof body.existing_client?.id === 'string' ? body.existing_client.id : null
  } catch {
    return null
  }
}
