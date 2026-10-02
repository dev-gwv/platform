import { Eye } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { useClientActivity } from './api'
import { clientActivityLines } from './client-activity'

/**
 * What the client did with the documents, on the Overview: up to three lines
 * ("Quotation opened · 2 Oct, 6:40 pm (3 times)", "Accepted by Priya"). Hidden
 * until the client has done something.
 */
export function ClientActivityCard({ projectId }: { projectId: string }) {
  const lines = clientActivityLines(useClientActivity(projectId).data)
  if (lines.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Eye className="size-4 text-tone-teal" aria-hidden /> What the client did
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1.5 text-sm">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
