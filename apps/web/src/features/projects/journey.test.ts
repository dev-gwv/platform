import { describe, expect, it } from 'vitest'
import { journey, type JourneyInput } from './journey'

const fresh: JourneyInput = {
  quotationSent: false,
  invoiced: false,
  shoots: 2,
  seatsNeeded: 8,
  seatsFilled: 0,
  deliverables: 3,
  delivered: 0,
}

describe('the project journey', () => {
  it('starts with the quotation, then the invoice, then the team, then delivery', () => {
    expect(journey(fresh).next?.action).toBe('Send the quotation')
    expect(journey({ ...fresh, quotationSent: true }).next?.action).toBe('Create the invoice')
    const team = journey({ ...fresh, quotationSent: true, invoiced: true }).next
    expect(team).toMatchObject({ key: 'team', action: 'Book the team', hint: '0 of 8 places filled.' })
    expect(journey({ ...fresh, quotationSent: true, invoiced: true, seatsFilled: 8 }).next).toMatchObject({
      key: 'deliver',
      hint: '0 of 3 delivered.',
    })
  })

  it('counts the quotation done once it is invoiced, link or no link', () => {
    // "Quotation is good, next step": the invoice is the studio accepting it.
    const j = journey({ ...fresh, invoiced: true })
    expect(j.next?.key).toBe('team')
    expect(j.steps.map((s) => s.done)).toEqual([true, true, false, false])
  })

  it('names the first thing missing, in order, even when a later step is done', () => {
    // People booked before anything was quoted or billed: the quotation is still next.
    const j = journey({ ...fresh, seatsFilled: 8 })
    expect(j.next?.key).toBe('quotation')
    expect(j.steps.map((s) => s.done)).toEqual([false, false, true, false])
  })

  it('asks for a shoot, or for the roles, before asking to book people', () => {
    const base = { ...fresh, quotationSent: true, invoiced: true }
    expect(journey({ ...base, shoots: 0, seatsNeeded: 0 }).next?.action).toBe('Add a shoot')
    expect(journey({ ...base, seatsNeeded: 0 }).next?.hint).toMatch(/who each day needs/)
  })

  it('leaves the invoice step out for someone who cannot see billing', () => {
    const j = journey({ ...fresh, quotationSent: true, invoiced: null })
    expect(j.steps.map((s) => s.key)).toEqual(['quotation', 'team', 'deliver'])
    expect(j.next?.key).toBe('team')
  })

  it('has nothing next once everything is delivered', () => {
    expect(
      journey({ quotationSent: true, invoiced: true, shoots: 1, seatsNeeded: 2, seatsFilled: 2, deliverables: 1, delivered: 1 }).next,
    ).toBeNull()
  })
})
