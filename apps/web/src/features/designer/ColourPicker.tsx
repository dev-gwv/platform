import { useState, type ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/ui/cn'
import {
  DIRECTIONS,
  GRADIENTS,
  PALETTE,
  cssPaint,
  hexFrom,
  isGradient,
  makeGradient,
  parseGradient,
  recentPaints,
  rememberPaint,
  type Gradient,
} from './paint'

/**
 * The designer's one colour picker (owner, 10 Nov: "a lot of control ... to
 * the color tones in the background", "including gradient"). Solid: this
 * design's own colours, recent picks, ten families of eight, and any colour by
 * picker or hex code. Gradient (where `gradients`): eighteen ready-made, or two
 * or three colours of your own in five directions. Dark like the editor.
 */
export function ColourPicker({
  value,
  onChange,
  gradients = false,
  theme = [],
  onReset,
  children,
  label = 'Colour',
}: {
  /** The paint now: '' for the look's own. */
  value: string
  onChange: (paint: string) => void
  gradients?: boolean
  /** This design's own colours, offered first. */
  theme?: string[]
  /** "Back to the look's colour", when there is one to go back to. */
  onReset?: (() => void) | undefined
  /** The trigger. */
  children: ReactNode
  label?: string
}) {
  const [tab, setTab] = useState<'solid' | 'gradient'>(gradients && isGradient(value) ? 'gradient' : 'solid')
  const [recent, setRecent] = useState<string[]>([])
  const pick = (p: string) => {
    onChange(p)
    rememberPaint(p)
    setRecent(recentPaints())
  }
  const shownRecent = recent.filter((p) => gradients || !isGradient(p))

  return (
    <Popover onOpenChange={(o) => o && setRecent(recentPaints())}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[320px] border-white/10 bg-[#1f2024] p-3 text-white"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // A pick must not take the cursor out of the text it colours.
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('input')) e.preventDefault()
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{label}</p>
          {onReset && (
            <button type="button" onClick={onReset} className="rounded-md px-2 py-0.5 text-xs text-white/70 hover:bg-white/10 hover:text-white">
              Reset
            </button>
          )}
        </div>
        {gradients && (
          <div className="mb-3 grid grid-cols-2 rounded-lg bg-white/10 p-1 text-sm" role="tablist">
            {(['solid', 'gradient'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn('rounded-md py-1 font-medium', tab === t ? 'bg-white text-slate-900' : 'text-white/70 hover:text-white')}
              >
                {t === 'solid' ? 'Solid' : 'Gradient'}
              </button>
            ))}
          </div>
        )}
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          {tab === 'solid' ? (
            <Solid value={value} theme={theme} recent={shownRecent} onPick={pick} />
          ) : (
            <Gradients value={value} theme={theme} recent={shownRecent.filter(isGradient)} onPick={pick} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Swatch({ paint, on, title, onPick }: { paint: string; on: boolean; title: string; onPick: (p: string) => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={() => onPick(paint)}
      className={cn(
        'relative size-7 rounded-md border transition-transform hover:scale-110',
        on ? 'border-violet-300 ring-2 ring-violet-400' : 'border-white/20',
      )}
      style={{ background: cssPaint(paint, '#000') }}
    >
      {on && <Check className="absolute inset-0 m-auto size-3.5 text-white mix-blend-difference" aria-hidden />}
    </button>
  )
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/50">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Solid({ value, theme, recent, onPick }: { value: string; theme: string[]; recent: string[]; onPick: (p: string) => void }) {
  const solid = isGradient(value) ? '' : value
  const [hex, setHex] = useState(solid)
  return (
    <>
      <div className="flex items-center gap-2">
        <label
          className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-white/20"
          style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
          title="Any colour"
        >
          <Plus className="size-4 text-white drop-shadow" aria-hidden />
          <input
            type="color"
            value={solid || '#C9A55C'}
            onChange={(e) => {
              setHex(e.target.value.toUpperCase())
              onPick(e.target.value.toUpperCase())
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Any colour"
          />
        </label>
        <input
          value={hex}
          onChange={(e) => {
            setHex(e.target.value)
            const h = hexFrom(e.target.value)
            if (h) onPick(h)
          }}
          placeholder="#C9A55C"
          maxLength={7}
          aria-label="Colour code"
          className="h-9 min-w-0 flex-1 rounded-md border border-white/20 bg-white/5 px-2 font-mono text-sm uppercase text-white placeholder:text-white/30"
        />
      </div>
      {theme.length > 0 && (
        <Row title="This design">
          {[...new Set(theme.map((t) => t.toUpperCase()))].map((c) => (
            <Swatch key={c} paint={c} on={solid.toUpperCase() === c} title={c} onPick={onPick} />
          ))}
        </Row>
      )}
      {recent.filter((p) => !isGradient(p)).length > 0 && (
        <Row title="Used lately">
          {recent.filter((p) => !isGradient(p)).map((c) => (
            <Swatch key={c} paint={c} on={solid.toUpperCase() === c} title={c} onPick={onPick} />
          ))}
        </Row>
      )}
      {PALETTE.map((f) => (
        <Row key={f.name} title={f.name}>
          {f.colours.map((c) => (
            <Swatch key={c} paint={c} on={solid.toUpperCase() === c} title={c} onPick={onPick} />
          ))}
        </Row>
      ))}
    </>
  )
}

function Gradients({ value, theme, recent, onPick }: { value: string; theme: string[]; recent: string[]; onPick: (p: string) => void }) {
  const now = parseGradient(value)
  const [g, setG] = useState<Gradient>(
    now ?? { kind: 'linear', angle: 135, stops: [theme[0] ?? '#F6E3B4', theme[1] ?? '#C9A55C'] },
  )
  const set = (next: Gradient) => {
    setG(next)
    onPick(makeGradient(next))
  }
  return (
    <>
      <Row title="Ready-made">
        {GRADIENTS.map((x) => (
          <button
            key={x.name}
            type="button"
            title={x.name}
            aria-label={x.name}
            aria-pressed={value === x.paint}
            onClick={() => {
              const p = parseGradient(x.paint)
              if (p) setG(p)
              onPick(x.paint)
            }}
            className={cn(
              'flex h-12 w-[calc(33.333%-0.25rem)] items-end rounded-md border p-1 text-left transition-transform hover:scale-[1.04]',
              value === x.paint ? 'border-violet-300 ring-2 ring-violet-400' : 'border-white/20',
            )}
            style={{ background: cssPaint(x.paint, '#000') }}
          >
            <span className="rounded bg-black/45 px-1 text-[10px] font-medium leading-4 text-white">{x.name}</span>
          </button>
        ))}
      </Row>
      {recent.length > 0 && (
        <Row title="Used lately">
          {recent.map((p) => (
            <Swatch key={p} paint={p} on={value === p} title="A gradient you used" onPick={onPick} />
          ))}
        </Row>
      )}
      <div className="rounded-lg border border-white/15 p-2.5">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/50">Make your own</p>
        <div className="mb-2 h-10 rounded-md border border-white/20" style={{ background: cssPaint(makeGradient(g), '#000') }} />
        <div className="mb-2 flex items-center gap-2">
          {g.stops.map((c, i) => (
            <label key={i} className="relative size-8 cursor-pointer overflow-hidden rounded-md border border-white/30" style={{ background: c }} title={`Colour ${i + 1}`}>
              <input
                type="color"
                value={c}
                onChange={(e) => set({ ...g, stops: g.stops.map((s, j) => (j === i ? e.target.value.toUpperCase() : s)) })}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={`Gradient colour ${i + 1}`}
              />
            </label>
          ))}
          {g.stops.length < 3 ? (
            <button
              type="button"
              onClick={() => set({ ...g, stops: [...g.stops, '#FFFFFF'] })}
              className="flex h-8 items-center gap-1 rounded-md border border-dashed border-white/30 px-2 text-xs text-white/80 hover:bg-white/10"
            >
              <Plus className="size-3.5" /> Colour
            </button>
          ) : (
            <button
              type="button"
              onClick={() => set({ ...g, stops: g.stops.slice(0, 2) })}
              className="h-8 rounded-md px-2 text-xs text-white/70 hover:bg-white/10"
            >
              Two colours
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {DIRECTIONS.map((d) => {
            const on = g.kind === d.g.kind && (d.g.kind === 'radial' || g.angle === d.g.angle)
            return (
              <button
                key={d.title}
                type="button"
                title={d.title}
                aria-label={d.title}
                aria-pressed={on}
                onClick={() => set({ ...g, ...d.g })}
                className={cn(
                  'flex size-8 items-center justify-center rounded-md border text-base',
                  on ? 'border-violet-300 bg-violet-500/30' : 'border-white/20 hover:bg-white/10',
                )}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
