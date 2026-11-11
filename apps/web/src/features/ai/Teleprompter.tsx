import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react'
import { DEFAULT_SPEED_INDEX, SPEEDS, pxPerSecond, stepSpeed } from './teleprompter'

const SIZES = [28, 34, 40, 48, 56] as const

/**
 * The model reads the script from a phone or laptop (owner, 10 Nov: "give
 * that to the model"): big white words on black, scrolling at speaking speed,
 * with play and pause, slower and faster, and the text size. Space plays or
 * pauses, Escape closes.
 */
export function Teleprompter({ title, lines, seconds, onClose }: { title: string; lines: string[]; seconds: number; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(DEFAULT_SPEED_INDEX)
  const [size, setSize] = useState(2)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = before
    }
  }, [onClose])

  useEffect(() => {
    if (!playing) return
    const el = box.current
    if (!el) return
    let last = performance.now()
    let carry = el.scrollTop
    let frame = 0
    const tick = (now: number) => {
      const room = el.scrollHeight - el.clientHeight
      const rate = pxPerSecond(room, Math.max(seconds, 10), SPEEDS[speed] ?? 1)
      carry += (rate * (now - last)) / 1000
      last = now
      el.scrollTop = carry
      if (carry >= room) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [playing, speed, seconds])

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`Teleprompter: ${title}`}>
      <div ref={box} className="flex-1 overflow-y-auto px-6 sm:px-16" onClick={() => setPlaying((p) => !p)}>
        <div className="mx-auto max-w-3xl py-[40vh]">
          {lines.map((l, i) => (
            <p key={i} className="mb-[0.9em] font-semibold leading-snug" style={{ fontSize: SIZES[size] }}>
              {l}
            </p>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-[38vh] h-px bg-amber-400/40" aria-hidden />
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/15 bg-black/90 px-3 py-3">
        <PromptButton label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} wide>
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          {playing ? 'Pause' : 'Play'}
        </PromptButton>
        <PromptButton
          label="Start again"
          onClick={() => {
            setPlaying(false)
            box.current?.scrollTo({ top: 0 })
          }}
        >
          <RotateCcw className="size-4" />
        </PromptButton>
        <span className="mx-1 flex items-center gap-1 rounded-full bg-white/10 px-1">
          <PromptButton label="Slower" onClick={() => setSpeed((s) => stepSpeed(s, -1))}>
            <Minus className="size-4" />
          </PromptButton>
          <span className="w-14 text-center text-sm tabular-nums">{SPEEDS[speed]}×</span>
          <PromptButton label="Faster" onClick={() => setSpeed((s) => stepSpeed(s, 1))}>
            <Plus className="size-4" />
          </PromptButton>
        </span>
        <span className="flex items-center gap-1 rounded-full bg-white/10 px-1">
          <PromptButton label="Smaller text" onClick={() => setSize((s) => Math.max(0, s - 1))}>
            <span className="text-xs font-bold">A−</span>
          </PromptButton>
          <PromptButton label="Bigger text" onClick={() => setSize((s) => Math.min(SIZES.length - 1, s + 1))}>
            <span className="text-base font-bold">A+</span>
          </PromptButton>
        </span>
        <PromptButton label="Close" onClick={onClose}>
          <X className="size-5" />
        </PromptButton>
      </div>
    </div>,
    document.body,
  )
}

function PromptButton({ label, onClick, children, wide }: { label: string; onClick: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        wide
          ? 'flex h-11 items-center gap-2 rounded-full bg-amber-400 px-5 font-semibold text-black hover:bg-amber-300'
          : 'flex size-10 items-center justify-center rounded-full text-white hover:bg-white/15'
      }
    >
      {children}
    </button>
  )
}
