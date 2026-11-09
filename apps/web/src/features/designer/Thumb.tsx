import type { DesignPage, DesignTheme } from '@ipc/contracts'
import { DesignPageView, PAGE_H, PAGE_W } from './DesignPageView'

/** A page drawn small: the Pages panel, grid view and the template gallery. */
export function Thumb({
  page,
  theme,
  width,
}: {
  page: DesignPage
  theme: DesignTheme
  width: number
}) {
  const s = width / PAGE_W
  return (
    <div
      className="pointer-events-none relative overflow-hidden rounded-[3px] bg-white shadow"
      style={{ width, height: PAGE_H * s }}
      aria-hidden
    >
      <div
        style={{
          width: PAGE_W,
          height: PAGE_H,
          transform: `scale(${s})`,
          transformOrigin: 'top left',
        }}
      >
        <DesignPageView page={page} theme={theme} editable={false} onChange={() => undefined} />
      </div>
    </div>
  )
}
