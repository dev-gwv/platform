import { describe, expect, it } from 'vitest'
import type { PlanInstalment } from '@ipc/contracts'
import { nextInvoiceFromPlan } from './from-plan'

const plan: PlanInstalment[] = [
  { label: 'Advance', mode: 'percent', value: 50, due_trigger: 'On signing' },
  { label: 'Balance', mode: 'percent', value: 50, due_trigger: 'On delivery' },
]

describe('the invoice after the quotation', () => {
  it('bills the booking amount first, from the default plan when no terms were sent', () => {
    expect(nextInvoiceFromPlan({ projectName: 'Pulkit', total: 150000, instalments: null, received: 0, invoiced: 0 })).toEqual({
      label: 'Booking amount',
      amount: 45000,
      description: 'Booking amount — Pulkit',
      fromDefault: true,
    })
  })

  it('follows the plan the client agreed to', () => {
    expect(nextInvoiceFromPlan({ projectName: 'Pulkit', total: 100000, instalments: plan, received: 0, invoiced: 0 })).toMatchObject({
      label: 'Advance',
      amount: 50000,
      fromDefault: false,
    })
  })

  it('moves on to the next part once one is invoiced or paid', () => {
    expect(nextInvoiceFromPlan({ projectName: 'P', total: 100000, instalments: plan, received: 0, invoiced: 50000 })?.label).toBe('Balance')
    expect(nextInvoiceFromPlan({ projectName: 'P', total: 100000, instalments: plan, received: 50000, invoiced: 0 })?.label).toBe('Balance')
  })

  it('has nothing to raise once every part is covered, or with no price yet', () => {
    expect(nextInvoiceFromPlan({ projectName: 'P', total: 100000, instalments: plan, received: 0, invoiced: 100000 })).toBeNull()
    expect(nextInvoiceFromPlan({ projectName: 'P', total: 0, instalments: plan, received: 0, invoiced: 0 })).toBeNull()
  })
})
