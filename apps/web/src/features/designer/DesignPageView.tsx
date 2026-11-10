import { use, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Copy, Plus, Trash2, X } from 'lucide-react'
import type {
  DesignElement,
  DesignPage,
  DesignPageData,
  DesignPhoto,
  DesignTextStyle,
  DesignTheme,
} from '@ipc/contracts'
import { Editable, type EditableProps } from './Editable'
import {
  ELEMENT_NAMES,
  duplicateElement,
  elementKey,
  isTextElement,
  removeElement,
  updateElement,
} from './elements'
import { useDesigner } from './context'
import { Movable } from './Movable'
import { PAGE_H, PAGE_W, PageCtx } from './page-context'
import type { Guide } from './snap'
import { PhotoFrame } from './PhotoFrame'
import { ColourPicker } from './ColourPicker'
import { cssPaint } from './paint'
import { isScript } from './templates'
import { WriteButton, type Writer } from './WriteButton'

export { PAGE_H, PAGE_W } from './page-context'

interface Props {
  page: DesignPage
  theme: DesignTheme
  editable: boolean
  onChange: (data: DesignPageData) => void
  /** "Write it for me", when the editor offers it. */
  writer?: Writer | undefined
}

const fontStack = (family: string, script = false) =>
  `'${family}', ${script ? 'cursive' : 'Georgia, serif'}`

/**
 * One page of a quotation design, drawn from its kind (Quotation Designer,
 * 0295). The layouts follow the owner's Canva quotation: an arched photo on
 * the cover, a photo over each section, script headings, italic words, the
 * total and the payment terms in soft panels.
 */
