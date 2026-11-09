import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Palette,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import type {
  DesignDoc,
  DesignPage,
  DesignPageData,
  DesignPageKind,
  DesignTheme,
} from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import {
  useDeleteDesign,
  useDesign,
  useDuplicateDesign,
  useSaveDesign,
} from '@/features/designer/api'
import { DesignPageView, PAGE_H, PAGE_W } from '@/features/designer/DesignPageView'
import { loadDesignerFonts } from '@/features/designer/fonts'
import {
  BODY_FONTS,
  HEADING_FONTS,
  PAGE_KIND_NAMES,
  TEMPLATES,
  blankPage,
  pageId,
  templateFor,
} from '@/features/designer/templates'

export function AiDesignerEditPage() {
  const { id } = useParams({ from: '/authed/ai/designer/$id' })
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <Editor key={id} id={id} />
    </AuthedPage>
  )
}

type SaveState = 'saved' | 'waiting' | 'saving' | 'failed'

function Editor({ id }: { id: string }) {
  const q = useDesign(id)
  useEffect(() => {
    loadDesignerFonts()
  }, [])
  if (q.isPending) return <SkeletonList rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <Workspace
      id={id}
      initial={{ title: q.data.title, template: q.data.template, doc: q.data.doc }}
    />
  )
}

interface Draft {
  title: string
  template: string
  doc: DesignDoc
}

