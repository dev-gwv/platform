import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lengthLabel, playsIn, posterSrc, SHIPPED, SHIPPED_HI, titleIn, TUTORIALS, tutorialFor, tutorialsWith, videoSrc, type HelpLang } from './tutorials'
import { mailLink, supportMessage, whatsappLink } from './support'

describe('tutorials', () => {
  const list = tutorialsWith([], TUTORIALS.map((t) => t.key))
  it('finds the tutorial for a page, and none for a page without one', () => {
    expect(tutorialFor('/follow-ups', list)?.key).toBe('leads')
    expect(tutorialFor('/projects/abc-123/quotation', list)?.key).toBe('quotation')
    expect(tutorialFor('/projects/abc-123', list)).toBeNull()
    expect(tutorialFor('/projects/abc-123', list, 'overview')).toBeNull()
    expect(tutorialFor('/projects/abc-123', list, 'shoots')?.key).toBe('assign')
    expect(tutorialFor('/projects/abc-123', list, 'deliverables')?.key).toBe('give-work')
    expect(tutorialFor('/projects/abc-123', list, 'billing')?.key).toBe('payments')
    expect(tutorialFor('/projects/new', list, 'shoots')?.key).toBe('project')
    expect(tutorialFor('/billing/invoices/new', list)?.key).toBe('invoices')
    expect(tutorialFor('/billing/invoices/abc-123/edit', list)?.key).toBe('invoices')
    expect(tutorialFor('/reports', list)).toBeNull()
  })

  it('lets the console replace a shipped video and add one for a new page', () => {
    const merged = tutorialsWith([
      { page_key: 'leads', title: 'Leads, the new way', url: 'https://videos.example/leads.mp4' },
      { page_key: 'reports', title: 'Read your reports', url: 'https://videos.example/reports.mp4' },
    ])
    expect(merged.find((t) => t.key === 'leads')).toMatchObject({ title: 'Leads, the new way', url: 'https://videos.example/leads.mp4' })
    expect(merged.some((t) => t.key === 'reports')).toBe(true)
  })

  it('lists only recordings that are shipped', () => {
    expect(tutorialsWith([], ['team']).map((t) => t.key)).toEqual(['team'])
  })

  it('ships every listed recording and its poster, in English and in Hindi', () => {
    const pub = (path: string) => fileURLToPath(new URL(`../../../public${path}`, import.meta.url))
    for (const t of TUTORIALS.filter((x) => SHIPPED.includes(x.key))) {
      const langs: HelpLang[] = SHIPPED_HI.includes(t.key) ? ['en', 'hi'] : ['en']
      for (const lang of langs) {
        expect(existsSync(pub(videoSrc(t, lang))), videoSrc(t, lang)).toBe(true)
        expect(existsSync(pub(posterSrc(t, lang)!)), posterSrc(t, lang)).toBe(true)
      }
      if (SHIPPED_HI.includes(t.key)) expect(t.hi?.title, t.key).toBeTruthy()
    }
  })

  it('plays Hindi where there is a Hindi recording, and English otherwise', () => {
    const team = TUTORIALS.find((t) => t.key === 'team')!
    expect(videoSrc(team, 'hi')).toBe('/help/hi/team.mp4')
    expect(titleIn(team, 'hi')).toBe(team.hi!.title)
    const linked = { ...team, url: 'https://videos.example/team.mp4' }
    expect(playsIn(linked, 'hi')).toBe('en')
    expect(videoSrc(linked, 'hi')).toBe('https://videos.example/team.mp4')
  })

  it('says the length plainly', () => {
    expect(lengthLabel(37)).toBe('37 s')
    expect(lengthLabel(65)).toBe('1 min 5 s')
    expect(lengthLabel(0)).toBe('')
  })
})

describe('support message', () => {
  const msg = supportMessage({ studio: 'Mehta Studios', name: 'Asha Mehta', role: 'Owner', plan: null, page: '/billing/payments', at: new Date('2026-10-02T13:10:00Z') })
  it('says who is asking and from where', () => {
    expect(msg).toContain('Studio: Mehta Studios')
    expect(msg).toContain('Plan: Trial')
    expect(msg).toContain('Page: /billing/payments')
    expect(msg).toContain('Time: 2 Oct, 6:40 pm')
  })
  it('builds WhatsApp and email links', () => {
    expect(whatsappLink('+91 98765 43210', 'hi there')).toBe('https://wa.me/919876543210?text=hi%20there')
    expect(mailLink('help@studioautopilot.in', 'Mehta Studios', 'x')).toBe('mailto:help@studioautopilot.in?subject=Help%20for%20Mehta%20Studios&body=x')
  })
})
