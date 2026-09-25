import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'

interface HsnData {
  source: string
  /** [code, description] */
  sac: [string, string][]
  /** [code, description, suggested GST rate or null] */
  hsn: [string, string, number | null][]
}

let cache: Promise<HsnData> | null = null
/** 3 MB of codes (about 250 KB over the wire), fetched the first time someone searches, then kept. */
function loadCodes(): Promise<HsnData> {
  cache ??= fetch('/hsn-sac.json').then((r) => {
    if (!r.ok) throw new Error('Could not load the HSN/SAC list.')
    return r.json() as Promise<HsnData>
  })
  cache.catch(() => {
    cache = null
  })
  return cache
}

export interface HsnPick {
  code: string
  description: string
  /** A GST rate the code usually carries, when the list knows one. */
  gstRate: number | null
}

/**
 * Search the government HSN (goods) and SAC (services) lists by code or by
 * words, and pick one into an invoice line -- the way a proper tax invoice
 * tool does, instead of the studio looking codes up on the internet.
 */
export function HsnSearchDialog({
  open,
  onOpenChange,
  onPick,
  initialQuery = '',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (pick: HsnPick) => void
  initialQuery?: string
}) {
  const [kind, setKind] = useState<'sac' | 'hsn'>('sac')
  const [q, setQ] = useState(initialQuery)
  const [data, setData] = useState<HsnData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQ(initialQuery)
    // A goods code is 4-8 digits and not 99xx; a service code starts 99.
    if (/^\d{4,}$/.test(initialQuery) && !initialQuery.startsWith('99')) setKind('hsn')
    loadCodes().then(setData, (e: Error) => setError(e.message))
  }, [open, initialQuery])

  const results = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    const rows: HsnPick[] =
      kind === 'sac'
        ? data.sac.map(([code, description]) => ({ code, description, gstRate: null }))
        : data.hsn.map(([code, description, gstRate]) => ({ code, description, gstRate }))
    if (!needle) return kind === 'sac' ? rows.filter((r) => r.code.length === 6).slice(0, 60) : rows.slice(0, 60)
    if (/^\d+$/.test(needle)) return rows.filter((r) => r.code.startsWith(needle)).slice(0, 100)
    const words = needle.split(/\s+/).filter(Boolean)
    return rows.filter((r) => words.every((w) => r.description.toLowerCase().includes(w))).slice(0, 100)
  }, [data, q, kind])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Find the HSN or SAC code" description="Services use a SAC code (99…). Goods use an HSN code." className="max-w-3xl">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist">
              {(['sac', 'hsn'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => setKind(k)}
                  className={cn('rounded-md px-3 py-1 text-sm font-medium transition-colors', kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
                >
                  {k === 'sac' ? 'SAC · services' : 'HSN · goods'}
                </button>
              ))}
            </div>
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={kind === 'sac' ? 'Type a code or words, e.g. 9983 or photography' : 'Type a code or words, e.g. 4911 or printed'}
                className="pl-9"
                aria-label="Search HSN or SAC"
              />
            </div>
          </div>

          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border">
            {error ? (
              <p className="p-4 text-sm text-destructive">{error}</p>
            ) : !data ? (
              <p className="p-4 text-sm text-muted-foreground">Loading the code list…</p>
            ) : results.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nothing matches “{q}”. Try fewer words, or the first digits of the code.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-28 px-3 py-2 font-semibold">{kind === 'sac' ? 'SAC code' : 'HSN code'}</th>
                    <th className="px-3 py-2 font-semibold">Description</th>
                    {kind === 'hsn' && <th className="w-20 px-3 py-2 text-right font-semibold">GST</th>}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.code + r.description}
                      className="cursor-pointer border-t border-border hover:bg-primary/5"
                      onClick={() => {
                        onPick(r)
                        onOpenChange(false)
                      }}
                    >
                      <td className="px-3 py-2 align-top">
                        <button
                          type="button"
                          className="font-semibold tabular-nums text-primary hover:underline"
                          aria-label={`Use ${r.code}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onPick(r)
                            onOpenChange(false)
                          }}
                        >
                          {r.code}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-foreground">{r.description}</td>
                      {kind === 'hsn' && <td className="px-3 py-2 text-right align-top text-muted-foreground">{r.gstRate != null ? `${r.gstRate}%` : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            From the CBIC HSN/SAC list. GST rates shown for goods are the usual rate for the chapter; check the notification for your exact item.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
