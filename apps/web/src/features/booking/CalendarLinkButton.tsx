import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Check, Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { calendarLink, type CalendarScope } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'

/** Google Calendar's "add by URL" page, given the link as webcal://. */
export function googleAddUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace(/^https?:/, 'webcal:'))}`
}

const WORDS: Record<CalendarScope, { button: string; title: string; what: string }> = {
  mine: {
    button: 'Add to Google Calendar',
    title: 'Your shoots in Google Calendar',
    what: 'Every shoot you are booked on, with the venue and your role. A new or moved booking shows up by itself.',
  },
  studio: {
    button: 'Shoots in Google Calendar',
    title: 'The studio’s shoots in Google Calendar',
    what: 'Every shoot day with its crew. A new or moved shoot shows up by itself.',
  },
}

/**
 * Shoots in Google Calendar (0257): one link, subscribed to once. Google
 * reads it again every few hours, so nobody sends a file per booking. The
 * link is a secret -- anyone holding it can see these shoots -- so "Make a
 * new link" ends the old one.
 */
export function CalendarLinkButton({ scope, size = 'sm' }: { scope: CalendarScope; size?: 'sm' | 'default' }) {
  const [open, setOpen] = useState(false)
  const words = WORDS[scope]
  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <CalendarPlus /> {words.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={words.title} className="sm:max-w-md">
          {open && <LinkBody scope={scope} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function LinkBody({ scope }: { scope: CalendarScope }) {
  const qc = useQueryClient()
  const key = ['calendar-link', scope]
  const link = useQuery({
    queryKey: key,
    queryFn: () => callApi(`/calendar/link?scope=${scope}`, { responseSchema: calendarLink }),
  })
  const rotate = useMutation({
    mutationFn: () => callApi('/calendar/link/rotate', { method: 'POST', body: { scope }, responseSchema: calendarLink }),
    onSuccess: (r) => {
      qc.setQueryData(key, r)
      setConfirming(false)
      toast.success('New link made. The old one has stopped working: add this one to your calendar.')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not make a new link.'),
  })
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const url = link.data?.url ?? ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy did not work here. Select the link and copy it.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{WORDS[scope].what}</p>
      <Button asChild disabled={!url}>
        <a href={url ? googleAddUrl(url) : undefined} target="_blank" rel="noreferrer">
          <CalendarPlus /> Open in Google Calendar
        </a>
      </Button>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">On an iPhone or in Outlook, add this link as a subscribed calendar:</p>
        <div className="flex gap-2">
          <Input readOnly value={link.isLoading ? 'Making your link…' : url} aria-label="Calendar link" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" onClick={() => void copy()} disabled={!url} aria-label="Copy link">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Google checks for new shoots every few hours. Anyone with this link can see these shoots, so keep it to yourself.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
          <span className="flex-1">The old link stops working. You add the new one again.</span>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            Keep this one
          </Button>
          <Button size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
            Make a new link
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setConfirming(true)} disabled={!url}>
          <RefreshCw /> Make a new link
        </Button>
      )}
    </div>
  )
}