export function DesignPageView({ page, theme, editable, onChange, writer }: Props) {
  const d = page.data
  const set = <K extends keyof DesignPageData>(k: K, v: DesignPageData[K]) =>
    onChange({ ...d, [k]: v })
  const t = useType(theme)
  const [guides, setGuides] = useState<Guide[]>([])
  const ed = useDesigner()
  const photo = (
    p: DesignPhoto,
    onP: (p: DesignPhoto) => void,
    style: CSSProperties,
    name = 'photo',
  ) => {
    // A grid cell's placement stays on the moving wrapper; the frame fills it.
    const { gridRow, ...frame } = style
    return (
      <Movable
        k={name}
        kind="photo"
        style={gridRow ? { gridRow } : undefined}
        onTap={() => ed?.pickFrame({ id: `${page.id}:${name}`, apply: onP })}
      >
        <PhotoFrame
          frameId={`${page.id}:${name}`}
          photo={p}
          onChange={onP}
          editable={editable}
          accent={theme.accent}
          style={gridRow ? { ...frame, height: '100%' } : frame}
        />
      </Movable>
    )
  }
  const text = (
    k:
      | 'title'
      | 'subtitle'
      | 'body'
      | 'studio'
      | 'tagline'
      | 'event'
      | 'location'
      | 'date'
      | 'team'
      | 'total'
      | 'payments',
    style: CSSProperties,
    opts: { placeholder: string; max: number; multiline?: boolean; className?: string },
  ) => (
    <Movable k={k} kind="text">
      <SE
        k={k}
        value={d[k]}
        onChange={(v) => set(k, v)}
        editable={editable}
        style={style}
        {...opts}
      />
    </Movable>
  )

  /** A "Write it for me" for one part, only while editing and when AI is offered. */
  const ai = (
    ask: Parameters<typeof WriteButton>[0]['ask'],
    apply: (r: { text: string; lines: string[] }) => void,
    style?: CSSProperties,
  ) =>
    editable && writer ? (
      <div style={{ margin: '6px 0', ...style }}>
        <WriteButton ask={ask} writer={writer} onWritten={apply} />
      </div>
    ) : null

  let body: ReactNode
  switch (page.kind) {
    case 'cover':
      body = (
        <div className="flex h-full flex-col items-center" style={{ padding: '110px 80px 90px' }}>
          {text(
            'studio',
            { ...t.heading(96), textAlign: 'center', lineHeight: 1.05 },
            { placeholder: 'Your studio name', max: 120 },
          )}
          <div style={{ height: 50 }} />
          {photo(d.photo, (p) => set('photo', p), {
            width: 500,
            height: 620,
            borderRadius: '250px 250px 8px 8px',
          })}
          <div style={{ height: 48 }} />
          {text(
            'tagline',
            { ...t.body(30), fontStyle: 'italic', textAlign: 'center' },
            { placeholder: 'A line about your work', max: 200 },
          )}
          {ai({ kind: 'tagline', current: d.tagline, lines: [] }, (r) => set('tagline', r.text))}
          <div style={{ flex: 1 }} />
          {text(
            'subtitle',
            { ...t.label(18), textAlign: 'center' },
            { placeholder: 'For the couple', max: 300 },
          )}
        </div>
      )
      break
    case 'about':
      body = (
        <div className="flex h-full flex-col">
          {photo(d.photo, (p) => set('photo', p), { width: '100%', height: 470 })}
          <div className="flex flex-1 flex-col" style={{ padding: '44px 72px 60px' }}>
            {text('title', { ...t.heading(76) }, { placeholder: 'About Us', max: 120 })}
            <div style={{ height: 18 }} />
            {text(
              'body',
              { ...t.body(22), fontStyle: 'italic', lineHeight: 1.6, opacity: 0.85 },
              { placeholder: 'Your story, in a few lines', max: 3000, multiline: true },
            )}
            {ai({ kind: 'about', current: d.body, lines: [] }, (r) => set('body', r.text))}
            <div style={{ flex: 1, minHeight: 30 }} />
            <Stats d={d} set={set} editable={editable} t={t} accent={theme.accent} />
            <div style={{ height: 22 }} />
            {text(
              'subtitle',
              { ...t.body(20), fontStyle: 'italic', opacity: 0.8 },
              { placeholder: 'Where you shoot', max: 300 },
            )}
          </div>
        </div>
      )
      break
    case 'event':
      body = (
        <div className="flex h-full flex-col">
          {photo(d.photo, (p) => set('photo', p), { width: '100%', height: 520 })}
          <div className="flex flex-1 flex-col" style={{ padding: '44px 72px 60px' }}>
            {text('title', { ...t.heading(70) }, { placeholder: 'Event Details', max: 120 })}
            <div style={{ height: 26 }} />
            <Row label="Event" t={t}>
              {text('event', t.body(24), { placeholder: 'Haldi', max: 120 })}
            </Row>
            <Row label="Location" t={t}>
              {text('location', t.body(24), { placeholder: 'Venue', max: 160 })}
            </Row>
            <Row label="Date" t={t}>
              {text('date', t.body(24), { placeholder: 'Date', max: 80 })}
            </Row>
            <Row label="Team Size" t={t}>
              {text('team', t.body(24), { placeholder: '3 Shooters with Assistants', max: 160 })}
            </Row>
            <div style={{ height: 14 }} />
            <Lines
              k="lines"
              lines={d.lines}
              onChange={(v) => set('lines', v)}
              editable={editable}
              style={{ ...t.body(22), fontStyle: 'italic' }}
              accent={theme.accent}
              placeholder="1 Candid Photographer"
              max={30}
            />
            {ai(
              {
                kind: 'event',
                current: [d.event, d.team].filter(Boolean).join(' · '),
                lines: d.lines,
              },
              (r) => set('lines', r.lines),
            )}
          </div>
        </div>
      )
      break
    case 'deliverables':
      body = (
        <div className="flex h-full flex-col" style={{ padding: '90px 72px 72px' }}>
          {text(
            'title',
            { ...t.heading(80), textAlign: 'center' },
            { placeholder: 'Deliverables', max: 120 },
          )}
          <div style={{ height: 34 }} />
          <Lines
            k="lines"
            lines={d.lines}
            onChange={(v) => set('lines', v)}
            editable={editable}
            style={{ ...t.body(23), lineHeight: 1.5 }}
            accent={theme.accent}
            placeholder="Edited high-resolution photographs"
            max={30}
          />
          {ai({ kind: 'deliverables', current: '', lines: d.lines }, (r) => set('lines', r.lines))}
          <div style={{ flex: 1, minHeight: 30 }} />
          <div
            style={{
              background: theme.panel,
              border: `2px solid ${theme.accent}`,
              borderRadius: 14,
              padding: '26px 30px',
              textAlign: 'center',
            }}
          >
            {text(
              'total',
              { ...t.body(30), fontWeight: 700 },
              { placeholder: 'Total Investment: INR 0/-', max: 200 },
            )}
          </div>
          <div style={{ height: 22 }} />
          <div style={{ background: theme.panel, borderRadius: 14, padding: '24px 30px' }}>
            <div style={{ ...t.label(16), marginBottom: 10 }}>Payments T&amp;C</div>
            {text(
              'payments',
              { ...t.body(21), fontStyle: 'italic', lineHeight: 1.5 },
              {
                placeholder: 'Advance at booking, the rest before the wedding',
                max: 600,
                multiline: true,
              },
            )}
          </div>
        </div>
      )
      break
    case 'addons':
      body = (
        <div className="flex h-full flex-col">
          {photo(d.photo, (p) => set('photo', p), { width: '100%', height: 380 })}
          <div className="flex flex-1 flex-col" style={{ padding: '40px 72px 60px' }}>
            {text('title', { ...t.heading(72) }, { placeholder: 'Add Ons', max: 120 })}
            <div style={{ height: 14 }} />
            <Addons
              d={d}
              set={set}
              editable={editable}
              t={t}
              accent={theme.accent}
              writer={editable ? writer : undefined}
            />
          </div>
        </div>
      )
      break
    case 'thanks': {
      const photos = [0, 1, 2, 3, 4].map((i) => d.photos[i] ?? { url: '', x: 50, y: 50, zoom: 1 })
      const setPhoto = (i: number, p: DesignPhoto) =>
        set(
          'photos',
          photos.map((x, j) => (j === i ? p : x)),
        )
      body = (
        <div className="flex h-full flex-col" style={{ padding: '80px 60px 70px' }}>
          {text(
            'title',
            { ...t.heading(96), textAlign: 'center' },
            { placeholder: 'Thank You', max: 120 },
          )}
          <div style={{ height: 36 }} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gridTemplateRows: '300px 300px',
              gap: 12,
            }}
          >
            {photo(
              photos[0]!,
              (p) => setPhoto(0, p),
              { gridRow: 'span 2', borderRadius: 6 },
              'photos.0',
            )}
            {photo(photos[1]!, (p) => setPhoto(1, p), { borderRadius: 6 }, 'photos.1')}
            {photo(photos[2]!, (p) => setPhoto(2, p), { borderRadius: 6 }, 'photos.2')}
            {photo(photos[3]!, (p) => setPhoto(3, p), { borderRadius: 6 }, 'photos.3')}
            {photo(photos[4]!, (p) => setPhoto(4, p), { borderRadius: 6 }, 'photos.4')}
          </div>
          <div style={{ flex: 1, minHeight: 30 }} />
          {text(
            'subtitle',
            { ...t.body(28), fontStyle: 'italic', textAlign: 'center' },
            { placeholder: 'Looking forward to your wedding', max: 300 },
          )}
          {ai({ kind: 'thanks', current: d.subtitle, lines: [] }, (r) => set('subtitle', r.text), {
            textAlign: 'center',
          })}
        </div>
      )
      break
    }
    case 'packages':
      body = (
        <div className="flex h-full flex-col" style={{ padding: '90px 50px 70px' }}>
          {text(
            'title',
            { ...t.heading(80), textAlign: 'center' },
            { placeholder: 'Our Packages', max: 120 },
          )}
          <div style={{ height: 40 }} />
          <Packages d={d} set={set} editable={editable} t={t} theme={theme} />
          <div style={{ flex: 1, minHeight: 24 }} />
          {text(
            'subtitle',
            { ...t.body(20), fontStyle: 'italic', textAlign: 'center', opacity: 0.8 },
            { placeholder: 'A line under the packages', max: 300 },
          )}
        </div>
      )
      break
    case 'team':
      body = (
        <div className="flex h-full flex-col" style={{ padding: '90px 60px 70px' }}>
          {text(
            'title',
            { ...t.heading(80), textAlign: 'center' },
            { placeholder: 'Our Team', max: 120 },
          )}
          <div style={{ height: 14 }} />
          {text(
            'body',
            { ...t.body(22), fontStyle: 'italic', textAlign: 'center', opacity: 0.85 },
            { placeholder: 'A line about your team', max: 3000, multiline: true },
          )}
          <div style={{ height: 40 }} />
          <People d={d} set={set} editable={editable} t={t} accent={theme.accent} />
        </div>
      )
      break
    case 'testimonial':
      body = (
        <div className="flex h-full flex-col items-center" style={{ padding: '90px 80px 80px' }}>
          {text(
            'title',
            { ...t.heading(80), textAlign: 'center' },
            { placeholder: 'Kind Words', max: 120 },
          )}
          <div style={{ height: 40 }} />
          {photo(d.photo, (p) => set('photo', p), { width: 360, height: 360, borderRadius: 360 })}
          <div style={{ height: 50 }} />
          <div aria-hidden style={{ ...t.heading(110), lineHeight: 0.6, opacity: 0.5 }}>
            “
          </div>
          {text(
            'body',
            { ...t.body(28), fontStyle: 'italic', textAlign: 'center', lineHeight: 1.55 },
            { placeholder: 'What a couple said about you', max: 3000, multiline: true },
          )}
          {ai({ kind: 'testimonial', current: d.body, lines: [] }, (r) => set('body', r.text))}
          <div style={{ height: 24 }} />
          {text(
            'subtitle',
            { ...t.label(17), textAlign: 'center' },
            { placeholder: 'Their names, their city', max: 300 },
          )}
        </div>
      )
      break
  }

  return (
    <PageCtx
      value={{
        pageId: page.id,
        editable,
        styles: d.styles,
        layout: d.layout,
        setBox: (k, box) => {
          const layout = { ...d.layout }
          if (box) layout[k] = box
          else delete layout[k]
          onChange({ ...d, layout })
        },
        setGuides,
      }}
    >
      <div
        className="designer-sheet relative overflow-hidden"
        style={{
          width: PAGE_W,
          height: PAGE_H,
          background: cssPaint(d.background, theme.background),
          color: theme.ink,
        }}
      >
        {body}
        {d.elements.map((el) => (
          <AddedItem
            key={el.id}
            el={el}
            pageId={page.id}
            t={t}
            accent={theme.accent}
            themeColours={[theme.background, theme.ink, theme.panel]}
            editable={editable}
            onData={onChange}
            data={d}
          />
        ))}
        {/* Canva's pink guides while an item is dragged onto the centre or a margin. */}
        {guides.map((g, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute z-30"
            style={
              g.axis === 'x'
                ? { left: g.at - 1, top: 0, bottom: 0, width: 2, background: '#ff3ea5' }
                : { top: g.at - 1, left: 0, right: 0, height: 2, background: '#ff3ea5' }
            }
          />
        ))}
      </div>
    </PageCtx>
  )
}

