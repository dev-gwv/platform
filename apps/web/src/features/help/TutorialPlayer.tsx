import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { lengthLabel, posterSrc, videoSrc, type Tutorial } from './tutorials'

/** One tutorial, playing, in a wide dialog. Sound is on: it carries a soft music bed. */
export function TutorialPlayer({ tutorial, onClose }: { tutorial: Tutorial | null; onClose: () => void }) {
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
