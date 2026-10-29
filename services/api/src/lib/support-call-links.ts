import type { TransactionSql } from 'postgres'

/**
 * Who takes support calls and where each books (0290): one Google Calendar
 * appointment schedule per person, in slot order, only those with a link. A
 * person with no name set reads "Support call 2", so the chooser never shows
 * a blank button.
 */
export async function readSupportCallLinks(sql: TransactionSql): Promise<{ name: string; url: string }[]> {
  const rows = await sql<{ slot: number; name: string | null; url: string }[]>`
    select slot, name, booking_url as url from support_calendars where booking_url is not null order by slot`
  return rows.map((r) => ({ name: r.name?.trim() || `Support call ${r.slot}`, url: r.url }))
}
