import { useEffect, useRef, useState } from 'react'
import { Mic, Send, Square, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { clock, VoiceNotePlayer } from './VoiceNotePlayer'

/** Five minutes is a long voice note; past that, write it down. */
const MAX_SECONDS = 300

/** The first format this browser can record: Chrome/Firefox webm, Safari mp4. */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m))
}

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; started: number }
  | { kind: 'preview'; blob: Blob; url: string; seconds: number }
  | { kind: 'error'; message: string }

/**
 * Record a voice note in place: tap the mic, talk, tap stop, listen back, send.
 *
 * The microphone is asked for only on the first tap, and released the moment
 * recording stops, so the browser's "recording" light never stays on.
 */
export function VoiceNoteRecorder({
  onSend,
  sending,
  onBusyChange,
}: {
  onSend: (blob: Blob, seconds: number) => Promise<unknown>
  sending: boolean
  /** Tells the composer to hide the text box while recording or previewing. */
  onBusyChange?: (busy: boolean) => void
}) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [now, setNow] = useState(Date.now())
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)

  useEffect(() => onBusyChange?.(state.kind === 'recording' || state.kind === 'preview'), [state.kind, onBusyChange])

  // Tick the timer while recording, and stop at the limit.
  useEffect(() => {
    if (state.kind !== 'recording') return
    const t = window.setInterval(() => {
      setNow(Date.now())
      if ((Date.now() - state.started) / 1000 >= MAX_SECONDS) recorder.current?.stop()
    }, 250)
    return () => window.clearInterval(t)
  }, [state])

  // Let go of the microphone and any preview if the panel closes mid-way.
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop())
      if (recorder.current?.state === 'recording') recorder.current.stop()
    },
    [],
  )
  useEffect(() => () => void (state.kind === 'preview' && URL.revokeObjectURL(state.url)), [state])

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState({ kind: 'error', message: 'This browser cannot record. Write a note instead.' })
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = s
      const mime = pickMime()
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      const started = Date.now()
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
      rec.onstop = () => {
        s.getTracks().forEach((t) => t.stop())
        stream.current = null
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || 'audio/webm' })
        const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
        setState(blob.size > 0 ? { kind: 'preview', blob, url: URL.createObjectURL(blob), seconds } : { kind: 'idle' })
      }
      recorder.current = rec
      rec.start(250)
      setNow(started)
      setState({ kind: 'recording', started })
    } catch {
      setState({ kind: 'error', message: 'Allow the microphone in your browser to record a voice note.' })
    }
  }

  if (state.kind === 'recording') {
    return (
      <div className="flex w-full items-center gap-3 rounded-full border border-destructive/30 bg-destructive/5 py-1.5 pl-4 pr-1.5">
        <span className="ipc-rec-dot size-2.5 rounded-full bg-destructive" aria-hidden />
        <span className="flex-1 text-sm font-medium tabular-nums text-destructive">
          Recording {clock((now - state.started) / 1000)}
        </span>
        <Button size="sm" variant="destructive" className="rounded-full" onClick={() => recorder.current?.stop()}>
          <Square className="fill-current" /> Stop
        </Button>
      </div>
    )
  }

  if (state.kind === 'preview') {
    return (
      <div className="flex w-full flex-wrap items-center gap-2">
        <div className="flex-1">
          <VoiceNotePlayer src={state.url} seconds={state.seconds} />
        </div>
        <Button size="icon" variant="ghost" aria-label="Discard recording" onClick={() => setState({ kind: 'idle' })} disabled={sending}>
          <Trash2 />
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={sending}
          onClick={() => void onSend(state.blob, state.seconds).then(() => setState({ kind: 'idle' }))}
        >
          <Send /> {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="rounded-full"
        onClick={() => void start()}
        aria-label="Record a voice note"
        title="Record a voice note"
      >
        <Mic />
      </Button>
      {state.kind === 'error' && <span className="text-xs text-destructive">{state.message}</span>}
    </div>
  )
}
