import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/ui/cn'
import { todayInIndia } from '@/shared/ui/days-left'
import { TEMPLATES } from '@/features/designer/templates'
import { designerFontsReady, loadDesignerFonts } from '@/features/designer/fonts'
import { CARD, drawReferralCard, type CardData } from './draw'

/**
 * A referral card drawn live from what is on screen (a sample couple on the
 * defaults page and before a client is picked), in the look's own fonts.
 */
export function CardPreview({ data, look, className }: { data: CardData; look: string | null | undefined; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(0)
  const theme = (TEMPLATES.find((t) => t.key === look) ?? TEMPLATES[0]!).theme

  useEffect(() => {
    loadDesignerFonts()
    let live = true
    void (async () => {
      await designerFontsReady()
      try {
        await Promise.all([
          document.fonts.load(`92px '${theme.heading}'`),
          document.fonts.load(`700 60px '${theme.body}'`),
          document.fonts.load(`italic 32px '${theme.body}'`),
        ])
      } catch {
        /* drawn in the fallback face */
      }
      if (live) setReady((n) => n + 1)
    })()
    return () => {
      live = false
    }
  }, [theme.heading, theme.body])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawReferralCard(ctx, data, theme, null)
  }, [data, theme, ready])

  return (
    <canvas
      ref={canvas}
      width={CARD}
      height={CARD}
      className={cn('aspect-square w-full rounded-xl border border-border shadow-md', className)}
      aria-label="How the referral card looks"
    />
  )
}

/** The sample couple a preview is drawn for. */
export const sampleCard = (studio: string, d: Pick<CardData, 'friendType' | 'friendValue' | 'friendTitle'> & { validDays?: number | undefined }): CardData => ({
  studio,
  from: 'Priya & Rahul',
  friendType: d.friendType,
  friendValue: d.friendValue,
  friendTitle: d.friendTitle,
  code: 'sample-a1b2c3',
  link: `${window.location.origin}/refer/sample-a1b2c3`,
  validUntil: d.validDays ? addDays(todayInIndia(), d.validDays) : null,
})

function addDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
