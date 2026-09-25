import { useState, type ChangeEvent } from 'react'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ExpenseAttachment } from '@ipc/contracts'
import { uploadFile } from '@/shared/api/client'
import { useFileBlobUrl } from '@/shared/hooks/use-file-blob-url'
import { Button } from '@/shared/ui/button'
import { useAddExpenseAttachment, useDeleteExpenseAttachment, useExpenseAttachments } from '@/features/financials/api'

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'

/**
 * The bills behind an expense: a photo of the receipt or the vendor's PDF.
 * Uploaded privately (a bill is not a public asset) and shown as thumbnails
 * fetched with the session, the way voice notes are.
 */
export function ReceiptsPanel({ expenseId, canEdit = true }: { expenseId: string; canEdit?: boolean }) {
  const { data, isLoading } = useExpenseAttachments(expenseId)
  const add = useAddExpenseAttachment()
  const remove = useDeleteExpenseAttachment()
  const [uploading, setUploading] = useState(false)
  const list = data ?? []

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const files = Array.from(input.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    ;(async () => {
      for (const f of files) {
        const stored = await uploadFile(f)
        await add.mutateAsync({ expenseId, file_id: stored.id })
      }
      toast.success(files.length === 1 ? 'Bill attached' : `${files.length} bills attached`)
    })()
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'We could not upload that file.'))
      .finally(() => {
        setUploading(false)
        input.value = ''
      })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="size-4" aria-hidden /> Bills & receipts
        {list.length > 0 && <span className="text-xs font-normal text-muted-foreground">{list.length}</span>}
      </p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : list.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {list.map((a) => (
            <Receipt key={a.id} a={a} onRemove={canEdit ? () => remove.mutate({ attachmentId: a.id, expenseId }) : undefined} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No bill attached yet.</p>
      )}
      {canEdit && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
          <Paperclip className="size-4" aria-hidden />
          {uploading ? 'Uploading…' : 'Add a photo or PDF of the bill'}
          <input type="file" accept={ACCEPT} multiple className="sr-only" disabled={uploading || add.isPending} onChange={onPick} aria-label="Upload a bill" />
        </label>
      )}
    </div>
  )
}

function Receipt({ a, onRemove }: { a: ExpenseAttachment; onRemove?: (() => void) | undefined }) {
  const isImage = !!a.mime_type?.startsWith('image/')
  const { url } = useFileBlobUrl(a.file_id, true, a.file_id ? undefined : (a.file_url ?? undefined))
  const open = () => {
    if (url) window.open(url, '_blank', 'noopener')
  }
  return (
    <li className="group relative overflow-hidden rounded-md border border-border bg-muted/40">
      <button type="button" onClick={open} className="flex aspect-square w-full items-center justify-center" title={a.file_name ?? 'Bill'}>
        {isImage && url ? (
          <img src={url} alt={a.file_name ?? 'Bill'} className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 p-2 text-center text-[11px] text-muted-foreground">
            <FileText className="size-6" aria-hidden />
            <span className="line-clamp-2 break-all">{a.file_name ?? 'File'}</span>
          </span>
        )}
      </button>
      {onRemove && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove ${a.file_name ?? 'bill'}`}
          className="absolute right-1 top-1 size-6 bg-card/80 text-destructive opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </li>
  )
}