/**
 * Something the studio added to the page itself (Canva's Text and Elements):
 * it stands where it was put, moves and resizes like everything else, and
 * while picked its bar has its colour (a shape), Copy and Delete.
 */
function AddedItem({
  el,
  pageId,
  t,
  accent,
  editable,
  data,
  onData,
  themeColours = [],
}: {
  el: DesignElement
  pageId: string
  t: Type
  accent: string
  themeColours?: string[]
  editable: boolean
  data: DesignPageData
  onData: (d: DesignPageData) => void
}) {
  const ed = useDesigner()
  const key = elementKey(el.id)
  const patch = (p: Partial<DesignElement>) => onData(updateElement(data, el.id, p))
  const at: CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w }
  const bar = editable ? (
    <>
      {(el.kind === 'line' || el.kind === 'box' || el.kind === 'circle') && (
        <ColourPicker
          value={el.color}
          onChange={(c) => patch({ color: c })}
          gradients
          theme={[accent, ...themeColours]}
          onReset={el.color ? () => patch({ color: '' }) : undefined}
          label="Shape colour"
        >
          <button
            type="button"
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm hover:bg-white/15"
            title="Colour"
          >
            <span className="size-4 rounded-full border border-white/60" style={{ background: cssPaint(el.color, accent) }} />
            Colour
          </button>
        </ColourPicker>
      )}
      <button
        type="button"
        onClick={() => onData(duplicateElement(data, el.id))}
        className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-white/15"
        title="Make a copy (Ctrl+D)"
      >
        <Copy className="size-4" /> Copy
      </button>
      <button
        type="button"
        onClick={() => {
          ed?.select(null)
          onData(removeElement(data, el.id))
        }}
        className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-red-500/80"
        title="Delete (Delete key)"
        aria-label={`Delete this ${ELEMENT_NAMES[el.kind].toLowerCase()}`}
      >
        <Trash2 className="size-4" />
      </button>
    </>
  ) : null

  if (isTextElement(el.kind)) {
    const style =
      el.kind === 'heading'
        ? { ...t.heading(64), textAlign: 'center' as const }
        : el.kind === 'subheading'
          ? { ...t.label(22), textAlign: 'center' as const }
          : { ...t.body(20), textAlign: 'center' as const, lineHeight: 1.5 }
    return (
      <Movable k={key} kind="text" style={at} actions={bar}>
        <SE
          k={key}
          value={el.text}
          onChange={(v) => patch({ text: v })}
          editable={editable}
          style={style}
          placeholder={ELEMENT_NAMES[el.kind]}
          max={1000}
          multiline
        />
      </Movable>
    )
  }

  if (el.kind === 'photo') {
    return <AddedPhoto el={el} pageId={pageId} accent={accent} editable={editable} bar={bar} patch={patch} />
  }

  // A line has a wider band to take hold of than the 3 px it draws.
  const pad = el.kind === 'line' ? 10 : 0
  return (
    <Movable
      k={key}
      kind="shape"
      style={{ ...at, top: el.y - pad, padding: `${pad}px 0` }}
      actions={bar}
    >
      <div
        style={{
          width: el.w,
          height: el.h,
          background: cssPaint(el.color, accent),
          borderRadius: el.kind === 'circle' ? '50%' : el.kind === 'line' ? 2 : 4,
        }}
      />
    </Movable>
  )
}

