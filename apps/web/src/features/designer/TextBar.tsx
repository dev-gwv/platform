import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react'
import type { DesignTextStyle, DesignTheme } from '@ipc/contracts'
import { ColourPicker } from './ColourPicker'
import { cn } from '@/shared/ui/cn'

/**
 * Canva's text bar (0297): shown while a text on the page has the cursor.
 * Size, alignment, colour, bold and italic for that one text; Reset puts the
 * layout's own back. The buttons keep the cursor where it was.
 */
export function TextBar({
  style,
  theme,
  onStyle,
}: {
  style: DesignTextStyle
  theme: DesignTheme
  onStyle: (s: DesignTextStyle) => void
}) {
  const scale = style.scale ?? 1
  const keep = (e: React.MouseEvent) => e.preventDefault()
  const btn = (on: boolean) =>
    cn(
      'flex size-8 items-center justify-center rounded-md text-white/80 hover:bg-white/15 hover:text-white',
      on && 'bg-white/20 text-white',
    )
  const swatches = [theme.ink, theme.accent, '#FFFFFF', '#000000']
  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#2b2d31] px-2 py-1 text-white shadow-lg"
      onMouseDown={keep}
      role="toolbar"
      aria-label="Text"
    >
      <button
        type="button"
        className={btn(false)}
        onClick={() =>
          onStyle({ ...style, scale: Math.max(0.4, Math.round((scale - 0.1) * 10) / 10) })
        }
        aria-label="Smaller"
        title="Smaller"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
      <button
        type="button"
        className={btn(false)}
        onClick={() =>
          onStyle({ ...style, scale: Math.min(2.5, Math.round((scale + 0.1) * 10) / 10) })
        }
        aria-label="Bigger"
        title="Bigger"
      >
        <Plus className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-white/15" />
      {(
        [
          ['left', AlignLeft],
          ['center', AlignCenter],
          ['right', AlignRight],
        ] as const
      ).map(([a, Icon]) => (
        <button
          key={a}
          type="button"
          className={btn(style.align === a)}
          onClick={() => onStyle({ ...style, align: a })}
          aria-label={`Align ${a}`}
          title={`Align ${a}`}
        >
          <Icon className="size-4" />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-white/15" />
      <button
        type="button"
        className={btn(!!style.bold)}
        onClick={() => onStyle({ ...style, bold: !style.bold })}
        aria-label="Bold"
        title="Bold"
      >
        <Bold className="size-4" />
      </button>
      <button
        type="button"
        className={btn(!!style.italic)}
        onClick={() => onStyle({ ...style, italic: !style.italic })}
        aria-label="Italic"
        title="Italic"
      >
        <Italic className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-white/15" />
      {swatches.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onStyle({ ...style, color: c.toUpperCase() })}
          aria-label={`Colour ${c}`}
          title="Text colour"
          className={cn(
            'size-6 rounded-full border-2',
            style.color?.toUpperCase() === c.toUpperCase()
              ? 'border-violet-400'
              : 'border-white/30',
          )}
          style={{ background: c }}
        />
      ))}
      <ColourPicker
        value={style.color ?? ''}
        onChange={(c) => onStyle({ ...style, color: c })}
        theme={[theme.ink, theme.accent, theme.background, theme.panel]}
        label="Text colour"
      >
        <button
          type="button"
          className="size-6 rounded-full border-2 border-white/30"
          title="More colours"
          aria-label="More colours"
          style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
        />
      </ColourPicker>
      <span className="mx-1 h-5 w-px bg-white/15" />
      <button
        type="button"
        className={btn(false)}
        onClick={() => onStyle({})}
        aria-label="Reset text style"
        title="Back to the layout's style"
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  )
}
