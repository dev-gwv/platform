import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** The link a UPI app understands: who to pay, how much, and what for. */
export function upiLink({ upi, name, amount, note }: { upi: string; name: string; amount: number; note: string }): string {
  const p = new URLSearchParams()
  p.set('pa', upi.trim())
  p.set('pn', name.slice(0, 60))
  if (amount > 0) p.set('am', amount.toFixed(2))
  p.set('cu', 'INR')
  p.set('tn', note.slice(0, 60))
  return `upi://pay?${p.toString()}`
}

/**
 * A scan-to-pay square on the invoice. Drawn as SVG so it prints sharp and
 * needs nothing fetched: the invoice may be opened from a WhatsApp link on
 * a slow connection.
 */
export function UpiQr({ value, size = 112, className }: { value: string; size?: number; className?: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  }, [value])
  return (
    <span
      role="img"
      aria-label="Scan to pay by UPI"
      className={className}
      style={{ display: 'inline-block', width: size, height: size }}
      // The generator's own SVG: our data, not user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
