import { describe, expect, it } from 'vitest'
import {
  briefDue,
  closedPost,
  factsText,
  followupText,
  indiaDatePlus,
  issueUrl,
  nudgeDue,
  nudgePost,
  readFollowupReply,
  readNoteReply,
  speechModelFor,
  ticketsLine,
  waLink,
  weeklyText,
  type StudioFacts,
} from './support-tickets'

const at = (iso: string) => Date.parse(iso)
const facts: StudioFacts = {
  studio: 'Mehta Studio',
  plan: 'Diamond Pro',
  access: 'paid',
  daysLeft: 12,
  joinedDaysAgo: 40,
  projects: 3,
  invoices: 1,
  leads: 12,
  shoots: 5,
  team: 4,
  activeDays7: 2,
  lastActiveDaysAgo: 1,
  stuck: [{ flow: 'Create project: event days', times: 2 }],
  earlier: [{ when: 'Mon 2 Nov, 3:00 pm', summary: 'Showed invoice numbering.' }],
}
const booking = { name: 'Asha', email: 'asha@example.com', notes: 'Cannot add the haldi', page: null }

describe('when the assistant acts', () => {
  it('briefs a call in the 75 minutes before it, never after it starts', () => {
    const start = '2026-11-12T10:00:00Z'
    expect(briefDue(start, at('2026-11-12T08:44:00Z'))).toBe(false)
    expect(briefDue(start, at('2026-11-12T08:46:00Z'))).toBe(true)
    expect(briefDue(start, at('2026-11-12T10:00:00Z'))).toBe(false)
  })

  it('asks about a call ten minutes after it ends, and not after a day', () => {
    const start = '2026-11-12T10:00:00Z'
    const end = '2026-11-12T10:20:00Z'
    expect(nudgeDue(start, end, at('2026-11-12T10:25:00Z'))).toBe(false)
    expect(nudgeDue(start, end, at('2026-11-12T10:31:00Z'))).toBe(true)
    expect(nudgeDue(start, end, at('2026-11-13T10:31:00Z'))).toBe(false)
    // No end time: taken as half an hour long.
    expect(nudgeDue(start, null, at('2026-11-12T10:35:00Z'))).toBe(false)
    expect(nudgeDue(start, null, at('2026-11-12T10:41:00Z'))).toBe(true)
  })
})

describe('the facts', () => {
  it('says the plan, what they made, where they got stuck and what they wrote', () => {
    const t = factsText(facts, booking)
    expect(t).toContain('Diamond Pro, 12 days left')
    expect(t).toContain('3 projects, 1 invoice, 12 leads')
    expect(t).toContain('Create project: event days (2×)')
    expect(t).toContain('Earlier call Mon 2 Nov')
    expect(t).toContain('"Cannot add the haldi"')
  })

  it('says plainly when the booker is not a studio we know', () => {
    expect(factsText(null, booking)).toContain('Not matched to a studio (booked as asha@example.com)')
  })

  it('shouts when access has ended', () => {
    expect(factsText({ ...facts, access: 'expired', daysLeft: null }, booking)).toContain('access has ENDED')
  })
})

describe('reading the voice note', () => {
  const said = 'Unko haldi add karna nahi aa raha tha, maine dikha diya. Kal invoice ka video bhejna hai.'

  it('reads the JSON even inside a code fence', () => {
    const r = readNoteReply(
      '```json\n{"summary":"Showed how to add the haldi.","kind":"training","status":"waiting_us","next_action":"Send the invoice video","due_in_days":1}\n```',
      said,
    )
    expect(r).toEqual({ summary: 'Showed how to add the haldi.', kind: 'training', status: 'waiting_us', nextAction: 'Send the invoice video', dueInDays: 1, watch: null })
  })

  it('drops the next step once it is solved', () => {
    const r = readNoteReply('{"summary":"Done.","kind":"bug","status":"solved","next_action":"x","due_in_days":2}', said)
    expect(r.nextAction).toBeNull()
    expect(r.dueInDays).toBeNull()
  })

  it('keeps what was said when the answer cannot be read', () => {
    const r = readNoteReply('sorry, I cannot help', said)
    expect(r.summary).toBe(said)
    expect(r.status).toBe('open')
    expect(r.kind).toBe('other')
  })

  it('never takes a kind or status the model made up', () => {
    const r = readNoteReply('{"summary":"s","kind":"complaint","status":"urgent"}', said)
    expect(r.kind).toBe('other')
    expect(r.status).toBe('open')
  })
})

