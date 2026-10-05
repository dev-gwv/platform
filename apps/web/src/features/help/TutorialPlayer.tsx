import { useRef } from 'react'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { watchedEnough } from './learning'
import { lengthLabel, posterSrc, videoSrc, type Tutorial } from './tutorials'

/**
 * One tutorial, playing, in a wide dialog. Sound is on: it carries a soft
 * music bed. `onWatched` fires once, when nearly all of it has played.
 */
export function TutorialPlayer({
  tutorial,
  onClose,
  onWatched,
}: {
  tutorial: Tutorial | null
  onClose: () => void
  onWatched?: ((key: string) => void) | undefined
}) {
  const told = useRef<string | null>(null)
  const watch = (v: HTMLVideoElement) => {
    if (!tutorial || !onWatched || told.current === tutorial.key) return
    if (watchedEnough(v.currentTime, v.duration)) {
      told.current = tutorial.key
      onWatched(tutorial.key)
    }
  }
  return (
    <Dialog open={!!tutorial} onOpenChange={(o) => !o && onClose()}>
      {tutorial && (
        <DialogContent title={tutorial.title} className="max-w-4xl p-0 sm:max-w-4xl">
          <video
            key={tutorial.key}
            className="aspect-video w-full rounded-t-lg bg-black"
            src={videoSrc(tutorial)}
            poster={posterSrc(tutorial)}
            controls
            autoPlay
            playsInline
            preload="auto"
            onTimeUpdate={(e) => watch(e.currentTarget)}
            onEnded={(e) => watch(e.currentTarget)}
          />
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-semibold">{tutorial.title}</p>
              {tutorial.blurb && <p className="text-sm text-muted-foreground">{tutorial.blurb}</p>}
            </div>
            {tutorial.seconds > 0 && <span className="shrink-0 text-xs text-muted-foreground">{lengthLabel(tutorial.seconds)}</span>}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
