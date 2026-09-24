import type { ProjectDetail, ProjectListItem, SessionState } from '@ipc/contracts'
import type { Client } from '@ipc/contracts'
import { deriveStage } from '@/features/data/stage'

/**
 * DEV-ONLY UI preview mode. Enabled with VITE_MOCK=1. Supplies a fake session
 * and canned API responses so the whole authed UI is viewable without a live
 * Supabase/DB. Tree-shaken out of production builds (guarded by import.meta.env).
 */
export const MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1'

/** Sentinel: this path is not mocked → fall through to the real fetch. */
export const NOT_MOCKED = Symbol('not-mocked')

/**
 * DEV knob for previewing the dashboard's Studio Setup Journey, which only
 * shows while a studio is still being set up. Append `?setup=fresh` for a brand
 * new studio (0 of 7) or `?setup=partial` for one three steps in. Without it the
 * fixtures are full, so the journey is correctly hidden.
 */
type SetupStage = 'fresh' | 'partial' | 'full'

function setupStage(): SetupStage {
  const v = new URLSearchParams(window.location.search).get('setup')
  return v === 'fresh' || v === 'partial' ? v : 'full'
}

/** Empty a fixture when the requested stage has not reached it yet. */
function atStage<T>(rows: T[], presentFrom: 'partial' | 'full'): T[] {
  const stage = setupStage()
  if (stage === 'full') return rows
  return stage === 'partial' && presentFrom === 'partial' ? rows : []
}

