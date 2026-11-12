import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Play, PlayCircle, X } from 'lucide-react'
import { learnSignals } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useHints, useSetHint } from '@/features/team/hints-api'
import { useAttendanceMe } from '@/features/attendance/api'
import { useTutorials } from '@/features/help/api'
import { useHelpLang } from '@/features/help/lang'
import { LangSwitch, TutorialPlayer } from '@/features/help/TutorialPlayer'
import { lengthLabel, type Tutorial } from '@/features/help/tutorials'
import { showTeamVideos, teamVideos, watchedLine } from './team-videos'

function useSince() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me', 'learn'],
    queryFn: () => callApi('/auth/learn', { responseSchema: learnSignals }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

/** Whether the card is up, so a team member's Home shows one card at a time. */
export function useTeamVideosShowing(): boolean {
  const hints = useHints()
  const since = useSince()
  const attendanceOn = useAttendanceMe().data?.enabled ?? false
  if (!hints.isSuccess || !since.data) return false
  const note = hints.data.team_videos
  return showTeamVideos(teamVideos(attendanceOn), note?.watched ?? [], (note?.closed.length ?? 0) > 0, since.data.since)
}

/**
 * "Learn your side of Studio AutoPilot" on a new team member's Home: a few
 * one-minute videos, each played right here, each ticked once watched.
 */
export function TeamVideosCard() {
  const hints = useHints()
  const setHint = useSetHint()
  const since = useSince()
  const attendanceOn = useAttendanceMe().data?.enabled ?? false
  const tutorials = useTutorials()
  const [lang, setLang] = useHelpLang()
  const [playing, setPlaying] = useState<Tutorial | null>(null)
  if (!hints.isSuccess || !since.data) return null
  const note = hints.data.team_videos ?? { watched: [], closed: [] }
  const videos = teamVideos(attendanceOn)
  if (!showTeamVideos(videos, note.watched, note.closed.length > 0, since.data.since)) return null
  const next = videos.find((v) => !note.watched.includes(v.key))

  const markWatched = (key: string) => {
    const now = hints.data?.team_videos ?? { watched: [], closed: [] }
    if (now.watched.includes(key)) return
    setHint.mutate({ key: 'team_videos', value: { watched: [...now.watched, key], closed: now.closed } })
  }

  return (
    <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-3 sm:p-4" data-testid="team-videos-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <PlayCircle className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{lang === 'hi' ? 'अपना काम सीखें, छोटे वीडियो में' : 'Learn your side of Studio AutoPilot'}</p>
            <p className="text-xs text-muted-foreground">
              {watchedLine(videos, note.watched, lang)} · {lang === 'hi' ? 'हर वीडियो एक मिनट से कम' : 'each under a minute'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <LangSwitch lang={lang} onChange={setLang} className="hidden sm:inline-flex" />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close the videos"
            title="Close. The videos stay in Help."
            onClick={() => setHint.mutate({ key: 'team_videos', value: { watched: note.watched, closed: ['all'] } })}
          >
            <X />
          </Button>
        </div>
      </div>
      <ol className="mt-3 flex flex-col gap-1.5">
        {videos.map((v, i) => {
          const done = note.watched.includes(v.key)
          const isNext = v === next
          const video = tutorials.find((t) => t.key === v.key) ?? null
          return (
            <li
              key={v.key}
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 text-sm',
                done && 'border-success/30 bg-success/10 text-muted-foreground',
                isNext && 'border-dashed border-tone-amber bg-tone-amber-soft',
                !done && !isNext && 'border-border',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  done ? 'border-success bg-success text-success-foreground' : 'border-input bg-card',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn('min-w-0 flex-1', isNext && 'font-semibold text-foreground')}>{v.title[lang]}</span>
              <span className="flex shrink-0 gap-2">
                {video && (
                  <Button size="sm" variant={isNext ? 'default' : 'outline'} onClick={() => setPlaying(video)}>
                    <Play /> {lang === 'hi' ? 'देखें' : 'Watch'}
                    {isNext && video.seconds > 0 && ` · ${lengthLabel(video.seconds)}`}
                  </Button>
                )}
                {isNext && v.to && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={v.to}>
                      {lang === 'hi' ? 'खोलें' : 'Open'} <ArrowRight />
                    </Link>
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      <TutorialPlayer tutorial={playing} onClose={() => setPlaying(null)} onWatched={markWatched} />
    </div>
  )
}
