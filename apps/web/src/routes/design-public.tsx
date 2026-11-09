import { useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { DesignPageView } from '@/features/designer/DesignPageView'
import { PrintCopy, Scaled } from '@/features/designer/Sheets'
import { loadDesignerFonts } from '@/features/designer/fonts'
import { usePublicDesign } from '@/features/designer/api'

/**
 * The client's copy of a quotation design (0296), from the link the studio
 * sent: every shown page, sized to the phone, and Download PDF. Read only;
 * opening it tells the studio "Opened".
 */
export function DesignPublicPage() {
  const { token } = useParams({ from: '/d/$token' })
  const q = usePublicDesign(token)
  useEffect(() => {
    loadDesignerFonts()
  }, [])
  useEffect(() => {
    if (q.data) document.title = q.data.title
  }, [q.data])

  if (q.isPending)
    return (
      <div className="mx-auto max-w-3xl p-4">
        <SkeletonList rows={3} />
      </div>
    )
  if (q.isError || !q.data)
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">This link is not available</h1>
        <p className="text-sm text-muted-foreground">Please ask the studio to send it again.</p>
      </div>
    )

  const doc = q.data.doc
  const pages = doc.pages.filter((p) => !p.hidden)
  return (
    <div className="min-h-screen" style={{ background: '#2a2a2a' }}>
      <div className="designer-screen sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-black/70 px-4 py-2 text-white backdrop-blur">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {q.data.title}
          {q.data.studio && <span className="text-white/60"> · {q.data.studio}</span>}
        </h1>
        <Button size="sm" onClick={() => window.print()}>
          <Download /> Download PDF
        </Button>
      </div>
      <div className="designer-screen mx-auto flex max-w-[794px] flex-col items-center gap-4 px-2 py-4 sm:gap-6 sm:py-6">
        {pages.map((p) => (
          <Scaled key={p.id}>
            <DesignPageView page={p} theme={doc.theme} editable={false} onChange={() => undefined} />
          </Scaled>
        ))}
      </div>
      <PrintCopy doc={doc} />
    </div>
  )
}
