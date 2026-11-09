import type { DesignDoc, DesignPage, PlanInstalment } from '@ipc/contracts'
import { blankPage, page, pageId, templateFor } from './templates'

/**
 * A new design filled from its project (Quotation Designer, 0295): one Event
 * page per shoot with its team and roles, the deliverables the client sees,
 * the total and the payment plan, the extras as Add-ons. The cover, About us
 * and Thank you pages come from the studio's last design, so its story and
 * photos are written once.
 */

export interface FillShoot {
  name: string
  shoot_date: string | null
  start_at?: string | null | undefined
  location: string | null
  status?: string | null | undefined
  requirements: readonly { name: string; quantity: number }[]
}

export interface FillDeliverable {
  title: string
  description?: string | null | undefined
  list_key: string
  visibility_scope: string
  show_on_quotation: boolean
  status: string
  additional_charge_amount: number
}

export interface FillInput {
  template: string
  studio: string
  project: {
    name: string
    client_name: string | null
    total_cost: number
    deliverables: readonly FillDeliverable[]
  } | null
  shoots: readonly FillShoot[]
  instalments: readonly PlanInstalment[]
  /** The studio's latest design: its cover, about and thank-you pages are reused. */
  previous?: DesignDoc | null | undefined
}

/** "INR 85,000/-", the way Indian studios write it on a quotation. */
export const inr = (n: number) => `INR ${Math.round(n).toLocaleString('en-IN')}/-`

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })

/** "3 Shooters with Assistants" from the shoot's roles; empty when none are planned. */
export function teamLine(reqs: readonly { quantity: number }[]): string {
  const n = reqs.reduce((s, r) => s + Math.max(0, r.quantity), 0)
  if (n === 0) return ''
  return `${n} ${n === 1 ? 'Shooter' : 'Shooters'} with Assistants`
}

export const roleLines = (reqs: readonly { name: string; quantity: number }[]) =>
  reqs.filter((r) => r.quantity > 0).map((r) => `${r.quantity} ${r.name}`)

/** "Advance: 25%, On Engagement: ₹10,000" from the agreed plan. */
export function paymentsLine(plan: readonly PlanInstalment[], total: number): string {
  return plan
    .map((p) => {
      const amount =
        p.mode === 'percent'
          ? total > 0
            ? inr((total * p.value) / 100)
            : `${p.value}%`
          : inr(p.value)
      return `${p.label}: ${amount}`
    })
    .join(', ')
}

const reuse = (
  previous: DesignDoc | null | undefined,
  kind: DesignPage['kind'],
): DesignPage | null => {
  const p = previous?.pages.find((x) => x.kind === kind)
  return p ? { ...structuredClone(p), id: pageId(), hidden: false } : null
}

export function fillDesign(input: FillInput): DesignDoc {
  const { project, studio } = input
  const theme = input.previous?.theme ?? templateFor(input.template).theme
  const cover = reuse(input.previous, 'cover') ?? blankPage('cover', studio)
  if (project?.client_name) cover.data.subtitle = `For ${project.client_name}`
  const pages: DesignPage[] = [cover, reuse(input.previous, 'about') ?? blankPage('about', studio)]

  const shoots = input.shoots.filter((s) => s.status !== 'cancelled')
  if (shoots.length === 0) pages.push(blankPage('event'))
  for (const s of shoots) {
    pages.push(
      page('event', {
        title: 'Event Details',
        event: s.name,
        location: s.location ?? '',
        date: s.shoot_date ? longDate(s.shoot_date) : '',
        team: teamLine(s.requirements),
        lines: roleLines(s.requirements),
      }),
    )
  }

  const shown = (project?.deliverables ?? []).filter(
    (d) => d.visibility_scope === 'client' && d.show_on_quotation && d.status !== 'cancelled',
  )
  const main = shown.filter((d) => d.list_key === 'primary')
  const extras = shown.filter((d) => d.list_key !== 'primary')
  const deliverables = blankPage('deliverables')
  if (project) {
    if (main.length > 0)
      deliverables.data.lines = main.map((d) =>
        d.description ? `${d.title}: ${d.description}` : d.title,
      )
    deliverables.data.total = `Total Investment: ${inr(project.total_cost)}`
    const pay = paymentsLine(input.instalments, project.total_cost)
    if (pay) deliverables.data.payments = pay
  }
  pages.push(deliverables)

  if (extras.length > 0) {
    pages.push(
      page('addons', {
        title: 'Add Ons',
        addons: extras.slice(0, 12).map((d) => ({
          name: d.title,
          lines: [
            d.description || '',
            d.additional_charge_amount > 0 ? inr(d.additional_charge_amount) : '',
          ].filter(Boolean),
        })),
      }),
    )
  } else {
    pages.push(reuse(input.previous, 'addons') ?? blankPage('addons'))
  }

  pages.push(reuse(input.previous, 'thanks') ?? blankPage('thanks'))
  return { version: 1, theme: { ...theme }, pages: pages.slice(0, 30) }
}
