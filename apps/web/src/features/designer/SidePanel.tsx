import { useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import {
  GripVertical,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Palette,
  Plus,
  Trash2,
  Upload,
  X,
  Files,
} from 'lucide-react'
import type { DesignDoc, DesignPage, DesignPageKind, DesignTheme } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Select } from '@/shared/ui/select'
import { useConfirm } from '@/shared/ui/confirm'
import { callApi } from '@/shared/api/client'
import { designDetail } from '@ipc/contracts'
import { useDeleteTemplate, useDesignPhotos, useDesignTemplates, useRemoveDesignPhoto } from './api'
import { PHOTO_DRAG_TYPE, useDesigner } from './context'
import { STARTERS, pourProject, starterDoc } from './starters'
import { BODY_FONTS, HEADING_FONTS, PAGE_KIND_NAMES, TEMPLATES, blankPage } from './templates'
import { Thumb } from './Thumb'

export type PanelKey = 'templates' | 'uploads' | 'pages' | 'look'

export const PANELS: { key: PanelKey; label: string; icon: typeof Palette }[] = [
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'uploads', label: 'Uploads', icon: Upload },
  { key: 'pages', label: 'Pages', icon: Files },
  { key: 'look', label: 'Look', icon: Palette },
]

/** The left rail of the editor (Canva's side bar): one tool at a time. */
export function SideRail({
  open,
  onOpen,
}: {
  open: PanelKey | null
  onOpen: (k: PanelKey | null) => void
}) {
  return (
    <nav
      className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-[#18191b] py-2"
      aria-label="Design tools"
    >
      {PANELS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onOpen(open === p.key ? null : p.key)}
          aria-pressed={open === p.key}
          className={cn(
            'flex w-16 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-white/70 hover:bg-white/10 hover:text-white',
            open === p.key && 'bg-white/15 text-white',
          )}
        >
          <p.icon className="size-5" aria-hidden />
          {p.label}
        </button>
      ))}
    </nav>
  )
}

interface PanelProps {
  panel: PanelKey
  doc: DesignDoc
  template: string
  studio: string
  onClose: () => void
  onDoc: (doc: DesignDoc, template?: string) => void
  onGoTo: (pageId: string) => void
}

export function SidePanel(props: PanelProps) {
  const title = PANELS.find((p) => p.key === props.panel)!.label
  return (
    <aside className="flex w-[min(320px,calc(100vw-72px))] shrink-0 flex-col border-r border-white/10 bg-[#252627] text-white">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close"
          className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {props.panel === 'templates' && <TemplatesPanel {...props} />}
        {props.panel === 'uploads' && <UploadsPanel />}
        {props.panel === 'pages' && <PagesPanel {...props} />}
        {props.panel === 'look' && <LookPanel {...props} />}
      </div>
    </aside>
  )
}

// ── Templates ───────────────────────────────────────────────────────

function TemplatesPanel({ doc, studio, onDoc }: PanelProps) {
  const confirm = useConfirm()
  const mine = useDesignTemplates()
  const del = useDeleteTemplate()

  async function use(layout: DesignDoc, template: string, name: string) {
    const ok = await confirm({
      title: `Use “${name}”?`,
      description:
        'Its look and pages replace these. Your events, deliverables and add-ons stay. Undo brings everything back.',
      confirmLabel: 'Use this template',
    })
    if (!ok) return
    onDoc(pourProject(layout, doc), template)
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
          Ready-made
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {STARTERS.map((s) => {
            const d = starterDoc(s.key, studio)
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => void use(d, s.look, s.name)}
                className="group flex flex-col gap-1.5 text-left"
                title={s.blurb}
              >
                <div className="rounded-md ring-2 ring-transparent transition group-hover:ring-violet-400">
                  <Thumb page={d.pages[0]!} theme={d.theme} width={132} />
                </div>
                <span className="text-xs font-medium leading-tight">{s.name}</span>
                <span className="text-[11px] text-white/50">{d.pages.length} pages</span>
              </button>
            )
          })}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
          Your templates
        </h3>
        {mine.data && mine.data.length === 0 && (
          <p className="text-xs text-white/50">
            Save any design as a template from the top bar, and it shows here.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {(mine.data ?? []).map((t) => (
            <div key={t.id} className="group relative flex flex-col gap-1.5">
              <button
                type="button"
                className="text-left"
                onClick={async () => {
                  const full = await callApi(`/designs/${t.id}`, { responseSchema: designDetail })
                  await use(full.doc, full.template, t.title)
                }}
              >
                <div className="flex aspect-[794/1123] items-center justify-center overflow-hidden rounded-md bg-white/10 ring-2 ring-transparent group-hover:ring-violet-400">
                  {t.cover_url ? (
                    <img src={t.cover_url} alt="" className="size-full object-cover" />
                  ) : (
                    <LayoutTemplate className="size-8 text-white/40" />
                  )}
                </div>
                <span className="mt-1.5 block truncate text-xs font-medium">{t.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete template ${t.title}`}
                title="Delete template"
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1.5 text-white opacity-0 hover:bg-red-600 group-hover:opacity-100 focus:opacity-100"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete the template “${t.title}”?`,
                      description: 'Designs already made from it stay as they are.',
                      destructive: true,
                      confirmLabel: 'Delete',
                    })
                  )
                    del.mutate(t.id, { onSuccess: () => toast.success('Template deleted') })
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// ── Uploads ─────────────────────────────────────────────────────────

function UploadsPanel() {
  const ctx = useDesigner()
  const photos = useDesignPhotos()
  const remove = useRemoveDesignPhoto()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [over, setOver] = useState(false)

  async function upload(files: File[]) {
    if (!ctx) return
    const pics = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (pics.length === 0) return void toast.error('Pick photos (JPG, PNG or WebP).')
    setBusy((n) => n + pics.length)
    // Two at a time: a phone on a slow line keeps up, and nothing waits on all ten.
    const queue = [...pics]
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        await ctx.uploadPhoto(f)
        setBusy((n) => n - 1)
      }
    }
    await Promise.all([worker(), worker()])
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setOver(false)
    void upload(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) =>
          void upload(Array.from(e.target.files ?? [])).then(() => {
            if (input.current) input.current.value = ''
          })
        }
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 font-medium text-white hover:bg-violet-500"
      >
        <Upload className="size-4" /> Upload photos
      </button>
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs text-white/60',
          over ? 'border-violet-400 bg-violet-500/10' : 'border-white/20',
        )}
      >
        <ImagePlus className="mx-auto mb-1 size-5" aria-hidden />
        Drop photos here. Big camera files (20–30 MB) are made small for you.
      </div>
      {busy > 0 && (
        <p className="flex items-center gap-2 text-xs text-white/70">
          <Loader2 className="size-3.5 animate-spin" /> Uploading {busy}{' '}
          {busy === 1 ? 'photo' : 'photos'}…
        </p>
      )}
      <p className="text-xs text-white/50">
        Drag a photo onto a frame, or tap a frame on the page and then a photo here.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(photos.data ?? []).map((p) => (
          <div key={p.id} className="group relative">
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PHOTO_DRAG_TYPE, p.url)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => {
                if (!ctx?.pickedFrame)
                  return void toast(
                    'Tap a photo frame on the page first, or drag this photo onto one.',
                  )
                ctx.applyToPicked({ url: p.url, x: 50, y: 50, zoom: 1 })
              }}
              className="block aspect-square w-full cursor-grab overflow-hidden rounded-md bg-white/10 ring-2 ring-transparent hover:ring-violet-400 active:cursor-grabbing"
              title={p.name || 'Photo'}
            >
              <img
                src={p.url}
                alt={p.name}
                loading="lazy"
                className="size-full object-cover"
                draggable={false}
              />
            </button>
            <button
              type="button"
              aria-label="Remove from uploads"
              title="Remove from uploads (designs keep it)"
              onClick={() => remove.mutate(p.id)}
              className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 hover:bg-red-600 group-hover:opacity-100 focus:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {photos.data?.length === 0 && busy === 0 && (
        <p className="text-center text-xs text-white/40">No photos yet.</p>
      )}
    </div>
  )
}

