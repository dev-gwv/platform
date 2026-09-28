import { useRef, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import type { CsvImportPreviewResponse } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useImportCommit, useImportPreview } from '../api'
import { WorkflowsSection } from './WorkflowsSection'

// Shows the columns that are read, including the ones the importer used to
// drop -- a sample that only demonstrates five teaches a studio to send five.
const SAMPLE = [
  'name,phone,email,event type,event date,venue,city,deal value,quality,notes',
  'Priya Sharma,9876543210,priya@example.in,Wedding,12/03/2027,Taj Lands End,Mumbai,"1,50,000",hot,Wants candid + album',
  'Rohan Mehta,9812345678,,Pre-wedding,05 Apr 2027,Lodhi Garden,Delhi,75000,warm,Asked about drone',
  '',
].join('\n')

/**
 * CSV import, then automations — the ways leads get into and through the
 * pipeline without anyone typing them. Sequences have their own section.
 */
export function ImportsTab() {
  const access = useAccess()
  const canCreate = access.hasAction('crm', 'create')
  return (
    <div className="flex flex-col gap-4">
      {canCreate ? (
        <CsvImport />
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">Importing needs the ability to create leads.</CardContent>
        </Card>
      )}
      <WorkflowsSection />
    </div>
  )
}

/** A shoot date, the way the rest of the CRM prints one. */
const importDateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const showDate = (iso: string) => importDateFormat.format(new Date(`${iso}T00:00:00`))

function CsvImport() {
  const [csv, setCsv] = useState('')
  /**
   * What to do about a number already in the CRM.
   *
   * crm_import_leads has taken skip / update / create since 0107 and this screen
   * only ever sent 'skip', so a studio re-importing a corrected spreadsheet had
   * no way to apply the corrections.
   */
  const [mode, setMode] = useState<'skip' | 'update' | 'create'>('skip')
  const skipDuplicates = mode === 'skip'
  const [preview, setPreview] = useState<CsvImportPreviewResponse | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewIt = useImportPreview()
  const commit = useImportCommit()

  async function onFile(file: File | undefined) {
    if (!file) return
    const text = await file.text()
    setCsv(text)
    setPreview(null)
  }

  function doPreview() {
    previewIt.mutate(csv, { onSuccess: setPreview })
  }

  function doCommit() {
    if (!preview) return
    // Every field the preview showed. This used to send five and drop the rest,
    // so the shoot dates and budgets a studio had in its file were listed in the
    // preview's column line and then thrown away on commit.
    const rows = preview.rows
      .filter((r) => r.valid && !!r.phone)
      .map((r) => ({
        name: r.name,
        phone: r.phone!,
        email: r.email,
        source: r.source,
        notes: r.notes,
        city: r.city,
        event_type: r.event_type,
        event_date: r.event_date,
        event_location: r.event_location,
        deal_value: r.deal_value,
        alternate_phone: r.alternate_phone,
        quality: r.quality,
      }))
    commit.mutate(
      { mode, rows, skip_duplicates: skipDuplicates },
      {
        onSuccess: () => {
          setPreview(null)
          setCsv('')
        },
      },
    )
  }

  const importable = preview ? preview.rows.filter((r) => r.valid && !(skipDuplicates && r.is_duplicate)).length : 0

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <p className="font-medium">Import leads from a spreadsheet</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Export a CSV with a header row. Only the phone is required. Columns are matched by name, and most
            spellings work: <span className="text-foreground">phone, name, email, notes, source, city, event type,
            event date, venue, deal value, alternate phone, quality</span>. Dates are read day-first (12/03/2027 is
            12 March) and ₹1,50,000 is understood.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <FileUp /> Choose CSV file
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCsv(SAMPLE)}>
            Paste a sample
          </Button>
        </div>
        <textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value)
            setPreview(null)
          }}
          rows={6}
          aria-label="CSV text"
          placeholder={SAMPLE}
          className="w-full rounded-md border border-input bg-card p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={doPreview} disabled={!csv.trim() || previewIt.isPending}>
            {previewIt.isPending ? 'Checking…' : 'Preview'}
          </Button>
          {preview && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">A number we already have:</span>
                <Select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                  aria-label="What to do about a number already in the CRM"
                  className="w-auto"
                >
                  <option value="skip">Leave that lead alone</option>
                  <option value="update">Fill in what is missing on it</option>
                  <option value="create">Add a second lead anyway</option>
                </Select>
              </label>
              <Button variant="outline" onClick={doCommit} disabled={importable === 0 || commit.isPending}>
                <Upload /> {commit.isPending ? 'Importing…' : `Import ${importable}`}
              </Button>
            </>
          )}
        </div>

        {preview && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <StatusBadge tone="neutral">{preview.total} rows</StatusBadge>
              <StatusBadge tone="success">{preview.valid} valid</StatusBadge>
              {preview.duplicates > 0 && <StatusBadge tone="warning">{preview.duplicates} already known</StatusBadge>}
              {preview.total - preview.valid > 0 && <StatusBadge tone="danger">{preview.total - preview.valid} with problems</StatusBadge>}
              <span className="text-muted-foreground">Columns: {preview.columns.join(', ')}</span>
            </div>
            <div className="table-wrap rounded-lg border border-border">
              <table className="table-sticky w-full text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Line</th>
                    <th className="px-2 py-1.5 font-medium">Name</th>
                    <th className="px-2 py-1.5 font-medium">Phone</th>
                    <th className="px-2 py-1.5 font-medium">Email</th>
                    <th className="px-2 py-1.5 font-medium">Event</th>
                    <th className="px-2 py-1.5 font-medium">Value</th>
                    <th className="px-2 py-1.5 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((p) => (
                    <tr key={p.row} className={`border-t border-border ${!p.valid ? 'bg-destructive/5' : ''}`}>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{p.row}</td>
                      <td className="px-2 py-1.5">{p.name ?? '—'}</td>
                      <td className="px-2 py-1.5">{p.phone ?? '—'}</td>
                      <td className="px-2 py-1.5">{p.email ?? '—'}</td>
                      {/* Shown because they are now saved. A studio should be
                          able to see the date it is about to commit. */}
                      <td className="px-2 py-1.5">
                        {[p.event_type, p.event_date ? showDate(p.event_date) : null].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{p.deal_value === null ? '—' : formatINR(p.deal_value)}</td>
                      <td className="px-2 py-1.5">
                        {!p.valid ? (
                          <span className="text-destructive">{p.error}</span>
                        ) : p.is_duplicate ? (
                          <span className="text-warning">{p.error ?? 'Already in the CRM'}{skipDuplicates ? ' · skipped' : ' · will duplicate'}</span>
                        ) : (
                          <span className="text-success">Will import</span>
                        )}
                        {p.warnings.length > 0 && (
                          <span className="block text-warning">{p.warnings.join(' · ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
