import { useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { PlayCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useTutorials } from './api'
import { TutorialPlayer } from './TutorialPlayer'
import { lengthLabel, tutorialFor, type Tutorial } from './tutorials'

/**
 * "Watch how · 40 s" beside a page's title -- only on a page that has a
 * tutorial. Plays it here, without leaving the page.
 */
export function WatchHow() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const list = useTutorials()
  const tutorial = tutorialFor(path, list)
  const [playing, setPlaying] = useState<Tutorial | null>(null)
  if (!tutorial) return null
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="border-primary/40 text-primary" onClick={() => setPlaying(tutorial)}>
        <PlayCircle /> Watch how{tutorial.seconds ? ` · ${lengthLabel(tutorial.seconds)}` : ''}
      </Button>
      <TutorialPlayer tutorial={playing} onClose={() => setPlaying(null)} />
    </>
  )
}
