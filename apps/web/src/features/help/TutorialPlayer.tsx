import { useRef } from 'react'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { cn } from '@/shared/ui/cn'
import { LANG_LABEL, useHelpLang } from './lang'
import { watchedEnough } from './learning'
import { blurbIn, hasHindi, lengthLabel, posterSrc, titleIn, videoSrc, type HelpLang, type Tutorial } from './tutorials'

/**
 * One tutorial, playing, in a wide dialog. Sound is on: a woman's voice
 * talks through each step over soft music. English or हिन्दी switches the
 * voice and the captions (the same steps);
 * the pick is remembered for the next video. `onWatched` fires once, when
 * nearly all of it has played.
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
  const [lang, setLang] = useHelpLang()
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
        <DialogContent title={titleIn(tutorial, lang)} className="max-w-4xl p-0 sm:max-w-4xl">
          <video
            key={`${tutorial.key}-${lang}`}
            className="aspect-video w-full rounded-t-lg bg-black"
            src={videoSrc(tutorial, lang)}
            poster={posterSrc(tutorial, lang)}
            controls
            autoPlay
            playsInline
            preload="auto"
            onTimeUpdate={(e) => watch(e.currentTarget)}
            onEnded={(e) => watch(e.currentTarget)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{titleIn(tutorial, lang)}</p>
              {blurbIn(tutorial, lang) && <p className="text-sm text-muted-foreground">{blurbIn(tutorial, lang)}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {hasHindi(tutorial) && <LangSwitch lang={lang} onChange={setLang} />}
              {tutorial.seconds > 0 && <span className="text-xs text-muted-foreground">{lengthLabel(tutorial.seconds)}</span>}
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

/** English · हिन्दी, as two bordered chips; the open one filled. */
export function LangSwitch({ lang, onChange, className }: { lang: HelpLang; onChange: (lang: HelpLang) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Language" className={cn('inline-flex rounded-full border border-border bg-card p-0.5', className)}>
      {(['en', 'hi'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          onClick={() => onChange(l)}
          className={cn(
            'rounded-full px-3 py-1 text-sm font-medium transition-colors',
            lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  )
}
