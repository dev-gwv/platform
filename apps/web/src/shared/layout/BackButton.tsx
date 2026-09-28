import { useCanGoBack, useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../ui/button'
import { HOME, parentOf } from './parent-of'

/**
 * Back, on every page. The browser's own history when this tab has some, so
 * it lands exactly where you came from (filters and all); otherwise the list
 * page above this one, so a link opened from WhatsApp still has a way out.
 */
export function BackButton() {
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const { pathname } = useLocation()
  if (pathname === HOME || pathname === '/') return null
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Back"
      title="Back"
      onClick={() => (canGoBack ? router.history.back() : void navigate({ to: parentOf(pathname) }))}
    >
      <ArrowLeft />
    </Button>
  )
}