/** An added photo frame: a new, empty one is picked at once, so a tap in Uploads fills it. */
function AddedPhoto({
  el,
  pageId,
  accent,
  editable,
  bar,
  patch,
}: {
  el: DesignElement
  pageId: string
  accent: string
  editable: boolean
  bar: ReactNode
  patch: (p: Partial<DesignElement>) => void
}) {
  const ed = useDesigner()
  const key = elementKey(el.id)
  const frameId = `${pageId}:${key}`
  const pick = () => ed?.pickFrame({ id: frameId, apply: (p) => patch({ photo: p }) })
  const fresh = editable && !el.photo.url && ed?.selected === frameId && ed.pickedFrame !== frameId
  useEffect(() => {
    if (fresh) pick()
  })
  return (
    <Movable
      k={key}
      kind="photo"
      style={{ position: 'absolute', left: el.x, top: el.y, width: el.w }}
      actions={bar}
      onTap={pick}
    >
      <PhotoFrame
        frameId={frameId}
        photo={el.photo}
        onChange={(p) => patch({ photo: p })}
        editable={editable}
        accent={accent}
        style={{ width: el.w, height: el.h, borderRadius: 6 }}
      />
    </Movable>
  )
}

/** A layout's text style with the studio's own settings on top (Canva's text bar). */
export function withTextStyle(base: CSSProperties, ts: DesignTextStyle | undefined): CSSProperties {
  if (!ts) return base
  const out: CSSProperties = { ...base }
  if (ts.scale && typeof base.fontSize === 'number')
    out.fontSize = Math.round(base.fontSize * ts.scale * 10) / 10
  if (ts.align) out.textAlign = ts.align
  if (ts.color) out.color = ts.color
  if (ts.bold !== undefined) out.fontWeight = ts.bold ? 700 : 400
  if (ts.italic !== undefined) out.fontStyle = ts.italic ? 'italic' : 'normal'
  return out
}

