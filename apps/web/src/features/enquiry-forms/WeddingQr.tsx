import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Heart, Pencil, Plus, QrCode, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { EnquiryPartner } from '@ipc/contracts'
import { partnerCounts, slugify } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { downloadQrPng } from '@/shared/ui/qr-download'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { useCreateWeddingQr, useEnquiryHub, usePartners, useUpdatePartner } from './api'
import { DownloadButtons, PrintCardPreview, QrImage } from './parts'

/**
 * Wedding QR codes (owner, 10 Nov; 0299). A partner is a shop or vendor that
 * keeps the studio's QR at its counter; a wedding QR is one the studio prints
 * and places at a client's wedding, so guests who liked the work can enquire.
 * Same form and counts underneath (enquiry_partners, kind 'wedding'), kept in
 * a place of its own and tied to the project it was made for.
 */

/** The words under the code on the printed card. */
export const WEDDING_QR_LINE = 'Loved our work? Scan to book us for your wedding'

/** Who may make and print them: whoever runs the studio's leads (as for partners). */
export function useCanManageWeddingQrs(): boolean {
  const { session } = useAuth()
  const access = useAccess()
  const role = session?.role
  const runs = (session?.is_owner ?? false) || role === 'super_admin' || role === 'admin' || role === 'manager' || role === 'platform_admin'
  return runs && access.hasModule('crm')
}

async function downloadWeddingQr(qr: EnquiryPartner, studio: string) {
  try {
    await downloadQrPng(qr.form_url, `${slugify(studio)}-wedding-${slugify(qr.name)}-qr`, studio, WEDDING_QR_LINE)
    toast.success(`${qr.name}'s QR downloaded, ready to print`)
  } catch {
    toast.error('Could not download the QR. Please try again.')
  }
}

/** The hub's "Wedding QR codes" tab: each wedding in a line, and Add wedding QR. */
export function WeddingQrSection({ studio }: { studio: string }) {
  const weddings = usePartners(false, true, 'wedding')
  const [adding, setAdding] = useState(false)
  const rows = weddings.data ?? []
  if (weddings.isPending) return <Skeleton className="h-32" />
  if (weddings.isError) return <ErrorState message="We could not load your wedding QR codes." onRetry={() => void weddings.refetch()} />
  return (
    <section className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title="No wedding QR codes yet"
              description="Print one for a client's wedding and place it at the venue. Guests who scan it are marked as from that wedding."
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus /> Add wedding QR
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add wedding QR
            </Button>
          </div>
          <Card>
            <ul className="divide-y divide-border">
              {rows.map((w) => (
                <WeddingQrRow key={w.id} qr={w} studio={studio} />
              ))}
            </ul>
          </Card>
        </>
      )}
      {adding && <AddWeddingQrDialog studio={studio} onClose={() => setAdding(false)} />}
    </section>
  )
}

/** One wedding: its code, whose it is, how it is doing in a sentence, then Download, Edit and Delete. */
function WeddingQrRow({ qr, studio }: { qr: EnquiryPartner; studio: string }) {
  const update = useUpdatePartner(qr.id)
  const confirm = useConfirm()
  const canExport = useAccess().hasModule('crm_export')
  const [editing, setEditing] = useState(false)
  const remove = async () => {
    const yes = await confirm({
      title: `Delete ${qr.name}'s wedding QR?`,
      description: 'A printed copy stops marking enquiries as from this wedding. Leads it already brought stay as they are.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) update.mutate({ archived: true }, { onSuccess: () => toast.success('Wedding QR deleted') })
  }
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
      <span className="size-14 shrink-0 rounded-xl border border-border bg-white p-1">
        <QrImage url={qr.form_url} label="" />
      </span>
      <span className="min-w-[10rem] flex-1">
        <span className="flex items-center gap-1.5 font-semibold">
          <Heart className="size-4 shrink-0 text-tone-rose" aria-hidden />
          <span className="truncate">{qr.name}</span>
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {partnerCounts(qr.scans, qr.enquiries, qr.booked)}
          {qr.project_id && qr.project_name && (
            <>
              {' · '}
              <Link to="/projects/$id" params={{ id: qr.project_id }} className="text-primary hover:underline">
                {qr.project_name}
              </Link>
            </>
          )}
        </span>
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => void downloadWeddingQr(qr, studio)}>
          <QrCode /> Download for print (HD)
        </Button>
        {canExport && qr.enquiries > 0 && <DownloadButtons query={{ partner_id: qr.id }} />}
        <Button size="icon" variant="outline" aria-label={`Edit ${qr.name}`} title="Edit" onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="hover:border-destructive/50 hover:text-destructive"
          aria-label={`Delete ${qr.name}`}
          title="Delete"
          disabled={update.isPending}
          onClick={() => void remove()}
        >
          <Trash2 />
        </Button>
      </div>
      {editing && <EditWeddingQrDialog qr={qr} onClose={() => setEditing(false)} />}
    </li>
  )
}

