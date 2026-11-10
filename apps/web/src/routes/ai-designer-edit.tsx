import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookmarkPlus,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  Maximize,
  Minus,
  PaintBucket,
  Plus,
  Redo2,
  Rows3,
  Send,
  Trash2,
  Undo2,
} from 'lucide-react'
import type {
  DesignDoc,
  DesignElementKind,
  DesignPage,
  DesignPageData,
  DesignPhoto,
  DesignTextStyle,
} from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { cn } from '@/shared/ui/cn'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { uploadFile } from '@/shared/api/client'
import {
  useAddDesignPhoto,
  useDeleteDesign,
  useDesign,
  useDuplicateDesign,
  useSaveAsTemplate,
  useSaveDesign,
  useWriteDesign,
} from '@/features/designer/api'
import { DesignPageView, PAGE_H, PAGE_W } from '@/features/designer/DesignPageView'
import { PrintCopy } from '@/features/designer/Sheets'
import { SendDesignDialog } from '@/features/designer/SendDesignDialog'
import { SidePanel, SideRail, type PanelKey } from '@/features/designer/SidePanel'
import { TextBar } from '@/features/designer/TextBar'
import { ColourPicker } from '@/features/designer/ColourPicker'
import { cssPaint } from '@/features/designer/paint'
import { Thumb } from '@/features/designer/Thumb'
import {
  DesignerContext,
  type ActiveText,
  type DesignerCtx,
  type PickedFrame,
} from '@/features/designer/context'
import {
  addElement,
  duplicateElement,
  elementKey,
  newElement,
  nudge,
  removeElement,
} from '@/features/designer/elements'
import { loadDesignerFonts } from '@/features/designer/fonts'
import { record, redo, startHistory, undo, type History } from '@/features/designer/history'
import { shrinkPhoto, sizeWords } from '@/features/designer/shrink'
import { PAGE_KIND_NAMES, pageId } from '@/features/designer/templates'
import type { Writer } from '@/features/designer/WriteButton'
import { useCompanyProfile } from '@/features/settings/api'

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
      projectName={q.data.project_name}
      isTemplate={q.data.is_template}
    />
  )
}

interface Draft {
  title: string
  template: string
  doc: DesignDoc
}

const ZOOMS = [25, 33, 50, 67, 75, 100, 125, 150, 200] as const
const clientOf = (doc: DesignDoc) =>
  doc.pages.find((p) => p.kind === 'cover')?.data.subtitle.replace(/^For\s+/i, '') ?? ''

/**
 * The Quotation Designer's editor, laid out like Canva's (owner, 9 Nov: "everything
 * that is there in Canva"): the whole screen, a dark workspace with the pages on
 * it, Templates · Uploads · Pages · Look on the left, a text bar while a text
 * has the cursor, undo and redo, zoom and grid view at the foot, and it saves by
 * itself.
 */
