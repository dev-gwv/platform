import { defuse } from '@ipc/domain'

/**
 * Exporting a table the way people expect it: a file that opens in Excel with
 * the columns intact.
 *
 * The quoting rule is RFC 4180's — a cell containing a comma, a quote or a
 * newline is wrapped and its quotes doubled. A studio name like "Roy, Jr." is
 * exactly the kind of thing that silently shifts every later column when this
 * is skipped.
 *
 * A typed cell that starts with = + - @ (or a tab or carriage return) would
 * run as a formula when the file is opened in Excel or Sheets, so it is kept
 * as text with a leading apostrophe, as the leads export does (`defuse`).
 * Numbers are ours, never typed, and stay numbers.
 */
export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : defuse(String(v))
  // \r as well as \n: a note pasted in from Windows carries CRLF, and a bare
  // carriage return splits the row just as surely as a newline does.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const cell = csvCell

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}

/**
 * Hand the browser a file. The BOM is there so Excel on Windows reads the
 * rupee sign and Indian names as UTF-8 rather than mojibake.
 */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
