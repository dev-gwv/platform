import { Images, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { SAMPLE_WORDS, samplesLine, type SampleSpot } from './samples'

/**
 * A sample photo tapped (owner, 10 Nov): whose it is, and the two ways to
 * put the studio's own in its place.
 */
export function ReplaceSampleDialog({
  onLibrary,
  onUpload,
  onClose,
}: {
  onLibrary: () => void
  onUpload: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Replace this sample photo" className="sm:max-w-md">
        <p className="text-sm text-muted-foreground">{SAMPLE_WORDS}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onUpload}>
            <Upload /> Upload your own
          </Button>
          <Button onClick={onLibrary}>
            <Images /> From the library
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Send to client and Download PDF while sample photos remain: refused, with
 * how many and a way straight to the first.
 */
export function SamplesLeftDialog({
  spots,
  doing,
  onShow,
  onClose,
}: {
  spots: SampleSpot[]
  doing: 'send' | 'print'
  onShow: () => void
  onClose: () => void
}) {
  const pages = [...new Set(spots.map((s) => s.page))]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={samplesLine(spots.length)} className="sm:max-w-md">
        <p className="text-sm">
          {doing === 'send'
            ? 'Before this goes to your client, put your own photos in place of the samples'
            : 'Before you download the PDF, put your own photos in place of the samples'}{' '}
          (on {pages.length === 1 ? 'page' : 'pages'} {pages.join(', ')}).
        </p>
        <p className="text-sm text-muted-foreground">
          The samples are The Mulberry Weddings&apos; own photos, shown only so you can see the
          look. Pick one from the library or upload your own.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onShow}>Show me</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
