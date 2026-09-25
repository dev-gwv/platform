import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Lightbulb, Loader2, Send, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Textarea } from '@/shared/ui/input'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { VoiceNoteRecorder } from '@/features/projects/VoiceNoteRecorder'
import { VoiceNotePlayer } from '@/features/projects/VoiceNotePlayer'
import { useSendFeatureRequest } from './api'

/**
 * "Suggest a feature · सुझाव दें" -- on every screen, in both languages, small
 * enough not to pull the eye from the work but always there. Anyone can say
 * what would help, by typing, by a voice note, or by showing the screen; it
 * goes straight to the people who build the app.
 */
export function SuggestFeatureButton({ variant = 'header' }: { variant?: 'header' | 'menu' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {variant === 'menu' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg border border-tone-amber/30 bg-tone-amber-soft px-3 py-2 text-left"
        >
          <Lightbulb className="size-4 shrink-0 text-tone-amber" aria-hidden />
          <span className="leading-tight">
            <span className="block text-sm font-semibold">Suggest a feature</span>
            <span className="block text-xs text-muted-foreground">सुझाव दें</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Suggest a feature · सुझाव दें"
          title="Suggest a feature · सुझाव दें"
          // One line with room around it: the two-line pill was cramped
          // against its own border.
          className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-tone-amber/40 bg-tone-amber-soft px-3 text-xs font-semibold text-foreground transition-colors hover:border-tone-amber sm:px-4"
        >
          <Lightbulb className="size-4 shrink-0 text-tone-amber" aria-hidden />
          <span className="hidden xl:inline">Suggest a feature</span>
          <span className="hidden text-muted-foreground xl:inline" aria-hidden>
            ·
          </span>
          <span className="hidden font-medium leading-normal sm:inline">सुझाव दें</span>
        </button>
      )}
      <SuggestFeatureDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function Bi({ en, hi }: { en: string; hi: string }) {
  return (
    <span className="leading-tight">
      <span className="block">{en}</span>
      <span className="block text-xs font-normal text-muted-foreground">{hi}</span>
    </span>
  )
}

export function SuggestFeatureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const send = useSendFeatureRequest()
  const [text, setText] = useState('')
  const [voice, setVoice] = useState<{ blob: Blob; seconds: number; url: string } | null>(null)
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [done, setDone] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  // Start clean each time it opens.
  useEffect(() => {
    if (!open) return
    setText('')
    setVoice(null)
    setShot(null)
    setDone(false)
    setProblem(null)
  }, [open])
  // What was typed survives a refresh or a closed tab until it is sent. Only
  // the text: a voice note or a screenshot cannot be kept this way.
  const draft = useFormDraft(open && !done ? 'suggest-feature' : null, text, setText)
  useEffect(() => () => void (voice && URL.revokeObjectURL(voice.url)), [voice])
  useEffect(() => () => void (shot && URL.revokeObjectURL(shot.url)), [shot])

  const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

  /**
   * One frame of the screen, as a PNG. The dialog steps aside while the
   * browser asks which tab to share, so the picture is of the page, not of
   * this box.
   */
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
      if (blob) setShot({ blob, url: URL.createObjectURL(blob) })
    } catch {
      setProblem('The screen was not shared. You can attach a picture instead.')
    } finally {
      setCapturing(false)
    }
  }

  function attach(file: File | undefined) {
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setProblem('Please pick a PNG, JPG or WebP picture.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setProblem('That picture is over 10 MB.')
      return
    }
    setProblem(null)
    setShot({ blob: file, url: URL.createObjectURL(file) })
  }

  const empty = !text.trim() && !voice && !shot

  async function submit() {
    if (empty) {
      setProblem('Write a line, record a voice note, or add a screenshot. · कुछ लिखें, बोलें या स्क्रीनशॉट जोड़ें।')
      return
    }
    await send.mutateAsync({ body: text, voice: voice && { blob: voice.blob, seconds: voice.seconds }, screenshot: shot?.blob ?? null })
    draft.clear()
    setDone(true)
  }

  return (
    <Dialog open={open && !capturing} onOpenChange={(o) => !capturing && onOpenChange(o)}>
      <DialogContent className="max-w-md" title="Suggest a feature · सुझाव दें" description="Tell us what would make your work easier. We read every one. · आपके काम को आसान बनाने के लिए क्या चाहिए, बताइए।">
        {done ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-tone-green-soft text-tone-green">
              <Lightbulb className="size-6" aria-hidden />
            </span>
            <p className="text-base font-semibold">Thank you · धन्यवाद</p>
            <p className="text-sm text-muted-foreground">We read every suggestion. · हम हर सुझाव पढ़ते हैं।</p>
            <Button className="mt-3" onClick={() => onOpenChange(false)}>
              Close · बंद करें
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <Bi en="What would help you?" hi="आपको क्या मदद करेगा?" />
              <Textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Send the album selection link on WhatsApp · जैसे: एल्बम सिलेक्शन लिंक WhatsApp पर भेजें"
                className="text-sm"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                <Bi en="Or say it in a voice note" hi="या वॉइस नोट में बोलिए" />
              </span>
              {voice ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <VoiceNotePlayer src={voice.url} seconds={voice.seconds} />
                  </div>
                  <Button size="icon" variant="ghost" aria-label="Remove the voice note" onClick={() => setVoice(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <VoiceNoteRecorder
                  sending={false}
                  maxSeconds={180}
                  sendLabel="Use this · रखें"
                  onSend={async (blob, seconds) => setVoice({ blob, seconds, url: URL.createObjectURL(blob) })}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                <Bi en="Show us the screen" hi="स्क्रीन दिखाइए" />
              </span>
              {shot ? (
                <div className="relative overflow-hidden rounded-lg border border-border">
                  <img src={shot.url} alt="Your screenshot" className="max-h-48 w-full object-contain bg-muted" />
                  <Button size="icon" variant="secondary" className="absolute right-2 top-2 size-7" aria-label="Remove the screenshot" onClick={() => setShot(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {canCapture && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void capture()}>
                      <Camera /> Capture this screen · स्क्रीन कैप्चर करें
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => picker.current?.click()}>
                    <ImagePlus /> Attach image · तस्वीर जोड़ें
                  </Button>
                  <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => attach(e.target.files?.[0])} />
                </div>
              )}
            </div>

            {problem && (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={send.isPending}>
                {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send · भेजें
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
