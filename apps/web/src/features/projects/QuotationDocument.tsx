import type { CSSProperties, ReactNode } from 'react'
import { EyeOff, Pencil } from 'lucide-react'
import { parseQuotationTerms } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { formatINR, humanize } from '@/shared/ui/format'

/**
 * The project quotation as a client keeps it — one paper for the studio's
 * preview and the public link, so the two can never drift apart.
 *
 * The anatomy is the studio's old quotation: a brand stripe, a letterhead,
 * who it is for, what is included, when the shoots are, what it costs, and
 * the terms. Everything outside `.paper` is dropped on print (styles.css).
 */

/** The eight sections the studio can show or hide on the client quotation. */
export const QUOTATION_PREFS = [
  { key: 'showBillTo', label: 'Bill to', legacy: 'bill_to' },
  { key: 'showProject', label: 'Project summary', legacy: 'project' },
  { key: 'showDeliverables', label: 'Deliverables', legacy: 'deliverables' },
  { key: 'showDeliverablesEstimated', label: 'Estimated dates on deliverables', legacy: 'deliverables_estimated' },
  { key: 'showEventSchedule', label: 'Event schedule', legacy: 'shoots' },
  { key: 'showShootServices', label: 'Services per shoot', legacy: 'services' },
  { key: 'showCostSummary', label: 'Cost summary', legacy: 'cost' },
  { key: 'showTerms', label: 'Terms & notes', legacy: 'terms' },
] as const

export type QuotationPrefKey = (typeof QUOTATION_PREFS)[number]['key']
export type QuotationPrefs = Record<QuotationPrefKey, boolean>

/**
 * Stored prefs to the eight switches. Anything missing is shown; links issued
 * before the camelCase keys carried snake_case ones, which still count.
 */
export function resolveQuotationPrefs(raw: Record<string, unknown> | null | undefined): QuotationPrefs {
  const src = raw ?? {}
  const out = {} as QuotationPrefs
  for (const p of QUOTATION_PREFS) {
    const v = typeof src[p.key] === 'boolean' ? src[p.key] : src[p.legacy]
    out[p.key] = typeof v === 'boolean' ? v : true
  }
  return out
}

export interface QuotationDocRow {
  id?: string | undefined
  title: string
  estimated_date?: string | null | undefined
  is_additional_charge?: boolean | undefined
  additional_charge_amount?: number | undefined
}

export interface QuotationDocShoot {
  title: string
  date?: string | null | undefined
  time?: string | null | undefined
  city?: string | null | undefined
  services: { name: string; quantity: number }[]
}

export interface QuotationDocumentData {
  studio: {
    name: string
    legalName?: string | null | undefined
    logoUrl?: string | null | undefined
    gstin?: string | null | undefined
    phone?: string | null | undefined
    email?: string | null | undefined
    website?: string | null | undefined
    address?: string | null | undefined
    footerNote?: string | null | undefined
  }
  /** The studio's own colour for the stripe; the app's primary otherwise. */
  brandColor?: string | null | undefined
  /** "Q-1A2B3C4D" — shown with a leading #. */
  number: string
  issuedAt?: string | null | undefined
  client: { name: string | null; phone?: string | null | undefined; email?: string | null | undefined; address?: string | null | undefined }
  project: { name: string; status?: string | null | undefined; createdAt?: string | null | undefined }
  deliverables: QuotationDocRow[]
  /** The second list — anything not on the primary one. */
  additional: QuotationDocRow[]
  shoots: QuotationDocShoot[]
  summary: { packageCost: number; additional: number; total: number; received: number; balance: number }
  /** One point per line; empty means the default terms. */
  terms: string | null
  notes?: string | null | undefined
}

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** A calendar date is read as local midnight, so it never slips a day. */
export function formatQuotationDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v)
  return Number.isNaN(d.getTime()) ? v : dayFormat.format(d)
}

const serviceList = (s: QuotationDocShoot) =>
  s.services.map((sv) => `${sv.name}${sv.quantity > 1 ? ` ×${sv.quantity}` : ''}`).join(', ')