/** Deterministic uuid from a short seed so fixtures satisfy uuid contracts. */
const uid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`

const CLIENT = { sharma: uid(0xc1), verma: uid(0xc2), nova: uid(0xc3) }
const PROJ = { p1: uid(0x91), p2: uid(0x92), p3: uid(0x93), p4: uid(0x94) }

export const mockSession: SessionState = {
  user_id: uid(1),
  company_id: uid(0xaa),
  role: 'super_admin',
  is_owner: true,
  is_platform_admin: true,
  display_name: 'Demo Owner',
  email: 'owner@demostudio.in',
  plan_gate: 'active',
  plan_expiry: '2027-01-01T00:00:00Z',
  permissions: [],
  // Two studios, so the switcher in the account menu shows in a preview.
  studios: [
    { profile_id: uid(1), company_id: uid(0xaa), company_name: 'Demo Studio', role: 'super_admin', is_owner: true },
    { profile_id: uid(0xf1), company_id: uid(0xab), company_name: 'Lensworks Weddings', role: 'employee', is_owner: false },
  ],
}

/** Directory rows carry a lot of nullable columns; only name the ones that vary. */
function member(
  user_id: string,
  name: string,
  email: string | null,
  role: string,
  over: Partial<{
    phone: string | null
    alternate_phone: string | null
    status: string
    engagement_type: string | null
    login_enabled: boolean
    salary: number | null
    address: string | null
    created_at: string
    role_ids: string[]
    role_names: string[]
    payout_type: 'salary' | 'per_shoot' | 'per_day' | 'per_project' | 'custom' | null
    commission_pct: number | null
    commission_basis: 'revenue' | 'payment' | 'profit' | 'manual' | null
    stipend_amount: number | null
    pay_effective_from: string | null
    pay_effective_to: string | null
    compensation_notes: string | null
    payment_type: string | null
    pay_components: ('monthly_salary' | 'freelancer_rate' | 'commission' | 'stipend')[]
    payment_status: 'active' | 'paused' | 'ended'
  }> = {},
) {
  return {
    user_id,
    name,
    email,
    role,
    phone: null,
    alternate_phone: null,
    status: 'active',
    engagement_type: null,
    login_enabled: true,
    salary: null,
    address: null,
    created_at: '2026-05-01T10:00:00Z',
    role_ids: [],
    role_names: [],
    payout_type: null,
    commission_pct: null,
    commission_basis: null,
    stipend_amount: null,
    pay_effective_from: null,
    pay_effective_to: null,
    compensation_notes: null,
    payment_type: null,
    pay_components: [],
    payment_status: 'active' as const,
    ...over,
  }
}

const clients: Client[] = [
  fakeClient(CLIENT.sharma, 'Sharma Family', '9876543210'),
  fakeClient(CLIENT.verma, 'Verma Weddings', '9812345678'),
  fakeClient(CLIENT.nova, 'Nova Events', '9900112233'),
]

const projects: ProjectListItem[] = [
  fakeProject(PROJ.p1, 'Sharma Wedding', 'active', 'Sharma Family', 185000, 227000),
  fakeProject(PROJ.p2, 'Verma Reception', 'on_hold', 'Verma Weddings', 90000, 90000),
  fakeProject(PROJ.p3, 'Nova Product Shoot', 'completed', 'Nova Events', 60000, 72000),
  fakeProject(PROJ.p4, 'Kapoor Pre-Wedding', 'active', 'Sharma Family', 45000, 45000),
]

const projectDetail: ProjectDetail = {
  id: PROJ.p1,
  name: 'Sharma Wedding',
  status: 'active',
  client_id: CLIENT.sharma,
  client_name: 'Sharma Family',
  client_phone: '9876543210',
  client_email: 'client@example.test',
  client_address: '12 Turner Road, Bandra West, Mumbai',
  package_cost: 185000,
  additional_deliverables_cost: 42000,
  total_cost: 227000,
  show_quotation: true,
  created_at: '2026-06-01T10:00:00Z',
  quotation_terms: null,
  quotation_display_prefs: {},
  deliverables: [
    delv(uid(0xd1), 'Wedding album (40 sheets)', 'client', true, 30000, [], { due: 40 }),
    delv(uid(0xd2), 'Highlight film', 'client', true, 12000, [{ id: uid(0x61), name: 'Engagement shoot' }], {
      status: 'review',
      due: -2,
      editor: [uid(0xe3), 'Sana Khan'],
      shoot: [uid(0x61), 'Engagement shoot'],
      link: 'https://drive.google.com/demo-highlight',
      notes: 3,
      voice: 1,
      activity: { daysAgo: 1, by: 'Sana Khan', kind: 'voice', body: null },
    }),
    delv(uid(0xd3), 'Raw footage archive', 'internal', false, 0, [], { status: 'completed', delivered: -1 }),
    delv(uid(0xd4), 'Edited Photos', 'client', false, 0, [], {
      status: 'in_progress',
      due: -3,
      editor: [uid(1), 'Demo Owner'],
      shoot: [uid(0x62), 'Wedding day'],
      notes: 1,
      activity: { daysAgo: 2, by: 'Demo Owner', kind: 'event', body: 'moved:in_progress' },
    }),
    delv(uid(0xd5), 'Data Sorting', 'internal', false, 0, [], { shoot: [uid(0x62), 'Wedding day'], due: 5 }),
  ],
  payments: [
    { id: uid(0xf1), amount: 100000, paid_on: '2026-06-02', mode: 'upi', reference: 'TXN9931', status: null, description: null, is_gst: false, gst_number: null },
    { id: uid(0xf2), amount: 50000, paid_on: '2026-07-15', mode: 'bank', reference: 'NEFT5521', status: null, description: null, is_gst: false, gst_number: null },
    { id: uid(0xf3), amount: 40000, paid_on: '2026-10-01', mode: 'UPI', reference: null, status: 'pending', description: 'Before the wedding', is_gst: false, gst_number: null },
  ],
}

const boardTasks = [
  boardTask(uid(0x1a), 'Cull & select — Sharma', 'to_do', 'high', 'Sharma Wedding', 0, {
    due_date: '2026-08-28',
    description: 'First pass, then hand to the editor.',
  }),
  boardTask(uid(0x1b), 'Colour grade film', 'to_do', 'urgent', 'Sharma Wedding', 1, {
    due_date: '2026-09-01',
    assignee_names: [],
  }),
  boardTask(uid(0x1c), 'Album layout', 'in_progress', 'medium', 'Sharma Wedding', 0),
  boardTask(uid(0x1d), 'Edit teaser', 'in_progress', 'high', 'Verma Reception', 1),
  boardTask(uid(0x1e), 'Client review call', 'completed', 'low', 'Nova Product Shoot', 0),
  boardTask(uid(0x1f), 'Retouch product set', 'completed', 'medium', 'Nova Product Shoot', 1),
]

/** Canned response for a path, or NOT_MOCKED to fall through to the network. */
/**
 * Theme is the one fixture that must REMEMBER a write: the picker saves, then
 * refetches, so a hard-coded reply would snap the selection back and make the
 * palette impossible to try in preview mode.
 */
/** Mirrors the theme fixture: a write here has to survive the refetch. */
const profileFx = {
  name: 'Demo Owner',
  email: 'owner@demostudio.in',
  phone: '9800000000',
  role: 'super_admin',
  status: 'active',
  avatar_url: null,
}

const themeState = { preset_key: 'ipc_classic', font_key: null as string | null, color_scheme: 'light' }

export function mockResponse(path: string, method: string, body?: unknown): unknown {
  if (method === 'GET' && path === '/auth/session') return mockSession
  if (method === 'POST' && path === '/auth/forgot-password') return { ok: true }
  if (method === 'POST' && (path === '/auth/logout' || path === '/auth/logout-all'))
    return { ok: true }
  if (method === 'POST' && /^\/team\/members\/[^/]+\/reset-password$/.test(path))
    return { ok: true }
  if (method === 'POST' && path === '/auth/reset-password')
    return {
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      token_type: 'bearer',
      expires_in: 1800,
    }
  // The directory pages, so it asks for `/clients?page=…` and expects
  // {items,total}. Matching only the bare path left the page erroring in mock
  // mode, which is the opposite of what a preview is for.
  if (method === 'GET' && path.startsWith('/clients?')) {
    const rows = atStage(clients, 'partial')
    const q = new URLSearchParams(path.split('?')[1] ?? '')
    return {
      items: rows,
      total: rows.length,
      page: Number(q.get('page') ?? 1),
      page_size: Number(q.get('page_size') ?? 25),
    }
  }
  if (method === 'GET' && path === '/clients') return atStage(clients, 'partial')
  if (method === 'GET' && path === '/projects') return atStage(projects, 'partial')
  // The All Projects page asks for one page plus totals across the filter.
  if (method === 'GET' && path.startsWith('/projects?')) {
    const q = new URLSearchParams(path.split('?')[1] ?? '')
    const all = atStage(projects, 'partial') as Array<{ status: string; name: string; client_name: string | null; total_cost: number; received: number }>
    const term = (q.get('search') ?? '').toLowerCase()
    const matched = all.filter((p) => !term || `${p.name} ${p.client_name ?? ''}`.toLowerCase().includes(term))
    const status = q.get('status')
    const rows = matched.filter((p) => !status || p.status === status)
    const value = rows.reduce((n, p) => n + p.total_cost, 0)
    const received = rows.reduce((n, p) => n + p.received, 0)
    const counts: Record<string, number> = {}
    for (const p of matched) counts[p.status] = (counts[p.status] ?? 0) + 1
    return {
      items: rows,
      total: rows.length,
      page: Number(q.get('page') ?? 1),
      page_size: Number(q.get('page_size') ?? 20),
      summary: { value, received, due: Math.max(0, value - received) },
      status_counts: counts,
    }
  }
  if (method === 'GET' && path === '/projects/tracking') return atStage(trackingRows, 'partial')
  // A deliverable's timeline: notes, voice notes and stage changes.
  if (path.startsWith('/projects/deliverables/') && path.includes('/notes')) {
    if (method === 'DELETE') return {}
    const did = path.split('/')[3] ?? ''
    if (method === 'POST') {
      const b = (body ?? {}) as { kind?: string; body?: string; file_id?: string; duration_seconds?: number }
      return {
        id: uid(0x9f0 + Math.floor(Math.random() * 100)),
        deliverable_id: did,
        kind: b.kind ?? 'text',
        body: b.body ?? null,
        file_id: b.file_id ?? null,
        duration_seconds: b.duration_seconds ?? null,
        author_id: uid(1),
        author_name: 'Demo Owner',
        created_at: new Date().toISOString(),
      }
    }
    const at = (daysAgo: number, h: number) => {
      const d = new Date()
      d.setDate(d.getDate() - daysAgo)
      d.setHours(h, 15, 0, 0)
      return d.toISOString()
    }
    const note = (n: number, kind: string, by: [string, string] | null, extra: object, when: string) => ({
      id: uid(0x9a0 + n), deliverable_id: did, kind, body: null, file_id: null, duration_seconds: null,
      author_id: by?.[0] ?? null, author_name: by?.[1] ?? null, created_at: when, ...extra,
    })
    const owner: [string, string] = [uid(1), 'Demo Owner']
    const sana: [string, string] = [uid(0xe3), 'Sana Khan']
    return [
      note(1, 'event', owner, { body: 'moved:in_progress' }, at(6, 10)),
      note(2, 'text', owner, { body: 'Keep it under 4 minutes. Open with the pheras, end on the vidaai. Song: Kesariya (acoustic).' }, at(6, 10)),
      note(3, 'voice', sana, { file_id: uid(0xfa1), duration_seconds: 14 }, at(3, 18)),
      note(4, 'text', sana, { body: 'First cut is on the drive. Colour pass tomorrow.' }, at(3, 18)),
      note(5, 'event', sana, { body: 'moved:review' }, at(1, 12)),
    ]
  }
  // Above the catch-all below, which would answer this with a project detail.
  if (method === 'GET' && path === '/projects/deliverable-sets')
    return atStage(deliverableSetsFx, 'partial')
  if (method === 'POST' && path === '/projects/deliverable-sets')
    return { id: uid(0xd5), ...(body as object) }
  if (method === 'DELETE' && path.startsWith('/projects/deliverable-sets/')) return {}
  if (method === 'GET' && path === '/projects/board/deliverables')
    return projectDetail.deliverables
      .filter((d) => d.status !== 'cancelled')
      .map((d) => ({ ...d, board_status: d.status, project_name: 'Sharma Wedding', due_date: d.estimated_date }))
  if (method === 'GET' && path === '/projects/deliverables/mine')
    return projectDetail.deliverables
      .filter((d) => d.assignee_id === uid(1) && !['completed', 'cancelled'].includes(d.status))
      .map((d) => ({ ...d, project_name: 'Sharma Wedding', client_name: 'Priya Sharma' }))
  if (method === 'GET' && path.startsWith('/projects/')) return projectDetail
  if (method === 'GET' && (path === '/tasks/board' || path.startsWith('/tasks/board')))
    return atStage(boardTasks, 'full')
  if (method === 'GET' && (path === '/tasks' || path.startsWith('/tasks?') || path === '/tasks/my'))
    return atStage(boardTasks, 'full')
  if (method === 'GET' && path === '/tasks/bundles') return atStage(bundlesFx, 'partial')
  if (method === 'POST' && path === '/tasks/bundles') return { id: uid(0xd8) }
  if (method === 'DELETE' && path.startsWith('/tasks/bundles/')) return {}
  if (method === 'POST' && /\/tasks\/bundles\/[^/]+\/apply$/.test(path)) return { created: 4 }
  if (method === 'GET' && path === '/shoots/services') return atStage(servicesFx, 'partial')
  if (method === 'GET' && path.startsWith('/shoots/presets')) {
    // The real endpoint filters on ?kind=; a mock that ignores it would show
    // edit-room presets in the shoot menu and hide the difference.
    const kind = new URLSearchParams(path.split('?')[1] ?? '').get('kind')
    return atStage(
      shootPresetsFx.filter((p) => !kind || p.kind === kind),
      'partial',
    )
  }
  // Echo what was sent: a preset that comes back under someone else's name
  // makes the save look like it saved the wrong thing.
  if (method === 'POST' && path === '/shoots/presets')
    return { id: uid(0x5d), ...(body as object) }
  if (method === 'DELETE' && path.startsWith('/shoots/presets/')) return {}
  if (method === 'GET' && (path === '/shoots' || path.startsWith('/shoots?'))) return shootsFx
  if (method === 'POST' && path === '/shoots') return { id: uid(0x5c) }
  if (method === 'PATCH' && path.startsWith('/shoots/')) return {}
  if (method === 'POST' && path === '/projects') return { id: PROJ.p1 }
  if (method === 'PATCH' && path.startsWith('/projects/')) return {}
  if (method === 'DELETE' && path.startsWith('/projects/')) return {}
  if (method === 'PUT' && /^\/projects\/[^/]+\/deliverables\/[^/]+\/shoots$/.test(path)) return {}
  if (method === 'POST' && /^\/projects\/[^/]+\/(deliverables|payments)$/.test(path)) return {}
  if (method === 'POST' && /^\/projects\/deliverables\/[^/]+\/stage$/.test(path)) return {}
  if (method === 'POST' && path === '/clients') return fakeClient(uid(0xc9), 'New Client', null)
  // Single client — the project editor loads this to edit contact details.
  if (method === 'GET' && /^\/clients\/[^/]+$/.test(path)) {
    const id = path.split('/')[2]!
    return clients.find((c) => c.id === id) ?? fakeClient(id, 'Sharma Family', '9876543210')
  }
  if (method === 'PATCH' && /^\/clients\/[^/]+$/.test(path)) {
    const id = path.split('/')[2]!
    const existing = clients.find((c) => c.id === id) ?? fakeClient(id, 'Sharma Family', '9876543210')
    const merged = { ...existing, ...(body as object) }
    const i = clients.findIndex((c) => c.id === id)
    if (i >= 0) clients[i] = merged
    return merged
  }
  if (method === 'GET' && path === '/team/members') return atStage(members, 'partial')
  // The directory page asks for `/team/directory?page=…`; the plain array it
  // gets back is paged client-side by useDirectoryPaged.
  if (method === 'GET' && (path === '/team/directory' || path.startsWith('/team/directory?')))
    return atStage(directory, 'partial')
  if (method === 'GET' && (path === '/enquiries' || path.startsWith('/enquiries?')))
    return atStage(enquiriesFx, 'partial').length
      ? { items: enquiriesFx, summary: enquirySummaryFx }
      : { items: [], summary: { total_count: 0, open_count: 0, new_count: 0, reviewed_count: 0, contacted_count: 0, converted_count: 0, closed_count: 0 } }
  if (method === 'POST' && path === '/enquiries') return { id: uid(0xe1) }
  if (method === 'PATCH' && path.startsWith('/enquiries/')) return { ok: true }
  if (method === 'DELETE' && path.startsWith('/enquiries/')) return { ok: true }
  if (method === 'POST' && /^\/enquiries\/[^/]+\/convert$/.test(path)) return { lead_id: uid(0xe9) }
  if (method === 'POST' && path === '/documents/quotations')
    return { link: 'http://localhost:5173/quotation?token=demo-quote' }
  if (method === 'POST' && path === '/documents/receipts')
    return { link: 'http://localhost:5173/receipt?token=demo-receipt' }
  if (method === 'GET' && path.startsWith('/public/quotation/')) return publicQuotationFx
  if (method === 'POST' && /^\/public\/quotation\/[^/]+\/respond$/.test(path)) return { ok: true }
  if (method === 'GET' && path.startsWith('/public/receipt/')) return publicReceiptFx
  if (method === 'GET' && path.startsWith('/public/delivery/')) return publicDeliveryFx
  if (method === 'GET' && path.startsWith('/public/team-terms/')) return publicTeamTermsFx
  if (method === 'POST' && /^\/public\/team-terms\/[^/]+\/ack$/.test(path)) return { ok: true }
  if (method === 'GET' && path.startsWith('/team-terms/templates'))
    return path.includes('archived=1') ? [] : atStage(teamTermsFx, 'partial')
  if (method === 'POST' && path === '/team-terms/templates') return { id: uid(0xb9) }
  if (method === 'PATCH' && path.startsWith('/team-terms/templates/')) return { ok: true }
  if (method === 'POST' && /\/team-terms\/templates\/[^/]+\/archive/.test(path)) return { ok: true }
  if (method === 'GET' && path.startsWith('/team-terms/sends')) return atStage(teamTermsSendsFx, 'full')
  if (method === 'GET' && path === '/terms/documents') return atStage(termsDocumentsFx, 'partial')
  if (method === 'GET' && /^\/terms\/documents\/[^/]+\/payload$/.test(path)) return termsDocumentPayloadFx
  if (method === 'POST' && path === '/terms/issue')
    return {
      document_id: uid(0xbc),
      token: 'demo-project-terms-token',
      url: 'http://localhost:5199/terms/acknowledge?token=demo-project-terms-token',
      email_status: 'not_requested',
      email_error: null,
    }
  // One project's terms: Sharma Wedding has a version waiting and an older
  // one it replaced; every other project has none yet.
  if (method === 'GET' && /^\/terms\/projects\/[^/]+\/documents$/.test(path))
    return path.includes(PROJ.p1)
      ? [
          {
            id: uid(0xbd), title: 'Terms & conditions — Sharma Wedding', created_at: '2026-09-20T10:00:00Z',
            expires_at: '2026-10-04T10:00:00Z', revoked_at: null, acknowledged_at: null, acknowledged_by_name: null,
            acknowledged_by_email: null, access_count: 2, link_live: true, emailed_to: 'priya@example.com',
          },
          {
            id: uid(0xbe), title: 'Terms & conditions — Sharma Wedding', created_at: '2026-09-10T10:00:00Z',
            expires_at: '2026-09-24T10:00:00Z', revoked_at: '2026-09-20T10:00:00Z', acknowledged_at: null, acknowledged_by_name: null,
            acknowledged_by_email: null, access_count: 1, link_live: false, emailed_to: null,
          },
        ]
      : []
  if (method === 'POST' && /^\/terms\/documents\/[^/]+\/link$/.test(path))
    return {
      document_id: path.split('/')[3]!,
      token: 'demo-fresh-token',
      url: 'http://localhost:5199/terms/acknowledge?token=demo-fresh-token',
      email_status: 'not_requested',
      email_error: null,
    }
  if (method === 'POST' && /^\/terms\/documents\/[^/]+\/email$/.test(path)) return { status: 'sent', error: null }
  if (method === 'POST' && /^\/terms\/documents\/[^/]+\/revoke$/.test(path)) return { ok: true }
  if (method === 'GET' && path === '/terms/templates') return []
  // Drafts: none saved yet; a save echoes back as the stored draft.
  if (method === 'GET' && path.startsWith('/terms/draft')) return null
  if (method === 'PUT' && path === '/terms/draft') {
    const b = (body ?? {}) as Record<string, unknown>
    return {
      id: uid(0xd7), project_id: b.project_id ?? null, rendered_body: b.rendered_body ?? '', title: b.title ?? null,
      payment_summary: null, sections: [], payment_terms: b.payment_terms ?? [], total_cost: b.total_cost ?? null,
      legal_note: null, template_id: null, updated_at: new Date().toISOString(),
    }
  }
  if (method === 'POST' && path === '/team-terms/sends')
    return {
      send_id: uid(0xba),
      link: 'http://localhost:5173/team-terms?token=demo-token',
      expires_at: '2026-12-31T00:00:00Z',
      email: 'skipped' as const,
    }
  if (method === 'POST' && /\/team-terms\/sends\/[^/]+\/revoke/.test(path)) return { ok: true }
  if (method === 'GET' && path === '/team/role-library') return roleLibraryFx
  if (method === 'GET' && path === '/team/roles') return atStage(employeeRoles, 'partial')
  // Echoes the request so a role added from the library comes back under the
  // name that was tapped, not a placeholder.
  if (method === 'POST' && path === '/team/roles')
    return { id: uid(0xfa), stage: null, member_count: 0, ...(body as object) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/team/roles/')) return { ok: true }
  if (method === 'PATCH' && /^\/team\/members\/[^/]+\/roles$/.test(path)) return { ok: true }
  if (method === 'POST' && path === '/team/members')
    return { user_id: uid(0xd5), temp_password: null, linked_existing_login: false }
  if ((method === 'PATCH' || method === 'DELETE') && /^\/team\/members\/[^/]+$/.test(path))
    return { ok: true }
  if (method === 'GET' && path === '/team/invitations') return atStage(invitations, 'partial')
  if (method === 'POST' && path === '/team/invitations')
    return {
      id: uid(0xfb),
      invite_link: 'http://localhost:5173/accept-invite?token=mock-invite-token',
      expires_at: '2026-09-08T10:00:00Z',
    }
  if (method === 'POST' && /^\/team\/invitations\/[^/]+\/resend$/.test(path))
    return {
      id: uid(0xfb),
      invite_link: 'http://localhost:5173/accept-invite?token=mock-invite-token-2',
      expires_at: '2026-09-08T10:00:00Z',
    }
  if (method === 'DELETE' && path.startsWith('/team/invitations/')) return { ok: true }
  if (method === 'GET' && path.startsWith('/auth/invite'))
    return {
      email: 'meera@crew.in',
      name: 'Meera Iyer',
      company_name: 'Demo Studio',
      role: 'employee',
      expires_at: '2026-09-06T10:00:00Z',
    }
  if (method === 'POST' && path === '/auth/accept-invite')
    return {
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      token_type: 'bearer',
      expires_in: 1800,
    }
  if (method === 'GET' && path.startsWith('/settings/lookups/active')) return []
  if (method === 'GET' && path.startsWith('/settings/lookups')) return []
  if (method === 'POST' && path === '/settings/lookups') return { id: uid(0xdc) }
  if (method === 'GET' && path === '/settings/profile') return profileFx
  if (method === 'PATCH' && path === '/settings/profile') {
    Object.assign(profileFx, body as Record<string, unknown>)
    return { ...profileFx }
  }
  if (method === 'GET' && path === '/settings/company') return companyFx
  if (method === 'PATCH' && path === '/settings/company') return companyFx
  if (method === 'GET' && path === '/settings/theme') return { ...themeState }
  if (method === 'PATCH' && path === '/settings/theme') {
    // Mirror the server, which writes `is_custom_theme ?? false` — a
    // preset-only PATCH turns the custom palette off. Merging blindly left it
    // on here, so the preview lied about what applying a preset does.
    const patch = body as Record<string, unknown>
    Object.assign(themeState, patch, { is_custom_theme: patch['is_custom_theme'] ?? false })
    return { ...themeState }
  }
  if (method === 'GET' && path === '/allocation') return atStage(slots, 'full')
  if (method === 'POST' && path === '/allocation') return { id: uid(0x5a) }
  if (method === 'POST' && path === '/allocation/batch') {
    const items = ((body as { items?: unknown[] } | undefined)?.items ?? []) as unknown[]
    return { results: items.map((_, index) => ({ index, id: uid(0x5b0 + index), error: null })) }
  }
  if (method === 'POST' && /^\/allocation\/[^/]+\/status$/.test(path)) return {}
  if (method === 'GET' && path === '/data/locations') return storageLocationsFx
  if (method === 'POST' && path === '/data/locations') {
    const created = { id: uid(0x77 + storageLocationsFx.length), name: 'New location', kind: 'drive', ...(body as object) }
    storageLocationsFx.push(created)
    return created
  }
  if (method === 'PATCH' && path.startsWith('/data/locations/')) {
    const id = path.split('/').pop()
    const loc = storageLocationsFx.find((l) => l.id === id)
    if (loc) Object.assign(loc, body as object)
    return loc ?? { id, name: 'Location', kind: 'drive' }
  }
  if (method === 'DELETE' && path.startsWith('/data/locations/')) return {}
  if (method === 'GET' && (path === '/data' || path.startsWith('/data?')))
    return atStage(dataRecords, 'full')
  if (method === 'POST' && path.includes('/verify')) return {}
  if (method === 'POST' && path === '/data') {
    const created = {
      data_type: null,
      project_id: null,
      project_name: null,
      shoot_id: null,
      primary_status: 'pending',
      backup_status: 'pending',
      primary_location_id: null,
      primary_location_name: null,
      backup_location_id: null,
      backup_location_name: null,
      card_count: 0,
      size_gb: 0,
      verified_at: null,
      created_at: new Date().toISOString(),
      ...(body as object),
      id: uid(0x78 + dataRecords.length),
    } as unknown as (typeof dataRecords)[number]
    created.primary_location_name = storageLocationsFx.find((l) => l.id === created.primary_location_id)?.name ?? null
    created.backup_location_name = storageLocationsFx.find((l) => l.id === created.backup_location_id)?.name ?? null
    withStage(created)
    dataRecords.push(created)
    return created
  }
  if (method === 'POST' && /^\/data\/[^/]+\/track$/.test(path)) {
    const id = path.split('/')[2]
    const r = dataRecords.find((x) => x.id === id) as Record<string, unknown> | undefined
    const b = body as { track: 'primary' | 'backup'; status: string }
    if (r) r[`${b.track}_status`] = b.status
    if (r) withStage(r)
    return r ?? {}
  }
  if (method === 'POST' && /^\/allocation\/[^/]+\/data$/.test(path)) {
    const id = path.split('/')[2]
    const sl = slots.find((x) => x.id === id) as Record<string, unknown> | undefined
    if (sl) Object.assign(sl, body as object)
    return {}
  }
  if (method === 'PATCH' && /^\/data\/[^/]+$/.test(path)) {
    const id = path.split('/').pop()
    const rec = dataRecords.find((r) => r.id === id)
    if (rec) {
      Object.assign(rec, body as object)
      rec.primary_location_name = storageLocationsFx.find((l) => l.id === rec.primary_location_id)?.name ?? null
      rec.backup_location_name = storageLocationsFx.find((l) => l.id === rec.backup_location_id)?.name ?? null
      withStage(rec)
    }
    return rec ?? null
  }
  if (method === 'DELETE' && /^\/data\/[^/]+$/.test(path)) return {}
  if (method === 'GET' && (path === '/work/submissions' || path.startsWith('/work/submissions?'))) return workSubs
  if (method === 'POST' && path === '/work/submissions') return { id: uid(0x8a) }
  if (method === 'GET' && path === '/billing/states') return states
  if (method === 'GET' && path === '/billing/invoices') return atStage(invoices2, 'full')
  if (method === 'GET' && path.startsWith('/billing/invoices/')) return invoiceDetailFx
  if (method === 'POST' && path === '/billing/invoices')
    return { id: uid(0x9a), invoice_number: 'INV-0004' }
  if (method === 'POST' && path.includes('/payments')) return {}
  if (method === 'GET' && (path === '/financials/expenses' || path.startsWith('/financials/expenses?')))
    return expensesFx
  if (method === 'POST' && path === '/financials/expenses') return expensesFx[0]
  if (method === 'GET' && path === '/financials/projects') return projectFin
  if (method === 'GET' && path.startsWith('/financials/profitability')) return profitabilityReportFx
  if (method === 'GET' && path.startsWith('/activity')) return activityLogFx
  if (method === 'POST' && path === '/activity') return { id: uid(0xea) }
  if (method === 'GET' && /^\/crm\/leads\/[^/]+\/timeline/.test(path)) return crmTimelineFx
  if (method === 'GET' && /^\/crm\/activities\/[^/]+\/ics$/.test(path)) return NOT_MOCKED
  if (method === 'POST' && path === '/crm/activities/call') return { activity: crmActivitiesFx[0], placed: false, provider: 'manual', call_sid: null, dial_url: 'tel:+919876500001' }
  if (method === 'POST' && path === '/crm/activities/meeting') return { activity: crmActivitiesFx[2], ics_url: '/crm/activities/x/ics' }
  if (method === 'POST' && path === '/crm/activities/email/sync') return { status: 'not_configured', provider: null, fetched: 0, imported: 0, unmatched: 0, message: 'Mailbox sync is not configured in preview.' }
  if (method === 'GET' && path.startsWith('/crm/activities')) return path.includes('open_tasks=1') ? crmActivitiesFx.filter((x) => x.type === 'task' && !x.done_at) : crmActivitiesFx
  if (method === 'POST' && path === '/crm/activities') return { ...crmActivitiesFx[0], id: uid(0xe9), ...(body as Record<string, unknown>) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/activities/')) return {}
  if (method === 'GET' && path === '/crm/integrations') return crmIntegrationsFx
  if (method === 'PUT' && path.startsWith('/crm/integrations/')) return {}
  if (method === 'GET' && path === '/crm/pipelines') return crmPipelinesFx
  if (method === 'POST' && path === '/crm/pipelines') return { ...crmPipelinesFx[0], id: uid(0xd8), name: String((body as { name?: string }).name ?? 'Pipeline'), is_default: false }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/pipelines/') && !path.endsWith('/stages')) return {}
  if (method === 'POST' && /^\/crm\/pipelines\/[^/]+\/stages$/.test(path)) return crmPipelinesFx[0]
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/stages/')) return {}
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/stage$/.test(path))
    return { status: 'contacted', stage_id: String((body as { stage_id?: string }).stage_id ?? STAGE.contacted) }
  if (method === 'GET' && path === '/crm/lost-reasons') return crmLostReasonsFx
  if (method === 'POST' && path === '/crm/lost-reasons') return { id: uid(0xd9), label: String((body as { label?: string }).label ?? 'Other'), position: 9, is_active: true }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/lost-reasons/')) return {}
  if (method === 'GET' && path.startsWith('/crm/contacts/')) return crmContactsFx[0]
  if (method === 'GET' && path.startsWith('/crm/contacts')) return crmContactsFx
  if (method === 'POST' && path === '/crm/contacts') return { ...crmContactsFx[0], id: uid(0xda), ...(body as Record<string, unknown>) }
  if (method === 'PATCH' && path.startsWith('/crm/contacts/')) return {}
  if (method === 'GET' && path.startsWith('/crm/companies/')) return crmCompaniesFx[0]
  if (method === 'GET' && path.startsWith('/crm/companies')) return crmCompaniesFx
  if (method === 'POST' && path === '/crm/companies') return { ...crmCompaniesFx[0], id: uid(0xdb), ...(body as Record<string, unknown>) }
  if (method === 'PATCH' && path.startsWith('/crm/companies/')) return {}
  if (method === 'GET' && path.startsWith('/crm/forecast')) return crmForecastFx
  if (method === 'GET' && path.startsWith('/crm/quotes')) return crmQuotesFx
  if (method === 'POST' && path === '/crm/quotes')
    return { ...crmQuotesFx[0], id: uid(0xd0), ...(body as Record<string, unknown>) }
  if (method === 'POST' && /^\/crm\/quotes\/[^/]+\/send$/.test(path))
    return { url: 'https://app.example/quote/accept?token=demo', open_url: null, delivery: 'none' }
  if (method === 'POST' && /^\/crm\/quotes\/[^/]+\/outcome$/.test(path))
    return { status: String((body as { status?: string }).status ?? 'accepted') }
  if (method === 'DELETE' && path.startsWith('/crm/quotes/')) return {}
  if (method === 'GET' && path === '/crm/prefs') return crmPrefsFx
  if (method === 'PUT' && path === '/crm/prefs') return { ...crmPrefsFx, ...(body as Record<string, unknown>) }
  if (method === 'GET' && path.startsWith('/public/quote/')) return publicQuoteFx
  if (method === 'POST' && path.includes('/public/quote/')) return { ok: true }
  if (method === 'GET' && (path === '/crm/leads' || path.startsWith('/crm/leads?')))
    return atStage(dealLeads(), 'partial')
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/send-template$/.test(path))
    return { url: 'https://wa.me/919876543210?text=Hi', rendered: 'Hi', delivery: 'link' }
  if (method === 'POST' && path === '/crm/leads/bulk') return { updated: 0, previous: [] }
  if (method === 'POST' && path === '/crm/leads/bulk/undo') return { restored: 0 }
  if (method === 'POST' && path === '/crm/leads/merge') return { merged: 1 }
  if (method === 'POST' && path === '/crm/leads/unmerge') return { restored: 1 }
  if (method === 'GET' && path === '/crm/duplicates') return []
  if (method === 'GET' && path === '/crm/templates') return crmTemplatesFx
  if (method === 'POST' && path === '/crm/templates')
    return { ...crmTemplatesFx[0], id: uid(0xc8), ...(body as Record<string, unknown>) }
  if (method === 'DELETE' && path.startsWith('/crm/templates/')) return {}
  if (method === 'GET' && path === '/crm/workflows') return crmWorkflowsFx
  if (method === 'POST' && path === '/crm/workflows') return { ...crmWorkflowsFx[0], id: uid(0xf5), ...(body as Record<string, unknown>), steps: crmWorkflowsFx[0]!.steps }
  if (method === 'POST' && /^\/crm\/workflows\/[^/]+\/enroll$/.test(path)) return { enrolled: 1 }
  if (method === 'GET' && /^\/crm\/workflows\/[^/]+\/enrollments$/.test(path)) return crmEnrollmentsFx
  if (method === 'GET' && path === '/crm/outbox') return crmOutboxFx
  if (method === 'GET' && /^\/crm\/leads\/[^/]+\/enrollments$/.test(path)) return crmEnrollmentsFx.filter((e) => e.status === 'active')
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/workflows/')) return {}
  if (method === 'POST' && path.startsWith('/crm/enrollments/')) return {}
  if (method === 'GET' && path === '/crm/scoring-rules') return crmScoringFx
  if (method === 'POST' && path === '/crm/scoring-rules') return { ...crmScoringFx[0], id: uid(0xf6), ...(body as Record<string, unknown>) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/scoring-rules/')) return {}
  if (method === 'POST' && path === '/crm/scoring/recompute') return { rescored: 4 }
  if (method === 'GET' && path.startsWith('/crm/stats')) return crmStatsFx
  if (method === 'GET' && path.startsWith('/crm/team-stats')) return crmTeamStatsFx
  if (method === 'POST' && path === '/crm/imports/preview') return crmPreviewFx
  if (method === 'POST' && path === '/crm/imports/commit')
    return { created: 1, skipped: 0, invalid: 0, ids: [uid(0xbe)] }
  if (method === 'POST' && path === '/crm/distribution') return { id: uid(0xca) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/distribution/')) return {}
  if (method === 'GET' && path === '/crm/views') return crmViewsFx
  if (method === 'POST' && path === '/crm/views')
    return { ...crmViewsFx[0], id: uid(0xcb), ...(body as Record<string, unknown>) }
  if (method === 'DELETE' && path.startsWith('/crm/views/')) return {}
  if (method === 'PATCH' && path.startsWith('/crm/views/')) return {}
  if (method === 'GET' && path === '/crm/settings') return { sla_hours: 24, hot_score: 60 }
  if (method === 'PATCH' && path === '/crm/settings') return { sla_hours: 24, hot_score: 60, ...(body as Record<string, unknown>) }
  if (method === 'GET' && path === '/crm/cadences') return crmCadencesFx
  if (method === 'POST' && path === '/crm/cadences') return { id: uid(0xcc) }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/cadences/')) return {}
  if (method === 'GET' && /^\/crm\/leads\/[^/]+\/cadence$/.test(path)) return null
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/cadence$/.test(path)) return { next_at: '2026-09-07T04:30:00Z' }
  if (method === 'DELETE' && /^\/crm\/leads\/[^/]+\/cadence$/.test(path)) return {}
  if (method === 'POST' && /^\/crm\/leads\/[^/]+\/convert$/.test(path))
    return { client_id: CLIENT.sharma, project_id: PROJ.p1 }
  if (method === 'GET' && path.startsWith('/cron/runs')) return cronRunsFx
  if (method === 'GET' && path.startsWith('/settings/audit')) return auditFx
  if (method === 'POST' && path === '/auth/change-password')
    return { access_token: 'mock-token', refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 1800 }
  if (method === 'GET' && path === '/shoots/my') return shootsFx
  if (method === 'PUT' && path.startsWith('/hr/attendance/')) return { id: uid(0xc2) }
  if (method === 'GET' && path === '/crm/distribution') return atStage(distributionFx, 'partial')
  if (method === 'GET' && path === '/crm/sources') return atStage(sourcesFx, 'partial')
  if (method === 'POST' && path === '/crm/sources')
    return {
      ...sourcesFx[0],
      id: uid(0xc7),
      ...(body as Record<string, unknown>),
      source_key: 'wf_' + '0'.repeat(29) + 'new',
      lead_count: 0,
      last_lead_at: null,
    }
  if ((method === 'PATCH' || method === 'DELETE') && path.startsWith('/crm/sources/')) return {}
  if (method === 'POST' && path === '/crm/leads')
    return {
      lead: {
        ...dealLeads()[3],
        id: uid(0xbf),
        ...(body as Record<string, unknown>),
        status: 'new',
        assignee_name: null,
      },
      created: true,
    }
  if (method === 'PATCH' && path.startsWith('/crm/leads/')) return {}
  if (method === 'GET' && path === '/hr/attendance/my') return attendanceFx
  // Two on, four off — the state most studios are actually in, and the one
  // worth seeing in the preview.
  if (method === 'GET' && path === '/settings/integrations')
    return {
      environment: 'development',
      items: [
        { key: 'email', label: 'Email (Resend)', configured: true,
          detail: 'Verification, invitations, quotations and receipts are delivered by the system.',
          requires: ['RESEND_API_KEY', 'EMAIL_FROM'] },
        { key: 'whatsapp', label: 'WhatsApp (Cloud API)', configured: false,
          detail: 'Opens wa.me with the text filled in, for someone to press send by hand. Nothing is delivered automatically.',
          requires: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'] },
        { key: 'calls', label: 'Click to call (Twilio)', configured: false,
          detail: 'Call only logs an activity. Dial the number yourself.',
          requires: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] },
        { key: 'payments', label: 'Subscription payments (Razorpay)', configured: false,
          detail: 'Renewal cannot take a payment.',
          requires: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] },
        { key: 'meta_leads', label: 'Meta lead ads', configured: false,
          detail: 'Only a generic JSON webhook works. Posts are not signature-verified.',
          requires: ['META_VERIFY_TOKEN', 'META_APP_SECRET', 'META_PAGE_ACCESS_TOKEN'] },
        { key: 'errors', label: 'Error tracking (Sentry)', configured: true,
          detail: 'Errors, traces and nightly job check-ins are reported.',
          requires: ['SENTRY_DSN'] },
      ],
    }
  if (method === 'GET' && path === '/hr/location')
    return {
      lat: 19.076,
      lng: 72.8777,
      radius_m: 150,
      timezone: 'Asia/Kolkata',
      is_active: true,
      // A studio that has declared its working day, so the preview shows the
      // fields populated rather than the untouched state.
      expected_checkin_time: '10:00:00',
      late_grace_minutes: 15,
      missed_cutoff_time: '12:00:00',
    }
  if (method === 'PATCH' && path === '/hr/location')
    return { ...(body as Record<string, unknown>), timezone: 'Asia/Kolkata' }
  if (method === 'GET' && path.startsWith('/hr/attendance?')) return atStage(rosterFx, 'partial')
  if (method === 'POST' && path === '/hr/check-out') return { id: uid(0xc1) }
  if (method === 'POST' && path === '/hr/check-in') return { id: uid(0xc0) }
  if (method === 'GET' && path === '/notifications') return notifs
  if (method === 'POST' && path.includes('/notifications/')) return {}
  if (method === 'GET' && path === '/subscription/plans') return plansFx
  if (method === 'POST' && path === '/subscription/order')
    return { order_id: uid(0xd0), amount: 5900 }
  if (method === 'POST' && path === '/subscription/activate')
    return { duplicate: false, expires_at: '2027-01-01T00:00:00Z' }
  if (method === 'GET' && path.startsWith('/public/terms/'))
    return {
      body: 'These are the terms of service for your photography package. By clicking "I agree" you accept the scope, payment schedule, and delivery timelines outlined in your quotation.',
    }
  if (method === 'POST' && path.includes('/terms/') && path.endsWith('/ack')) return { ok: true }
  if (method === 'GET' && path === '/platform/studios') return platformStudiosFx
  if (method === 'GET' && path === '/platform/usage') return platformUsageFx
  if (method === 'POST' && /^\/platform\/studios\/[^/]+\/plan$/.test(path)) return { ok: true }
  // 204-style writes: return an empty object so the schema (z.any) passes.
  if (method === 'POST' && path === '/tasks/board/order') return {}
  if (method === 'PATCH' && path.includes('/status')) return {}
  return NOT_MOCKED
}

const platformStudiosFx = [
  {
    id: uid(0xaa),
    name: 'Demo Studio',
    owner_email: 'owner@demostudio.in',
    plan_gate: 'active',
    plan_expiry: '2027-01-01T00:00:00Z',
    user_count: 4,
    project_count: 4,
    created_at: '2026-05-01T10:00:00Z',
  },
  {
    id: uid(0xab),
    name: 'Lens & Light',
    owner_email: 'hi@lenslight.in',
    plan_gate: 'grandfathered',
    plan_expiry: null,
    user_count: 2,
    project_count: 7,
    created_at: '2026-06-12T10:00:00Z',
  },
  {
    id: uid(0xac),
    name: 'Frame Story',
    owner_email: 'team@framestory.in',
    plan_gate: 'grace',
    plan_expiry: '2026-08-01T00:00:00Z',
    user_count: 6,
    project_count: 12,
    created_at: '2026-03-20T10:00:00Z',
  },
  {
    id: uid(0xad),
    name: 'Old Studio',
    owner_email: 'x@old.in',
    plan_gate: 'expired',
    plan_expiry: '2026-04-01T00:00:00Z',
    user_count: 1,
    project_count: 2,
    created_at: '2025-11-02T10:00:00Z',
  },
]

const platformUsageFx = {
  studio_count: 4,
  active_studio_count: 2,
  total_users: 13,
  revenue_last_30d: 17700,
}

const storageLocationsFx = [
  { id: uid(0x74), name: 'Studio NAS', kind: 'nas' },
  { id: uid(0x75), name: 'Drive B', kind: 'drive' },
  { id: uid(0x76), name: 'Google Drive', kind: 'cloud' },
]

/**
 * The stage is the database's to work out (0160), so the mock works it out
 * too -- with the same rules -- rather than echoing whatever was sent.
 */
function withStage(r: object) {
  const x = r as Record<string, unknown>
  const people = members as { user_id: string; name: string }[]
  x.data_status = deriveStage({
    primary_status: (x.primary_status as 'pending') ?? 'pending',
    backup_status: (x.backup_status as 'pending') ?? 'pending',
    date_received: (x.date_received as string | null) ?? null,
    issue_found: !!x.issue_found,
    is_not_required: !!x.is_not_required,
  })
  if (x.copied_by_uid) x.copied_by_name = people.find((m) => m.user_id === x.copied_by_uid)?.name ?? null
  const sl = slots.find((s) => s.id === x.slot_id)
  if (sl) {
    x.user_id = sl.user_id
    x.user_name = sl.user_name
  }
}

const dataRecords = [
  {
    id: uid(0x71),
    data_label: 'CF Card A (Cam 1)',
    data_type: 'photo',
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    shoot_id: uid(0x61),
    primary_status: 'verified',
    backup_status: 'verified',
    primary_location_id: storageLocationsFx[0]!.id,
    primary_location_name: storageLocationsFx[0]!.name,
    backup_location_id: storageLocationsFx[2]!.id,
    backup_location_name: storageLocationsFx[2]!.name,
    card_count: 2,
    size_gb: 64.5,
    verified_at: '2026-07-02T09:00:00Z',
    created_at: '2026-07-01T09:00:00Z',
    // Rahul's Candid seat on the engagement shoot: data safe, both copies checked.
    slot_id: uid(0x51),
    user_id: uid(0xe1),
    user_name: 'Rahul Verma',
    team_member_name: 'Rahul Verma',
    requirement_name: 'Candid Photographer',
    copied_by_name: 'Sana Khan',
    data_status: 'verified',
  },
  {
    id: uid(0x72),
    data_label: 'SD Card B (Cam 2)',
    data_type: 'photo',
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    shoot_id: uid(0x61),
    primary_status: 'copied',
    backup_status: 'pending',
    primary_location_id: storageLocationsFx[1]!.id,
    primary_location_name: storageLocationsFx[1]!.name,
    backup_location_id: null,
    backup_location_name: null,
    card_count: 1,
    size_gb: 32,
    verified_at: null,
    created_at: '2026-07-01T09:05:00Z',
    data_status: 'copied',
  },
  {
    id: uid(0x73),
    data_label: 'Cinema drive',
    data_type: 'video',
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    shoot_id: uid(0x62),
    primary_status: 'copied',
    backup_status: 'copied',
    primary_location_id: null,
    primary_location_name: null,
    backup_location_id: null,
    backup_location_name: null,
    card_count: 4,
    size_gb: 512,
    verified_at: null,
    created_at: '2026-07-05T09:00:00Z',
    data_status: 'backed_up',
  },
]

const plansFx = [
  { id: uid(0xe0), key: 'starter', name: 'Starter', price: 2000, billing_interval: 'monthly' },
  { id: uid(0xe1a), key: 'pro', name: 'Pro', price: 5000, billing_interval: 'monthly' },
  {
    id: uid(0xe2a),
    key: 'studio',
    name: 'Studio (Yearly)',
    price: 50000,
    billing_interval: 'yearly',
  },
]

const notifs = [
  {
    id: uid(0xf1),
    type: 'reminder',
    title: 'Call Priya about wedding date',
    body: null,
    read_at: null,
    created_at: '2026-07-06T06:00:00Z',
  },
  {
    id: uid(0xf2),
    type: 'work',
    title: 'Album v1 was approved',
    body: 'Great work',
    read_at: null,
    created_at: '2026-07-05T10:00:00Z',
  },
  {
    id: uid(0xf3),
    type: 'billing',
    title: 'INV-0001 is overdue',
    body: null,
    read_at: '2026-07-04T10:00:00Z',
    created_at: '2026-07-03T10:00:00Z',
  },
]

/** One of each shape the roster has to render: closed, still in, late, absent. */
const rosterFx = [
  {
    user_id: uid(0xe1),
    name: 'Rahul Sharma',
    email: 'rahul@demostudio.in',
    phone: '9811111111',
    engagement_type: 'in_house',
    status: 'present',
    check_in_at: '2026-09-01T03:34:00Z',
    check_out_at: '2026-09-01T12:04:00Z',
  },
  {
    user_id: uid(0xe3),
    name: 'Sana Khan',
    email: 'sana@demostudio.in',
    phone: '9833333333',
    engagement_type: 'in_house',
    status: 'present',
    check_in_at: '2026-09-01T04:02:00Z',
    check_out_at: null,
  },
  {
    user_id: uid(0xe2),
    name: 'Anita Desai',
    email: 'anita@demostudio.in',
    phone: null,
    engagement_type: 'freelancer',
    status: 'late',
    // 11:11 against a 10:00 start: seventy-one minutes, so the preview shows
    // the hours-and-minutes form rather than only the badge.
    late_minutes: 71,
    check_in_at: '2026-09-01T05:41:00Z',
    check_out_at: '2026-09-01T12:30:00Z',
  },
  {
    user_id: uid(0xe4),
    name: 'Imran Qureshi',
    email: null,
    phone: '9844444444',
    engagement_type: 'freelancer',
    status: 'absent',
    check_in_at: null,
    check_out_at: null,
  },
]

const attendanceFx = [
  {
    id: uid(0xd1),
    a_date: '2026-07-06',
    check_in_at: '2026-07-06T04:05:00Z',
    check_out_at: null,
    status: 'present',
  },
  {
    id: uid(0xd2),
    a_date: '2026-07-05',
    check_in_at: '2026-07-05T04:35:00Z',
    check_out_at: '2026-07-05T13:00:00Z',
    status: 'late',
  },
  { id: uid(0xd3), a_date: '2026-07-04', check_in_at: null, check_out_at: null, status: 'absent' },
]

/** Dates are relative to "now" so the due/overdue buckets are always live. */
const daysFromNow = (n: number, hour = 10) => {
  const at = new Date()
  at.setDate(at.getDate() + n)
  at.setHours(hour, 0, 0, 0)
  return at.toISOString()
}

const COMPANY = { verma: uid(0xde) }
const PIPELINE = uid(0xd0)
const STAGE = { new: uid(0xd1), contacted: uid(0xd2), qualified: uid(0xd3), proposal: uid(0xd4), won: uid(0xd5), lost: uid(0xd6) }
/** Deal fields for the fixtures above: a stage per status, a value on most. */
const STAGE_FOR: Record<string, string> = {
  new: STAGE.new,
  contacted: STAGE.contacted,
  qualified: STAGE.qualified,
  proposal_sent: STAGE.proposal,
  converted: STAGE.won,
  lost: STAGE.lost,
}
const withDeal = <T extends { status: string; name: string | null }>(l: T, i: number) => ({
  ...l,
  pipeline_id: PIPELINE,
  stage_id: STAGE_FOR[l.status] ?? STAGE.new,
  deal_value: i % 3 === 2 ? null : 60000 + i * 15000,
  close_date: i % 2 === 0 ? '2026-10-15' : null,
  title: i === 0 ? 'December wedding' : null,
  score: [72, 35, 10, 55, 20, 65][i % 6] ?? 0,
  crm_company_id: i === 1 ? COMPANY.verma : null,
  crm_company_name: i === 1 ? 'Verma Weddings' : null,
})
const dealLeads = () => rawLeads.map(withDeal)

const rawLeads = [
  {
    id: uid(0xb1),
    name: 'Priya & Arjun',
    phone: '9876500001',
    email: 'priya@x.in',
    source: 'facebook',
    status: 'new',
    assigned_to: uid(0xe1),
    assignee_name: 'Rahul',
    notes: 'Dec wedding, asked for two photographers.',
    follow_up_at: daysFromNow(-2),
    last_contacted_at: null,
    converted_at: null,
    is_hot: true,
    created_at: '2026-07-05T08:00:00Z',
  },
  {
    id: uid(0xb2),
    name: 'Meera',
    phone: '9876500002',
    email: null,
    source: 'webform',
    status: 'contacted',
    assigned_to: uid(0xe3),
    assignee_name: 'Sana',
    notes: null,
    follow_up_at: daysFromNow(0, 16),
    last_contacted_at: daysFromNow(-3),
    converted_at: null,
    is_hot: false,
    created_at: '2026-07-04T08:00:00Z',
  },
  {
    id: uid(0xb3),
    name: 'Corporate Event',
    phone: '9876500003',
    email: 'events@co.in',
    source: 'referral',
    status: 'proposal_sent',
    assigned_to: uid(0xe1),
    assignee_name: 'Rahul',
    notes: 'Quote sent for a two-day conference shoot.',
    follow_up_at: daysFromNow(4),
    last_contacted_at: daysFromNow(-5),
    converted_at: null,
    is_hot: false,
    created_at: '2026-07-03T08:00:00Z',
  },
  {
    id: uid(0xb4),
    name: 'Walk-in enquiry',
    phone: '9876500004',
    email: null,
    source: 'enquiry',
    status: 'new',
    assigned_to: null,
    assignee_name: null,
    notes: null,
    follow_up_at: null,
    last_contacted_at: null,
    converted_at: null,
    is_hot: false,
    created_at: '2026-07-02T08:00:00Z',
  },
  {
    id: uid(0xb5),
    name: 'Kapoor Family',
    phone: '9876500005',
    email: null,
    source: 'referral',
    status: 'converted',
    assigned_to: uid(0xe3),
    assignee_name: 'Sana',
    notes: 'Booked the pre-wedding package.',
    follow_up_at: null,
    last_contacted_at: daysFromNow(-12),
    converted_at: daysFromNow(-6),
    is_hot: false,
    created_at: '2026-06-20T08:00:00Z',
  },
]

const sourcesFx = [
  {
    id: uid(0xc5),
    label: 'Website contact form',
    source_key: 'wf_9f2c41ba7e5d4a1b8c3e6f0d2a4b7c91',
    kind: 'webform',
    is_active: true,
    created_at: '2026-06-01T10:00:00Z',
    lead_count: 2,
    last_lead_at: '2026-07-04T08:00:00Z',
  },
  {
    id: uid(0xc6),
    label: 'Meta — Wedding campaign',
    source_key: 'mt_3a7e91c05b2d4e6f8a1c3b5d7e9f0a2c',
    kind: 'meta',
    is_active: false,
    created_at: '2026-05-12T10:00:00Z',
    lead_count: 1,
    last_lead_at: '2026-07-05T08:00:00Z',
  },
]

const distributionFx = [
  { id: uid(0xba), user_id: uid(0xe1), user_name: 'Rahul Sharma', priority: 0, is_active: true, lead_count: 2 },
  { id: uid(0xbb), user_id: uid(0xe3), user_name: 'Sana Khan', priority: 1, is_active: true, lead_count: 1 },
]

const expensesFx = [
  {
    id: uid(0xa1),
    project_id: PROJ.p1,
    party_id: null,
    party_name: null,
    category: 'Travel',
    description: 'Outstation shoot',
    amount: 15000,
    expense_date: '2026-06-20',
    gst_treatment: 'non_gst',
    gst_rate: null,
    is_fixed_overhead: false,
  },
  {
    id: uid(0xa2),
    project_id: null,
    party_id: null,
    party_name: null,
    category: 'Rent',
    description: 'Studio rent',
    amount: 40000,
    expense_date: '2026-06-01',
    gst_treatment: 'gst_applicable',
    gst_rate: 18,
    is_fixed_overhead: true,
  },
  {
    id: uid(0xa3),
    project_id: PROJ.p3,
    party_id: null,
    party_name: null,
    category: 'Props',
    description: 'Product staging',
    amount: 8000,
    expense_date: '2026-06-28',
    gst_treatment: 'non_gst',
    gst_rate: null,
    is_fixed_overhead: false,
  },
]

const projectFin = [
  {
    project_id: PROJ.p1,
    name: 'Sharma Wedding',
    revenue: 227000,
    received: 150000,
    direct_team_cost: 40000,
    project_expenses: 15000,
    gross_profit: 172000,
    balance_pending: 77000,
  },
  {
    project_id: PROJ.p3,
    name: 'Nova Product Shoot',
    revenue: 72000,
    received: 72000,
    direct_team_cost: 18000,
    project_expenses: 8000,
    gross_profit: 46000,
    balance_pending: 0,
  },
]

const profitabilityReportFx = {
  items: projectFin.map((p) => ({
    project_id: p.project_id,
    project_name: p.name,
    client_id: CLIENT.sharma,
    client_name: p.name === 'Sharma Wedding' ? 'Sharma Family' : 'Nova Events',
    project_status: 'active',
    created_at: '2026-06-01T10:00:00Z',
    project_total_value: p.revenue,
    paid_income: p.received,
    receivables: p.revenue - p.received,
    company_expense_total: p.project_expenses,
    gross_profit: p.gross_profit,
    expected_project_profit: p.gross_profit,
    gross_margin: p.revenue ? Math.round((p.gross_profit / p.revenue) * 100) : 0,
    expected_margin: p.revenue ? Math.round((p.gross_profit / p.revenue) * 100) : 0,
    collection_rate: p.revenue ? Math.round((p.received / p.revenue) * 100) : 0,
    expense_ratio: p.revenue ? Math.round((p.project_expenses / p.revenue) * 100) : 0,
    balance_status: p.balance_pending > 0 ? 'pending' : 'settled',
    profitability_status: 'healthy',
    attention_flags: [] as string[],
  })),
  summary: {
    project_count: projectFin.length,
    total_project_value: projectFin.reduce((s, p) => s + p.revenue, 0),
    total_paid_income: projectFin.reduce((s, p) => s + p.received, 0),
    total_receivables: projectFin.reduce((s, p) => s + (p.revenue - p.received), 0),
    total_company_expenses: projectFin.reduce((s, p) => s + p.project_expenses, 0),
    total_gross_profit: projectFin.reduce((s, p) => s + p.gross_profit, 0),
    average_gross_margin: 70,
    average_collection_rate: 90,
    loss_project_count: 0,
    pending_project_count: projectFin.filter((p) => p.balance_pending > 0).length,
    over_collected_project_count: 0,
  },
  pagination: { page: 1, page_size: 50, total_count: projectFin.length, total_pages: 1 },
}

const activityLogFx = {
  items: [
    {
      id: uid(0xeb),
      user_id: uid(0x1),
      user_name: 'Demo Owner',
      action: 'company.update',
      entity_type: 'company',
      entity_id: null,
      metadata: { name: 'Demo Studio' },
      created_at: '2026-09-05T13:00:00Z',
    },
    {
      id: uid(0xec),
      user_id: uid(0x1),
      user_name: 'Demo Owner',
      action: 'lead.created',
      entity_type: 'lead',
      entity_id: uid(0xb1),
      metadata: { name: 'Priya & Arjun' },
      created_at: '2026-09-05T10:00:00Z',
    },
    {
      id: uid(0xed),
      user_id: uid(0xe1),
      user_name: 'Rahul Sharma',
      action: 'task.completed',
      entity_type: 'task',
      entity_id: null,
      metadata: { title: 'Edit teaser' },
      created_at: '2026-09-04T16:30:00Z',
    },
  ],
  next_cursor: null,
}

const invoiceDetailFx = {
  id: uid(0x91),
  invoice_number: 'INV-0001',
  invoice_date: '2026-06-10',
  status: 'partial',
  place_of_supply: '27',
  client_name: 'Sharma Family',
  subtotal: 120000,
  discount: 0,
  taxable: 120000,
  tax: 20400,
  total: 140400,
  amount_paid: 100000,
  balance_due: 40400,
  created_at: '2026-06-10T10:00:00Z',
  items: [
    {
      id: uid(0x9b1),
      description: 'Photography package',
      quantity: 1,
      rate: 100000,
      amount: 100000,
      gst_rate: 18,
      cgst: 9000,
      sgst: 9000,
      igst: 0,
    },
    {
      id: uid(0x9b2),
      description: 'Wedding album',
      quantity: 2,
      rate: 10000,
      amount: 20000,
      gst_rate: 12,
      cgst: 1200,
      sgst: 1200,
      igst: 0,
    },
  ],
  payments: [{ id: uid(0x9c1), amount: 100000, paid_on: '2026-06-12', mode: 'upi' }],
}

const states = [
  { code: '27', name: 'Maharashtra' },
  { code: '07', name: 'Delhi' },
  { code: '29', name: 'Karnataka' },
  { code: '33', name: 'Tamil Nadu' },
]

const invoices2 = [
  {
    id: uid(0x91),
    invoice_number: 'INV-0001',
    client_name: 'Sharma Family',
    invoice_date: '2026-06-10',
    total: 140400,
    balance_due: 40400,
    status: 'partial',
  },
  {
    id: uid(0x92),
    invoice_number: 'INV-0002',
    client_name: 'Verma Weddings',
    invoice_date: '2026-06-18',
    total: 90000,
    balance_due: 0,
    status: 'paid',
  },
  {
    id: uid(0x93),
    invoice_number: 'INV-0003',
    client_name: 'Nova Events',
    invoice_date: '2026-07-01',
    total: 72000,
    balance_due: 72000,
    status: 'sent',
  },
]

const workSubs = [
  {
    id: uid(0x81),
    project_id: PROJ.p1,
    task_id: null,
    submission_link: 'https://drive.google.com/album-v1',
    location_note: null,
    title: 'Wedding album — first cut',
    submitted_by_name: 'Rajesh Kumar',
    notes: 'First album cut',
    status: 'submitted',
    review_notes: null,
    created_at: '2026-07-03T08:00:00Z',
  },
  {
    id: uid(0x82),
    project_id: PROJ.p1,
    task_id: null,
    submission_link: 'https://drive.google.com/film-v2',
    location_note: null,
    title: 'Highlight film',
    submitted_by_name: 'Anita Rao',
    notes: 'Highlight film',
    status: 'approved',
    review_notes: 'Great work',
    created_at: '2026-07-01T08:00:00Z',
  },
  {
    id: uid(0x83),
    project_id: PROJ.p2,
    task_id: null,
    submission_link: 'https://drive.google.com/teaser',
    title: 'Teaser reel',
    submitted_by_name: 'Rajesh Kumar',
    location_note: null,
    notes: null,
    status: 'rejected',
    review_notes: 'Re-grade the outdoor shots',
    created_at: '2026-06-28T08:00:00Z',
  },
  {
    id: uid(0x84),
    project_id: PROJ.p1,
    task_id: null,
    title: 'Pre-wedding edits',
    submitted_by_name: 'Anita Rao',
    submission_link: 'https://drive.google.com/prewed',
    location_note: null,
    notes: null,
    status: 'sent',
    review_notes: null,
    created_at: '2026-06-25T08:00:00Z',
  },
]

const teamPick = (
  id: number,
  name: string,
  roleNames: string[],
  over: Partial<{ role: string; engagement_type: string; payout_type: string; freelancer_rate: number; phone: string }> = {},
) => ({
  user_id: uid(id),
  name,
  role: over.role ?? 'employee',
  role_names: roleNames,
  engagement_type: over.engagement_type ?? 'in_house',
  phone: over.phone ?? null,
  email: null,
  payout_type: over.payout_type ?? null,
  freelancer_rate: over.freelancer_rate ?? null,
})

// Job roles and pay so the assign desk shows role matches, who is busy, and a
// freelancer's rate pre-filling the payout.
const members = [
  teamPick(0xe1, 'Rahul Verma', ['Candid Photographer'], { payout_type: 'salary' }),
  teamPick(0xe2, 'Anita Rao', ['Cinematographer'], { payout_type: 'salary' }),
  teamPick(0xe3, 'Sana Khan', ['Video Editor'], { role: 'manager' }),
  teamPick(0xe4, 'Vikram Singh', ['Candid Photographer', 'Traditional Photographer'], {
    engagement_type: 'freelancer',
    payout_type: 'per_shoot',
    freelancer_rate: 12000,
  }),
  teamPick(0xe5, 'Meera Iyer', ['Traditional Videographer'], {
    engagement_type: 'freelancer',
    payout_type: 'per_day',
    freelancer_rate: 9000,
  }),
  teamPick(0xe6, 'Arjun Das', ['Drone Operator'], { engagement_type: 'freelancer', payout_type: 'per_shoot', freelancer_rate: 7000 }),
  teamPick(0xe7, 'Kavya Nair', ['Photographer'], { engagement_type: 'freelancer', payout_type: 'per_shoot', freelancer_rate: 10000 }),
]

const bundlesFx = [
  {
    id: uid(0xd6),
    name: 'Wedding editing',
    items: [
      { id: uid(0xd61), title: 'Cull and select', priority: 'high', sort_order: 0 },
      { id: uid(0xd62), title: 'Colour grade', priority: 'medium', sort_order: 1 },
      { id: uid(0xd63), title: 'Album layout', priority: 'medium', sort_order: 2 },
      { id: uid(0xd64), title: 'Client review', priority: 'low', sort_order: 3 },
    ],
  },
  {
    id: uid(0xd7),
    name: 'Shoot preparation',
    items: [
      { id: uid(0xd71), title: 'Confirm call sheet', priority: 'urgent', sort_order: 0 },
      { id: uid(0xd72), title: 'Charge batteries and format cards', priority: 'high', sort_order: 1 },
    ],
  },
]

const deliverableSetsFx = [
  {
    id: uid(0x78),
    name: 'House standard',
    items: [
      { title: 'Edited Photos', is_additional_charge: false, additional_charge_amount: 0, show_on_quotation: true },
      { title: 'Wedding Teaser', is_additional_charge: false, additional_charge_amount: 0, show_on_quotation: true },
      { title: 'Drone Shots', is_additional_charge: true, additional_charge_amount: 15000, show_on_quotation: true },
    ],
  },
]

const ROLE = { photographer: uid(0xf1), editor: uid(0xf2), drone: uid(0xf3) }

const enquiriesFx = [
  {
    id: uid(0xe2),
    name: 'Meera Iyer',
    phone: '9812000001',
    email: 'meera@example.com',
    message: 'Wedding in December, looking for candid plus a film.',
    source: 'website',
    enquiry_status: 'new' as const,
    assigned_to: null,
    assigned_to_name: null,
    converted_lead_id: null,
    created_at: '2026-09-05T09:10:00Z',
  },
  {
    id: uid(0xe3),
    name: 'Arjun Nair',
    phone: '9812000002',
    email: null,
    message: 'Asked about pre-wedding packages in Goa.',
    source: 'instagram',
    enquiry_status: 'contacted' as const,
    assigned_to: uid(0x3),
    assigned_to_name: 'Rahul Sharma',
    converted_lead_id: null,
    created_at: '2026-09-03T14:20:00Z',
  },
  {
    id: uid(0xe4),
    name: 'Kavya Reddy',
    phone: '9812000003',
    email: 'kavya@example.com',
    message: null,
    source: 'referral',
    enquiry_status: 'converted' as const,
    assigned_to: uid(0x3),
    assigned_to_name: 'Rahul Sharma',
    converted_lead_id: uid(0xe9),
    created_at: '2026-08-28T11:00:00Z',
  },
]

const enquirySummaryFx = {
  total_count: 3,
  open_count: 2,
  new_count: 1,
  reviewed_count: 0,
  contacted_count: 1,
  converted_count: 1,
  closed_count: 0,
}

const publicQuotationFx = {
  snapshot: {
    items: [
      { title: 'Traditional Photography', chargeable: false, amount: 0 },
      { title: 'Candid Photography', chargeable: false, amount: 0 },
      { title: 'Wedding Album', chargeable: false, amount: 0 },
      { title: 'Drone Shots', chargeable: true, amount: 15000 },
    ],
    package_cost: 150000,
    add_ons: 15000,
    total: 165000,
    project_name: 'Sharma Wedding',
  },
  notes: 'Valid for 30 days. 50% advance confirms the date.',
  accepted_at: null,
  accepted_by_name: null,
  declined_at: null,
  client_name: 'Sharma Family',
  company_name: 'Demo Studio',
}

const publicReceiptFx = {
  amount: 50000,
  paid_on: '2026-07-20',
  mode: 'upi',
  reference: 'UPI/2026/0720',
  project_name: 'Sharma Wedding',
  client_name: 'Sharma Family',
  company_name: 'Demo Studio',
  total_cost: 165000,
  received_total: 50000,
}

const publicDeliveryFx = {
  submission_link: 'https://drive.example/sharma-wedding',
  notes: 'Full set of edited photographs and the highlight film.',
  delivered_at: '2026-09-01T10:00:00Z',
  project_name: 'Sharma Wedding',
  client_name: 'Sharma Family',
  company_name: 'Demo Studio',
}

const publicTeamTermsFx = {
  status: 'viewed' as const,
  mode: 'acknowledgement_required' as const,
  recipient_name: 'Anita Desai',
  role_name: 'Photographer',
  rendered_body:
    'Photographer & Cinematographer Undertaking\n\nThis undertaking is executed on 2026-07-20 between Demo Studio, having its office at 12 MG Road, Mumbai (the "Company"), and Anita Desai (the "Team Member"), assigned as Photographer for Engagement shoot under project Sharma Wedding scheduled on 2026-08-10.\n\nConfidential Information\nThe Team Member shall maintain strict confidentiality of all client and project information.\n\nAcknowledgement\nBy acknowledging this document electronically, the Team Member confirms that they have read, understood, and agreed to all terms above.',
  acknowledged_at: null,
  acknowledged_by_name: null,
  expires_at: '2026-09-18T09:00:00Z',
  shoot_name: 'Engagement shoot',
  shoot_date: '2026-08-10',
  project_name: 'Sharma Wedding',
  company_name: 'Demo Studio',
}

const teamTermsFx = [
  {
    id: uid(0xb1),
    title: 'Photographer & Cinematographer Undertaking',
    description: 'For anyone shooting on the day.',
    body: 'The Team Member is booked as {{role}} for {{shoot_name}} on {{shoot_date}}.',
    mode: 'acknowledgement_required' as const,
    validity_days: 60,
    category: 'production' as const,
    version: 2,
    is_active: true,
    archived_at: null,
    role_ids: [ROLE.photographer],
    send_count: 3,
  },
  {
    id: uid(0xb2),
    title: 'Shoot Day Call Sheet',
    description: 'Reporting time and dress code. Nothing to sign.',
    body: 'Report by {{reporting_time}} at {{shoot_name}}.',
    mode: 'send_only' as const,
    validity_days: null,
    category: 'general' as const,
    version: 1,
    is_active: true,
    archived_at: null,
    role_ids: [],
    send_count: 0,
  },
]

const termsDocumentsFx = [
  {
    id: uid(0xbb),
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    client_name: 'Sharma Family',
    client_phone: '9876543210',
    acknowledged_at: '2026-06-05T10:00:00Z',
    acknowledged_by_name: 'Sharma Family',
    has_active_link: false,
    link_expires_at: null,
    created_at: '2026-06-01T10:00:00Z',
  },
]

/** What the in-app document viewer reads — the studio's own copy. */
const termsDocumentPayloadFx = {
  title: 'Wedding photography — terms & agreement',
  body: [
    '1. Booking is confirmed on receipt of the booking amount.',
    '2. The shoot date is held only against a confirmed booking.',
    '3. Edited photographs are delivered within 45 working days of the event.',
    '4. Raw footage remains with the studio and is not part of the deliverables.',
    '5. Travel and stay outside city limits are billed at actuals.',
  ].join('\n\n'),
  project_name: 'Sharma Wedding',
  client_name: 'Sharma Family',
  client_phone: '9876543210',
  company_name: 'IPC Studios',
  logo_url: null,
  company_phone: '9820000000',
  company_email: 'hello@ipcstudios.test',
  company_address: '2nd Floor, Linking Road\nBandra West, Mumbai 400050',
  payment_summary: null,
  sections: [
    { heading: 'Cancellation', body: 'The booking amount is non-refundable within 30 days of the event.' },
  ],
  expires_at: null,
  revoked: false,
  acknowledged_at: '2026-06-05T10:00:00Z',
  acknowledged_by_name: 'Sharma Family',
  access_count: 3,
  company_legal_name: 'IPC Studios Private Limited',
  company_website: 'ipcstudios.test',
  client_email: 'sharma@example.test',
  client_address: 'Juhu, Mumbai',
  gstin: '27AAAAA0000A1Z5',
  document_number: 'T-1A2B3C4D',
  issued_at: '2026-06-01T10:00:00Z',
  payment_terms: [
    { id: 't1', label: 'On booking', mode: 'percentage', value: 40, due_trigger: 'On signing', due_date: null, notes: null },
    { id: 't2', label: 'Before the event', mode: 'percentage', value: 40, due_trigger: '7 days prior', due_date: null, notes: null },
    { id: 't3', label: 'On delivery', mode: 'percentage', value: 20, due_trigger: 'On handover', due_date: null, notes: null },
  ],
  total_cost: 250000,
  legal_note: 'Subject to Mumbai jurisdiction.',
  document_footer_note: 'Thank you for choosing IPC Studios.',
  already_acknowledged: null,
}

const teamTermsSendsFx = [
  {
    id: uid(0xb5),
    shoot_id: uid(0x61),
    shoot_name: 'Engagement shoot',
    shoot_date: '2026-08-10',
    project_id: PROJ.p1,
    user_id: uid(0x3),
    role_name: 'Photographer',
    template_id: uid(0xb1),
    template_title: 'Photographer & Cinematographer Undertaking',
    template_version: 2,
    mode: 'acknowledgement_required' as const,
    recipient_name: 'Rahul Sharma',
    recipient_email: 'rahul@demostudio.in',
    recipient_phone: null,
    status: 'acknowledged' as const,
    sent_via: 'email',
    sent_at: '2026-07-20T09:00:00Z',
    viewed_at: '2026-07-20T10:15:00Z',
    acknowledged_at: '2026-07-20T10:18:00Z',
    acknowledged_by_name: 'Rahul Sharma',
    expires_at: '2026-09-18T09:00:00Z',
    created_at: '2026-07-20T09:00:00Z',
  },
]

const servicesFx = [
  { id: uid(0x71), name: 'Photographer' },
  { id: uid(0x72), name: 'Cinematographer' },
  { id: uid(0x73), name: 'Drone Pilot' },
  { id: uid(0x74), name: 'Candid Photographer' },
  { id: uid(0x75), name: 'Light Assistant' },
]

const shootPresetsFx = [
  {
    id: uid(0x76),
    kind: 'shoot' as const,
    name: 'Wedding day (full crew)',
    payload: {
      requirements: [
        { name: 'Photographer', quantity: 2 },
        { name: 'Cinematographer', quantity: 2 },
        { name: 'Drone Pilot', quantity: 1 },
      ],
      internal_work: ['Wedding Day Edited Photos', 'Wedding Day Reel', 'Data Sorting'],
    },
  },
  {
    id: uid(0x77),
    kind: 'internal_work' as const,
    name: 'Standard edit room',
    payload: { requirements: [], internal_work: ['Edited Photos', 'Reel', 'Data Sorting'] },
  },
]

/** The shoot day, as a plain date — the booking calendar groups on it. */
const shootDay = (n: number) => daysFromNow(n).slice(0, 10)

const shootsFx = [
  {
    id: uid(0x61),
    name: 'Engagement shoot',
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    client_name: 'Priya Sharma',
    shoot_date: shootDay(3),
    start_at: null,
    end_at: null,
    location: 'Bandra, Mumbai',
    map_link: null,
    status: 'confirmed',
    requirements: [
      { service_id: uid(0x74), name: 'Candid Photographer', quantity: 2 },
      { service_id: uid(0x72), name: 'Cinematographer', quantity: 1 },
    ],
  },
  {
    id: uid(0x62),
    name: 'Wedding day',
    project_id: PROJ.p1,
    project_name: 'Sharma Wedding',
    client_name: 'Priya Sharma',
    shoot_date: shootDay(9),
    start_at: null,
    end_at: null,
    location: 'Taj Lands End',
    map_link: null,
    status: 'planned',
    requirements: [
      { service_id: uid(0x74), name: 'Candid Photographer', quantity: 2 },
      { service_id: uid(0x73), name: 'Drone Pilot', quantity: 1 },
    ],
  },
  // No requirements on purpose: the booking screen has to say so rather than
  // showing a shoot that looks fully staffed because nothing was asked for.
  {
    id: uid(0x63),
    name: 'Product set A',
    project_id: PROJ.p3,
    project_name: 'Nova Product Shoot',
    client_name: 'Nova Retail',
    shoot_date: shootDay(-4),
    start_at: null,
    end_at: null,
    location: 'Studio',
    map_link: null,
    status: 'completed',
    requirements: [],
  },
]

const companyFx = {
  name: 'Demo Studio',
  legal_name: 'Demo Studio Pvt Ltd',
  display_name: 'Demo Studio',
  city: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
  website: 'https://demostudio.in',
  invoice_gst_number: '27ABCDE1234F1Z5',
  avatar_url: null,
  invoice_number_prefix: 'INV-',
  invoice_next_number: 4,
  quote_number_prefix: 'QT-',
  quote_next_number: 1,
}


const employeeRoles = [
  {
    id: ROLE.photographer,
    type_name: 'Photographer',
    role_code: 'photographer',
    stage: 'production' as const,
    member_count: 2,
  },
  // Unstaged on purpose: this is the shape of a role saved before the stage
  // column existed, and the page has to file it by name.
  { id: ROLE.editor, type_name: 'Editor', role_code: 'editor', stage: null, member_count: 1 },
  {
    id: ROLE.drone,
    type_name: 'Drone Operator',
    role_code: 'drone_operator',
    stage: 'production' as const,
    member_count: 1,
  },
]

const roleLibraryFx = [
  { id: uid(0xa1), type_name: 'Client Coordinator', role_code: 'client_coordinator', stage: 'pre' as const },
  { id: uid(0xa2), type_name: 'Creative Director', role_code: 'creative_director', stage: 'pre' as const },
  { id: uid(0xa3), type_name: 'Candid Photographer', role_code: 'candid_photographer', stage: 'production' as const },
  { id: uid(0xa4), type_name: 'Cinematographer', role_code: 'cinematographer', stage: 'production' as const },
  { id: uid(0xa5), type_name: 'Drone Operator', role_code: 'drone_operator', stage: 'production' as const },
  { id: uid(0xa6), type_name: 'Lighting Technician', role_code: 'lighting_technician', stage: 'production' as const },
  { id: uid(0xa7), type_name: 'Same Day Video Editor', role_code: 'same_day_video_editor', stage: 'post' as const },
  { id: uid(0xa8), type_name: 'Album Designer', role_code: 'album_designer', stage: 'post' as const },
  { id: uid(0xa9), type_name: 'Data Manager', role_code: 'data_manager', stage: 'post' as const },
  { id: uid(0xaa), type_name: 'Operations Manager', role_code: 'operations_manager', stage: 'other' as const },
]

/** One of each shape the directory has to render: owner, staff, freelancer, no-login. */
const directory = [
  member(uid(0x1), 'Demo Owner', 'owner@demostudio.in', 'super_admin', {
    phone: '9800000000',
    engagement_type: 'in_house',
    created_at: '2026-05-01T10:00:00Z',
  }),
  member(uid(0xe1), 'Rahul Sharma', 'rahul@demostudio.in', 'employee', {
    phone: '9811111111',
    engagement_type: 'in_house',
    salary: 45000,
    role_ids: [ROLE.photographer],
    role_names: ['Photographer'],
    created_at: '2026-05-14T10:00:00Z',
    payment_type: 'salaried',
    pay_components: ['monthly_salary'],
    payment_status: 'active',
    pay_effective_from: '2026-05-14',
  }),
  member(uid(0xe2), 'Anita Desai', 'anita@demostudio.in', 'employee', {
    engagement_type: 'freelancer',
    salary: 12000,
    role_ids: [ROLE.photographer, ROLE.drone],
    role_names: ['Drone Operator', 'Photographer'],
    created_at: '2026-06-02T10:00:00Z',
    payment_type: 'freelancer',
    pay_components: ['freelancer_rate', 'commission'],
    commission_pct: 5,
    commission_basis: 'revenue',
    payment_status: 'active',
    pay_effective_from: '2026-06-02',
  }),
  member(uid(0xe3), 'Sana Khan', 'sana@demostudio.in', 'manager', {
    phone: '9833333333',
    alternate_phone: '9822222222',
    engagement_type: 'in_house',
    salary: 68000,
    role_ids: [ROLE.editor],
    role_names: ['Editor'],
    created_at: '2026-06-20T10:00:00Z',
    payment_type: 'salaried',
    pay_components: ['monthly_salary'],
    payment_status: 'active',
    pay_effective_from: '2026-06-20',
  }),
  member(uid(0xe4), 'Imran Qureshi', null, 'employee', {
    phone: '9844444444',
    engagement_type: 'freelancer',
    login_enabled: false,
    status: 'inactive',
    created_at: '2026-07-11T10:00:00Z',
  }),
]

const invitations = [
  {
    id: uid(0xf9),
    email: 'meera@crew.in',
    name: 'Meera Iyer',
    role: 'employee',
    expires_at: '2026-09-06T10:00:00Z',
    created_at: '2026-08-30T10:00:00Z',
    last_sent_at: '2026-08-30T10:00:00Z',
    send_count: 1,
    expired: false,
  },
]

/** Tracking rows: one burning, one late, one waiting, one stalled, one done. */
const trackingRows = [
  {
    id: PROJ.p1,
    name: 'Sharma Wedding',
    status: 'active',
    client_name: 'Sharma Family',
    total_cost: 227000,
    tasks_total: 8,
    tasks_done: 3,
    tasks_overdue: 2,
    deliverables_total: 3,
    deliverables_done: 1,
    deliverables_late: 2,
    data_records_total: 4,
    data_records_unverified: 3,
    pending_reviews: 1,
    shoots_total: 2,
    shoots_done: 2,
    next_shoot_date: null,
    last_activity_at: '2026-08-28T10:00:00Z',
  },
  {
    id: PROJ.p2,
    name: 'Verma Reception',
    status: 'on_hold',
    client_name: 'Verma Weddings',
    total_cost: 90000,
    tasks_total: 5,
    tasks_done: 2,
    tasks_overdue: 1,
    deliverables_total: 2,
    deliverables_done: 0,
    data_records_total: 2,
    data_records_unverified: 0,
    pending_reviews: 2,
    shoots_total: 1,
    shoots_done: 1,
    next_shoot_date: null,
    last_activity_at: '2026-08-20T10:00:00Z',
  },
  {
    id: PROJ.p3,
    name: 'Nova Product Shoot',
    status: 'completed',
    client_name: 'Nova Events',
    total_cost: 72000,
    tasks_total: 4,
    tasks_done: 4,
    tasks_overdue: 0,
    deliverables_total: 2,
    deliverables_done: 2,
    data_records_total: 3,
    data_records_unverified: 0,
    pending_reviews: 0,
    shoots_total: 1,
    shoots_done: 1,
    next_shoot_date: null,
    last_activity_at: '2026-08-15T10:00:00Z',
  },
  {
    id: PROJ.p4,
    name: 'Kapoor Pre-Wedding',
    status: 'active',
    client_name: 'Sharma Family',
    total_cost: 45000,
    tasks_total: 3,
    tasks_done: 1,
    tasks_overdue: 0,
    deliverables_total: 1,
    deliverables_done: 0,
    data_records_total: 0,
    data_records_unverified: 0,
    pending_reviews: 0,
    shoots_total: 2,
    shoots_done: 0,
    next_shoot_date: '2026-09-18',
    last_activity_at: '2026-08-31T10:00:00Z',
  },
]

// Booked against the shoots above by id and role name, which is what the
// booking screen counts: the engagement day is one candid short of its two.
const slots = [
  {
    id: uid(0x51),
    user_id: uid(0xe1),
    user_name: 'Rahul Verma',
    shoot_id: uid(0x61),
    service_name: 'Candid Photographer',
    start_at: daysFromNow(3, 10),
    end_at: daysFromNow(3, 22),
    status: 'booked',
    estimated_cost: 8000,
    final_cost: null,
    cost_status: 'tentative',
    cost_notes: null,
  },
  {
    id: uid(0x52),
    user_id: uid(0xe2),
    user_name: 'Anita Rao',
    shoot_id: uid(0x61),
    service_name: 'Cinematographer',
    start_at: daysFromNow(3, 10),
    end_at: daysFromNow(3, 22),
    status: 'booked',
    estimated_cost: 10000,
    final_cost: null,
    cost_status: 'tentative',
    cost_notes: null,
  },
]

function boardTask(
  id: string,
  title: string,
  status: string,
  priority: string,
  project_name: string,
  sort_order: number,
  over: { due_date?: string | null; description?: string | null; assignee_names?: string[] } = {},
) {
  return {
    id,
    title,
    description: null,
    status,
    priority,
    due_date: null,
    project_id: PROJ.p1,
    project_name,
    assignee_names: ['Rahul Sharma'],
    sort_order,
    ...over,
  }
}

function fakeClient(id: string, name: string, phone: string | null): Client {
  return {
    id,
    company_id: mockSession.company_id,
    name,
    email: null,
    phone,
    alternate_phone: null,
    address: null,
    city: 'Mumbai',
    relation: null,
    gstin: null,
    notes: null,
    created_at: '2026-05-01T10:00:00Z',
  }
}

function fakeProject(
  id: string,
  name: string,
  status: ProjectListItem['status'],
  client_name: string,
  pkg: number,
  total: number,
): ProjectListItem {
  return {
    id,
    name,
    status,
    client_id: CLIENT.sharma,
    client_name,
    client_phone: '9876543210',
    package_cost: pkg,
    total_cost: total,
    // Part paid, so the list's received and pending columns have something to
    // show rather than a wall of zeroes.
    received: Math.round(total * 0.4),
    created_at: '2026-06-01T10:00:00Z',
    next_shoot_date: null,
    tasks_overdue: 0,
  }
}

function delv(
  id: string,
  title: string,
  visibility_scope: 'client' | 'internal',
  is_additional_charge: boolean,
  amount: number,
  sourceShoots: { id: string; name: string }[] = [],
  extra: {
    status?: string
    /** Days from today it is due; negative is late. */
    due?: number
    delivered?: number
    editor?: [string, string]
    shoot?: [string, string]
    link?: string
    notes?: number
    voice?: number
    activity?: { daysAgo: number; by: string; kind: 'text' | 'voice' | 'event'; body: string | null }
  } = {},
) {
  // A local date so this can run before the helpers further down exist.
  const day = (n: number) => {
    const at = new Date()
    at.setDate(at.getDate() + n)
    const p = (x: number) => String(x).padStart(2, '0')
    return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
  }
  return {
    id,
    project_id: PROJ.p1,
    title,
    list_key: 'primary',
    is_additional_charge,
    additional_charge_amount: amount,
    visibility_scope,
    show_on_quotation: visibility_scope === 'client',
    start_rule: sourceShoots.length > 0 ? ('specific_shoots' as const) : ('whole_project' as const),
    status: extra.status ?? 'pending',
    estimated_date: extra.due !== undefined ? day(extra.due) : null,
    delivered_at: extra.delivered !== undefined ? `${day(extra.delivered)}T10:00:00Z` : null,
    assignee_id: extra.editor?.[0] ?? null,
    assignee_name: extra.editor?.[1] ?? null,
    shoot_id: extra.shoot?.[0] ?? null,
    shoot_name: extra.shoot?.[1] ?? null,
    delivery_link: extra.link ?? null,
    notes_count: extra.notes ?? 0,
    voice_count: extra.voice ?? 0,
    last_activity_at: extra.activity ? `${day(-extra.activity.daysAgo)}T09:30:00Z` : null,
    last_activity_by: extra.activity?.by ?? null,
    last_activity_kind: extra.activity?.kind ?? null,
    last_activity_body: extra.activity?.body ?? null,
  }
}


const stageFx = (id: string, name: string, key: string, position: number, kind: 'open' | 'won' | 'lost', probability_default: number, deal_count: number) => ({
  id,
  pipeline_id: PIPELINE,
  name,
  key,
  position,
  kind,
  probability_default,
  wip_limit: key === 'proposal_sent' ? 5 : null,
  required_fields: key === 'proposal_sent' ? ['deal_value'] : [],
  deal_count,
})
const crmPipelinesFx = [
  {
    id: PIPELINE,
    name: 'Sales',
    is_default: true,
    position: 0,
    created_at: '2026-08-01T09:00:00Z',
    stages: [
      stageFx(STAGE.new, 'New', 'new', 0, 'open', 10, 1),
      stageFx(STAGE.contacted, 'Contacted', 'contacted', 1, 'open', 25, 1),
      stageFx(STAGE.qualified, 'Qualified', 'qualified', 2, 'open', 50, 1),
      stageFx(STAGE.proposal, 'Proposal sent', 'proposal_sent', 3, 'open', 75, 0),
      stageFx(STAGE.won, 'Won', 'converted', 4, 'won', 100, 1),
      stageFx(STAGE.lost, 'Lost', 'lost', 5, 'lost', 0, 0),
    ],
  },
]
const crmLostReasonsFx = [
  { id: uid(0xd7), label: 'Budget', position: 0, is_active: true },
  { id: uid(0xdc), label: 'Timing', position: 1, is_active: true },
  { id: uid(0xdd), label: 'Went elsewhere', position: 2, is_active: true },
]
const crmCompaniesFx = [
  {
    id: COMPANY.verma,
    name: 'Verma Weddings',
    domain: 'vermaweddings.in',
    phone: '9812345678',
    city: 'Pune',
    notes: null,
    owner_id: uid(1),
    owner_name: 'Demo Owner',
    is_archived: false,
    contact_count: 1,
    deal_count: 1,
    open_value: 90000,
    created_at: '2026-08-01T09:00:00Z',
  },
]
const crmContactsFx = [
  {
    id: uid(0xdf),
    name: 'Aanya Sharma',
    phone: '9876543210',
    email: 'aanya@example.in',
    lifecycle: 'lead',
    owner_id: uid(1),
    owner_name: 'Demo Owner',
    source: 'facebook',
    crm_company_id: null,
    crm_company_name: null,
    notes: null,
    is_archived: false,
    deal_count: 1,
    open_deal_count: 1,
    last_contacted_at: null,
    created_at: '2026-08-01T09:00:00Z',
  },
  {
    id: uid(0xe1),
    name: 'Rahul Verma',
    phone: '9812345678',
    email: null,
    lifecycle: 'customer',
    owner_id: uid(1),
    owner_name: 'Demo Owner',
    source: 'referral',
    crm_company_id: COMPANY.verma,
    crm_company_name: 'Verma Weddings',
    notes: 'Repeat client',
    is_archived: false,
    deal_count: 2,
    open_deal_count: 1,
    last_contacted_at: '2026-08-20T09:00:00Z',
    created_at: '2026-07-01T09:00:00Z',
  },
]
const crmForecastFx = {
  from: '2026-08-07',
  to: '2026-12-05',
  count: 3,
  total_value: 330000,
  weighted: 197500,
  won_value: 90000,
  open_value: 240000,
  by_stage: [
    { stage_id: STAGE.contacted, name: 'Contacted', kind: 'open', count: 1, total_value: 150000, weighted: 37500 },
    { stage_id: STAGE.qualified, name: 'Qualified', kind: 'open', count: 1, total_value: 90000, weighted: 45000 },
    { stage_id: STAGE.won, name: 'Won', kind: 'won', count: 1, total_value: 90000, weighted: 90000 },
  ],
  by_owner: [{ user_id: uid(1), name: 'Demo Owner', count: 3, total_value: 330000, weighted: 197500 }],
  by_month: [
    { month: '2026-09', count: 2, total_value: 240000, weighted: 82500 },
    { month: '2026-10', count: 1, total_value: 90000, weighted: 90000 },
  ],
}

const crmQuotesFx = [
  {
    id: uid(0xd1),
    lead_id: uid(0xb1),
    lead_name: 'Priya & Arjun',
    quote_number: 'Q-0007',
    title: 'Wedding package',
    status: 'sent',
    valid_until: '2026-09-20',
    place_of_supply: 'Maharashtra',
    intra_state: true,
    subtotal: 120000,
    discount: 0,
    taxable: 120000,
    tax: 21600,
    total: 141600,
    notes: 'Half in advance to confirm the date.',
    terms: 'Balance before delivery.',
    sent_at: '2026-09-04T09:00:00Z',
    accepted_at: null,
    accepted_by_name: null,
    accepted_by_email: null,
    accepted_ip: null,
    declined_at: null,
    decline_reason: null,
    items: [
      { description: 'Wedding coverage', quantity: 1, rate: 100000, amount: 100000, gst_rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
      { description: 'Album', quantity: 2, rate: 10000, amount: 20000, gst_rate: 18, taxable: 20000, cgst: 1800, sgst: 1800, igst: 0 },
    ],
    created_at: '2026-09-04T09:00:00Z',
  },
  {
    id: uid(0xd2),
    lead_id: uid(0xb2),
    lead_name: 'Meera',
    quote_number: 'Q-0006',
    title: 'Pre-wedding shoot',
    status: 'accepted',
    valid_until: '2026-09-10',
    place_of_supply: 'Maharashtra',
    intra_state: true,
    subtotal: 50000,
    discount: 5000,
    taxable: 45000,
    tax: 8100,
    total: 53100,
    notes: null,
    terms: null,
    sent_at: '2026-08-28T09:00:00Z',
    accepted_at: '2026-08-30T09:00:00Z',
    accepted_by_name: 'Meera',
    accepted_by_email: 'meera@x.in',
    accepted_ip: '203.0.113.7',
    declined_at: null,
    decline_reason: null,
    items: [
      { description: 'Pre-wedding shoot', quantity: 1, rate: 50000, amount: 50000, gst_rate: 18, taxable: 45000, cgst: 4050, sgst: 4050, igst: 0 },
    ],
    created_at: '2026-08-28T09:00:00Z',
  },
]

const crmPrefsFx = {
  columns: ['lead', 'stage', 'score', 'source', 'owner', 'value', 'follow_up'],
  default_view_id: null,
  density: 'comfortable',
  pipeline_id: null,
}

const publicQuoteFx = {
  quote_number: 'Q-0007',
  title: 'Wedding package',
  status: 'sent',
  valid_until: '2026-09-20',
  subtotal: 120000,
  discount: 0,
  taxable: 120000,
  tax: 21600,
  total: 141600,
  notes: 'Half in advance to confirm the date.',
  terms: 'Balance before delivery.',
  accepted_at: null,
  declined_at: null,
  studio: 'Demo Studio',
  client_name: 'Priya & Arjun',
  items: [
    { description: 'Wedding coverage', quantity: 1, rate: 100000, amount: 100000, gst_rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
    { description: 'Album', quantity: 2, rate: 10000, amount: 20000, gst_rate: 18, taxable: 20000, cgst: 1800, sgst: 1800, igst: 0 },
  ],
  expired: false,
}

const activityFx = (id: string, over: Partial<Record<string, unknown>>) => ({
  id,
  lead_id: uid(0xb1),
  lead_name: 'Priya & Arjun',
  contact_id: uid(0xdf),
  contact_name: 'Aanya Sharma',
  type: 'note',
  direction: 'none',
  subject: null,
  body: null,
  outcome: null,
  started_at: '2026-09-04T09:00:00Z',
  ended_at: null,
  duration_s: null,
  due_at: null,
  done_at: null,
  assigned_to: uid(1),
  assignee_name: 'Demo Owner',
  actor_id: uid(1),
  actor_name: 'Demo Owner',
  provider: 'manual',
  external_id: null,
  location: null,
  created_at: '2026-09-04T09:00:00Z',
  ...over,
})
const crmActivitiesFx = [
  activityFx(uid(0xe2), { type: 'call', direction: 'out', outcome: 'answered', duration_s: 660, body: 'Wants two photographers and a drone.' }),
  activityFx(uid(0xe3), { type: 'task', subject: 'Send the album mock-up', due_at: '2026-09-05T04:30:00Z', created_at: '2026-09-03T09:00:00Z' }),
  activityFx(uid(0xe4), { type: 'meeting', direction: 'out', subject: 'Venue recce', location: 'Taj Lands End, Bandra', started_at: '2026-09-10T04:30:00Z', ended_at: '2026-09-10T05:30:00Z', created_at: '2026-09-02T09:00:00Z' }),
  activityFx(uid(0xe5), { type: 'whatsapp', direction: 'in', subject: 'Yes, Sunday works', provider: 'whatsapp', created_at: '2026-09-01T12:00:00Z', lead_id: uid(0xb2), lead_name: 'Meera' }),
]
const crmTimelineFx = {
  items: [
    ...crmActivitiesFx.filter((a) => a.lead_id === uid(0xb1)).map((a) => ({ kind: 'activity', at: a.created_at, activity: a })),
    { kind: 'event', at: '2026-08-01T09:00:00Z', event: { id: uid(0xe0), lead_id: uid(0xb1), from_status: null, to_status: 'new', actor_id: null, actor_name: null, note: 'arrived via facebook', created_at: '2026-08-01T09:00:00Z' } },
  ],
  next_cursor: null,
}
const crmIntegrationsFx = [
  { provider: 'gmail', status: 'not_configured', credentials_present: false, config: {}, last_error: null, last_sync_at: null, connected_by: null, updated_at: null },
  { provider: 'o365', status: 'not_configured', credentials_present: false, config: {}, last_error: null, last_sync_at: null, connected_by: null, updated_at: null },
  { provider: 'twilio', status: 'connected', credentials_present: true, config: {}, last_error: null, last_sync_at: null, connected_by: uid(1), updated_at: '2026-09-01T09:00:00Z' },
]


const crmTemplatesFx = [
  {
    id: uid(0xc5),
    name: 'First follow-up',
    body: 'Hi {{name}}, thanks for reaching out to {{studio}}!',
    kind: 'whatsapp',
    created_at: '2026-08-01T09:00:00Z',
  },
]

const WF = uid(0xf0)
const crmWorkflowsFx = [
  {
    id: WF,
    name: 'Facebook nurture',
    trigger: 'lead_created',
    condition: { source: 'facebook' },
    is_active: true,
    allow_reenroll: false,
    exit_on_reply: true,
    steps: [
      { id: uid(0xf1), step_no: 1, kind: 'action', config: { action: 'mark_hot' } },
      { id: uid(0xf2), step_no: 2, kind: 'delay', config: { amount: 1, unit: 'days' } },
      { id: uid(0xf3), step_no: 3, kind: 'branch', config: { conditions: [{ field: 'inbound_replies', op: 'gte', value: 1 }], yes_step: 5, no_step: 4 } },
      { id: uid(0xf4), step_no: 4, kind: 'action', config: { action: 'notify_assignee', note: 'No reply yet — call them.' } },
      { id: uid(0xf7), step_no: 5, kind: 'exit', config: {} },
    ],
    active_count: 1,
    completed_count: 3,
    errored_count: 0,
    last_enrolled_at: '2026-09-04T09:00:00Z',
    created_at: '2026-08-01T09:00:00Z',
  },
]
const crmEnrollmentsFx = [
  { id: uid(0xf8), workflow_id: WF, workflow_name: 'Facebook nurture', lead_id: uid(0xb1), lead_name: 'Priya & Arjun', current_step: 3, next_at: '2026-09-06T09:00:00Z', status: 'active', exit_reason: null, steps_run: 2, log: [{ step: 1, kind: 'action', result: 'mark_hot', at: '2026-09-04T09:00:00Z' }, { step: 2, kind: 'delay', at: '2026-09-04T09:00:01Z' }], enrolled_at: '2026-09-04T09:00:00Z' },
  { id: uid(0xf9), workflow_id: WF, workflow_name: 'Facebook nurture', lead_id: uid(0xb2), lead_name: 'Meera', current_step: 5, next_at: null, status: 'completed', exit_reason: null, steps_run: 4, log: [{ step: 1, kind: 'action', result: 'mark_hot', at: '2026-08-20T09:00:00Z' }], enrolled_at: '2026-08-20T09:00:00Z' },
]
const crmOutboxFx = [
  {
    id: uid(0xb7),
    lead_id: uid(0xb1),
    lead_name: 'Priya & Arjun',
    template_name: 'First follow-up',
    channel: 'whatsapp',
    status: 'manual',
    error: null,
    created_at: '2026-09-04T09:05:00Z',
    sent_at: '2026-09-04T10:00:00Z',
  },
  {
    id: uid(0xb8),
    lead_id: uid(0xb2),
    lead_name: 'Meera',
    template_name: 'First follow-up',
    channel: 'whatsapp',
    status: 'failed',
    error: 'whatsapp send failed 401: check the access token',
    created_at: '2026-09-03T09:05:00Z',
    sent_at: null,
  },
]

const crmScoringFx = [
  { id: uid(0xfa), label: 'Has an email address', field: 'has_email', op: 'eq', value: true, points: 10, is_active: true, position: 0 },
  { id: uid(0xfb), label: 'Came by referral', field: 'source', op: 'eq', value: 'referral', points: 15, is_active: true, position: 1 },
  { id: uid(0xfc), label: 'Deal worth 50,000 or more', field: 'deal_value', op: 'gte', value: 50000, points: 20, is_active: true, position: 2 },
  { id: uid(0xfd), label: 'Has replied', field: 'inbound_replies', op: 'gte', value: 1, points: 25, is_active: true, position: 3 },
  { id: uid(0xfe), label: 'Gone quiet for 14 days', field: 'days_since_contact', op: 'gte', value: 14, points: -15, is_active: true, position: 6 },
]

const crmStatsFx = {
  from: '2026-08-01',
  to: '2026-08-31',
  total: 4,
  overdue: 1,
  uncontacted: 1,
  created: 4,
  won: 1,
  lost: 0,
  conversion_rate: 0.25,
  byStatus: { new: 1, contacted: 1, proposal_sent: 1, converted: 1 },
  bySource: { facebook: 2, enquiry: 2 },
}

const crmTeamStatsFx = [
  {
    user_id: uid(0xe1),
    user_name: 'Rahul',
    open: 2,
    overdue: 1,
    due_today: 0,
    uncontacted: 1,
    hot: 1,
    created: 2,
    won: 1,
    lost: 0,
    within_sla: 2,
    sla_hours: 24,
    avg_first_response_hours: 3.5,
  },
]

const crmPreviewFx = {
  columns: ['name', 'phone', 'email', 'notes'],
  rows: [
    {
      row: 2,
      name: 'Priya',
      phone: '9876543210',
      email: 'priya@test.in',
      source: 'manual',
      notes: 'Interested',
      valid: true,
      error: null,
      phone_norm: '919876543210',
      is_duplicate: false,
    },
  ],
  total: 1,
  valid: 1,
  duplicates: 0,
}

const cronRunsFx = [
  {
    id: uid(0xd9),
    job_name: 'reminder_cron',
    started_at: '2026-09-05T08:00:00Z',
    finished_at: '2026-09-05T08:00:01Z',
    dry_run: false,
    summary: { reminders_due: 2, notifications_created: 1 },
  },
  {
    id: uid(0xda),
    job_name: 'crm_followup_cron',
    started_at: '2026-09-05T08:00:01Z',
    finished_at: '2026-09-05T08:00:02Z',
    dry_run: false,
    summary: { overdue: 1, notified: 1, rules_applied: 0 },
  },
]

const auditFx = {
  items: [
    {
      id: uid(0xdb),
      actor_user_id: uid(1),
      actor_name: 'Demo Owner',
      action: 'company.update',
      entity_type: 'company',
      entity_id: uid(0xaa),
      before: { name: 'Demo' },
      after: { name: 'Demo Studio' },
      ip: '127.0.0.1',
      correlation_id: 'req-demo-1',
      created_at: '2026-09-05T07:30:00Z',
    },
  ],
  next_cursor: null,
}

const crmViewsFx = [
  {
    id: uid(0xca),
    user_id: uid(1),
    name: 'My overdue',
    query: { search: '', filters: ['overdue'], status: 'all', assignee: 'all' },
    visibility: 'private',
    created_at: '2026-08-01T09:00:00Z',
  },
]

const crmCadencesFx = [
  {
    id: uid(0xcd),
    name: 'Wedding enquiry follow-up',
    is_active: true,
    steps: [
      { id: uid(0xce), step_no: 1, day_offset: 0, template_id: null, template_name: null, note: 'Call and confirm the date' },
      { id: uid(0xcf), step_no: 2, day_offset: 3, template_id: uid(0xc5), template_name: 'First follow-up', note: null },
    ],
    active_leads: 1,
    created_at: '2026-08-01T09:00:00Z',
  },
]
