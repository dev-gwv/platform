/**
 * Today's date in India as YYYY-MM-DD. The server runs in UTC, so
 * `new Date().toISOString().slice(0, 10)` is still yesterday until 5:30 am IST.
 */
export function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}