export function QuotationDocument({
  data,
  prefs,
  onEditTerms,
}: {
  data: QuotationDocumentData
  prefs: QuotationPrefs
  /** The studio's view: an Edit button on the terms, and a note when they are hidden. */
  onEditTerms?: (() => void) | undefined
}) {
  const { studio, client, project, summary } = data
  const number = `#${data.number}`
  const hasAdditional =
    data.additional.length > 0 || data.deliverables.some((d) => d.is_additional_charge) || summary.additional > 0
  const style = data.brandColor ? ({ '--quotation-brand': data.brandColor } as CSSProperties) : undefined

  return (
    <article
      className="paper quotation-paper relative overflow-hidden rounded-xl border border-border bg-card p-5 pt-7 shadow-sm sm:p-10 sm:pt-12"
      style={style}
    >
      <div className="quotation-brand-stripe" aria-hidden />

      {/* A div, not <header>: print hides every <header> as app chrome. */}
      <div className="paper-block flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
        <div className="flex min-w-0 items-start gap-4">
          {studio.logoUrl && (
            <img
              src={studio.logoUrl}
              alt=""
              className="size-14 shrink-0 rounded-md border border-border bg-white object-contain p-1"
            />
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Project Quotation
            </p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{studio.name}</h1>
            {studio.legalName && studio.legalName !== studio.name && (
              <p className="mt-0.5 text-xs text-muted-foreground">{studio.legalName}</p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">Prepared for {client.name ?? 'client'}</p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Quotation No.</p>
          <p className="font-mono text-sm font-semibold">{number}</p>
          <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">Issued</p>
          <p className="text-sm">{formatQuotationDate(data.issuedAt)}</p>
          <div className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
            {studio.gstin && (
              <div>
                GSTIN: <span className="text-foreground">{studio.gstin}</span>
              </div>
            )}
            {studio.phone && <div>{studio.phone}</div>}
            {studio.email && <div className="break-all">{studio.email}</div>}
            {studio.website && <div className="break-all">{studio.website}</div>}
            {studio.address && <div className="whitespace-pre-line">{studio.address}</div>}
          </div>
        </div>
      </div>

      {(prefs.showBillTo || prefs.showProject) && (
        <section className="paper-block grid gap-6 py-6 sm:grid-cols-2">
          {prefs.showBillTo && (
            <SummaryCard title="Bill to">
              {client.name ? (
                <div className="space-y-1 text-sm">
                  <p className="text-base font-semibold">{client.name}</p>
                  {client.phone && <SummaryRow label="Phone" value={client.phone} />}
                  {client.email && <SummaryRow label="Email" value={client.email} />}
                  {client.address && <SummaryRow label="Address" value={client.address} multiline />}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No client linked.</p>
              )}
            </SummaryCard>
          )}
          {prefs.showProject && (
            <SummaryCard title="Project">
              <div className="space-y-1 text-sm">
                <p className="text-base font-semibold">{project.name}</p>
                {project.status && <SummaryRow label="Status" value={humanize(project.status)} />}
                {project.createdAt && <SummaryRow label="Created" value={formatQuotationDate(project.createdAt)} />}
              </div>
            </SummaryCard>
          )}
        </section>
      )}

      {prefs.showDeliverables &&
        (data.deliverables.length === 0 && data.additional.length === 0 ? (
          <section className="paper-block mt-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            Deliverables will be shared separately.
          </section>
        ) : (
          <>
            <DeliverablesBlock title="Deliverables" rows={data.deliverables} showEstimated={prefs.showDeliverablesEstimated} />
            <DeliverablesBlock title="Additional services" rows={data.additional} showEstimated={prefs.showDeliverablesEstimated} />
          </>
        ))}

      {prefs.showEventSchedule && data.shoots.length > 0 && (
        <ShootsBlock shoots={data.shoots} showServices={prefs.showShootServices} />
      )}

      {prefs.showCostSummary && (
        <section className="paper-block mt-8 flex justify-end">
          <div className="w-full max-w-sm rounded-xl border border-border bg-muted/30 p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</h3>
            <TotalsRow label="Package cost" value={formatINR(summary.packageCost)} />
            {hasAdditional && <TotalsRow label="Additional deliverables" value={formatINR(summary.additional)} />}
            <div className="my-3 border-t border-border" />
            <TotalsRow label="Total quotation value" value={formatINR(summary.total)} emphasis />
            {summary.received > 0 && (
              <>
                <div className="my-3 border-t border-dashed border-border" />
                <TotalsRow label="Amount received" value={formatINR(summary.received)} muted />
                <TotalsRow label="Balance pending" value={formatINR(summary.balance)} strong />
              </>
            )}
          </div>
        </section>
      )}

      {prefs.showTerms ? (
        <section className="paper-block mt-10 border-t border-border pt-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terms &amp; notes</h3>
            {onEditTerms && (
              <Button variant="ghost" size="sm" className="no-print h-7 px-2 text-xs" onClick={onEditTerms}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            {parseQuotationTerms(data.terms).map((t, i) => (
              <li key={`${i}-${t.slice(0, 24)}`}>{t}</li>
            ))}
          </ol>
        </section>
      ) : (
        onEditTerms && (
          <section className="no-print mt-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <EyeOff className="size-3.5" /> Terms &amp; notes are hidden from the client.
            </span>
            <Button variant="outline" size="sm" className="h-8" onClick={onEditTerms}>
              <Pencil className="size-3.5" /> Edit terms
            </Button>
          </section>
        )
      )}

      {data.notes && (
        <p className="paper-block mt-4 whitespace-pre-line rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {data.notes}
        </p>
      )}

      <footer className="paper-block mt-8 space-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
        {studio.footerNote && <p className="whitespace-pre-line text-foreground/80">{studio.footerNote}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{studio.name} · Project Quotation</span>
          <span>{number}</span>
        </div>
      </footer>
    </article>
  )
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function SummaryRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className={multiline ? 'min-w-0 whitespace-pre-line' : 'min-w-0 break-words'}>{value}</span>
    </div>
  )
}

const charge = (d: QuotationDocRow) =>
  d.is_additional_charge ? formatINR(Number(d.additional_charge_amount ?? 0)) : 'Included'

function AdditionalPill({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 inline-block rounded-full border border-accent bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
      {children}
    </span>
  )
}

/**
 * A table on a wide screen and on paper; stacked cards on a phone, where
 * three columns would squeeze the titles to a word a line.
 */
function DeliverablesBlock({ title, rows, showEstimated }: { title: string; rows: QuotationDocRow[]; showEstimated: boolean }) {
  if (rows.length === 0) return null
  return (
    <section className="paper-block mt-6">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="quotation-table hidden overflow-x-auto rounded-lg border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Item</th>
              {showEstimated && <th className="px-3 py-2">Estimated</th>}
              <th className="px-3 py-2 text-right">Charge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.id ?? i} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{d.title}</div>
                  {d.is_additional_charge && <AdditionalPill>Additional charge</AdditionalPill>}
                </td>
                {showEstimated && (
                  <td className="px-3 py-2 text-muted-foreground">{formatQuotationDate(d.estimated_date)}</td>
                )}
                <td className="px-3 py-2 text-right font-medium tabular-nums">{charge(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="quotation-cards space-y-2 sm:hidden">
        {rows.map((d, i) => (
          <li key={d.id ?? i} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{d.title}</p>
                {showEstimated && d.estimated_date && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Estimated {formatQuotationDate(d.estimated_date)}</p>
                )}
                {d.is_additional_charge && <AdditionalPill>Additional</AdditionalPill>}
              </div>
              <div className="shrink-0 text-right text-sm font-semibold tabular-nums">{charge(d)}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ShootsBlock({ shoots, showServices }: { shoots: QuotationDocShoot[]; showServices: boolean }) {
  const when = (s: QuotationDocShoot) => `${formatQuotationDate(s.date)}${s.time ? ` · ${s.time.slice(0, 5)}` : ''}`
  return (
    <section className="paper-block mt-6">
      <h3 className="mb-3 text-sm font-semibold">Event schedule</h3>
      <div className="quotation-table hidden overflow-x-auto rounded-lg border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Shoot</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">City</th>
              {showServices && <th className="px-3 py-2">Services</th>}
            </tr>
          </thead>
          <tbody>
            {shoots.map((s, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium">{s.title}</td>
                <td className="px-3 py-2 text-muted-foreground">{when(s)}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.city || '—'}</td>
                {showServices && (
                  <td className="px-3 py-2 text-muted-foreground">{s.services.length ? serviceList(s) : '—'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="quotation-cards space-y-2 sm:hidden">
        {shoots.map((s, i) => (
          <li key={i} className="rounded-lg border border-border bg-card p-3">
            <p className="font-medium">{s.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {when(s)}
              {s.city ? ` · ${s.city}` : ''}
            </p>
            {showServices && s.services.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">{serviceList(s)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function TotalsRow({
  label,
  value,
  emphasis,
  strong,
  muted,
}: {
  label: string
  value: string
  emphasis?: boolean
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={`text-sm ${emphasis ? 'font-semibold' : muted ? 'text-muted-foreground' : ''}`}>{label}</span>
      <span
        className={
          emphasis
            ? 'quotation-total text-lg font-bold tabular-nums text-primary'
            : strong
              ? 'text-sm font-semibold tabular-nums'
              : muted
                ? 'text-sm tabular-nums text-muted-foreground'
                : 'text-sm font-medium tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  )
}
