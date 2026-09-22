import { useRef, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import type { CsvImportPreviewResponse } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useAccess } from '@/shared/auth/useAccess'
import { useImportCommit, useImportPreview } from '../api'
import { WorkflowsSection } from './WorkflowsSection'
import { CadencesSection } from './CadencesSection'

const SAMPLE = 'name,phone,email,notes\nPriya Sharma,9876543210,priya@example.in,Wedding in December\n'

/**
 * CSV import, then cadences and automations — the ways leads get into and
 * through the pipeline without anyone typing them.
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
      <CadencesSection />
      <WorkflowsSection />
    </div>
  )
}

function CsvImport() {
  const [csv, setCsv] = useState('')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
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
    const rows = preview.rows
      .filter((r) => r.valid && !!r.phone)
      .map((r) => ({ name: r.name, phone: r.phone!, email: r.email, source: r.source, notes: r.notes }))
    commit.mutate(
      { mode: "skip", rows, skip_duplicates: skipDuplicates },
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
            Export a CSV with a header row. Columns are matched by name — phone, name, email, notes, source — and only the phone is required.
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
                <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                Skip numbers already in the CRM
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
                      <td className="px-2 py-1.5">
                        {!p.valid ? (
                          <span className="text-destructive">{p.error}</span>
                        ) : p.is_duplicate ? (
                          <span className="text-warning">{p.error ?? 'Already in the CRM'}{skipDuplicates ? ' · skipped' : ' · will duplicate'}</span>
                        ) : (
                          <span className="text-success">Will import</span>
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
