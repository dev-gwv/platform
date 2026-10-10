import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'

interface Crumb {
  label: string
  to?: string
}

/** Locked primitive — page trail. Last crumb renders as current (no link). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1 pb-2 text-sm text-muted-foreground">
      {items.map((c, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <ChevronRight className="size-3.5" />}
            {c.to && !last ? (
              <Link to={c.to} className="hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className={last ? 'text-foreground' : undefined}>{c.label}</span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
