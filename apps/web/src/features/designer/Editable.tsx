import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { cn } from '@/shared/ui/cn'

/**
 * Text typed straight onto the page, the way Canva edits a text box. The
 * element is uncontrolled while it has the cursor (a re-render would throw
 * the caret to the start) and follows the document otherwise.
 * `multiline` keeps Enter as a new line; a single line hands Enter to
 * `onEnter` (a list adds the next line) and Backspace on an empty line to
 * `onEmptyBackspace` (a list drops it).
 */
export function Editable({
  value,
  onChange,
  editable,
  placeholder,
  multiline = false,
  max,
  className,
  style,
  onEnter,
  onEmptyBackspace,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  editable: boolean
  placeholder?: string | undefined
  multiline?: boolean | undefined
  max: number
  className?: string | undefined
  style?: CSSProperties | undefined
  onEnter?: (() => void) | undefined
  onEmptyBackspace?: (() => void) | undefined
  autoFocus?: boolean | undefined
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    if (el.textContent !== value) el.textContent = value
  }, [value])

  useLayoutEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus()
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [autoFocus])

  if (!editable) {
    if (!value) return null
    return (
      <div className={cn('whitespace-pre-line', className)} style={style}>
        {value}
      </div>
    )
  }

  const read = () => {
    const raw = ref.current?.innerText ?? ''
    const text = (multiline ? raw : raw.replace(/\s*\n\s*/g, ' ')).slice(0, max)
    if (text !== value) onChange(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      read()
      onEnter?.()
    } else if (e.key === 'Backspace' && onEmptyBackspace && !(ref.current?.textContent ?? '')) {
      e.preventDefault()
      onEmptyBackspace()
    }
  }

  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline={multiline}
      aria-label={placeholder}
      tabIndex={0}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={cn('designer-editable whitespace-pre-line', className)}
      style={style}
      onInput={read}
      onBlur={read}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        // Words only: a paste from a website must not bring its fonts along.
        e.preventDefault()
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
      }}
    />
  )
}