describe('posts and small helpers', () => {
  it('links the nudge to the ticket', () => {
    expect(nudgePost({ name: 'Asha', studioName: 'Mehta Studio' }, 'https://x/t/1')).toContain('Asha · Mehta Studio')
  })

  it('says nothing at 9 am when nothing is open, and marks late steps', () => {
    expect(ticketsLine(0, [])).toBeNull()
    const line = ticketsLine(3, [{ name: 'Asha', action: 'Send the video', late: true }])!
    expect(line).toContain('3 tickets open, 1 waiting on you')
    expect(line).toContain('⏰ Asha: Send the video')
  })

  it("counts days in India's calendar", () => {
    // 20:00 UTC is already the next day in India.
    expect(indiaDatePlus(at('2026-11-11T20:00:00Z'), 0)).toBe('2026-11-12')
    expect(indiaDatePlus(at('2026-11-11T20:00:00Z'), 1)).toBe('2026-11-13')
  })

  it("uses Groq's Whisper unless the provider is OpenAI", () => {
    expect(speechModelFor('https://api.groq.com/openai/v1')).toBe('whisper-large-v3-turbo')
    expect(speechModelFor('https://api.openai.com/v1')).toBe('whisper-1')
  })
})

describe('step 2: follow-ups, issues, the Monday post', () => {
  const tutorials = [
    { key: 'project-shoots', title: 'Project step 2: the event days' },
    { key: 'invoices', title: 'Make an invoice' },
  ]

  it('reads what the studio is to do, and drops it once solved', () => {
    expect(readNoteReply('{"summary":"s","kind":"training","status":"waiting_them","watch":"project"}', 'x').watch).toBe('project')
    expect(readNoteReply('{"summary":"s","kind":"training","status":"solved","watch":"project"}', 'x').watch).toBeNull()
    expect(readNoteReply('{"summary":"s","kind":"training","status":"open","watch":"album"}', 'x').watch).toBeNull()
  })

  it('takes only tutorials we ship, at most two, and adds the links itself', () => {
    const r = readFollowupReply('{"message":"Hi Asha, thank you for the call.","tutorials":["invoices","made-up","project-shoots","invoices"]}', tutorials)!
    expect(r.tutorials.map((t) => t.key)).toEqual(['invoices', 'project-shoots'])
    const text = followupText(r.message, r.tutorials, 'https://studioautopilot.in/')
    expect(text).toContain('▶️ Make an invoice: https://studioautopilot.in/help?play=invoices')
    expect(readFollowupReply('{"message":""}', tutorials)).toBeNull()
  })

  it('opens a WhatsApp chat with the message written', () => {
    expect(waLink('919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye')
  })

  it("never puts a phone or email in the GitHub issue", () => {
    const url = issueUrl('dev-gwv/platform', { studio: 'Mehta Studio', plan: 'Pro', when: 'Mon 2 Nov', summary: 'Invoice total wrong', nextAction: null, bookingNotes: null, link: 'https://x/t/1' })
    const body = decodeURIComponent(url.split('body=')[1]!)
    expect(url.startsWith('https://github.com/dev-gwv/platform/issues/new?')).toBe(true)
    expect(body).toContain('Mehta Studio (Pro)')
    expect(body).not.toMatch(/@|\d{10}/)
  })

  it('says nothing on Monday after an empty week, and names what to fix', () => {
    expect(weeklyText({ calls: 0, solved: 0, open: 0, closedByThemselves: 0, kinds: [], bugsOpen: 0, stuck: [], repeat: [] })).toBeNull()
    const t = weeklyText({
      calls: 5,
      solved: 4,
      open: 1,
      closedByThemselves: 2,
      kinds: [{ kind: 'training', n: 3 }, { kind: 'bug', n: 1 }],
      bugsOpen: 1,
      stuck: [{ flow: 'Create project: event days', studios: 3 }],
      repeat: [{ name: 'Mehta Studio', calls: 2 }],
    })!
    expect(t).toContain('5 calls, 4 solved (2 closed by themselves), 1 still open')
    expect(t).toContain('Fix first: Create project: event days')
  })

  it('says how a ticket closed itself', () => {
    expect(closedPost('Asha', 'Mehta Studio', 'project')).toBe('✅ Closed by itself: Asha · Mehta Studio went on to make a project after the call.')
  })
})
