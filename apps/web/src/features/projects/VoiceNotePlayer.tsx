import { useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { useFileBlobUrl } from '@/shared/hooks/use-file-blob-url'

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * A voice note you can play: a round play button, a bar that fills as it
 * plays, and the length. The recording is fetched on the first tap, not when
 * the timeline opens, so ten notes cost nothing until someone listens.
 *
 * `seconds` comes from the recorder: a browser recording often reports no
 * duration of its own until it has been played through once.
 */
export function VoiceNotePlayer({
  fileId,
  path,
  src,
  seconds,
  tone = 'default',
}: {
  fileId?: string | null | undefined
  /** Where to fetch it from, when not /files/:id (the platform inbox). */
  path?: string | undefined
  /** A local recording, before it is sent. */
  src?: string | null | undefined
  seconds?: number | null | undefined
  tone?: 'default' | 'inverse' | undefined
}) {
  const [wanted, setWanted] = useState(false)
  const remote = useFileBlobUrl(src ? null : fileId, wanted, path)
  const url = src ?? remote.url
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const total = seconds && seconds > 0 ? seconds : 0

  // The first tap asks for the file; play once it arrives.
  useEffect(() => {
    if (wanted && url && audio.current && audio.current.paused && !playing) {
      void audio.current.play().catch(() => undefined)
    }
    // Only when the URL first arrives, not on every play/pause.
  }, [url])

  function toggle() {
    const el = audio.current
    if (!url || !el) {
      setWanted(true)
      return
    }
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  }

  const loading = wanted && !url && !remote.error
  const pct = total ? Math.min(100, (at / total) * 100) : 0
  const inverse = tone === 'inverse'

  return (
    <div className={cn('flex min-w-[12rem] items-center gap-2.5 rounded-full py-1 pl-1 pr-3', inverse ? 'bg-primary-foreground/15' : 'bg-muted')}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95',
          inverse ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
        )}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>
      <div className={cn('relative h-1.5 flex-1 overflow-hidden rounded-full', inverse ? 'bg-primary-foreground/25' : 'bg-foreground/10')}>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', inverse ? 'bg-primary-foreground' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('shrink-0 text-xs tabular-nums', inverse ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
        {remote.error ? 'Unavailable' : clock(playing || at > 0 ? at : total)}
      </span>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setAt(0)
          }}
          onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          className="hidden"
        />
      )}
    </div>
  )
}