/** A text on the page that takes its own style and tells the editor when it has the cursor. */
function SE({ k, style, ...rest }: Omit<EditableProps, 'onFocus' | 'active'> & { k: string }) {
  const page = use(PageCtx)
  const ed = useDesigner()
  return (
    <Editable
      {...rest}
      style={withTextStyle(style ?? {}, page?.styles[k])}
      onFocus={
        page && ed
          ? () => {
              ed.setActiveText({ pageId: page.pageId, key: k })
              ed.select(`${page.pageId}:${k}`)
            }
          : undefined
      }
      active={!!page && ed?.activeText?.pageId === page.pageId && ed?.activeText?.key === k}
    />
  )
}

type Type = ReturnType<typeof useType>

function useType(theme: DesignTheme) {
  const script = isScript(theme.heading)
  return {
    heading: (px: number): CSSProperties => ({
      fontFamily: fontStack(theme.heading, script),
      fontSize: script ? px : Math.round(px * 0.72),
      lineHeight: 1.1,
      color: theme.accent,
      fontWeight: script ? 400 : 600,
    }),
    body: (px: number): CSSProperties => ({ fontFamily: fontStack(theme.body), fontSize: px }),
    label: (px: number): CSSProperties => ({
      fontFamily: fontStack(theme.body),
      fontSize: px,
      letterSpacing: '0.22em',
      textTransform: 'uppercase',
      fontWeight: 600,
      color: theme.accent,
    }),
  }
}