/** "Whose wedding?": pick the project, and its QR is made (or the one it has is given back). */
export function AddWeddingQrDialog({
  studio,
  projectId: fixedProject,
  projectName,
  onClose,
}: {
  studio: string
  projectId?: string | undefined
  projectName?: string | null | undefined
  onClose: () => void
}) {
  const make = useCreateWeddingQr()
  const [projectId, setProjectId] = useState(fixedProject ?? '')
  const [label, setLabel] = useState<string | null>(projectName ?? null)
  const [made, setMade] = useState<EnquiryPartner | null>(null)
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={made ? 'Wedding QR ready' : 'Whose wedding?'} className="max-w-md">
        {made ? (
          <div className="flex flex-col items-center gap-3">
            <PrintCardPreview url={made.form_url} studio={studio} line={WEDDING_QR_LINE} />
            <p className="text-center text-sm text-muted-foreground">Guests who scan it are marked as from {made.name}.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wedding-project">The wedding's project</Label>
            <ProjectPicker
              id="wedding-project"
              value={projectId}
              label={label}
              disabled={!!fixedProject}
              onChange={(id, name) => {
                setProjectId(id)
                setLabel(name)
              }}
              className={projectId ? undefined : 'border-warning/60 bg-warning/5'}
            />
          </div>
        )}
        <DialogFooter>
          {made ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              <Button onClick={() => void downloadWeddingQr(made, studio)}>
                <QrCode /> Download for print (HD)
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!projectId || make.isPending}
                onClick={() => make.mutate({ project_id: projectId }, { onSuccess: (qr) => setMade(qr) })}
              >
                {make.isPending ? 'Making…' : 'Make wedding QR'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Rename it, or move it to another project. */
function EditWeddingQrDialog({ qr, onClose }: { qr: EnquiryPartner; onClose: () => void }) {
  const update = useUpdatePartner(qr.id)
  const [name, setName] = useState(qr.name)
  const [projectId, setProjectId] = useState(qr.project_id ?? '')
  const [label, setLabel] = useState<string | null>(qr.project_name)
  const save = () =>
    update.mutate(
      { name: name.trim(), occasion: name.trim(), ...(projectId && projectId !== qr.project_id ? { project_id: projectId } : {}) },
      {
        onSuccess: () => {
          toast.success('Wedding QR saved')
          onClose()
        },
        onError: (e) => toast.error(e instanceof Error && e.message ? e.message : 'We could not save it.'),
      },
    )
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Edit wedding QR" className="max-w-md">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wedding-name">Name on the form</Label>
            <Input id="wedding-name" value={name} maxLength={70} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wedding-edit-project">The wedding's project</Label>
            <ProjectPicker
              id="wedding-edit-project"
              value={projectId}
              label={label}
              onChange={(id, n) => {
                setProjectId(id)
                setLabel(n)
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={name.trim().length < 2 || update.isPending} onClick={save}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One line on a project's Referrals & wishes: "Wedding QR: 42 scans · 6
 * enquiries" with Download, or "Make wedding QR" when it has none. Only for
 * those who run leads; nothing for anyone else.
 */
export function ProjectWeddingQrLine({ projectId, projectName }: { projectId: string; projectName: string }) {
  const can = useCanManageWeddingQrs()
  const weddings = usePartners(false, can, 'wedding')
  const hub = useEnquiryHub()
  const [adding, setAdding] = useState(false)
  if (!can || weddings.isPending) return null
  const studio = hub.data?.studio ?? ''
  const mine = (weddings.data ?? []).find((w) => w.project_id === projectId)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
      <Heart className="size-4 shrink-0 text-tone-rose" aria-hidden />
      {mine ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Wedding QR:</span> {partnerCounts(mine.scans, mine.enquiries, mine.booked)}
          </span>
          <Button size="sm" variant="outline" onClick={() => void downloadWeddingQr(mine, studio)}>
            <QrCode /> Download for print (HD)
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-muted-foreground">Place a QR at the wedding so guests can enquire.</span>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Make wedding QR
          </Button>
        </>
      )}
      {adding && <AddWeddingQrDialog studio={studio} projectId={projectId} projectName={projectName} onClose={() => setAdding(false)} />}
    </div>
  )
}
