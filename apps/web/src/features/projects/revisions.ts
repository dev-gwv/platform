import type { MyDeliverable } from '@ipc/contracts'

/**
 * Work sent back for changes, from the editor's side. The server says which
 * deliverables are back with them, what the reviewer said and the last
 * version handed in (0180); this turns that into the order the lists show
 * them in and the words they use.
 */

type Revisable = Pick<MyDeliverable, 'changes_requested'>

/** Sent-back work first -- it is what someone is waiting on -- the rest in the order given. */
export function changesFirst<T extends Revisable>(rows: readonly T[]): T[] {
  return [...rows.filter((d) => d.changes_requested), ...rows.filter((d) => !d.changes_requested)]
}

export function needChangesCount(rows: readonly Revisable[]): number {
  return rows.filter((d) => d.changes_requested).length
}

/** "1 needs changes", "3 need changes". */
export function needChangesLabel(n: number): string {
  return `${n} ${n === 1 ? 'needs' : 'need'} changes`
}

/** What goes under "Upload revision": which version it will be, when one came before. */
export function revisionHint(lastVersion: number | null | undefined): string {
  return lastVersion
    ? `This is version ${lastVersion + 1}. It goes back to your manager for review.`
    : 'It goes back to your manager for review.'
}

/** Once it is in: "Version 2 sent for review", or plainly for a first hand-in. */
export function submittedMessage(version: number | null | undefined): string {
  return version && version > 1 ? `Version ${version} sent for review` : 'Work submitted'
}