function Row({ label, t, children }: { label: string; t: Type; children: ReactNode }) {
  return (
    <div className="flex items-baseline" style={{ gap: 16, padding: '7px 0' }}>
      <span style={{ ...t.label(15), width: 150, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

/** A bulleted list typed in place: Enter adds the next line, Backspace on an empty one removes it. */
function Lines({
  k,
  lines,
  onChange,
  editable,
  style,
  accent,
  placeholder,
  max,
}: {
  k: string
  lines: string[]
  onChange: (v: string[]) => void
  editable: boolean
  style: CSSProperties
  accent: string
  placeholder: string
  max: number
}) {
  const [focus, setFocus] = useState<number | null>(null)
  const shown = editable ? lines : lines.filter((l) => l.trim())
  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      {shown.map((line, i) => (
        <div key={i} className="flex items-baseline" style={{ gap: 14 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 8,
              background: accent,
              flexShrink: 0,
              transform: 'translateY(-4px)',
            }}
          />
          <SE
            k={k}
            value={line}
            editable={editable}
            max={400}
            placeholder={placeholder}
            style={{ ...style, flex: 1 }}
            autoFocus={focus === i}
            onChange={(v) => onChange(lines.map((x, j) => (j === i ? v : x)))}
            onEnter={() => {
              if (lines.length >= max) return
              onChange([...lines.slice(0, i + 1), '', ...lines.slice(i + 1)])
              setFocus(i + 1)
            }}
            onEmptyBackspace={() => {
              onChange(lines.filter((_, j) => j !== i))
              setFocus(Math.max(0, i - 1))
            }}
          />
        </div>
      ))}
      {editable && lines.length < max && (
        <AddButton
          onClick={() => {
            onChange([...lines, ''])
            setFocus(lines.length)
          }}
        >
          Add a line
        </AddButton>
      )}
    </div>
  )
}

function Stats({
  d,
  set,
  editable,
  t,
  accent,
}: {
  d: DesignPageData
  set: <K extends keyof DesignPageData>(k: K, v: DesignPageData[K]) => void
  editable: boolean
  t: Type
  accent: string
}) {
  const stats = editable ? d.stats : d.stats.filter((s) => s.value || s.label)
  return (
    <div className="flex flex-wrap items-start" style={{ gap: 40 }}>
      {stats.map((s, i) => (
        <div key={i} className="group/stat relative" style={{ minWidth: 150 }}>
          <SE
            k="stats.value"
            value={s.value}
            editable={editable}
            max={20}
            placeholder="8+"
            style={{ ...t.body(52), fontWeight: 700, color: accent, lineHeight: 1 }}
            onChange={(v) =>
              set(
                'stats',
                d.stats.map((x, j) => (j === i ? { ...x, value: v } : x)),
              )
            }
          />
          <SE
            k="stats.label"
            value={s.label}
            editable={editable}
            max={60}
            placeholder="Years of Experience"
            style={{ ...t.body(18), fontStyle: 'italic', marginTop: 6 }}
            onChange={(v) =>
              set(
                'stats',
                d.stats.map((x, j) => (j === i ? { ...x, label: v } : x)),
              )
            }
          />
          {editable && (
            <RemoveButton
              label="Remove this figure"
              onClick={() =>
                set(
                  'stats',
                  d.stats.filter((_, j) => j !== i),
                )
              }
            />
          )}
        </div>
      ))}
      {editable && d.stats.length < 4 && (
        <AddButton onClick={() => set('stats', [...d.stats, { value: '', label: '' }])}>
          Add a figure
        </AddButton>
      )}
    </div>
  )
}

function Addons({
  d,
  set,
  editable,
  t,
  accent,
  writer,
}: {
  d: DesignPageData
  set: <K extends keyof DesignPageData>(k: K, v: DesignPageData[K]) => void
  editable: boolean
  t: Type
  accent: string
  writer?: Writer | undefined
}) {
  const put = (i: number, a: DesignPageData['addons'][number]) =>
    set(
      'addons',
      d.addons.map((x, j) => (j === i ? a : x)),
    )
  return (
    <div className="flex flex-col" style={{ gap: 20 }}>
      {d.addons.map((a, i) => (
        <div key={i} className="group/stat relative">
          <SE
            k="addons.name"
            value={a.name}
            editable={editable}
            max={80}
            placeholder="Pre Wedding Shoot"
            style={{ ...t.heading(44) }}
            onChange={(v) => put(i, { ...a, name: v })}
          />
          <div style={{ height: 6 }} />
          <Lines
            k="addons.lines"
            lines={a.lines}
            onChange={(lines) => put(i, { ...a, lines })}
            editable={editable}
            style={{ ...t.body(20), fontStyle: 'italic' }}
            accent={accent}
            placeholder="1 day, 2 locations · INR 25,000/-"
            max={12}
          />
          {editable && writer && a.name.trim() && (
            <div style={{ marginTop: 6 }}>
              <WriteButton
                ask={{ kind: 'addon', current: a.name, lines: a.lines }}
                writer={writer}
                onWritten={(r) => put(i, { ...a, lines: r.lines })}
              />
            </div>
          )}
          {editable && (
            <RemoveButton
              label="Remove this add-on"
              onClick={() =>
                set(
                  'addons',
                  d.addons.filter((_, j) => j !== i),
                )
              }
            />
          )}
        </div>
      ))}
      {editable && d.addons.length < 12 && (
        <AddButton onClick={() => set('addons', [...d.addons, { name: '', lines: [''] }])}>
          Add an add-on
        </AddButton>
      )}
    </div>
  )
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="designer-chrome inline-flex w-fit items-center gap-2 rounded-full border-2 border-dashed border-amber-500/70 bg-amber-50/80 px-4 py-1.5 text-amber-800 hover:bg-amber-100"
      style={{ fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: 600 }}
    >
      <Plus className="size-4" aria-hidden /> {children}
    </button>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="designer-chrome absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full border border-border bg-white text-muted-foreground opacity-0 shadow transition-opacity hover:text-destructive group-hover/stat:opacity-100 focus:opacity-100"
    >
      <X className="size-4" />
    </button>
  )
}

type Setter = <K extends keyof DesignPageData>(k: K, v: DesignPageData[K]) => void

/** Two or three packages side by side, the middle one raised. */
function Packages({
  d,
  set,
  editable,
  t,
  theme,
}: {
  d: DesignPageData
  set: Setter
  editable: boolean
  t: Type
  theme: DesignTheme
}) {
  const put = (i: number, p: DesignPageData['packages'][number]) =>
    set(
      'packages',
      d.packages.map((x, j) => (j === i ? p : x)),
    )
  const n = d.packages.length
  return (
    <div className="flex items-stretch" style={{ gap: 18 }}>
      {d.packages.map((p, i) => {
        const raised = n === 3 && i === 1
        return (
          <div
            key={i}
            className="group/stat relative flex flex-1 flex-col"
            style={{
              background: raised ? theme.accent : theme.panel,
              color: raised ? theme.background : theme.ink,
              borderRadius: 16,
              padding: '30px 24px',
              transform: raised ? 'translateY(-14px)' : undefined,
              border: raised ? 'none' : `1.5px solid ${theme.accent}55`,
            }}
          >
            <SE
              k="packages.name"
              value={p.name}
              editable={editable}
              max={60}
              placeholder="Gold"
              style={{
                ...t.label(18),
                color: raised ? theme.background : theme.accent,
                textAlign: 'center',
              }}
              onChange={(v) => put(i, { ...p, name: v })}
            />
            <div style={{ height: 12 }} />
            <SE
              k="packages.price"
              value={p.price}
              editable={editable}
              max={60}
              placeholder="INR 1,85,000/-"
              style={{ ...t.body(24), fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}
              onChange={(v) => put(i, { ...p, price: v })}
            />
            <div
              style={{
                height: 1,
                background: raised ? `${theme.background}55` : `${theme.accent}44`,
                margin: '20px 0',
              }}
            />
            <Lines
              k="packages.lines"
              lines={p.lines}
              onChange={(lines) => put(i, { ...p, lines })}
              editable={editable}
              style={{ ...t.body(18), lineHeight: 1.4 }}
              accent={raised ? theme.background : theme.accent}
              placeholder="What it includes"
              max={10}
            />
            {editable && (
              <RemoveButton
                label="Remove this package"
                onClick={() =>
                  set(
                    'packages',
                    d.packages.filter((_, j) => j !== i),
                  )
                }
              />
            )}
          </div>
        )
      })}
      {editable && n < 3 && (
        <div className="flex items-center">
          <AddButton
            onClick={() => set('packages', [...d.packages, { name: '', price: '', lines: [''] }])}
          >
            Add a package
          </AddButton>
        </div>
      )}
    </div>
  )
}

/** Up to eight people, round photos, name and role. */
function People({
  d,
  set,
  editable,
  t,
  accent,
}: {
  d: DesignPageData
  set: Setter
  editable: boolean
  t: Type
  accent: string
}) {
  const put = (i: number, p: DesignPageData['people'][number]) =>
    set(
      'people',
      d.people.map((x, j) => (j === i ? p : x)),
    )
  return (
    <div className="flex flex-wrap justify-center" style={{ gap: '36px 30px' }}>
      {d.people.map((p, i) => (
        <div
          key={i}
          className="group/stat relative flex flex-col items-center"
          style={{ width: 200 }}
        >
          <Movable k={`people.${i}`} kind="photo">
            <PhotoFrame
              frameId={`${use(PageCtx)?.pageId}:people.${i}`}
              photo={p.photo}
              onChange={(photo) => put(i, { ...p, photo })}
              editable={editable}
              accent={accent}
              style={{ width: 180, height: 180, borderRadius: 180 }}
            />
          </Movable>
          <div style={{ height: 14 }} />
          <SE
            k="people.name"
            value={p.name}
            editable={editable}
            max={80}
            placeholder="Name"
            style={{ ...t.body(24), fontWeight: 700, textAlign: 'center' }}
            onChange={(v) => put(i, { ...p, name: v })}
          />
          <SE
            k="people.role"
            value={p.role}
            editable={editable}
            max={80}
            placeholder="Role"
            style={{ ...t.label(14), textAlign: 'center', marginTop: 4 }}
            onChange={(v) => put(i, { ...p, role: v })}
          />
          {editable && (
            <RemoveButton
              label="Remove this person"
              onClick={() =>
                set(
                  'people',
                  d.people.filter((_, j) => j !== i),
                )
              }
            />
          )}
        </div>
      ))}
      {editable && d.people.length < 8 && (
        <div className="flex items-center">
          <AddButton
            onClick={() =>
              set('people', [
                ...d.people,
                { name: '', role: '', photo: { url: '', x: 50, y: 50, zoom: 1 } },
              ])
            }
          >
            Add a person
          </AddButton>
        </div>
      )}
    </div>
  )
}