// ── Pages ───────────────────────────────────────────────────────────

const KINDS: DesignPageKind[] = [
  'event',
  'packages',
  'deliverables',
  'addons',
  'team',
  'testimonial',
  'about',
  'thanks',
  'cover',
]

function PagesPanel({ doc, studio, onDoc, onGoTo }: PanelProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const move = (from: number, to: number) => {
    if (from === to) return
    const pages = [...doc.pages]
    const [p] = pages.splice(from, 1)
    pages.splice(to, 0, p!)
    onDoc({ ...doc, pages })
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-white/50">Drag to change the order. Tap a page to go to it.</p>
      {doc.pages.map((p, i) => (
        <div
          key={p.id}
          draggable
          onDragStart={() => setDragging(i)}
          onDragEnd={() => setDragging(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragging !== null) move(dragging, i)
            setDragging(null)
          }}
          className={cn(
            'flex cursor-grab items-center gap-2 rounded-lg p-1.5 hover:bg-white/10',
            dragging === i && 'opacity-40',
          )}
        >
          <GripVertical className="size-4 shrink-0 text-white/40" aria-hidden />
          <button
            type="button"
            onClick={() => onGoTo(p.id)}
            className="flex flex-1 items-center gap-3 text-left"
          >
            <span className={cn(p.hidden && 'opacity-40')}>
              <Thumb page={p} theme={doc.theme} width={70} />
            </span>
            <span className="text-xs">
              <span className="font-medium">
                {i + 1}. {PAGE_KIND_NAMES[p.kind]}
              </span>
              {p.hidden && <span className="block text-white/50">Hidden from the PDF</span>}
            </span>
          </button>
        </div>
      ))}
      {doc.pages.length < 30 &&
        (adding ? (
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  const page: DesignPage = blankPage(k, studio)
                  onDoc({ ...doc, pages: [...doc.pages, page] })
                  setAdding(false)
                  onGoTo(page.id)
                }}
                className="rounded-md border border-white/15 px-2 py-2 text-xs hover:bg-white/10"
              >
                {PAGE_KIND_NAMES[k]}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/25 text-sm hover:bg-white/10"
          >
            <Plus className="size-4" /> Add a page
          </button>
        ))}
    </div>
  )
}

// ── Look ────────────────────────────────────────────────────────────

function LookPanel({ doc, template, onDoc }: PanelProps) {
  const theme = doc.theme
  const setTheme = (t: DesignTheme) => onDoc({ ...doc, theme: t })
  const colour = (k: 'background' | 'ink' | 'accent' | 'panel', label: string) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      {label}
      <input
        type="color"
        value={theme[k]}
        onChange={(e) => setTheme({ ...theme, [k]: e.target.value.toUpperCase() })}
        className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent"
      />
    </label>
  )
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onDoc({ ...doc, theme: { ...t.theme } }, t.key)}
            aria-pressed={template === t.key}
            className={cn(
              'overflow-hidden rounded-lg border-2 text-left',
              template === t.key ? 'border-violet-400' : 'border-white/15 hover:border-white/40',
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
          onChange={(e) => setTheme({ ...theme, heading: e.target.value })}
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
        <Select value={theme.body} onChange={(e) => setTheme({ ...theme, body: e.target.value })}>
          {BODY_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-xs text-white/50">
        A page can have its own colour: use Page colour above that page.
      </p>
    </div>
  )
}
