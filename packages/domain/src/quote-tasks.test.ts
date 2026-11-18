import { describe, expect, it } from 'vitest'
import { fillFormMessage, jobCoversCut, planQuotationTasks, quoteWorkOf, videoCutOf } from './quote-tasks'

const shoots = [
  { name: 'Engagement', shoot_date: '2027-02-07' },
  { name: 'Haldi', shoot_date: '2027-02-13' },
  { name: 'Rituals and wedding', shoot_date: '2027-02-14' },
]

describe('quoteWorkOf', () => {
  it('says what kind of work each deliverable is', () => {
    expect(quoteWorkOf('Highlight film (4–5 min)')).toBe('video')
    expect(quoteWorkOf('4-5 Instagram reels of key moments')).toBe('video')
    expect(quoteWorkOf('Save the date video')).toBe('video')
    expect(quoteWorkOf('Save the date')).toBe('design')
    expect(quoteWorkOf('Wedding countdown videos (3)')).toBe('design')
    expect(quoteWorkOf('E-invite for each side & monologue shoot')).toBe('design')
    expect(quoteWorkOf('2 Royal album of 40 sheets')).toBe('album')
    expect(quoteWorkOf('2 Large photo frames, 20×30 inches')).toBe('print')
    expect(quoteWorkOf('All unedited photographs')).toBe('photo')
    expect(quoteWorkOf('Edited photographs, colour-graded')).toBe('photo')
    expect(quoteWorkOf('Private online gallery with QR code')).toBe('gallery')
    expect(quoteWorkOf('Drone coverage')).toBe('other')
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
    expect(copies.map((t) => t.due)).toEqual(['2027-02-14', '2027-02-20', '2027-03-11'])
    expect(copies[1]!.title).toBe('Data copy for Instagram reels')
    expect(copies.every((t) => t.role === 'admin')).toBe(true)
  })

  it('never starts an edit before the footage exists', () => {
    const [t] = planQuotationTasks({
      today: '2026-11-18',
      shoots,
      deliverables: [{ id: 'r', title: 'Reel', due: '2027-02-16', workDays: 7 }],
    })
    expect(t!.due).toBe('2027-02-15')
  })

  it('gives every deliverable its task, to the role that makes it', () => {
    expect(plan.find((t) => t.deliverableId === 'photos')).toMatchObject({ role: 'photo_editor', title: 'Edit Edited photographs', due: '2027-02-15' })
    expect(plan.find((t) => t.deliverableId === 'reels')!.role).toBe('video_editor')
    // A design starts now, from the client's details, with no data copy.
    expect(plan.find((t) => t.deliverableId === 'inv')).toMatchObject({ role: 'designer', title: 'Design E-invite for each side', due: '2026-11-18' })
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

describe('splitting video work between editors', () => {
  it('tells full-length films, reels and short films apart', () => {
    expect(videoCutOf('Full-length film of each event')).toBe('full')
    expect(videoCutOf('Instagram reels (4-5)')).toBe('reel')
    expect(videoCutOf('Highlight film (4-5 min)')).toBe('short')
    expect(videoCutOf('Wedding teaser')).toBe('short')
  })
  it("reads an editor's job role", () => {
    const usman = 'Teaser, Film & Reel Editor'
    const rayeen = 'Full-length & Reel Editor'
    expect(jobCoversCut(usman, 'short')).toBe(true)
    expect(jobCoversCut(usman, 'full')).toBe(false)
    expect(jobCoversCut(usman, 'reel')).toBe(true)
    expect(jobCoversCut(rayeen, 'full')).toBe(true)
    expect(jobCoversCut(rayeen, 'short')).toBe(false)
    expect(jobCoversCut(rayeen, 'reel')).toBe(true)
    expect(jobCoversCut('Video Editor', 'full')).toBeNull()
  })
})
