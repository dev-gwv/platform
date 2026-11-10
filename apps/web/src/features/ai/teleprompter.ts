/**
 * Teleprompter maths, pure so it is tested: the script scrolls past in the
 * time it is meant to be spoken, made slower or faster by the reader.
 */

export const SPEEDS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5] as const
export const DEFAULT_SPEED_INDEX = 3

/** Pixels a second so `scrollable` pixels pass in `seconds`, at a speed (1 = as written). */
export function pxPerSecond(scrollable: number, seconds: number, speed: number): number {
  if (scrollable <= 0 || seconds <= 0 || speed <= 0) return 0
  return (scrollable / seconds) * speed
}

/** The next speed step up or down, kept inside the list. */
export function stepSpeed(index: number, by: 1 | -1): number {
  return Math.min(SPEEDS.length - 1, Math.max(0, index + by))
}

/** The words a model reads, in order: the hook, then each part. */
export function spokenText(s: { hook: string; parts: { text: string }[] }): string[] {
  return [s.hook, ...s.parts.map((p) => p.text)].map((t) => t.trim()).filter(Boolean)
}