function Workspace({ id, initial }: { id: string; initial: Draft }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const save = useSaveDesign(id)
  const dup = useDuplicateDesign()
  const del = useDeleteDesign()
  const [draft, setDraft] = useState<Draft>(initial)
  const [state, setState] = useState<SaveState>('saved')
  const [lookOpen, setLookOpen] = useState(false)
  const pending = useRef<Draft | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const body = pending.current
    if (!body) return
    pending.current = null
    setState('saving')
    save.mutate(
      { title: body.title.trim() || 'Untitled design', template: body.template, doc: body.doc },
      {
        onSuccess: () => setState((s) => (s === 'saving' && !pending.current ? 'saved' : s)),
        onError: () => {
          pending.current ??= body
          setState('failed')
        },
      },
    )
  }, [save])

  const change = useCallback(
    (next: Draft) => {
      setDraft(next)
      pending.current = next
      setState('waiting')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 900)
    },
    [flush],
  )

  // Leaving the page saves what is waiting; closing the tab with it unsaved asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      flush()
    }
  }, [flush])

  const doc = draft.doc
  const setDoc = (d: DesignDoc) => change({ ...draft, doc: d })
  const setPages = (pages: DesignPage[]) => setDoc({ ...doc, pages })
  const setPage = (i: number, p: DesignPage) => setPages(doc.pages.map((x, j) => (j === i ? p : x)))
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= doc.pages.length) return
    const pages = [...doc.pages]
    ;[pages[i], pages[j]] = [pages[j]!, pages[i]!]
    setPages(pages)
  }

  function print() {
    flush()
    window.print()
  }

  return (
    <div className="designer-root">
      <div
        data-sticky-actions
        className="designer-screen no-print sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur"
      >
        <Button asChild variant="ghost" size="sm">
          <Link to="/ai/designer">
            <ArrowLeft /> Designs
          </Link>
        </Button>
        <Input
          value={draft.title}
          maxLength={160}
          onChange={(e) => change({ ...draft, title: e.target.value })}
          className="h-9 w-56 max-w-full flex-1 font-medium sm:flex-none"
          aria-label="Design name"
        />
        <SaveLine state={state} onRetry={flush} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={lookOpen ? 'default' : 'outline'}
            size="sm"
            onClick={() => setLookOpen((o) => !o)}
          >
            <Palette /> Look
          </Button>
          <Button size="sm" onClick={print}>
            <Download /> Download PDF
          </Button>
          <RowMenu
            label="More"
            items={[
              {
                label: 'Make a copy',
                icon: <Copy className="size-4" />,
                onSelect: () => {
                  flush()
                  dup.mutate(id, {
                    onSuccess: (r) =>
                      void navigate({ to: '/ai/designer/$id', params: { id: r.id } }),
                  })
                },
              },
              {
                label: 'Delete design',
                icon: <Trash2 className="size-4" />,
                danger: true,
                divider: true,
                onSelect: async () => {
                  if (
                    !(await confirm({
                      title: `Delete “${draft.title}”?`,
                      description: 'The design and its pages go for good.',
                      destructive: true,
                      confirmLabel: 'Delete',
                    }))
                  )
                    return
                  pending.current = null
                  del.mutate(id, { onSuccess: () => void navigate({ to: '/ai/designer' }) })
                },
              },
            ]}
          />
        </div>
      </div>

      <div
        className={cn(
          'designer-screen grid gap-6',
          lookOpen && 'lg:grid-cols-[minmax(0,1fr)_300px]',
        )}
      >
        {lookOpen && (
          <div className="no-print lg:order-2">
            <LookPanel
              template={draft.template}
              theme={doc.theme}
              onTemplate={(key) =>
                change({
                  ...draft,
                  template: key,
                  doc: { ...doc, theme: { ...templateFor(key).theme } },
                })
              }
              onTheme={(theme) => setDoc({ ...doc, theme })}
              onClose={() => setLookOpen(false)}
            />
          </div>
        )}
        <div className="flex min-w-0 flex-col items-center gap-6 pb-16">
          {doc.pages.map((p, i) => (
            <div key={p.id} className="flex w-full max-w-[794px] flex-col gap-2">
              <PageBar
                n={i + 1}
                page={p}
                first={i === 0}
                last={i === doc.pages.length - 1}
                only={doc.pages.length === 1}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onHide={() => setPage(i, { ...p, hidden: !p.hidden })}
                onCopy={() =>
                  doc.pages.length < 30 &&
                  setPages([
                    ...doc.pages.slice(0, i + 1),
                    { ...structuredClone(p), id: pageId() },
                    ...doc.pages.slice(i + 1),
                  ])
                }
                onDelete={async () => {
                  if (
                    await confirm({
                      title: `Delete page ${i + 1}?`,
                      description: 'Its words and photos go with it.',
                      destructive: true,
                      confirmLabel: 'Delete',
                    })
                  )
                    setPages(doc.pages.filter((_, j) => j !== i))
                }}
              />
              <Scaled hidden={p.hidden}>
                <DesignPageView
                  page={p}
                  theme={doc.theme}
                  editable
                  onChange={(data: DesignPageData) => setPage(i, { ...p, data })}
                />
              </Scaled>
            </div>
          ))}
          {doc.pages.length < 30 && (
            <AddPage onAdd={(kind) => setPages([...doc.pages, blankPage(kind)])} />
          )}
        </div>
      </div>

      {/* What Download PDF prints: the shown pages, full size, nothing to edit.
          On <body> itself, in normal flow, so each page takes its own margin-free sheet. */}
      {createPortal(
        <div className="designer-print" aria-hidden>
          {doc.pages
            .filter((p) => !p.hidden)
            .map((p) => (
              <div key={p.id} className="designer-print-page">
                <DesignPageView
                  page={p}
                  theme={doc.theme}
                  editable={false}
                  onChange={() => undefined}
                />
              </div>
            ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

function SaveLine({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'failed')
    return (
      <button
        type="button"
        onClick={onRetry}
        className="text-xs font-medium text-destructive underline-offset-2 hover:underline"
      >
        Not saved · Try again
      </button>
    )
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {state === 'saved' ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Loader2 className="size-3.5 animate-spin" />
      )}
      {state === 'saved' ? 'Saved' : 'Saving…'}
    </span>
  )
}

/** The page drawn at A4 and scaled down to the column's width. */
function Scaled({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / PAGE_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="relative w-full">
      <div
        className={cn(
          'relative overflow-hidden rounded-sm shadow-lg ring-1 ring-black/10',
          hidden && 'opacity-40',
        )}
        style={{ width: PAGE_W * scale, height: PAGE_H * scale }}
      >
        <div
          style={{
            width: PAGE_W,
            height: PAGE_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function PageBar({
  n,
  page,
  first,
  last,
  only,
  onUp,
  onDown,
  onHide,
  onCopy,
  onDelete,
}: {
  n: number
  page: DesignPage
  first: boolean
  last: boolean
  only: boolean
  onUp: () => void
  onDown: () => void
  onHide: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const btn =
    'flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40'
  return (
    <div className="no-print flex items-center gap-1.5">
      <span className="mr-auto text-sm font-medium">
        Page {n} · {PAGE_KIND_NAMES[page.kind]}
        {page.hidden && (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Hidden from the PDF
          </span>
        )}
      </span>
      <button
        type="button"
        className={btn}
        onClick={onUp}
        disabled={first}
        aria-label="Move up"
        title="Move up"
      >
        <ArrowUp className="size-4" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={onDown}
        disabled={last}
        aria-label="Move down"
        title="Move down"
      >
        <ArrowDown className="size-4" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={onHide}
        aria-label={page.hidden ? 'Show this page' : 'Hide this page'}
        title={page.hidden ? 'Show this page' : 'Hide this page'}
      >
        {page.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </button>
      <button
        type="button"
        className={btn}
        onClick={onCopy}
        aria-label="Duplicate page"
        title="Duplicate page"
      >
        <Copy className="size-4" />
      </button>
      <button
        type="button"
        className={cn(btn, 'hover:text-destructive')}
        onClick={onDelete}
        disabled={only}
        aria-label="Delete page"
        title="Delete page"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

const KINDS: DesignPageKind[] = ['event', 'about', 'deliverables', 'addons', 'thanks', 'cover']

function AddPage({ onAdd }: { onAdd: (k: DesignPageKind) => void }) {
  return (
    <div className="no-print flex w-full max-w-[794px] flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-border p-3">
      <span className="text-sm font-medium">
        <Plus className="mr-1 inline size-4" aria-hidden />
        Add a page:
      </span>
      {KINDS.map((k) => (
        <Button key={k} variant="outline" size="sm" onClick={() => onAdd(k)}>
          {PAGE_KIND_NAMES[k]}
        </Button>
      ))}
    </div>
  )
}

function LookPanel({
  template,
  theme,
  onTemplate,
  onTheme,
  onClose,
}: {
  template: string
  theme: DesignTheme
  onTemplate: (k: string) => void
  onTheme: (t: DesignTheme) => void
  onClose: () => void
}) {
  const colour = (k: 'background' | 'ink' | 'accent' | 'panel', label: string) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      {label}
      <input
        type="color"
        value={theme[k]}
        onChange={(e) => onTheme({ ...theme, [k]: e.target.value.toUpperCase() })}
        className="h-8 w-12 cursor-pointer rounded border border-border bg-card"
      />
    </label>
  )
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 lg:sticky lg:top-16">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Look</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTemplate(t.key)}
            aria-pressed={template === t.key}
            className={cn(
              'overflow-hidden rounded-lg border-2 text-left',
              template === t.key ? 'border-primary' : 'border-border hover:border-primary/50',
            )}
          >
            <div
              className="flex h-12 items-center justify-center"
              style={{ background: t.theme.background }}
            >
              <span
                style={{
                  fontFamily: `'${t.theme.heading}', cursive`,
                  color: t.theme.accent,
                  fontSize: 22,
                }}
              >
                Aa
              </span>
            </div>
            <p className="px-2 py-1 text-xs font-medium">{t.name}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {colour('background', 'Page')}
        {colour('accent', 'Headings & lines')}
        {colour('ink', 'Words')}
        {colour('panel', 'Boxes')}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Heading font
        <Select
          value={theme.heading}
          onChange={(e) => onTheme({ ...theme, heading: e.target.value })}
        >
          {HEADING_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Words font
        <Select value={theme.body} onChange={(e) => onTheme({ ...theme, body: e.target.value })}>
          {BODY_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </label>
    </div>
  )
}
