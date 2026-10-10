import type { ProjectDraft } from '@/features/projects/wizard'

export type Patch = (p: Partial<ProjectDraft>) => void

/** "Created, but …" for whatever did not save after the project itself did. */
export function missedWarning(shoots: string[], work: string[]): string | null {
  const parts = [
    shoots.length ? `these shoots did not save: ${shoots.join(', ')}.` : '',
    work.length ? `This team work did not save: ${work.join(', ')}.` : '',
  ].filter(Boolean)
  if (parts.length === 0) return null
  const text = parts.join(' ')
  return `Created, but ${text.charAt(0).toLowerCase()}${text.slice(1)} Add them from the project.`
}

export const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
