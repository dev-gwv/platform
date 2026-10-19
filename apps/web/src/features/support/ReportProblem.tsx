import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Camera, CheckCircle2, ImagePlus, Loader2, Send, X } from 'lucide-react'
import type { SupportKind } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Textarea } from '@/shared/ui/input'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useCreateSupportRequest } from './api'

/**
 * Report a problem / ask the team (0271). Anyone signed in can open it -- from the help bubble, the sidebar
 * Help, the assistant when it hands over, or a "Couldn't show" screen -- with `openReportProblem()`. What they
 * write, the page they are on and their screenshots reach our team at once (bell, email, the support Sheet),
 * and the answer comes back to Your requests and their bell.
 */
export interface ReportPrefill {
  body?: string
  kind?: SupportKind
  /** The assistant's conversation, carried to the team (not shown in the box). */
  context?: string
}

type Listener = (p: ReportPrefill) => void
const listeners = new Set<Listener>()
/** Opens the Report a problem dialog from anywhere in the app. */
export function openReportProblem(prefill: ReportPrefill = {}) {
  listeners.forEach((l) => l(prefill))
}

const KINDS: { value: SupportKind; label: string }[] = [
  { value: 'problem', label: 'Something isn’t working' },
  { value: 'question', label: 'A question' },
  { value: 'billing', label: 'My plan or a payment' },
  { value: 'idea', label: 'An idea' },
]
const MAX_SHOTS = 3

/** Mounted once in the app shell; listens for openReportProblem(). */
export function ReportProblemHost() {
  const [prefill, setPrefill] = useState<ReportPrefill | null>(null)
  useEffect(() => {
    const l: Listener = (p) => setPrefill({ ...p })
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return <ReportProblemDialog prefill={prefill} onClose={() => setPrefill(null)} />
}

function ReportProblemDialog({ prefill, onClose }: { prefill: ReportPrefill | null; onClose: () => void }) {
  const open = !!prefill
  const send = useCreateSupportRequest()
  const [kind, setKind] = useState<SupportKind>('problem')
  const [text, setText] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([])
  const [capturing, setCapturing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sentId, setSentId] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!prefill) return
    setKind(prefill.kind ?? 'problem')
    setText(prefill.body ?? '')
    setUrgent(false)
    setShots([])
    setProblem(null)
    setSentId(null)
  }, [prefill])
  // What was typed survives a refresh until it is sent (not the screenshots).
  const draft = useFormDraft(open && !sentId && !prefill?.body ? 'report-problem' : null, text, setText)
  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots])

  const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

  /** One frame of the screen; the dialog steps aside while the browser asks which tab to share. */
  async function capture() {
    setProblem(null)
    setCapturing(true)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      await video.play()
      await new Promise((r) => setTimeout(r, 250))
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      stream.getTracks().forEach((t) => t.stop())
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (blob) setShots((s) => [...s, { blob, url: URL.createObjectURL(blob) }].slice(0, MAX_SHOTS))
    } catch {
      setProblem('The screen was not shared. You can attach a picture instead.')
    } finally {
      setCapturing(false)
    }
  }

  function attach(files: FileList | null) {
    if (!files) return
    const next = [...shots]
    for (const file of Array.from(files)) {
      if (next.length >= MAX_SHOTS) break
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        setProblem('Please pick PNG, JPG or WebP pictures.')
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        setProblem(`${file.name} is over 10 MB.`)
        continue
      }
      next.push({ blob: file, url: URL.createObjectURL(file) })
    }
    setShots(next)
  }

  async function submit() {
    if (text.trim().length < 5) {
      setProblem('Tell us what happened in a sentence or two.')
      return
    }
    const out = await send.mutateAsync({ kind, body: text, urgent, screenshots: shots.map((s) => s.blob), ...(prefill?.context ? { context: prefill.context } : {}) })
    draft.clear()
    setSentId(out.items[0]?.id ?? 'sent')
  }

  return (
    <Dialog open={open && !capturing} onOpenChange={(o) => !capturing && !o && onClose()}>
      <DialogContent className="max-w-md" title="Tell the team" description="A person on the Studio AutoPilot team reads this. We answer in Your requests, usually within a working day.">
        {sentId ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-tone-green-soft text-tone-green">
              <CheckCircle2 className="size-6" aria-hidden />
            </span>
            <p className="text-base font-semibold">Sent to the team</p>
            <p className="text-sm text-muted-foreground">We will answer in Your requests, and your bell will ring.</p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" asChild onClick={onClose}>
                <Link to="/support-requests">Your requests</Link>
              </Button>
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What is it about?">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    kind === k.value ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border text-muted-foreground hover:border-primary/50',
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              What happened?
              <Textarea
                rows={4}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={kind === 'problem' ? 'e.g. I press Save on the quotation and nothing happens.' : 'Write it the way you would on WhatsApp.'}
                className={cn('text-sm', !text.trim() && 'border-warning/60')}
              />
            </label>
            {prefill?.context && <p className="-mt-2 text-xs text-muted-foreground">Your chat with the assistant goes with it, so you don’t have to type it again.</p>}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Show us the screen (optional)</span>
              {shots.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {shots.map((s, i) => (
                    <div key={s.url} className="relative overflow-hidden rounded-lg border border-border">
                      <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-20 w-full bg-muted object-cover" />
                      <Button size="icon" variant="secondary" className="absolute right-1 top-1 size-6" aria-label="Remove this screenshot" onClick={() => setShots((all) => all.filter((x) => x !== s))}>
                        <X />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {shots.length < MAX_SHOTS && (
                <div className="flex flex-wrap gap-2">
                  {canCapture && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void capture()}>
                      <Camera /> Capture this screen
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => picker.current?.click()}>
                    <ImagePlus /> Attach a picture
                  </Button>
                  <input ref={picker} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { attach(e.target.files); e.target.value = '' }} />
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
              It is stopping my work today
            </label>

            {problem && (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={send.isPending}>
                {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send to the team
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
