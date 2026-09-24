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
  | { kind: 'error'; message: string; retry: boolean }

/** Why the microphone did not start, in words a person can act on. */
export function micProblem(e: unknown): { message: string; retry: boolean } {
  const name = e instanceof DOMException || e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return {
      message: 'The microphone is blocked for this site. Click the 🔒 (or ⓘ) left of the address, set Microphone to Allow, then tap Try again.',
      retry: true,
    }
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return { message: 'No microphone was found. Plug one in (or check your headset), then try again.', retry: true }
  if (name === 'NotReadableError' || name === 'AbortError')
    return { message: 'Another app is using the microphone. Close it (Zoom, Meet…) and try again.', retry: true }
  return { message: 'The microphone could not start. Try again, or write a note instead.', retry: true }
}

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
  autoStart = false,
  maxSeconds = MAX_SECONDS,
  sendLabel = 'Send',
  compact = false,
}: {
  onSend: (blob: Blob, seconds: number) => Promise<unknown>
  sending: boolean
  /** Tells the composer to hide the text box while recording or previewing. */
  onBusyChange?: (busy: boolean) => void
  /** Start listening as soon as it appears -- "send them a voice brief". */
  autoStart?: boolean
  maxSeconds?: number
  /** The word on the button after listening back; "Use this" where it is kept for later. */
  sendLabel?: string
  /** Just the dot and the mic, where there is no room for the words. */
  compact?: boolean
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
      if ((Date.now() - state.started) / 1000 >= maxSeconds) recorder.current?.stop()
    }, 250)
    return () => window.clearInterval(t)
  }, [state, maxSeconds])

  // Opened to record: start once, on mount.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoStart || autoStarted.current) return
    autoStarted.current = true
    void start()
  }, [autoStart])

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
      setState({ kind: 'error', message: 'This browser cannot record. Write a note instead.', retry: false })
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
      listen(s)
    } catch (e) {
      setState({ kind: 'error', ...micProblem(e) })
    }
  }

  /** A live level, so people can see it is hearing them. */
  const [levels, setLevels] = useState<number[]>(() => Array(12).fill(0))
  const audioCtx = useRef<AudioContext | null>(null)
  function listen(s: MediaStream) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      audioCtx.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      ctx.createMediaStreamSource(s).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        if (ctx.state === 'closed') return
        analyser.getByteFrequencyData(data)
        const bars = Array.from({ length: 12 }, (_, i) => (data[i + 1] ?? 0) / 255)
        setLevels(bars)
        requestAnimationFrame(tick)
      }
      tick()
    } catch {
      /* the meter is a nicety; recording works without it */
    }
  }
  useEffect(() => {
    if (state.kind !== 'recording') {
      void audioCtx.current?.close().catch(() => undefined)
      audioCtx.current = null
    }
  }, [state.kind])

  if (state.kind === 'recording') {
    return (
      <div className="flex w-full items-center gap-3 rounded-full border border-destructive/40 bg-destructive/5 py-1.5 pl-4 pr-1.5">
        <span className="ipc-rec-dot size-3 rounded-full bg-destructive" aria-hidden />
        <span className="text-sm font-semibold tabular-nums text-destructive">
          Recording {clock((now - state.started) / 1000)}
        </span>
        <span className="flex h-6 flex-1 items-center gap-0.5" aria-hidden>
          {levels.map((v, i) => (
            <span key={i} className="w-1 rounded-full bg-destructive/70 transition-[height] duration-75" style={{ height: `${Math.max(12, Math.round(v * 100))}%` }} />
          ))}
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
          <Send /> {sending ? 'Sending…' : sendLabel}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* A red dot and the words: nobody should have to guess this records. */}
      <button
        type="button"
        onClick={() => void start()}
        aria-label="Record a voice note"
        title="Record a voice note"
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-destructive/40 bg-destructive/5 px-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
      >
        <span className="relative flex size-3 items-center justify-center" aria-hidden>
          <span className="absolute size-3 animate-ping rounded-full bg-destructive/30" />
          <span className="size-2.5 rounded-full bg-destructive" />
        </span>
        <Mic className="size-4" aria-hidden />
        <span className={compact ? 'hidden' : 'hidden sm:inline'}>{state.kind === 'error' && state.retry ? 'Try again' : 'Voice note'}</span>
      </button>
      {state.kind === 'error' && (
        <p role="alert" className="max-w-xs rounded-lg bg-destructive/5 px-2.5 py-1.5 text-left text-xs text-destructive">
          {state.message}
        </p>
      )}
    </div>
  )
}
