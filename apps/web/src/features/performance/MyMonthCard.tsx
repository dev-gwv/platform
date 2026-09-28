import { Link } from '@tanstack/react-router'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { useMyMonth } from './api'
import { LateNow, ScoreNumber, ScoreParts } from './Scorecard'

/** The member's month on their dashboard: the score, the four parts in words, and what is late. */
export function MyMonthCard() {
  const m = useMyMonth()
  if (!m.data) return null
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>My month</CardTitle>
        <span className="flex items-center gap-3">
          <ScoreNumber score={m.data.score} className="text-2xl" />
          <Button asChild variant="ghost" size="sm">
            <Link to="/performance/me">Details</Link>
          </Button>
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ScoreParts card={m.data} />
        <LateNow card={m.data} />
      </CardContent>
    </Card>
  )
}
