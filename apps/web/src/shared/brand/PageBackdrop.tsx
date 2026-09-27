/**
 * The ground every signed-out page stands on.
 *
 * One warm wash from above, and nothing else. It replaces an animated camera
 * aperture — six blades, a barrel, drifting bokeh — which was careful work and
 * the wrong kind of it: on thirteen screens, six of which a studio's own
 * clients open to read a quotation, moving artwork behind the content competes
 * with the thing people came to do.
 *
 * Light rather than graphics: the wash is the brand amber at low alpha, so it
 * reads as a room lit from one side instead of as a picture. It is a plain
 * element with no canvas, no timers and no animation frame, so there is
 * nothing to pause for reduced motion and nothing to repaint on scroll.
 */
export function PageBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 bg-background"
      style={{
        background:
          // Two stops only. A third turns a wash into a gradient, and a
          // gradient is the thing that dates a login screen.
          'radial-gradient(64rem 34rem at 50% -10rem, color-mix(in srgb, var(--brand) 13%, transparent) 0%, transparent 72%)',
      }}
    />
  )
}