function Workspace({
  id,
  initial,
  projectName,
  isTemplate,
}: {
  id: string
  initial: Draft
  projectName: string | null
  isTemplate: boolean
}) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const save = useSaveDesign(id)
  const dup = useDuplicateDesign()
  const del = useDeleteDesign()
  const asTemplate = useSaveAsTemplate()
  const addPhoto = useAddDesignPhoto()
  const company = useCompanyProfile()
  const write = useWriteDesign()
  const studio = company.data?.display_name || company.data?.name || ''

  const [hist, setHist] = useState<History<Draft>>(() => startHistory(initial))
  const draft = hist.present
  const [state, setState] = useState<SaveState>('saved')
  const [panel, setPanel] = useState<PanelKey | null>(() =>
    window.innerWidth >= 1100 ? 'uploads' : null,
  )
  const [sending, setSending] = useState(false)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [view, setView] = useState<'scroll' | 'grid'>('scroll')
  const [activeText, setActiveText] = useState<ActiveText | null>(null)
  const [picked, setPicked] = useState<PickedFrame | null>(null)
  // Step 4: the item picked to move or resize, and the photo being cropped.
  const [selected, setSelected] = useState<string | null>(null)
  const [cropping, setCropping] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  const pending = useRef<Draft | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(900)

  // ── saving ────────────────────────────────────────────────────────
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

  const queueSave = useCallback(
    (next: Draft) => {
      pending.current = next
      setState('waiting')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 900)
    },
    [flush],
  )

  const change = useCallback(
    (next: Draft) => {
      setHist((h) => record(h, next, Date.now()))
      queueSave(next)
    },
    [queueSave],
  )

  const step = useCallback(
    (dir: 'undo' | 'redo') => {
      setHist((h) => {
        const n = dir === 'undo' ? undo(h) : redo(h)
        if (n !== h) queueSave(n.present)
        return n
      })
    },
    [queueSave],
  )

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

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, outside a text being typed (which keeps its own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))
        return
      const k = e.key.toLowerCase()
      // The picked item: Escape lets go, the arrows move it, Delete takes an added one off.
      const sel = selected ? selected.split(/:(.*)/s) : null
      const pi = sel ? doc.pages.findIndex((p) => p.id === sel[0]) : -1
      const pg = pi >= 0 ? doc.pages[pi]! : null
      const key = sel?.[1] ?? ''
      const added = pg && key.startsWith('el.') ? key.slice(3) : null
      if (!(e.ctrlKey || e.metaKey)) {
        if (k === 'escape') {
          setSelected(null)
          setCropping(null)
          setPicked(null)
        } else if (pg && (k === 'delete' || k === 'backspace') && added) {
          e.preventDefault()
          setSelected(null)
          setPage(pi, { ...pg, data: removeElement(pg.data, added) })
        } else if (pg && !cropping && ARROWS[k]) {
          e.preventDefault()
          const [x, y] = ARROWS[k]!
          const n = e.shiftKey ? 10 : 1
          setPage(pi, { ...pg, data: nudge(pg.data, key, x * n, y * n) })
        }
        return
      }
      if (k === 'd' && pg && added) {
        e.preventDefault()
        setPage(pi, { ...pg, data: duplicateElement(pg.data, added) })
      } else if (k === 'z') {
        e.preventDefault()
        step(e.shiftKey ? 'redo' : 'undo')
      } else if (k === 'y') {
        e.preventDefault()
        step('redo')
      } else if (k === 's') {
        e.preventDefault()
        flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── the canvas's width, for Fit ───────────────────────────────────
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const fit = () => setCanvasW(el.clientWidth)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fitScale = Math.min(1, Math.max(0.2, (canvasW - 64) / PAGE_W))
  const scale = zoom === 'fit' ? fitScale : zoom / 100

  // The page in view, for "Page 3 of 9".
  useEffect(() => {
    const root = canvas.current
    if (!root || view !== 'scroll') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset['index'] ?? 0))
      },
      { root, threshold: 0.5 },
    )
    root.querySelectorAll('[data-page-index]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [view, draft.doc.pages.length, scale])

  // ── the document ──────────────────────────────────────────────────
  const doc = draft.doc
  const setDoc = (d: DesignDoc, template?: string) =>
    change({ ...draft, doc: d, template: template ?? draft.template })
  const setPages = (pages: DesignPage[]) => setDoc({ ...doc, pages })
  const setPage = (i: number, p: DesignPage) => setPages(doc.pages.map((x, j) => (j === i ? p : x)))
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= doc.pages.length) return
    const pages = [...doc.pages]
    ;[pages[i], pages[j]] = [pages[j]!, pages[i]!]
    setPages(pages)
  }
  const goTo = (pid: string) => {
    setView('scroll')
    requestAnimationFrame(() =>
      document
        .getElementById(`page-${pid}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  /** A new text, photo frame or shape, on the page in view, picked at once. */
  const addItem = (kind: DesignElementKind) => {
    const i = Math.min(current, doc.pages.length - 1)
    const p = doc.pages[i]
    if (!p) return
    if (p.data.elements.length >= 40) {
      toast.error('A page holds 40 added items. Put this one on another page.')
      return
    }
    const el = newElement(kind, p.data.elements.length)
    setPage(i, { ...p, data: addElement(p.data, el) })
    setSelected(`${p.id}:${elementKey(el.id)}`)
    if (view === 'grid') goTo(p.id)
    if (window.innerWidth < 1024) setPanel(null)
  }

  const activePageIndex = activeText ? doc.pages.findIndex((p) => p.id === activeText.pageId) : -1
  const activeStyle: DesignTextStyle | null =
    activeText && activePageIndex >= 0
      ? (doc.pages[activePageIndex]!.data.styles[activeText.key] ?? {})
      : null
  const setActiveStyle = (s: DesignTextStyle) => {
    if (!activeText || activePageIndex < 0) return
    const p = doc.pages[activePageIndex]!
    const styles = { ...p.data.styles }
    if (Object.keys(s).length === 0) delete styles[activeText.key]
    else styles[activeText.key] = s
    setPage(activePageIndex, { ...p, data: { ...p.data, styles } })
  }

  // ── photos: made small, uploaded, kept in Uploads ────────────────
  const uploadPhoto = useCallback(
    async (file: File): Promise<DesignPhoto | null> => {
      try {
        const small = await shrinkPhoto(file)
        const stored = await uploadFile(small.file, { isPublic: true })
        addPhoto.mutate({
          url: stored.url,
          name: file.name.slice(0, 200),
          width: small.width,
          height: small.height,
          size_bytes: small.after,
        })
        if (small.after < small.before * 0.9)
          toast.success(
            `${file.name}: made smaller, ${sizeWords(small.before)} → ${sizeWords(small.after)}`,
          )
        return { url: stored.url, x: 50, y: 50, zoom: 1 }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'The photo did not upload. Try again.')
        return null
      }
    },
    [addPhoto],
  )

  const ctx = useMemo<DesignerCtx>(
    () => ({
      activeText,
      setActiveText,
      pickedFrame: picked?.id ?? null,
      pickFrame: setPicked,
      applyToPicked: (p) => {
        picked?.apply(p)
      },
      uploadPhoto,
      selected,
      select: setSelected,
      cropping,
      setCropping,
      scale,
    }),
    [activeText, picked, uploadPhoto, selected, cropping, scale],
  )

  const writer: Writer = (ask) =>
    write.mutateAsync({ ...ask, studio, project: projectName ?? '', client: clientOf(doc) })

  function print() {
    flush()
    window.print()
  }

  function saveTemplate() {
    flush()
    const title =
      `${draft.title.replace(/\s*[–-]\s*Quotation$/i, '') || 'My template'} template`.slice(0, 160)
    asTemplate.mutate(
      { title, template: draft.template, doc },
      {
        onSuccess: () =>
          toast.success('Saved as a template. Start a new design from it under Templates.'),
      },
    )
  }

  return (
    <DesignerContext value={ctx}>
      <div className="designer-screen fixed inset-0 z-40 flex flex-col bg-[#0e0f11] text-white">
        {/* ── top bar ── */}
        <header className="flex h-14 shrink-0 items-center gap-2 bg-gradient-to-r from-[#1e2a5a] via-[#24205a] to-[#3b1f5c] px-3">
          <Link
            to="/ai/designer"
            className="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-white/10"
            onClick={() => flush()}
          >
            <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Designs</span>
          </Link>
          <span className="mx-1 h-6 w-px bg-white/20" />
          <button
            type="button"
            onClick={() => step('undo')}
            disabled={hist.past.length === 0}
            className="flex size-9 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-30"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => step('redo')}
            disabled={hist.future.length === 0}
            className="flex size-9 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-30"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="size-5" />
          </button>
          <SaveLine state={state} onRetry={flush} />
          <input
            value={draft.title}
            maxLength={160}
            onChange={(e) => change({ ...draft, title: e.target.value })}
            className="mx-auto hidden h-9 w-[min(360px,40vw)] rounded-md md:block border border-transparent bg-transparent px-2 text-center text-sm font-medium hover:border-white/30 focus:border-white/60 focus:bg-black/20 focus:outline-none"
            aria-label="Design name"
          />
          {isTemplate && (
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">Template</span>
          )}
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button
              type="button"
              onClick={saveTemplate}
              disabled={asTemplate.isPending}
              className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-white/10 lg:flex"
              title="Save these pages and this look as a template"
            >
              <BookmarkPlus className="size-4" /> Save as template
            </button>
            <button
              type="button"
              onClick={print}
              className="flex h-9 items-center gap-1.5 rounded-md bg-white/10 px-3 text-sm hover:bg-white/20"
            >
              <Download className="size-4" /> <span className="hidden sm:inline">Download PDF</span>
            </button>
            {!isTemplate && (
              <button
                type="button"
                onClick={() => {
                  flush()
                  setSending(true)
                }}
                className="flex h-9 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-semibold text-[#24205a] hover:bg-white/90"
              >
                <Send className="size-4" /> <span className="hidden sm:inline">Send to client</span>
              </button>
            )}
            <RowMenu
              label="More"
              className="text-white hover:bg-white/10"
              items={[
                {
                  label: 'Save as template',
                  icon: <BookmarkPlus className="size-4" />,
                  onSelect: saveTemplate,
                },
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
                  label: isTemplate ? 'Delete template' : 'Delete design',
                  icon: <Trash2 className="size-4" />,
                  danger: true,
                  divider: true,
                  onSelect: async () => {
                    if (
                      !(await confirm({
                        title: `Delete “${draft.title}”?`,
                        description: 'It and its pages go for good. Your photos stay in Uploads.',
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
        </header>

        <div className="relative flex min-h-0 flex-1">
          <SideRail open={panel} onOpen={setPanel} />
          {panel && (
            // Beside the pages on a wide screen; over them on a phone or a small laptop.
            <div className="absolute inset-y-0 left-[72px] z-20 flex shadow-2xl lg:static lg:shadow-none">
              <SidePanel
                panel={panel}
                doc={doc}
                template={draft.template}
                studio={studio}
                onClose={() => setPanel(null)}
                onDoc={setDoc}
                onGoTo={(pid) => {
                  if (window.innerWidth < 1024) setPanel(null)
                  goTo(pid)
                }}
                onAdd={addItem}
                pageNumber={Math.min(current + 1, doc.pages.length)}
              />
            </div>
          )}

          <main className="relative flex min-w-0 flex-1 flex-col bg-[#18191b]">
            {/* the text bar, while a text has the cursor */}
            <div className="flex min-h-12 shrink-0 items-center justify-center px-3 py-1">
              {activeStyle ? (
                <TextBar style={activeStyle} theme={doc.theme} onStyle={setActiveStyle} />
              ) : (
                <p className="hidden text-xs text-white/50 sm:block">
                  {picked
                    ? 'Photo frame picked: tap a photo in Uploads to put it here, or drag the photo to move it.'
                    : 'Tap any text to change it. Drag photos from Uploads onto the frames.'}
                </p>
              )}
            </div>

            <div
              ref={canvas}
              className="min-h-0 flex-1 overflow-auto"
              onMouseDown={(e) => {
                // A press on empty space must not put the cursor in the nearest text (Chrome does).
                const el = e.target as HTMLElement
                if (
                  !el.closest(
                    '.designer-editable, input, button, label, select, [data-photo-frame], [data-movable], [role="textbox"]',
                  )
                )
                  e.preventDefault()
              }}
              onPointerDown={(e) => {
                const el = e.target as HTMLElement
                // Like Canva: a tap anywhere but a text closes the text bar, and anywhere but a frame lets the frame go.
                if (!el.closest('.designer-editable')) {
                  setActiveText(null)
                  const focused = document.activeElement
                  if (
                    focused instanceof HTMLElement &&
                    focused.classList.contains('designer-editable')
                  ) {
                    // The caret must go too, or Chrome puts the cursor back in the text on mouse-up.
                    window.getSelection()?.removeAllRanges()
                    focused.blur()
                  }
                }
                const item = el.closest('[data-movable]')?.getAttribute('data-movable') ?? null
                if (!item) {
                  setPicked(null)
                  setSelected(null)
                }
                if (item !== cropping) setCropping(null)
              }}
            >
              {view === 'grid' ? (
                <div
                  data-canvas-bg
                  className="grid gap-6 p-8"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
                >
                  {doc.pages.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => goTo(p.id)}
                      className={cn(
                        'flex flex-col items-center gap-2 text-xs text-white/70 hover:text-white',
                        p.hidden && 'opacity-40',
                      )}
                    >
                      <span className="rounded ring-2 ring-transparent hover:ring-violet-400">
                        <Thumb page={p} theme={doc.theme} width={180} />
                      </span>
                      {i + 1}. {PAGE_KIND_NAMES[p.kind]}
                    </button>
                  ))}
                </div>
              ) : (
                <div
                  data-canvas-bg
                  className="flex min-w-fit flex-col items-center gap-8 px-8 py-6"
                >
                  {doc.pages.map((p, i) => (
                    <section
                      key={p.id}
                      id={`page-${p.id}`}
                      data-page-index={i}
                      data-index={i}
                      className="flex flex-col gap-2"
                      style={{ width: PAGE_W * scale }}
                    >
                      <PageBar
                        n={i + 1}
                        page={p}
                        first={i === 0}
                        last={i === doc.pages.length - 1}
                        only={doc.pages.length === 1}
                        onUp={() => move(i, -1)}
                        onDown={() => move(i, 1)}
                        onHide={() => setPage(i, { ...p, hidden: !p.hidden })}
                        onColour={(c) => setPage(i, { ...p, data: { ...p.data, background: c } })}
                        background={doc.theme.background}
                        themeColours={[doc.theme.background, doc.theme.accent, doc.theme.ink, doc.theme.panel]}
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
                              description: 'Its words and photos go with it. Undo brings it back.',
                              destructive: true,
                              confirmLabel: 'Delete',
                            })
                          )
                            setPages(doc.pages.filter((_, j) => j !== i))
                        }}
                      />
                      <div
                        className={cn(
                          'relative overflow-hidden shadow-2xl',
                          p.hidden && 'opacity-40',
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
                          <DesignPageView
                            page={p}
                            theme={doc.theme}
                            editable
                            writer={writer}
                            onChange={(data: DesignPageData) => setPage(i, { ...p, data })}
                          />
                        </div>
                      </div>
                    </section>
                  ))}
                  {doc.pages.length < 30 && (
                    <button
                      type="button"
                      onClick={() => setPanel('pages')}
                      className="flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/25 px-6 text-sm text-white/80 hover:bg-white/10"
                      style={{ width: PAGE_W * scale }}
                    >
                      <Plus className="size-4" /> Add a page
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── zoom and view, Canva's foot bar ── */}
            <footer className="flex h-11 shrink-0 items-center gap-3 border-t border-white/10 bg-[#18191b] px-4 text-xs text-white/80">
              <span className="tabular-nums">
                Page {Math.min(current + 1, doc.pages.length)} of {doc.pages.length}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setZoom(stepZoom(scale, -1))}
                  className="flex size-7 items-center justify-center rounded hover:bg-white/10"
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  <Minus className="size-4" />
                </button>
                <input
                  type="range"
                  min={20}
                  max={200}
                  step={1}
                  value={Math.round(scale * 100)}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="hidden w-32 accent-violet-400 sm:block"
                  aria-label="Zoom"
                />
                <button
                  type="button"
                  onClick={() => setZoom(stepZoom(scale, 1))}
                  className="flex size-7 items-center justify-center rounded hover:bg-white/10"
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  <Plus className="size-4" />
                </button>
                <span className="w-10 text-right tabular-nums">{Math.round(scale * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom('fit')}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded px-2 hover:bg-white/10',
                    zoom === 'fit' && 'bg-white/15',
                  )}
                  title="Fit the page to the screen"
                >
                  <Maximize className="size-3.5" /> Fit
                </button>
                <span className="mx-1 h-5 w-px bg-white/15" />
                <button
                  type="button"
                  onClick={() => setView('scroll')}
                  className={cn(
                    'flex size-7 items-center justify-center rounded hover:bg-white/10',
                    view === 'scroll' && 'bg-white/15',
                  )}
                  aria-label="Scroll view"
                  title="Scroll view"
                >
                  <Rows3 className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveText(null)
                    setPicked(null)
                    setView('grid')
                  }}
                  className={cn(
                    'flex size-7 items-center justify-center rounded hover:bg-white/10',
                    view === 'grid' && 'bg-white/15',
                  )}
                  aria-label="Grid view"
                  title="Grid view"
                >
                  <LayoutGrid className="size-4" />
                </button>
              </div>
            </footer>
          </main>
        </div>
      </div>

      <PrintCopy doc={doc} />
      {sending && (
        <SendDesignDialog
          id={id}
          title={draft.title}
          client={clientOf(doc)}
          studio={studio}
          onClose={() => setSending(false)}
        />
      )}
    </DesignerContext>
  )
}

/** The next zoom stop up or down from where the page is now. */
/** Arrow keys → which way an item moves. */
const ARROWS: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
}

export function stepZoom(scale: number, dir: 1 | -1): number {
  const now = Math.round(scale * 100)
  if (dir === 1) return ZOOMS.find((z) => z > now) ?? 200
  return [...ZOOMS].reverse().find((z) => z < now) ?? 25
}

function SaveLine({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'failed')
    return (
      <button
        type="button"
        onClick={onRetry}
        className="ml-1 text-xs font-medium text-red-300 underline-offset-2 hover:underline"
      >
        Not saved · Try again
      </button>
    )
  return (
    <span className="ml-1 flex items-center gap-1 text-xs text-white/70">
      {state === 'saved' ? (
        <Check className="size-3.5 text-emerald-300" />
      ) : (
        <Loader2 className="size-3.5 animate-spin" />
      )}
      <span className="hidden sm:inline">{state === 'saved' ? 'Saved' : 'Saving…'}</span>
    </span>
  )
}

function PageBar({
  n,
  page,
  first,
  last,
  only,
  background,
  onUp,
  onDown,
  onHide,
  onCopy,
  onDelete,
  onColour,
  themeColours,
}: {
  themeColours: string[]
  n: number
  page: DesignPage
  first: boolean
  last: boolean
  only: boolean
  background: string
  onUp: () => void
  onDown: () => void
  onHide: () => void
  onCopy: () => void
  onDelete: () => void
  onColour: (c: string) => void
}) {
  const btn =
    'flex size-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30'
  return (
    <div className="flex items-center gap-1 text-white">
      <span className="mr-auto truncate text-sm font-medium text-white/85">
        Page {n} · {PAGE_KIND_NAMES[page.kind]}
        {page.hidden && (
          <span className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-xs">
            Hidden from the PDF
          </span>
        )}
      </span>
      <ColourPicker
        value={page.data.background}
        onChange={onColour}
        gradients
        theme={themeColours}
        onReset={page.data.background ? () => onColour('') : undefined}
        label="Page background"
      >
        <button
          type="button"
          className={cn(btn, 'w-auto gap-1.5 px-2 text-xs')}
          title="Page background: colours and gradients"
          aria-label="Page background"
        >
          <PaintBucket className="size-4" />
          <span className="size-4 rounded ring-1 ring-white/50" style={{ background: cssPaint(page.data.background, background) }} />
          Background
        </button>
      </ColourPicker>
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
        className={cn(btn, 'hover:text-red-300')}
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
