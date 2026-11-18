import { describe, expect, it } from 'vitest'
import { fillFormMessage, planQuotationTasks, quoteWorkOf } from './quote-tasks'

const shoots = [
  { name: 'Engagement', shoot_date: '2027-02-07' },
  { name: 'Haldi', shoot_date: '2027-02-13' },
  { name: 'Rituals and wedding', shoot_date: '2027-02-14' },
]

describe('quoteWorkOf', () => {
  it('tells films and reels from photos, and e-invites apart', () => {
    expect(quoteWorkOf('Highlight film (4–5 min)')).toBe('video')
    expect(quoteWorkOf('4-5 Instagram reels of key moments')).toBe('video')
    expect(quoteWorkOf('Full-length film of each event')).toBe('video')
    expect(quoteWorkOf('E-invite for each side & monologue shoot')).toBe('e_invite')
    expect(quoteWorkOf('2 Royal album of 40 sheets')).toBe('none')
    expect(quoteWorkOf('All unedited photographs')).toBe('none')
  })
})

describe('planQuotationTasks', () => {
  const plan = planQuotationTasks({
    today: '2026-11-18',
    shoots,
    clientName: 'Nupur Jain',
    deliverables: [
      { id: 'reels', title: 'Instagram reels', due: '2027-02-28', workDays: 7 },
      { id: 'hl', title: 'Highlight film', due: '2027-04-11', workDays: 30 },
      { id: 'photos', title: 'Edited photographs', due: '2027-02-21', workDays: 7 },
      { id: 'inv', title: 'E-invite for each side', due: null, workDays: 7 },
    ],
    forms: {
      e_invite: { form: 'https://f/e', reference: 'https://r', message: 'Form: {form} Ref: {reference}' },
      event_timeline: { form: 'https://f/t', message: 'Fill this' },
    },
  })

  it('starts each edit its working days before the promise, and copies data the day before', () => {
    const reels = plan.find((t) => t.deliverableId === 'reels')!
    expect(reels).toMatchObject({ kind: 'edit', title: 'Edit Instagram reels', due: '2027-02-21' })
    const film = plan.find((t) => t.deliverableId === 'hl')!
    expect(film.due).toBe('2027-03-12')
    const copies = plan.filter((t) => t.kind === 'data_copy')
    expect(copies.map((t) => t.due)).toEqual(['2027-02-20', '2027-03-11'])
    expect(copies[0]!.title).toBe('Data copy for Instagram reels')
  })

  it('never starts an edit before the footage exists', () => {
    const [t] = planQuotationTasks({
      today: '2026-11-18',
      shoots,
      deliverables: [{ id: 'r', title: 'Reel', due: '2027-02-16', workDays: 7 }],
    })
    expect(t!.due).toBe('2027-02-15')
  })

  it('gives photos no edit task', () => {
    expect(plan.some((t) => t.deliverableId === 'photos')).toBe(false)
  })

  it('asks the manager for the e-invite form today, with the studio message', () => {
    const t = plan.find((t) => t.kind === 'e_invite')!
    expect(t).toMatchObject({ due: '2026-11-18', title: "Send the e-invite form in Nupur Jain's WhatsApp group" })
    expect(t.description).toContain('Form: https://f/e Ref: https://r')
  })

  it('sends the event timeline form 8 days before the wedding', () => {
    const t = plan.find((t) => t.kind === 'event_timeline')!
    expect(t.due).toBe('2027-02-06')
    expect(t.description).toContain('Fill this\n\nhttps://f/t')
  })

  it('skips the timeline form for a wedding already past', () => {
    const late = planQuotationTasks({ today: '2027-03-01', shoots, deliverables: [] })
    expect(late.some((t) => t.kind === 'event_timeline')).toBe(false)
  })

  it('fills a message that names its links', () => {
    expect(fillFormMessage({ form: 'F', reference: 'R', message: 'a {form} b {reference}' })).toBe('a F b R')
  })
})
