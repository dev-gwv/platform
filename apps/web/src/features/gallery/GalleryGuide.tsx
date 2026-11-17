import { CircleHelp } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { GoogleDriveIcon } from './GoogleDriveIcon'

/**
 * "How it works" beside the gallery's buttons (owner, 31 Oct: "add a help
 * guide near it so users understand how to use it, and about the Frameline
 * features too"). A press opens it and a click away closes it: never a box
 * that stays on the page. Promises only what Frameline does today (no selfie
 * search until it runs).
 */
const STEPS = [
  { title: 'Create the gallery', text: 'One link and one PIN for this project’s guests.' },
  {
    title: 'Bring the photos in',
    text: 'Import from Google Drive: pick folders, each becomes an album, and it keeps going if you leave the page. Or Open gallery to upload from your computer.',
  },
  { title: 'Share it', text: 'Send to the client on WhatsApp with the link and PIN, or Download QR for the venue. The client’s tracking page shows it too.' },
] as const

export function GalleryGuide() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <CircleHelp /> How it works
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <p className="text-sm font-semibold">How the photo gallery works</p>
        <ol className="mt-2 flex flex-col gap-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-2.5 text-sm">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
              <span>
                <b>{s.title}.</b> <span className="text-muted-foreground">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            <b className="text-foreground">In Frameline</b> (Open gallery): albums, your watermark, the couple’s PIN that shows every photo, guest sign-ups and
            visits, and how long the gallery stays open.
          </p>
          <p className="flex gap-1.5">
            <GoogleDriveIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <b className="text-foreground">Google Drive</b> is connected once by the studio owner, in Settings → Gallery. Frameline sees only the files you pick.
              Standard photos count 1 each, Original files 2. Import from Google Drive comes with Pro and Studio Max.
            </span>
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
