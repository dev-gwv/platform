import { MessageCircle } from 'lucide-react'
import type { GalleryCover } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useTalkToUs } from '@/features/billing/talk-to-us'
import { NewBadge } from '@/shared/ui/new-badge'
import { coverSentence, coverShare } from './cover-text'

/**
 * Google Drive galleries included in the studio's plan (0307, owner 17 Nov): "4,200 of 25,000 photos kept ·
 * included in your Pro plan until 17 Dec 2026", a bar, and Ask for more photos (WhatsApp: more are sold by the
 * team). Shown in the Google Drive card on the Photo sharing app and on Settings → Gallery.
 */
export function CoverLine({ cover }: { cover: GalleryCover }) {
  const talk = useTalkToUs()
  const share = coverShare(cover)
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3', share >= 0.9 ? 'border-warning/50 bg-warning/5' : 'bg-muted/30')}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        Photos included in your plan <NewBadge feature="galleryCover" />
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full', share >= 0.9 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">{coverSentence(cover)}</p>
      <div>
        <Button size="sm" variant="outline" onClick={() => talk.say('Hi, please add more Google Drive gallery photos to my Studio AutoPilot plan.')}>
          <MessageCircle /> Ask for more photos
        </Button>
      </div>
    </div>
  )
}
