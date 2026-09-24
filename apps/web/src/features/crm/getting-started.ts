import type { CrmLead } from '@ipc/contracts'

/**
 * What a studio still has to do before leads run themselves.
 *
 * Kept out of the component so the rules can be tested without rendering: each
 * step is done or not from data the page already holds, never from a flag
 * somebody has to remember to set. A checklist that can go stale is worse than
 * none, because it tells you to do something you did last week.
 */
export interface StartStep {
  key: string
  title: string
  detail: string
  done: boolean
  /** Where the work actually happens. */
  to: string
  search?: Record<string, string>
}

export interface StartInput {
  leads: readonly CrmLead[]
  /** Lead sources with a live webhook — a form or Meta pointed at us. */
  sourceCount: number
  /** Message templates saved for Quick Response. */
  templateCount: number
  /** People on the distribution rota. */
  rotaCount: number
}

export function startSteps(input: StartInput): StartStep[] {
  const { leads, sourceCount, templateCount, rotaCount } = input
  return [
    {
      key: 'source',
      title: 'Connect a lead source',
      detail: 'A website form or Meta lead ad, so enquiries arrive on their own.',
      done: sourceCount > 0,
      to: '/lead-sources',
    },
    {
      key: 'lead',
      title: 'Add your first lead',
      detail: 'A name and a number is enough to start.',
      done: leads.length > 0,
      to: '/follow-ups',
    },
    {
      key: 'template',
      title: 'Save a message template',
      detail: 'The reply you send every new enquiry, ready in one tap on WhatsApp.',
      done: templateCount > 0,
      to: '/follow-ups/setup',
      search: { section: 'templates' },
    },
    {
      key: 'rota',
      title: 'Say who gets new leads',
      detail: 'Without a rota, an arriving lead belongs to nobody.',
      done: rotaCount > 0,
      to: '/follow-ups/setup',
      search: { section: 'distribution' },
    },
    {
      key: 'followup',
      title: 'Promise a call-back',
      detail: 'Put a follow-up date on a lead — that date is what the Today tab runs on.',
      done: leads.some((l) => l.follow_up_at !== null),
      to: '/follow-ups',
    },
  ]
}

export const remaining = (steps: readonly StartStep[]): number => steps.filter((s) => !s.done).length

/** Nothing left to nag about: the card stops appearing on its own. */
export const allDone = (steps: readonly StartStep[]): boolean => remaining(steps) === 0
