import { Download } from 'lucide-react'
import { Button } from './button'

/**
 * Saving a document as a PDF.
 *
 * There is no PDF generator in this app — not on the server, and no library in
 * the bundle — so the browser's own print pipeline is what exists. It is also
 * better than most of the alternatives: it renders the real stylesheet, the
 * text stays selectable and searchable rather than becoming a picture, and it
 * costs nothing to load on a client-facing page that a stranger opens once.
 * "Save as PDF" is the default destination in every current browser.
 *
 * What it does badly on its own is the FILENAME. Browsers name the saved file
 * after `document.title`, which on every page here is "IPC Studios" — so a
 * client who saves three quotations gets three files called the same thing.
 * This swaps the title for the document's own name while the dialog is open
 * and puts it back afterwards.
 */

/** Windows and macOS both refuse these; a slash would also split the path. */
const unsafe = /[\\/:*?"<>|]/g

export function documentFilename(name: string): string {
  const clean = name
    .replace(unsafe, ' ')
    // Control characters go by code point rather than by regex: a pattern
    // containing them trips no-control-regex, and that rule is usually right
    // because it is normally a typo. Here it is deliberate, so it is spelled
    // out instead.
    .split('')
    .filter((ch) => (ch.codePointAt(0) ?? 0) > 31)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  // Some filesystems stop at 255 bytes; well short of that is plenty.
  return (clean || 'Document').slice(0, 120)
}

function downloadDocument(name: string): void {
  const previous = document.title
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    document.title = previous
    window.removeEventListener('afterprint', restore)
  }

  document.title = documentFilename(name)
  window.addEventListener('afterprint', restore)
  // iOS Safari has historically not fired afterprint at all. Without this the
  // tab keeps the document's name for ever, which looks like a bug on the page
  // behind the dialog.
  window.setTimeout(restore, 120_000)

  window.print()
}

/**
 * The button itself, so every document offers the same thing in the same
 * words. `name` becomes the saved file's name — pass the document's own
 * identity ("Quote QT-0007"), not the page's.
 */
export function DownloadDocumentButton({
  name,
  label = 'Download',
  size = 'sm',
  variant = 'outline',
  className,
}: {
  name: string
  label?: string
  size?: 'sm' | 'default' | 'lg' | 'icon'
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
  className?: string
}) {
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={() => downloadDocument(name)}
      // Said plainly, because a Download button that opens a print dialog is
      // otherwise a surprise.
      title="Save as PDF using your browser's print dialog"
    >
      <Download className="mr-1 size-4" /> {label}
    </Button>
  )
}
