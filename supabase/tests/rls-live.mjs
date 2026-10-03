// Live end-to-end verification against a REAL self-hosted stack (Postgres + API).
// Exercises the whole path pglite can't: self-issued JWT auth + the withUser
// SET-ROLE/GUC transaction model enforcing RLS on plain Postgres. Proves a user
// in studio A cannot read studio B's data. Creates two throwaway studios.
//
// Run it AFTER `docker compose up` on the VPS (or any host with the API up):
//   API_URL=https://api.yourstudio.in bun supabase/tests/rls-live.mjs
const API = (process.env.API_URL ?? '').replace(/\/+$/, '')
if (!API) {
  console.error('Set API_URL (e.g. https://api.yourstudio.in)')
  process.exit(2)
}

const rand = () => Math.random().toString(36).slice(2, 10)
/** Registration requires a phone. Distinct per studio so no dedupe rule can join them. */
const randPhone = () => `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`
let pass = 0
let fail = 0
/**
 * `detail` is the response that decided it. Printed only on failure, and only
 * far enough to name the cause -- a bare "FAIL" tells you a thing is broken
 * and not one word about why, which is the whole failure mode this suite
 * exists to catch. Three expense checks failed in CI for a week reading
 * "FAIL" with no status; they were sending a token that an earlier test had
 * deliberately revoked, and the 401 was right there in the response.
 */
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail !== undefined) {
    const body = typeof detail === 'string' ? detail : JSON.stringify(detail)
    console.log(`      got: ${body.slice(0, 300)}`)
  }
  ok ? pass++ : fail++
}

/**
 * `ip` signs a call in from another device -- a team member on their own
 * phone -- so its sign-ins do not count against this run's own per-IP
 * credential limit. (With no proxy in front, the API reads the last
 * X-Forwarded-For hop as the peer.)
 */
async function api(path, { token, method = 'GET', body, ip } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function makeStudio(label) {
  const email = `rls-${label}-${rand()}@example.com`
  const reg = await api('/auth/register', {
    method: 'POST',
    body: {
      company_name: `RLS ${label} ${rand()}`,
      admin_name: `Owner ${label}`,
      email,
      phone: randPhone(),
      password: 'Testpass12345!',
    },
  })
  // Register requires email verification; off-production it returns the token.
  if (reg.status !== 200 || !reg.json.verification_token) {
    throw new Error(`register ${label}: ${reg.status} ${JSON.stringify(reg.json)}`)
  }

  // In straight away: sign-up hands back a session, and the password alone
  // signs in before the email is confirmed (the app asks for it inside).
  check(`${label}: sign-up signs the owner straight in`, !!reg.json.session?.access_token, reg.json.session ? 'session' : reg.json)
  const early = await api('/auth/login', { method: 'POST', body: { email, password: 'Testpass12345!' } })
  check(`${label}: login works before the email is confirmed`, early.status === 200 && !!early.json.access_token, { status: early.status })
  const unconfirmed = await api('/auth/session', { token: early.json.access_token })
  check(`${label}: the session says the email is not confirmed yet`, unconfirmed.json.email_verified === false, unconfirmed.json.email_verified)

  const verified = await api('/auth/verify', { method: 'POST', body: { token: reg.json.verification_token } })
  check(`${label}: verify returns a token`, verified.status === 200 && !!verified.json.access_token)

  // Password login now works.
  const login = await api('/auth/login', { method: 'POST', body: { email, password: 'Testpass12345!' } })
  check(
    `${label}: login returns an access + refresh pair`,
    login.status === 200 && !!login.json.access_token && !!login.json.refresh_token,
  )
  return { token: login.json.access_token, refresh: login.json.refresh_token, email }
}

const a = await makeStudio('A')
const b = await makeStudio('B')

// ── Studio setup (0191): a brand-new studio starts at step 1, and the owner
//    closes it. Studio B is still empty here. (No extra sign-ins: the
//    credential limiter is shared by the whole suite.) The employee half is in
//    the Reports block, which already has an employee signed in. ──
{
  const fresh = await api('/auth/session', { token: b.token })
  check(
    'setup: a brand-new studio is not set up yet, at step 1',
    fresh.status === 200 && fresh.json.setup_done === false && fresh.json.setup_step === 1,
    fresh.json,
  )
  const bad = await api('/settings/company/setup', { token: b.token, method: 'PATCH', body: { action: 'later' } })
  check('setup: an unknown action is refused (422)', bad.status === 422, { status: bad.status })
  const done = await api('/settings/company/setup', { token: b.token, method: 'PATCH', body: { action: 'done' } })
  const after = await api('/auth/session', { token: b.token })
  check(
    'setup: PATCH done -> the session shows setup_done true',
    done.status === 200 && after.status === 200 && after.json.setup_done === true && after.json.setup_step === null,
    { patch: done.status, session: after.json },
  )
}

// Studio A creates a client.
const created = await api('/clients', {
  token: a.token,
  method: 'POST',
  body: { name: `A Client ${rand()}` },
})
check('A: can create a client', created.status === 201 && !!created.json.id)
const aClientId = created.json.id

// Studio A sees its own client.
const aList = await api('/clients', { token: a.token })
check('A: sees its own client', Array.isArray(aList.json) && aList.json.some((c) => c.id === aClientId))

// Studio B must NOT see A's client (RLS).
const bList = await api('/clients', { token: b.token })
check(
  "B: list excludes A's client (cross-tenant RLS)",
  Array.isArray(bList.json) && !bList.json.some((c) => c.id === aClientId),
)

// Studio B cannot fetch A's client by id.
const bGet = await api(`/clients/${aClientId}`, { token: b.token })
check("B: cannot fetch A's client by id (404)", bGet.status === 404)

// No token → unauthorized.
const anon = await api('/clients')
check('anon: rejected without a token', anon.status === 401)

// Malformed uuid filters are caller errors (422), never cast-error 500s.
const badUuid = await api('/team-terms/sends?shoot_id=nope', { token: a.token })
check('sends: malformed uuid filter is 422', badUuid.status === 422)

// The enquiry inbox pages instead of truncating at a fixed cap.
for (let i = 0; i < 3; i++) {
  await api('/enquiries', { token: a.token, method: 'POST', body: { name: `Paged ${i} ${rand()}` } })
}
const eqPage1 = await api('/enquiries?limit=2', { token: a.token })
const eqIds1 = new Set((eqPage1.json.items ?? []).map((e) => e.id))
check(
  'enquiries: first page carries a cursor',
  eqPage1.status === 200 && eqIds1.size === 2 && !!eqPage1.json.next_cursor,
)
const eqPage2 = await api(`/enquiries?limit=2&cursor=${encodeURIComponent(eqPage1.json.next_cursor)}`, {
  token: a.token,
})
const eqIds2 = new Set((eqPage2.json.items ?? []).map((e) => e.id))
const overlap = [...eqIds2].some((id) => eqIds1.has(id))
check(
  'enquiries: second page continues without overlap',
  eqPage2.status === 200 && eqIds2.size === 1 && !overlap && !eqPage2.json.next_cursor,
)

// Referral campaigns: create, then list -- the list handler's own summary
// query once referenced `status` with no FROM clause reaching the table it
// meant to aggregate, so this 400ed on every call, for every studio, the
// moment a campaign existed to summarize.
const campaign = await api('/referrals/campaigns', {
  token: a.token,
  method: 'POST',
  body: { name: `Referral ${rand()}`, reward_type: 'fixed', reward_value: 500 },
})
check('referrals: can create a campaign', campaign.status === 201 && !!campaign.json.id)
const campaignList = await api('/referrals/campaigns', { token: a.token })
check(
  'referrals: list loads and includes the new campaign',
  campaignList.status === 200 &&
    Array.isArray(campaignList.json.campaigns) &&
    campaignList.json.campaigns.some((c) => c.id === campaign.json.id) &&
    campaignList.json.summary.total_campaigns >= 1,
)

// Invoice templates: layout_json is a jsonb column written with a manual
// `${JSON.stringify(x)}::jsonb` cast instead of the driver's own sql.json()
// helper used everywhere else in this file for the same kind of param. That
// pattern double-encoded the value on write for most (not all -- data-
// dependent) requests, so the list endpoint's response-schema parse blew up
// with a 500 for every studio the moment more than one template existed.
// Create two (the first request alone didn't reproduce it live -- the bug
// was data/timing-dependent, not "always broken").
const template1 = await api('/billing/templates', {
  token: a.token,
  method: 'POST',
  body: { name: `Template ${rand()}`, layout_json: { header_text: 'From the studio' } },
})
const template2 = await api('/billing/templates', {
  token: a.token,
  method: 'POST',
  body: { name: `Template ${rand()}`, layout_json: { header_text: 'Second one' } },
})
check(
  'invoice templates: create returns the full row, not just an id',
  template1.status === 201 &&
    template1.json.layout_json?.header_text === 'From the studio' &&
    template2.status === 201 &&
    template2.json.layout_json?.header_text === 'Second one',
)
const templateList = await api('/billing/templates', { token: a.token })
const byId = new Map((templateList.json.items ?? []).map((t) => [t.id, t]))
check(
  'invoice templates: list loads and layout_json round-trips as an object for every row',
  templateList.status === 200 &&
    typeof byId.get(template1.json.id)?.layout_json === 'object' &&
    byId.get(template1.json.id)?.layout_json.header_text === 'From the studio' &&
    typeof byId.get(template2.json.id)?.layout_json === 'object' &&
    byId.get(template2.json.id)?.layout_json.header_text === 'Second one',
)

// Project templates: same double-encoding bug as invoice templates above --
// deliverables_json/shoots_json/tasks_json were written with a manual
// `${JSON.stringify(x)}::jsonb` cast instead of sql.json(), so every field
// came back as a string and the list 500ed for every studio once a template
// existed with more than a trivial payload.
const projectTemplate = await api('/projects/templates', {
  token: a.token,
  method: 'POST',
  body: {
    name: `Template ${rand()}`,
    deliverables_json: [{ name: 'Edited album', quantity: 1 }],
    shoots_json: [{ name: 'Engagement', kind: 'pre-wedding' }],
    tasks_json: [{ title: 'Cull photos' }],
  },
})
check('project templates: create returns an id', projectTemplate.status === 201 && !!projectTemplate.json.id)
const projectTemplateList = await api('/projects/templates', { token: a.token })
const pt = (projectTemplateList.json.items ?? []).find((t) => t.id === projectTemplate.json.id)
check(
  'project templates: list loads and every jsonb field round-trips as an array',
  projectTemplateList.status === 200 &&
    Array.isArray(pt?.deliverables_json) &&
    pt.deliverables_json[0]?.name === 'Edited album' &&
    Array.isArray(pt?.shoots_json) &&
    pt.shoots_json[0]?.name === 'Engagement' &&
    Array.isArray(pt?.tasks_json) &&
    pt.tasks_json[0]?.title === 'Cull photos',
)

// Numeric query params must survive driver serialization (regression: custom
// pg serializers once returned numbers unchanged and every LIMIT query died
// with ERR_INVALID_ARG_TYPE in production while string-only routes stayed up).
const auditPage = await api('/settings/audit?limit=1', { token: a.token })
check('audit: numeric limit param works (200)', auditPage.status === 200)
const cronHistory = await api('/cron/runs?limit=1', { token: a.token })
check('cron: numeric limit param works (200)', cronHistory.status === 200)

// ── refresh + sign-out ────────────────────────────────────────
const rotated = await api('/auth/refresh', { method: 'POST', body: { refresh_token: a.refresh } })
check(
  'refresh: exchanges for a new pair',
  rotated.status === 200 && !!rotated.json.access_token && rotated.json.refresh_token !== a.refresh,
)

const refreshedCall = await api('/clients', { token: rotated.json.access_token })
check('refresh: the new access token works', refreshedCall.status === 200)

const spent = await api('/auth/refresh', { method: 'POST', body: { refresh_token: a.refresh } })
// Inside the 60s grace window a spent token means another tab just rotated:
// 409, so that tab waits for the new token instead of signing out (0221).
check('refresh: a just-spent token is refused as a race (409)', spent.status === 409)

// That replay landed inside the 60s grace window, where a spent token means
// "two tabs raced", not theft — so the successor must still work. Revocation on
// STALE reuse is covered by the pglite suite, which can age the row.
const afterReuse = await api('/auth/refresh', {
  method: 'POST',
  body: { refresh_token: rotated.json.refresh_token },
})
check('refresh: a racing replay does not kill the family', afterReuse.status === 200)

// A fresh sign-in, then sign out everywhere.
const reLogin = await api('/auth/login', { method: 'POST', body: { email: a.email, password: 'Testpass12345!' } })
check('A: can sign in again after the family was revoked', reLogin.status === 200)

const logoutAll = await api('/auth/logout-all', { method: 'POST', token: reLogin.json.access_token })
check('logout-all: accepted', logoutAll.status === 200)

const deadAccess = await api('/clients', { token: reLogin.json.access_token })
check('logout-all: the access token is stranded (401)', deadAccess.status === 401)

const deadRefresh = await api('/auth/refresh', {
  method: 'POST',
  body: { refresh_token: reLogin.json.refresh_token },
})
check('logout-all: the refresh token is revoked (401)', deadRefresh.status === 401)

// ── password reset ────────────────────────────────────────────
// Unknown emails answer exactly like known ones (no account enumeration).
const unknown = await api('/auth/forgot-password', {
  method: 'POST',
  body: { email: `nobody-${rand()}@example.com` },
})
check(
  'forgot-password: unknown email still returns ok, no token',
  unknown.status === 200 && unknown.json.ok === true && !unknown.json.reset_token,
)

const forgot = await api('/auth/forgot-password', { method: 'POST', body: { email: b.email } })
check('forgot-password: issues a token for a real account', forgot.status === 200 && !!forgot.json.reset_token)

const NEW_PW = 'Newpass98765!'
const reset = await api('/auth/reset-password', {
  method: 'POST',
  body: { token: forgot.json.reset_token, password: NEW_PW },
})
check('reset-password: succeeds and signs in', reset.status === 200 && !!reset.json.access_token)

const replay = await api('/auth/reset-password', {
  method: 'POST',
  body: { token: forgot.json.reset_token, password: NEW_PW },
})
check('reset-password: the link is one-time (400)', replay.status === 400)

const oldPw = await api('/auth/login', { method: 'POST', body: { email: b.email, password: 'Testpass12345!' } })
check('B: the old password no longer works (401)', oldPw.status === 401)

const newPw = await api('/auth/login', { method: 'POST', body: { email: b.email, password: NEW_PW } })
check('B: the new password works', newPw.status === 200 && !!newPw.json.access_token)

// The session B held before the reset must be dead (stateless JWT + password_changed_at).
const stale = await api('/clients', { token: b.token })
check('B: the pre-reset session is rejected (401)', stale.status === 401)

// The token minted by the reset itself is still good.
const fresh = await api('/clients', { token: reset.json.access_token })
check('B: the post-reset session works', fresh.status === 200)

// ── writes that only fail against the real driver ──────────────
// postgres.js refuses `undefined` inside a values object. The expense insert
// used to set `itemize_json: undefined` whenever the caller omitted it — which
// is every caller — so creating a company expense failed for everyone while
// typecheck, lint and the pglite suite all stayed green. Only a real insert
// through the real driver catches that shape of bug.
// A's sessions were all revoked by the logout-all block above -- that is what
// it is testing, and `a.token` died with them. These checks used it anyway and
// were reading 401 as a broken insert. Sign back in for a live token; A's
// password was never changed (only B's was reset).
const aAgain = await api('/auth/login', {
  method: 'POST',
  body: { email: a.email, password: 'Testpass12345!' },
})
check('A: signs back in for the expense checks', aAgain.status === 200, aAgain.json)
const aToken = aAgain.json.access_token

const expenseMin = await api('/financials/expenses', {
  token: aToken,
  method: 'POST',
  body: { amount: 2500 },
})
check(
  'A: can create an expense with only the required fields',
  expenseMin.status === 201,
  { status: expenseMin.status, ...expenseMin.json },
)

const expenseFull = await api('/financials/expenses', {
  token: aToken,
  method: 'POST',
  body: {
    amount: 8000,
    description: 'Drone rental',
    category: 'Equipment',
    expense_date: new Date().toISOString().slice(0, 10),
    gst_treatment: 'gst_applicable',
    gst_rate: 18,
  },
})
check('A: can create a fully specified expense', expenseFull.status === 201, {
  status: expenseFull.status,
  ...expenseFull.json,
})

const expenseItemized = await api('/financials/expenses', {
  token: aToken,
  method: 'POST',
  body: { amount: 4000, itemize_json: [{ title: 'Battery', amount: 4000, qty: 1 }] },
})
check('A: can create an itemized expense', expenseItemized.status === 201, {
  status: expenseItemized.status,
  ...expenseItemized.json,
})

// The list is the other half of the fix that went in with these: it pages on
// the server now, and its tiles are counted over the same filtered set.
const expensePage = await api('/financials/expenses?page=1&page_size=2', { token: aToken })
check(
  'A: the expense list pages, with a real total',
  expensePage.status === 200 &&
    Array.isArray(expensePage.json.items) &&
    typeof expensePage.json.total === 'number' &&
    expensePage.json.total >= 3,
  { status: expensePage.status, ...expensePage.json },
)

const expenseTiles = await api('/financials/expenses/summary?gst=gst_applicable', { token: aToken })
const gstOnly = await api('/financials/expenses?page=1&page_size=100&gst=gst_applicable', { token: aToken })
check(
  'A: the summary counts the same rows the filtered list returns',
  expenseTiles.status === 200 &&
    gstOnly.status === 200 &&
    expenseTiles.json.count === gstOnly.json.items.length,
  { tiles: expenseTiles.json.count, list: gstOnly.json.items?.length },
)

// ── the payment ledger (0145) ─────────────────────────────────
// There were two payment tables and nothing joined them: money recorded
// against an invoice never reached the project, and money recorded against
// the project left the invoice unpaid. `received_payments` is the single
// ledger now, and an invoice's totals are derived from it by trigger.
//
// These run against the real HTTP path on purpose. The bug that survived the
// pglite suite was in response SHAPING, not in SQL: the list selected
// invoice_id, typed it, and then rebuilt the row as an object literal that
// left it out — and the schema's `.default(null)` filled the hole in silence.
const ledgerClient = await api('/clients', {
  token: aToken,
  method: 'POST',
  body: { name: 'Ledger Co', phone: randPhone() },
})
const ledgerProject = await api('/projects', {
  token: aToken,
  method: 'POST',
  body: { name: 'Ledger project', client_id: ledgerClient.json.id, package_cost: 10000 },
})
const ledgerInvoice = await api('/billing/invoices', {
  token: aToken,
  method: 'POST',
  body: {
    client_id: ledgerClient.json.id,
    project_id: ledgerProject.json.id,
    place_of_supply: '27',
    intra_state: true,
    invoice_date: new Date().toISOString().slice(0, 10),
    discount: 0,
    discount_type: 'flat',
    status: 'sent',
    lines: [{ description: 'Ledger probe', quantity: 1, rate: 10000, gst_rate: 0 }],
  },
})
check('ledger: an invoice can be raised on a project', ledgerInvoice.status === 201, {
  status: ledgerInvoice.status,
  ...ledgerInvoice.json,
})

const invId = ledgerInvoice.json.id
const paid = await api(`/billing/invoices/${invId}/payments`, {
  token: aToken,
  method: 'POST',
  body: { amount: 10000, paid_on: new Date().toISOString().slice(0, 10), mode: 'upi' },
})
check('ledger: a payment can be recorded against the invoice', paid.status === 204, paid.json)

const invAfter = await api(`/billing/invoices/${invId}`, { token: aToken })
check(
  'ledger: the invoice settles itself from the payment',
  invAfter.json.status === 'paid' && Number(invAfter.json.amount_paid) === 10000,
  { status: invAfter.json.status, amount_paid: invAfter.json.amount_paid },
)

// The journey's invoice: the whole project, with the wizard's advance applied
// to it rather than recorded twice. The same ledger rows, now linked.
{
  const advClient = await api('/clients', { token: aToken, method: 'POST', body: { name: 'Advance Co', phone: randPhone() } })
  const advProject = await api('/projects', {
    token: aToken,
    method: 'POST',
    body: { name: 'Advance project', client_id: advClient.json.id, package_cost: 100000, payments: [{ amount: 50000, paid_on: '2026-05-01', mode: 'UPI', status: 'paid' }] },
  })
  const before = await api(`/projects/${advProject.json.id}`, { token: aToken })
  const advance = (before.json.payments ?? [])[0]
  check('advance: the wizard records one advance on the project', before.status === 200 && advance?.amount === 50000 && advance?.invoice_id === null, { status: before.status, payments: before.json.payments })
  const inv = await api('/billing/invoices', {
    token: aToken,
    method: 'POST',
    body: {
      client_id: advClient.json.id,
      project_id: advProject.json.id,
      place_of_supply: '27',
      intra_state: true,
      discount: 0,
      discount_type: 'flat',
      status: 'draft',
      attach_payment_ids: [advance?.id],
      lines: [{ description: 'Advance project — Package', quantity: 1, rate: 100000, gst_rate: 0 }],
    },
  })
  const detail = await api(`/billing/invoices/${inv.json.id}`, { token: aToken })
  check(
    'advance: the invoice counts the advance as paid and reads the balance (never a draft)',
    inv.status === 201 && detail.json.status === 'partial' && Number(detail.json.amount_paid) === 50000 && Number(detail.json.balance_due) === 50000,
    { status: inv.status, inv: detail.json.status, paid: detail.json.amount_paid, due: detail.json.balance_due },
  )
  const after = await api(`/projects/${advProject.json.id}`, { token: aToken })
  const received = (after.json.payments ?? []).filter((x) => x.status !== 'pending').reduce((n, x) => n + Number(x.amount), 0)
  check('advance: the project received total does not move, and the payment now names its invoice', received === 50000 && (after.json.payments ?? [])[0]?.invoice_id === inv.json.id, { received, payments: after.json.payments })
  // Another project's payment, or one already on an invoice, is never taken.
  const inv2 = await api('/billing/invoices', {
    token: aToken,
    method: 'POST',
    body: { client_id: ledgerClient.json.id, project_id: ledgerProject.json.id, place_of_supply: '27', intra_state: true, discount: 0, discount_type: 'flat', status: 'sent', attach_payment_ids: [advance?.id], lines: [{ description: 'x', quantity: 1, rate: 100, gst_rate: 0 }] },
  })
  const d2 = await api(`/billing/invoices/${inv2.json.id}`, { token: aToken })
  check("advance: another project's payment is never attached", inv2.status === 201 && Number(d2.json.amount_paid) === 0, { status: inv2.status, paid: d2.json.amount_paid })
}

// The half that was broken: this money has to reach the project.
const fin = await api('/financials/projects', { token: aToken })
const projRow = (Array.isArray(fin.json) ? fin.json : []).find(
  (f) => f.project_id === ledgerProject.json.id,
)
check(
  'ledger: money recorded on the invoice reaches the project',
  Number(projRow?.received) === 10000,
  { received: projRow?.received },
)

// And the shaping bug: the list must return the link it selects.
const payList = await api('/billing/payments?page=1&page_size=50', { token: aToken })
const listed = ((payList.json.items ?? payList.json) || []).find((p) => p.invoice_id === invId)
check(
  'ledger: the payments list says which invoice a payment settled',
  !!listed && listed.invoice_number === invAfter.json.invoice_number,
  { found: !!listed, invoice_number: listed?.invoice_number },
)

// Deleting it must un-settle the invoice, or a mistake stays "paid" for ever.
if (listed) {
  const gone = await api(`/billing/payments/${listed.id}`, { token: aToken, method: 'DELETE' })
  const invUnpaid = await api(`/billing/invoices/${invId}`, { token: aToken })
  check(
    'ledger: removing the payment un-settles the invoice',
    gone.status < 300 && Number(invUnpaid.json.amount_paid) === 0 && invUnpaid.json.status !== 'paid',
    { delete: gone.status, amount_paid: invUnpaid.json.amount_paid, status: invUnpaid.json.status },
  )
}

// ── Billing belongs to the project (0169) ─────────────────────
// A payment recorded on the project can settle one of its invoices; the
// project page lists its invoices; the Billing overview gathers what is
// owed; an invoice has a link a client opens without logging in, which the
// studio can stop; cancelling keeps the money on the project.
{
  const pid = ledgerProject.json.id
  const onProject = await api(`/projects/${pid}/payments`, {
    token: aToken,
    method: 'POST',
    body: { amount: 4000, paid_on: new Date().toISOString().slice(0, 10), status: 'paid', invoice_id: invId },
  })
  const inv4 = await api(`/billing/invoices/${invId}`, { token: aToken })
  check(
    'billing: a payment on the project can settle its invoice',
    onProject.status === 201 && Number(inv4.json.amount_paid) === 4000 && inv4.json.status === 'partial',
    { status: onProject.status, amount_paid: inv4.json.amount_paid, inv: inv4.json.status },
  )

  const detail = await api(`/projects/${pid}`, { token: aToken })
  const pay = (detail.json.payments ?? []).find((x) => x.id === onProject.json.id)
  check('billing: the project payment says which invoice it settled', pay?.invoice_number === inv4.json.invoice_number, { pay })

  const pb = await api(`/projects/${pid}/billing`, { token: aToken })
  check(
    'billing: the project lists its invoices',
    pb.status === 200 && (pb.json.invoices ?? []).some((i) => i.id === invId) && pb.json.plan === null,
    { status: pb.status, invoices: pb.json.invoices?.length, plan: pb.json.plan },
  )

  const other = await api('/projects', { token: aToken, method: 'POST', body: { name: 'Other project', client_id: ledgerClient.json.id, package_cost: 5000 } })
  const otherInv = await api('/billing/invoices', {
    token: aToken,
    method: 'POST',
    body: {
      client_id: ledgerClient.json.id, project_id: other.json.id, place_of_supply: '27', intra_state: true,
      invoice_date: new Date().toISOString().slice(0, 10), discount: 0, discount_type: 'flat', status: 'sent',
      lines: [{ description: 'Other', quantity: 1, rate: 5000, gst_rate: 0 }],
    },
  })
  const wrong = await api(`/projects/${pid}/payments`, {
    token: aToken,
    method: 'POST',
    body: { amount: 100, status: 'paid', invoice_id: otherInv.json.id },
  })
  check("billing: a payment cannot settle another project's invoice", wrong.status === 422, { status: wrong.status })

  const ov = await api('/billing/overview', { token: aToken })
  check(
    'billing: the overview lists the unpaid invoice with its project',
    ov.status === 200 && (ov.json.due_invoices ?? []).some((i) => i.id === invId && i.project_name === 'Ledger project'),
    { status: ov.status, due: ov.json.due_invoices?.length },
  )
  const ovB = await api('/billing/overview', { token: newPw.json.access_token })
  check("billing: another studio's overview does not see it", ovB.status === 200 && !(ovB.json.due_invoices ?? []).some((i) => i.id === invId), { status: ovB.status })

  const listRow = await api(`/billing/invoices?project_id=${pid}&page=1&page_size=10`, { token: aToken })
  check(
    'billing: the invoice list carries the project',
    (listRow.json.items ?? []).some((i) => i.id === invId && i.project_id === pid && i.project_name === 'Ledger project'),
    { items: listRow.json.items?.length },
  )

  const share = await api(`/billing/invoices/${invId}/share`, { token: aToken, method: 'POST', body: {} })
  const token = (share.json.link ?? '').split('token=')[1] ?? ''
  const pub = await api(`/public/invoice/${token}`)
  check(
    'billing: the client link opens the invoice without logging in',
    share.status === 201 && pub.status === 200 && pub.json.invoice?.invoice_number === inv4.json.invoice_number && Number(pub.json.invoice?.balance_due) === 6000,
    { share: share.status, pub: pub.status },
  )
  const bShare = await api(`/billing/invoices/${invId}/share`, { token: newPw.json.access_token, method: 'POST', body: {} })
  check("billing: another studio cannot make a link to it", bShare.status === 404, { status: bShare.status })
  const junk = await api(`/public/invoice/${'x'.repeat(40)}`)
  check('billing: a made-up link does not open', junk.status === 404, { status: junk.status })

  await api(`/billing/invoices/${invId}/share`, { token: aToken, method: 'POST', body: { revoke: true } })
  const pubAfter = await api(`/public/invoice/${token}`)
  check('billing: a stopped link no longer opens', pubAfter.status === 404, { status: pubAfter.status })

  const share2 = await api(`/billing/invoices/${invId}/share`, { token: aToken, method: 'POST', body: {} })
  const token2 = (share2.json.link ?? '').split('token=')[1] ?? ''
  const cancel = await api(`/billing/invoices/${invId}/cancel`, { token: aToken, method: 'POST', body: {} })
  const afterCancel = await api(`/projects/${pid}`, { token: aToken })
  const kept = (afterCancel.json.payments ?? []).find((x) => x.id === onProject.json.id)
  const pubCancelled = await api(`/public/invoice/${token2}`)
  check(
    'billing: cancelling keeps the money on the project and closes the link',
    cancel.status === 200 && !!kept && kept.invoice_id === null && pubCancelled.status === 404,
    { cancel: cancel.status, kept: !!kept, invoice_id: kept?.invoice_id, pub: pubCancelled.status },
  )
}

// ── Billing in four heads (0170) ──────────────────────────────
// Receipt numbers per financial year, one expenses ledger with bills and
// "paid by", the accountant's GST summary -- and the screens that went away.
{
  const pid = ledgerProject.json.id
  const p1 = await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 1000, status: 'paid', paid_on: '2026-05-02', mode: 'UPI' } })
  const d1 = await api(`/billing/payments/${p1.json.id}`, { token: aToken })
  check('receipts: a received payment gets a number in the year\'s series', /^RCP-\d{4}-\d{2}-\d{4}$/.test(d1.json.receipt_number ?? ''), { n: d1.json.receipt_number, mode: d1.json.mode })
  const promised = await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 700, status: 'pending', paid_on: '2026-05-03' } })
  const d2 = await api(`/billing/payments/${promised.json.id}`, { token: aToken })
  check('receipts: a promise has no number yet', d2.status === 200 && d2.json.receipt_number === null, { n: d2.json.receipt_number })
  await api(`/projects/${pid}/payments/${promised.json.id}`, { token: aToken, method: 'PATCH', body: { status: 'paid' } })
  const d3 = await api(`/billing/payments/${promised.json.id}`, { token: aToken })
  await api(`/projects/${pid}/payments/${promised.json.id}`, { token: aToken, method: 'PATCH', body: { paid_on: '2026-05-09' } })
  const moved = await api(`/billing/payments/${promised.json.id}`, { token: aToken })
  check('payments: changing the date on the project moves it in Billing too', moved.json.date_received === '2026-05-09', { date_received: moved.json.date_received })
  check('receipts: numbered the day it is received, after the one before', !!d3.json.receipt_number && d3.json.receipt_number > d1.json.receipt_number, { before: d1.json.receipt_number, after: d3.json.receipt_number })
  const link = await api('/documents/receipts', { token: aToken, method: 'POST', body: { payment_id: p1.json.id } })
  const rtoken = (link.json.link ?? '').split('token=')[1] ?? ''
  const pub = await api(`/public/receipt/${rtoken}`)
  check('receipts: the client\'s receipt carries the number', pub.status === 200 && pub.json.receipt_number === d1.json.receipt_number, { status: pub.status, n: pub.json.receipt_number })
  const list = await api(`/billing/payments?search=${encodeURIComponent(d1.json.receipt_number ?? '')}&page=1&page_size=5`, { token: aToken })
  const promise2 = await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 300, status: 'pending', paid_on: '2026-06-01' } })
  const all = await api('/billing/payments?page=1&page_size=5', { token: aToken })
  const filtered = await api('/billing/payments?status=paid&page=1&page_size=5', { token: aToken })
  check(
    'payments: the promised count is over the same payments as the promised amount, whatever the filter',
    promise2.status === 201 && all.json.summary?.promised_count >= 1 && filtered.json.summary?.promised_count === all.json.summary?.promised_count && filtered.json.summary?.promised_amount === all.json.summary?.promised_amount,
    { all: all.json.summary, filtered: filtered.json.summary },
  )
  check('receipts: the list finds a payment by its number and shows the year\'s tiles', (list.json.items ?? []).some((x) => x.id === p1.json.id) && typeof list.json.summary?.received_this_fy === 'number', { found: list.json.items?.length, tiles: list.json.summary })

  const cleared = await api(`/billing/payments/${p1.json.id}/cleared`, { token: aToken, method: 'POST', body: { cleared: true } })
  const recon = await api('/financials/reconciliation', { token: aToken })
  const personal = await api('/personal-expenses', { token: aToken })
  check('gone: banked, reconciliation and personal expenses no longer answer', cleared.status === 404 && recon.status === 404 && personal.status === 404, { cleared: cleared.status, recon: recon.status, personal: personal.status })

  const me = await api('/auth/session', { token: aToken })
  const myId = me.json.user_id ?? me.json.user?.user_id ?? null
  const exp = await api('/financials/expenses', { token: aToken, method: 'POST', body: { amount: 500, category: 'Travel', description: 'Cab', expense_date: '2026-05-04', paid_by_user_id: myId } })
  check('expenses: paid by a person is owed back by default', exp.status === 201 && exp.json.reimbursement_status === 'pending' && exp.json.paid_by_user_id === myId, { status: exp.status, body: exp.json, me: me.json })
  const sum1 = await api('/financials/expenses/summary', { token: aToken })
  check('expenses: the To reimburse tile counts it', Number(sum1.json.to_reimburse) >= 500, sum1.json)
  const back = await api(`/financials/expenses/${exp.json.id}/reimbursed`, { token: aToken, method: 'POST', body: {} })
  const sum2 = await api('/financials/expenses/summary', { token: aToken })
  check('expenses: paid back clears it', back.status === 200 && Number(sum2.json.to_reimburse) === Number(sum1.json.to_reimburse) - 500, { back: back.status, before: sum1.json.to_reimburse, after: sum2.json.to_reimburse })

  // A bill on the expense: uploaded privately, attached by id, invisible to another studio.
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 0, 1, 1, 1, 0, 24, 221, 141, 176, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
  const fd = new FormData()
  fd.append('file', new Blob([png], { type: 'image/png' }), 'bill.png')
  const up = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${aToken}` }, body: fd })
  const upJson = await up.json().catch(() => ({}))
  const att = await api(`/financials/expenses/${exp.json.id}/attachments`, { token: aToken, method: 'POST', body: { file_id: upJson.id } })
  const atts = await api(`/financials/expenses/${exp.json.id}/attachments`, { token: aToken })
  check('expenses: a bill can be uploaded and attached', up.status === 200 && att.status === 201 && (atts.json ?? []).length === 1 && atts.json[0].mime_type === 'image/png', { up: up.status, att: att.status, body: att.json, n: atts.json?.length })
  const theirs = await api(`/financials/expenses/${exp.json.id}/attachments`, { token: newPw.json.access_token })
  const theirFile = await fetch(`${API}/files/${upJson.id}`, { headers: { Authorization: `Bearer ${newPw.json.access_token}` } })
  check('expenses: another studio sees neither the bill nor the file', (theirs.status === 200 ? (theirs.json ?? []).length === 0 : theirs.status === 403 || theirs.status === 404) && theirFile.status === 404, { list: theirs.status, n: theirs.json?.length, file: theirFile.status })
  const row = ((await api('/financials/expenses?page=1&page_size=50&paid_by=' + myId, { token: aToken })).json.items ?? []).find((x) => x.id === exp.json.id)
  check('expenses: the list says who paid and how many bills', row?.paid_by_name != null && row?.attachment_count === 1 && row?.reimbursement_status === 'reimbursed', { row })

  const gst = await api('/financials/gst-summary?from=2026-05-01&to=2026-05-31', { token: aToken })
  check('for the CA: GST by month answers for the period', gst.status === 200 && Array.isArray(gst.json.months) && gst.json.months.length === 1 && gst.json.months[0].month === '2026-05', { status: gst.status, months: gst.json.months })
}

// ── One person, many studios, one email (0159) ─────────────────
// A freelancer on two studios' teams: both studios add the same email, they
// sign in once with their own password, see both studios, switch between
// them -- and each studio still sees only its own data.
{
  // Studios A and B from the top of this file: the credential endpoints share
  // one per-IP limit, and two more sign-ups would spend most of it. Both
  // tokens are the latest each studio holds (A's after logout-all, B's after
  // its password reset).
  const c = { token: aToken }
  const d = { token: newPw.json.access_token }
  const shared = `rls-free-${rand()}@example.com`
  const member = (password) => ({
    name: 'Shared Freelancer',
    phone: randPhone(),
    email: shared,
    password,
    create_login: true,
    engagement_type: 'freelancer',
    // Admin, so the RLS check below has something (clients) to read.
    role: 'admin',
  })

  const inC = await api('/team/members', { token: c.token, method: 'POST', body: member('Freelance12345!') })
  check('multi: studio A adds the freelancer', inC.status === 201 && inC.json.linked_existing_login === false, inC.json)

  const twiceC = await api('/team/members', { token: c.token, method: 'POST', body: member('Other12345!') })
  check('multi: the same email twice in one studio is still refused (409)', twiceC.status === 409, twiceC.json)

  // 0223: studio B cannot take over a login that belongs to studio A's
  // person by typing its email -- the same person joins B through an invite,
  // with their own password.
  const typedD = await api('/team/members', { token: d.token, method: 'POST', body: member('Ignored12345!') })
  check(
    'multi: studio B adding an email that signs in elsewhere is refused (409), never linked',
    typedD.status === 409 && /another studio/i.test(JSON.stringify(typedD.json)),
    typedD.json,
  )

  const invD = await api('/team/invitations', {
    token: d.token,
    method: 'POST',
    body: { name: 'Shared Freelancer', email: shared, role: 'admin' },
  })
  const invDToken = /[?&]token=([^&]+)/.exec(invD.json.invite_link ?? '')?.[1] ?? ''
  const joinD = await api('/auth/accept-invite', { method: 'POST', body: { token: invDToken, password: 'Freelance12345!' } })
  const joinedD = await api('/auth/session', { token: joinD.json.access_token })
  const inD = { json: { user_id: joinedD.json.user_id } }
  check(
    'multi: through an invite, studio B gets them on their existing login',
    joinD.status === 200 && joinedD.json.user_id !== inC.json.user_id && (joinedD.json.studios ?? []).length === 2,
    joinedD.json,
  )

  // Accepting signed them in, with their own password: that is the sign-in
  // the rest of this block uses (the credential endpoints share one per-IP
  // limit across the whole file).
  const login = joinD

  const s1 = await api('/auth/session', { token: login.json.access_token })
  const studios = s1.json.studios ?? []
  check('multi: the session lists both studios', s1.status === 200 && studios.length === 2, s1.json)
  const other = studios.find((st) => st.company_id !== s1.json.company_id)

  // A client of C's, to prove D's session cannot see it.
  const cClient = await api('/clients', { token: c.token, method: 'POST', body: { name: `C Client ${rand()}` } })

  const sw = await api('/auth/switch', {
    token: login.json.access_token,
    method: 'POST',
    body: { profile_id: other?.profile_id, refresh_token: login.json.refresh_token },
  })
  check('multi: switching studio returns a fresh pair', sw.status === 200 && !!sw.json.access_token, sw.json)
  const s2 = await api('/auth/session', { token: sw.json.access_token })
  check(
    'multi: after switching, the session is the other studio',
    s2.status === 200 && s2.json.company_id === other?.company_id && s2.json.user_id === other?.profile_id,
    s2.json,
  )
  const dSession = [
    { tok: login.json.access_token, sess: s1 },
    { tok: sw.json.access_token, sess: s2 },
  ].find((x) => x.sess.json.user_id === inD.json.user_id)
  if (dSession) {
    const seen = await api('/clients', { token: dSession.tok })
    check(
      "multi: in studio B, studio A's client is invisible (RLS per studio)",
      Array.isArray(seen.json) && !seen.json.some((cl) => cl.id === cClient.json.id),
      seen.json,
    )
  } else check('multi: found the studio B session', false, { s1: s1.json.user_id, s2: s2.json.user_id })

  // The session left behind gave up its refresh token.
  const stale = await api('/auth/refresh', { method: 'POST', body: { refresh_token: login.json.refresh_token } })
  check('multi: the session switched away from cannot refresh', stale.status === 401, stale.json)

  // Switching into a studio that is not theirs is refused.
  const foreign = await api('/auth/switch', {
    token: sw.json.access_token,
    method: 'POST',
    body: { profile_id: inC.json.user_id === other?.profile_id ? inD.json.user_id : inC.json.user_id },
  })
  check('multi: switching back to the first studio works', foreign.status === 200, foreign.json)
  const notTheirs = await api('/auth/switch', {
    token: sw.json.access_token,
    method: 'POST',
    body: { profile_id: '00000000-0000-4000-8000-000000000000' },
  })
  check("multi: switching into someone else's studio is refused (403)", notTheirs.status === 403, notTheirs.json)

  // Next sign-in opens the studio they were last in.
  const again = await api('/auth/login', { method: 'POST', body: { email: shared, password: 'Freelance12345!' } })
  const s3 = await api('/auth/session', { token: again.json.access_token })
  check(
    'multi: the next sign-in opens the last studio used',
    s3.json.user_id === (inC.json.user_id === other?.profile_id ? inD.json.user_id : inC.json.user_id),
    { got: s3.json.user_id },
  )

  // D removes them: D is gone from their list, C still works, and they were
  // not signed out of C.
  const removed = await api(`/team/members/${inD.json.user_id}`, { token: d.token, method: 'DELETE' })
  check('multi: studio B removes them', removed.status === 200, removed.json)
  const back = await api('/auth/login', { method: 'POST', body: { email: shared, password: 'Freelance12345!' } })
  const s5 = await api('/auth/session', { token: back.json.access_token })
  check(
    'multi: after removal from B, signing in lands in A',
    s5.status === 200 && s5.json.user_id === inC.json.user_id && (s5.json.studios ?? []).length === 1,
    s5.json,
  )

  // An invitation to the same email joins that login too, with the existing
  // password -- not a second account. Studio B, which removed them above,
  // asks them back.
  const inv = await api('/team/invitations', {
    token: d.token,
    method: 'POST',
    body: { name: 'Shared Freelancer', email: shared, role: 'employee' },
  })
  // Read off the link as text: APP_URL is unset in CI, so it is not a URL.
  const invToken = /[?&]token=([^&]+)/.exec(inv.json.invite_link ?? '')?.[1] ?? ''
  const peek = await api(`/auth/invite?token=${encodeURIComponent(invToken ?? '')}`)
  check('multi: the invite says this email already has a login', peek.status === 200 && peek.json.has_account === true, peek.json)
  const badAccept = await api('/auth/accept-invite', { method: 'POST', body: { token: invToken, password: 'NotMine12345!' } })
  check('multi: accepting needs the existing password (401)', badAccept.status === 401, badAccept.json)
  const accepted = await api('/auth/accept-invite', {
    method: 'POST',
    body: { token: invToken, password: 'Freelance12345!' },
  })
  const s6 = await api('/auth/session', { token: accepted.json.access_token })
  check(
    'multi: accepting signs them into the inviting studio, alongside A',
    accepted.status === 200 && (s6.json.studios ?? []).length === 2 && s6.json.user_id !== inC.json.user_id,
    s6.json,
  )

  // One password for every studio: changing it signs out all of them.
  const changed = await api('/auth/change-password', {
    token: s6.status === 200 ? accepted.json.access_token : back.json.access_token,
    method: 'POST',
    body: { current_password: 'Freelance12345!', new_password: 'Changed12345!' },
  })
  const oldC = await api('/auth/session', { token: back.json.access_token })
  check(
    "multi: a password change signs out every studio's sessions",
    changed.status === 200 && oldC.status === 401,
    { change: changed.status, oldC: oldC.status },
  )
  const newLogin = await api('/auth/login', { method: 'POST', body: { email: shared, password: 'Changed12345!' } })
  check('multi: the new password works', newLogin.status === 200, newLogin.json)

  // 0223: a no-login person's email in one studio is not a door into it.
  // Studio A keeps someone in its directory with no login; studio B types the
  // same email, first with a login (refused), then without (kept apart).
  const quiet = `rls-quiet-${rand()}@example.com`
  const dirC = await api('/team/members', {
    token: c.token,
    method: 'POST',
    body: { name: 'Directory Only', phone: randPhone(), email: quiet, create_login: false },
  })
  const grabD = await api('/team/members', {
    token: d.token,
    method: 'POST',
    body: { name: 'Not Them', phone: randPhone(), email: quiet, password: 'Grab12345!', create_login: true },
  })
  check(
    "multi: a login on another studio's no-login email is refused (409)",
    dirC.status === 201 && grabD.status === 409,
    { dirC: dirC.status, grabD: grabD.status },
  )
  const grabLogin = await api('/auth/login', { method: 'POST', body: { email: quiet, password: 'Grab12345!' } })
  check('multi: and nobody can sign in to it with the typed password', grabLogin.status === 401, grabLogin.json)
  const dirD = await api('/team/members', {
    token: d.token,
    method: 'POST',
    body: { name: 'Their Own', phone: randPhone(), email: quiet, create_login: false },
  })
  check(
    'multi: a no-login add with that email is its own person, not linked',
    dirD.status === 201 && dirD.json.user_id !== dirC.json.user_id && dirD.json.linked_existing_login === false,
    dirD.json,
  )
}

// ── Assign team: bulk booking, payout set with the booking ─────────
{
  const me = await api('/auth/session', { token: aToken })
  const uid = me.json.user_id
  const day = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10)
  const at = (h) => `${day}T${String(h).padStart(2, '0')}:00:00.000Z`

  const members = await api('/team/members', { token: aToken })
  check(
    'assign: the crew picker gets job roles for each person',
    members.status === 200 && Array.isArray(members.json) && members.json.every((m) => Array.isArray(m.role_names)),
    members.json,
  )

  const batch = await api('/allocation/batch', {
    token: aToken,
    method: 'POST',
    body: {
      items: [
        { user_id: uid, start_at: at(4), end_at: at(6), service_name: 'Candid Photographer' },
        // Overlaps the first: refused on its own, without undoing the others.
        { user_id: uid, start_at: at(5), end_at: at(7), service_name: 'Cinematographer' },
        {
          user_id: uid,
          start_at: at(8),
          end_at: at(9),
          service_name: 'Drone Operator',
          estimated_cost: 7000,
          cost_status: 'final',
          cost_notes: 'Paid on the day',
        },
      ],
    },
  })
  const r = batch.json.results ?? []
  check(
    'assign: a bulk booking books what it can and names the clash',
    batch.status === 201 && !!r[0]?.id && r[1]?.error === 'double_booked' && !!r[2]?.id,
    batch.json,
  )

  const list = await api('/allocation', { token: aToken })
  const drone = (Array.isArray(list.json) ? list.json : []).find((x) => x.id === r[2]?.id)
  check(
    'assign: payout status, amount and note are saved with the booking',
    drone?.cost_status === 'final' && Number(drone?.estimated_cost) === 7000 && drone?.cost_notes === 'Paid on the day',
    drone,
  )

  // Remove: the seat opens again and the same hours can be booked.
  const released = await api(`/allocation/${r[0]?.id}/status`, { token: aToken, method: 'POST', body: { status: 'released' } })
  const rebook = await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: uid, start_at: at(5), end_at: at(7), service_name: 'Cinematographer' },
  })
  check('assign: removing someone frees their hours for another booking', released.status === 204 && rebook.status === 201, {
    released: released.status,
    rebook: rebook.json,
  })
}

// ── Data from a booking: who copied it, where the copies are (0160) ──────
{
  const me = await api('/auth/session', { token: aToken })
  const uid = me.json.user_id
  const day = new Date(Date.now() + 50 * 86_400_000).toISOString().slice(0, 10)
  const booked = await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: uid, start_at: `${day}T04:00:00.000Z`, end_at: `${day}T08:00:00.000Z`, service_name: 'Drone Operator' },
  })
  const slotId = booked.json.id

  const created = await api('/data', {
    token: aToken,
    method: 'POST',
    body: {
      slot_id: slotId,
      data_label: 'Drone cards',
      copied_by_name: 'Aman (intern)',
      folder_path: '/2026/Drone',
      primary_status: 'copied',
      backup_status: 'not_required',
      size_gb: 128,
    },
  })
  check(
    'data: a record for a booking takes its person and role, and its stage is worked out',
    created.status === 201 &&
      created.json.slot_id === slotId &&
      created.json.user_id === uid &&
      created.json.requirement_name === 'Drone Operator' &&
      created.json.copied_by_name === 'Aman (intern)' &&
      created.json.copied_by_uid === null &&
      created.json.data_status === 'backed_up',
    created.json,
  )

  const bySlot = await api(`/data?slot_id=${slotId}`, { token: aToken })
  check(
    'data: a booking finds its record',
    Array.isArray(bySlot.json) && bySlot.json.length === 1 && bySlot.json[0].id === created.json.id,
    bySlot.json,
  )

  const tracked = await api(`/data/${created.json.id}/track`, {
    token: aToken,
    method: 'POST',
    body: { track: 'primary', status: 'verified' },
  })
  check(
    'data: verifying the main copy completes custody and stamps when',
    tracked.status === 200 && tracked.json.data_status === 'verified' && !!tracked.json.verified_at,
    tracked.json,
  )

  // The stage is derived: a caller sending one neither fails nor changes it.
  const forced = await api(`/data/${created.json.id}`, { token: aToken, method: 'PATCH', body: { data_status: 'received' } })
  check('data: a stage sent by a caller is ignored, not refused', forced.status === 200 && forced.json.data_status === 'verified', forced.json)

  const badTrack = await api(`/data/${created.json.id}/track`, {
    token: aToken,
    method: 'POST',
    body: { track: 'primary', status: 'not_required' },
  })
  check('data: the main copy cannot be marked not needed', badTrack.status === 422, badTrack.json)

  const other = await api(`/data?slot_id=${slotId}`, { token: newPw.json.access_token })
  check("data: another studio cannot see this studio's data", Array.isArray(other.json) && other.json.length === 0, other.json)

  // Opting a booking out needs a reason.
  const noReason = await api(`/allocation/${slotId}/data`, { token: aToken, method: 'POST', body: { data_required: false } })
  const withReason = await api(`/allocation/${slotId}/data`, {
    token: aToken,
    method: 'POST',
    body: { data_required: false, data_not_required_reason: 'Assistant, no camera' },
  })
  const slots = await api('/allocation', { token: aToken })
  const s = (Array.isArray(slots.json) ? slots.json : []).find((x) => x.id === slotId)
  check(
    'data: a booking can say no data is needed -- with a reason',
    noReason.status === 422 && withReason.status === 204 && s?.data_not_required_reason === 'Assistant, no camera',
    { noReason: noReason.status, withReason: withReason.status, slot: s },
  )
}

// ── Deliverables: editor, stage, link, studio boundary (0161) ────────────
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Deliverable Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', {
    token: aToken,
    method: 'POST',
    body: { name: 'Deliverables project', client_id: client.json.id, package_cost: 50000 },
  })
  const pid = project.json.id
  const shoot = await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Wedding day' } })

  // An editor with their own login, who cannot edit projects.
  const edEmail = `editor-${rand()}@example.com`
  const inv = await api('/team/invitations', { token: aToken, method: 'POST', body: { name: 'Priya Editor', email: edEmail, role: 'employee' } })
  const invToken = /[?&]token=([^&]+)/.exec(inv.json.invite_link ?? '')?.[1] ?? ''
  const joined = await api('/auth/accept-invite', { method: 'POST', body: { token: invToken, password: 'Editor12345!' } })
  const edToken = joined.json.access_token
  const edUid = (await api('/auth/session', { token: edToken })).json.user_id
  check('deliverables: an editor joins with their own login', joined.status === 200 && !!edUid, joined.json)

  // Growing a studio list from a form: a list tied to a module the person can
  // create in is open to them; any other list stays with the owner.
  const edLead = await api('/settings/lookups', { token: edToken, method: 'POST', body: { category: 'lead_source', value: `Fair ${rand()}` } })
  const ownerCat = await api('/settings/lookups', { token: aToken, method: 'POST', body: { category: 'expense_category', value: `Drone hire ${rand()}` } })
  check(
    'lookups: an employee cannot add to an owner-only list; the owner adds an expense category',
    edLead.status === 403 && ownerCat.status === 201,
    { edLead: edLead.status, ownerCat: ownerCat.status },
  )

  const added = await api(`/projects/${pid}/deliverables`, {
    token: aToken,
    method: 'POST',
    body: { title: 'Highlight film', shoot_id: shoot.json.id, assignee_id: edUid, visibility_scope: 'client' },
  })
  const detail = await api(`/projects/${pid}`, { token: aToken })
  const film = (detail.json.deliverables ?? []).find((d) => d.id === added.json.id)
  check(
    'deliverables: one is tied to its shoot and its editor, and giving it to an editor starts it',
    added.status === 201 && film?.shoot_name === 'Wedding day' && film?.assignee_name === 'Priya Editor' && film?.status === 'in_progress',
    film ?? added.json,
  )

  const mine = await api('/projects/deliverables/mine', { token: edToken })
  check(
    'deliverables: the editor sees it on their own list',
    mine.status === 200 && mine.json.some((d) => d.id === added.json.id && d.project_name === 'Deliverables project'),
    mine.json,
  )

  const sent = await api(`/projects/deliverables/${added.json.id}/stage`, {
    token: edToken,
    method: 'POST',
    body: { status: 'review', delivery_link: 'https://drive.example.com/film' },
  })
  const after = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === added.json.id)
  check(
    'deliverables: the editor can say it is with the client, with the link',
    sent.status === 204 && after?.status === 'review' && after?.delivery_link === 'https://drive.example.com/film',
    { sent: sent.json, after },
  )
  const delivered = await api(`/projects/deliverables/${added.json.id}/stage`, { token: aToken, method: 'POST', body: { status: 'completed' } })
  const done = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === added.json.id)
  check('deliverables: delivering stamps when', delivered.status === 204 && !!done?.delivered_at, done)

  // Work the editor is not on is not theirs to move.
  const other = await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Album' } })
  const notTheirs = await api(`/projects/deliverables/${other.json.id}/stage`, { token: edToken, method: 'POST', body: { status: 'in_progress' } })
  check('deliverables: someone else cannot move work they are not on (403)', notTheirs.status === 403, notTheirs.json)

  // Voice notes: the editor records one, the owner hears it; the timeline
  // carries the stage changes the database wrote on its own.
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], { type: 'audio/webm;codecs=opus' }), 'voice-note.weba')
  const up = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${edToken}` }, body: form })
  const upJson = await up.json().catch(() => ({}))
  check('notes: a browser voice recording uploads', up.status === 200 && upJson.mime === 'audio/webm', upJson)
  const voice = await api(`/projects/deliverables/${added.json.id}/notes`, {
    token: edToken, method: 'POST', body: { kind: 'voice', file_id: upJson.id, duration_seconds: 7 },
  })
  const text = await api(`/projects/deliverables/${added.json.id}/notes`, { token: aToken, method: 'POST', body: { kind: 'text', body: 'Lovely, send it.' } })
  const timeline = await api(`/projects/deliverables/${added.json.id}/notes`, { token: aToken })
  const kinds = (timeline.json ?? []).map((n) => `${n.kind}:${n.kind === 'event' ? n.body : n.author_name}`)
  check(
    'notes: the timeline has the stage changes, the voice note and the reply, in order',
    voice.status === 201 && text.status === 201 && timeline.status === 200 &&
      JSON.stringify(kinds) === JSON.stringify(['event:moved:review', 'event:moved:completed', 'voice:Priya Editor', 'text:' + (timeline.json?.[3]?.author_name ?? '?')]),
    { voice: voice.status, text: text.status, kinds },
  )
  const counted = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === added.json.id)
  check('notes: the card knows there is a voice note', counted?.voice_count === 1 && counted?.notes_count === 2 && counted?.last_activity_kind === 'text', counted)
  const noteNotTheirs = await api(`/projects/deliverables/${other.json.id}/notes`, { token: edToken, method: 'POST', body: { kind: 'text', body: 'hi' } })
  check('notes: someone not on the work cannot write on it (403)', noteNotTheirs.status === 403, noteNotTheirs.json)
  const emptyNote = await api(`/projects/deliverables/${added.json.id}/notes`, { token: aToken, method: 'POST', body: { kind: 'text', body: '  ' } })
  check('notes: an empty note is refused (422)', emptyNote.status === 422, emptyNote.json)

  // ── A studio's own stages, and submitted work moving the deliverable (0166)
  const stages = await api('/projects/stages', { token: edToken })
  check(
    'stages: every studio starts with its named stages, readable by the team',
    stages.status === 200 && ['with_manager', 'approved', 'with_client', 'client_approved', 'changes_requested'].every((c) => stages.json.some((s) => s.code === c)),
    stages.json,
  )
  const grading = await api('/projects/stages', { token: aToken, method: 'POST', body: { label: 'Colour grading', stage: 'in_progress', color: 'violet' } })
  const edAdds = await api('/projects/stages', { token: edToken, method: 'POST', body: { label: 'Mine', stage: 'in_progress' } })
  check('stages: a manager adds one; an editor cannot (403)', grading.status === 201 && grading.json.code === 'colour_grading' && edAdds.status === 403, { grading: grading.json, edAdds: edAdds.status })

  const reel = await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Teaser reel', assignee_id: edUid } })
  const toGrading = await api(`/projects/deliverables/${reel.json.id}/stage`, { token: edToken, method: 'POST', body: { status: 'in_progress', custom_status_code: 'colour_grading' } })
  const approveSelf = await api(`/projects/deliverables/${reel.json.id}/stage`, { token: edToken, method: 'POST', body: { status: 'review', custom_status_code: 'approved' } })
  const wrongStep = await api(`/projects/deliverables/${reel.json.id}/stage`, { token: aToken, method: 'POST', body: { status: 'pending', custom_status_code: 'with_client' } })
  check(
    'stages: the editor moves to a team stage, not to Approved (403); a stage from another step is refused (422)',
    toGrading.status === 204 && approveSelf.status === 403 && wrongStep.status === 422,
    { toGrading: toGrading.status, approveSelf: approveSelf.status, wrongStep: wrongStep.status },
  )

  const submitted = await api('/work/submissions', {
    token: edToken,
    method: 'POST',
    body: { project_id: pid, deliverable_id: reel.json.id, submission_link: 'https://drive.example.com/reel-v1' },
  })
  const inReview = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === reel.json.id)
  const reelTimeline = (await api(`/projects/deliverables/${reel.json.id}/notes`, { token: aToken })).json ?? []
  const submittedEvent = reelTimeline.find((n) => n.body === `submitted:${submitted.json.id}`)
  check(
    'submissions: work handed in for a deliverable moves it to Review · With manager, link and all',
    submitted.status === 201 && inReview?.status === 'review' && inReview?.custom_status_code === 'with_manager' &&
      inReview?.delivery_link === 'https://drive.example.com/reel-v1' && submittedEvent?.link === 'https://drive.example.com/reel-v1',
    { submitted: submitted.json, inReview, reelTimeline },
  )

  // "Mine" is mine for a manager too: My Work never shows someone else's work as yours.
  const ownerMine = await api(`/work/submissions?mine=1&project_id=${pid}`, { token: aToken })
  const ownerAll = await api(`/work/submissions?project_id=${pid}`, { token: aToken })
  const edSubs = await api('/work/submissions', { token: edToken })
  const edTask = await api('/tasks', { token: aToken, method: 'POST', body: { project_id: pid, title: 'Colour grade the reel', status: 'to_do', priority: 'medium', assignees: [edUid] } })
  const ownerTasks = await api(`/tasks/my?project_id=${pid}`, { token: aToken })
  const edTasks = await api(`/tasks/my?project_id=${pid}`, { token: edToken })
  check(
    "my work: a manager's own lists hold only their own tasks and submissions; reviewing still shows everyone's",
    ownerMine.status === 200 && !(ownerMine.json ?? []).some((x) => x.id === submitted.json.id) &&
      (ownerAll.json ?? []).some((x) => x.id === submitted.json.id) &&
      (edSubs.json ?? []).length > 0 && (edSubs.json ?? []).every((x) => x.submitted_by_name === (edSubs.json ?? [])[0].submitted_by_name) &&
      edTask.status < 300 && !(ownerTasks.json ?? []).some((t) => t.id === edTask.json.id) &&
      (edTasks.json ?? []).some((t) => t.id === edTask.json.id) && (edTasks.json ?? []).every((t) => t.project_id === pid),
    { ownerMine: (ownerMine.json ?? []).length, ownerAll: (ownerAll.json ?? []).length, edTask: edTask.status, ownerTasks: (ownerTasks.json ?? []).map((t) => t.title), edTasks: (edTasks.json ?? []).map((t) => t.title) },
  )
  const sentBack = await api(`/work/submissions/${submitted.json.id}/review`, {
    token: aToken, method: 'POST', body: { approve: false, review_notes: 'Shorter intro, please' },
  })
  const backAgain = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === reel.json.id)
  const afterReview = (await api(`/projects/deliverables/${reel.json.id}/notes`, { token: edToken })).json ?? []
  check(
    'submissions: sending it back moves it to Changes requested, and the editor reads why in its timeline',
    (sentBack.status === 200 || sentBack.status === 204) && backAgain?.status === 'in_progress' && backAgain?.custom_status_code === 'changes_requested' &&
      afterReview.some((n) => n.kind === 'text' && n.body === 'Shorter intro, please'),
    { sentBack: sentBack.status, backAgain, afterReview },
  )
  const wrongProject = await api('/work/submissions', {
    token: edToken, method: 'POST', body: { project_id: '00000000-0000-4000-8000-000000000001', deliverable_id: reel.json.id, submission_link: 'https://x.example.com' },
  })
  check('submissions: a deliverable from another project is refused (422)', wrongProject.status === 422, wrongProject.json)

  // ── Suggest a feature
  const idea = await api('/feedback/features', { token: edToken, method: 'POST', body: { body: 'WhatsApp the album link', page_url: '/my-work' } })
  const blank = await api('/feedback/features', { token: edToken, method: 'POST', body: { body: '  ' } })
  const inboxAsStudio = await api('/platform/feedback', { token: aToken })
  check(
    'feedback: anyone can suggest a feature; an empty one is refused; a studio cannot read the inbox',
    idea.status === 201 && blank.status === 422 && inboxAsStudio.status === 403,
    { idea: idea.json, blank: blank.status, inbox: inboxAsStudio.status },
  )

  const internal = await api(`/projects/${pid}/deliverables`, {
    token: aToken,
    method: 'POST',
    body: { title: 'Data sorting', visibility_scope: 'internal', show_on_quotation: true },
  })
  const internalRow = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === internal.json.id)
  check('deliverables: team work never goes on the quotation', internalRow?.show_on_quotation === false, internalRow)

  const foreignShoot = await api(`/projects/${pid}/deliverables`, {
    token: aToken,
    method: 'POST',
    body: { title: 'Teaser', shoot_id: '00000000-0000-4000-8000-000000000000' },
  })
  check('deliverables: a shoot from elsewhere is refused (422)', foreignShoot.status === 422, foreignShoot.json)

  const otherStudioNotes = await api(`/projects/deliverables/${added.json.id}/notes`, { token: newPw.json.access_token })
  check('notes: another studio cannot read them (404)', otherStudioNotes.status === 404, otherStudioNotes.json)
  const cross = await api(`/projects/${pid}/deliverables`, {
    token: newPw.json.access_token,
    method: 'POST',
    body: { title: 'Sneaky', is_additional_charge: true, additional_charge_amount: 99999 },
  })
  const total = (await api(`/projects/${pid}`, { token: aToken })).json.total_cost
  check(
    "deliverables: another studio cannot add to this project or change its total",
    cross.status === 404 && Number(total) === 50000,
    { cross: cross.status, total },
  )

  // A javascript: link never gets in; a dropped extra stops being charged.
  const badLink = await api(`/projects/deliverables/${added.json.id}/stage`, {
    token: aToken,
    method: 'POST',
    body: { status: 'review', delivery_link: 'javascript:alert(1)' },
  })
  check('deliverables: only web links are accepted (422)', badLink.status === 422, badLink.json)
  const extra = await api(`/projects/${pid}/deliverables`, {
    token: aToken,
    method: 'POST',
    body: { title: 'Drone film', is_additional_charge: true, additional_charge_amount: 8000 },
  })
  const withExtra = Number((await api(`/projects/${pid}`, { token: aToken })).json.total_cost)
  await api(`/projects/deliverables/${extra.json.id}/stage`, { token: aToken, method: 'POST', body: { status: 'cancelled' } })
  const afterDrop = Number((await api(`/projects/${pid}`, { token: aToken })).json.total_cost)
  check('deliverables: a dropped extra is no longer charged', withExtra === 58000 && afterDrop === 50000, { withExtra, afterDrop })

  // ── The production board: every deliverable in flight, by stage and by person
  const nowMs = Date.now()
  await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: edUid, start_at: new Date(nowMs - 30 * 60_000).toISOString(), end_at: new Date(nowMs + 30 * 60_000).toISOString(), service_name: 'Candid' },
  })
  const board = await api('/projects/board', { token: aToken })
  const boardIds = new Set((board.json.items ?? []).map((d) => d.id))
  const edRow = (board.json.people ?? []).find((p) => p.user_id === edUid)
  check(
    "board: the studio's deliverables, its stages and its people, with who is on a shoot today",
    board.status === 200 && boardIds.has(reel.json.id) && boardIds.has(other.json.id) && !boardIds.has(extra.json.id) &&
      (board.json.stages ?? []).some((s) => s.code === 'with_manager') && edRow?.on_shoot_today === true &&
      board.json.counts.open >= 2 && board.json.counts.truncated === false,
    { status: board.status, counts: board.json.counts, edRow },
  )
  const bBoard = await api('/projects/board', { token: newPw.json.access_token })
  check(
    "board: another studio sees none of this studio's work",
    bBoard.status === 200 && !(bBoard.json.items ?? []).some((d) => boardIds.has(d.id)),
    bBoard.status,
  )
  const gone = await api('/projects/board/deliverables', { token: aToken })
  check('board: the old deliverables strip endpoint is gone', gone.status === 404 || gone.status === 400, gone.status)

  const trio = await Promise.all(
    ['Pre-wedding reel', 'Highlights', 'Photo selection'].map((title) =>
      api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title } }).then((r) => r.json.id),
    ),
  )
  const bulkAssign = await api('/projects/deliverables/bulk', { token: aToken, method: 'POST', body: { ids: trio, assignee_id: edUid } })
  const afterBulk = (await api('/projects/board', { token: aToken })).json.items.filter((d) => trio.includes(d.id))
  check(
    'board: three deliverables handed to one editor at once, and giving them out starts them',
    bulkAssign.status === 200 && bulkAssign.json.updated === 3 &&
      afterBulk.length === 3 && afterBulk.every((d) => d.assignee_id === edUid && d.status === 'in_progress'),
    { bulk: bulkAssign.json, afterBulk },
  )
  const bulkStage = await api('/projects/deliverables/bulk', {
    token: aToken, method: 'POST', body: { ids: trio.slice(0, 2), stage: { status: 'review', custom_status_code: 'with_manager' } },
  })
  const bulkWrongStep = await api('/projects/deliverables/bulk', {
    token: aToken, method: 'POST', body: { ids: trio, stage: { status: 'pending', custom_status_code: 'with_client' } },
  })
  const bulkDue = await api('/projects/deliverables/bulk', { token: aToken, method: 'POST', body: { ids: trio, estimated_date: '2020-01-01' } })
  const lateNow = (await api('/projects/board', { token: aToken })).json
  check(
    'board: a bulk move to a stage works, a stage from the wrong step is refused, and a past due date counts as late',
    bulkStage.status === 200 && bulkWrongStep.status === 422 && bulkDue.status === 200 &&
      lateNow.items.filter((d) => trio.includes(d.id) && d.custom_status_code === 'with_manager').length === 2 &&
      lateNow.counts.late >= 3 && lateNow.counts.in_review >= 2,
    { stage: bulkStage.status, wrong: bulkWrongStep.status, due: bulkDue.status, counts: lateNow.counts },
  )
  const bulkEmpty = await api('/projects/deliverables/bulk', { token: aToken, method: 'POST', body: { ids: [], assignee_id: null } })
  const bulkTwo = await api('/projects/deliverables/bulk', { token: aToken, method: 'POST', body: { ids: trio, assignee_id: null, estimated_date: null } })
  const bulkByEditor = await api('/projects/deliverables/bulk', { token: edToken, method: 'POST', body: { ids: trio, assignee_id: null } })
  const bulkOtherStudio = await api('/projects/deliverables/bulk', { token: newPw.json.access_token, method: 'POST', body: { ids: trio, assignee_id: null } })
  const stillHis = (await api('/projects/board', { token: aToken })).json.items.filter((d) => trio.includes(d.id))
  check(
    'board: bulk refuses an empty list, two changes at once, an editor (403), and another studio changes nothing',
    bulkEmpty.status === 422 && bulkTwo.status === 422 && bulkByEditor.status === 403 &&
      (bulkOtherStudio.status === 403 || bulkOtherStudio.json?.updated === 0) &&
      stillHis.every((d) => d.assignee_id === edUid),
    { empty: bulkEmpty.status, two: bulkTwo.status, editor: bulkByEditor.status, other: bulkOtherStudio.status, otherJson: bulkOtherStudio.json },
  )

  // ── Team Booking v2: bookings say what they are for, crew hear about it,
  // and payout stays with whoever plans crew (0172)
  const bookDay = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10)
  const nextDay = new Date(Date.now() + 71 * 86_400_000).toISOString().slice(0, 10)
  const booked = await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: {
      user_id: edUid, shoot_id: shoot.json.id, service_name: 'Candid Photographer',
      start_at: `${bookDay}T04:00:00.000Z`, end_at: `${bookDay}T10:00:00.000Z`, estimated_cost: 5000,
    },
  })
  const inDay = await api(`/allocation?from=${bookDay}&to=${bookDay}`, { token: aToken })
  const theSlot = (inDay.json ?? []).find((x) => x.id === booked.json.id)
  const outOfDay = await api(`/allocation?from=${nextDay}&to=${nextDay}`, { token: aToken })
  check(
    'booking: a day window returns the booking with its shoot, project and client, and a later day does not',
    booked.status === 201 && theSlot?.shoot_name === 'Wedding day' && theSlot?.project_name === 'Deliverables project' &&
      !!theSlot?.client_name && Number(theSlot?.estimated_cost) === 5000 &&
      !(outOfDay.json ?? []).some((x) => x.id === booked.json.id),
    { theSlot, out: (outOfDay.json ?? []).length },
  )
  const edList = await api('/allocation', { token: edToken })
  const edRows = Array.isArray(edList.json) ? edList.json : []
  check(
    'booking: a team member sees only their own bookings, with no payout',
    edList.status === 200 && edRows.length > 0 && edRows.every((x) => x.user_id === edUid) &&
      edRows.every((x) => x.estimated_cost === null && x.final_cost === null && x.cost_notes === null),
    edRows.slice(0, 2),
  )
  const edNotes = await api('/notifications?type=shoot_assigned', { token: edToken })
  const ownerNotes = await api('/notifications?type=shoot_assigned', { token: aToken })
  check(
    'booking: the person booked is told, the person booking is not',
    (edNotes.json ?? []).some((n) => n.entity_id === shoot.json.id && /Wedding day/.test(n.title)) &&
      !(ownerNotes.json ?? []).some((n) => n.entity_id === shoot.json.id),
    { ed: (edNotes.json ?? []).length, owner: (ownerNotes.json ?? []).length },
  )
  const mineShoots = await api('/shoots/my', { token: edToken })
  const wd = (mineShoots.json ?? []).find((x) => x.id === shoot.json.id)
  check(
    "booking: My Shoots lists who is on the shoot, by name and role",
    (wd?.crew ?? []).some((m) => m.user_id === edUid && m.service_name === 'Candid Photographer') &&
      (wd?.crew ?? []).every((m) => !('estimated_cost' in m)),
    wd?.crew,
  )
  const noSlot = await api('/allocation/00000000-0000-4000-8000-000000000999/status', { token: aToken, method: 'POST', body: { status: 'released' } })
  check('booking: releasing a booking that does not exist is 404', noSlot.status === 404, noSlot.status)
  const sangeet = await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Sangeet' } })
  const goneSlot = await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: edUid, shoot_id: sangeet.json.id, service_name: 'Cinematographer', start_at: `${nextDay}T12:00:00.000Z`, end_at: `${nextDay}T15:00:00.000Z` },
  })
  const del = await api(`/shoots/${sangeet.json.id}`, { token: aToken, method: 'DELETE' })
  const afterDel = ((await api(`/allocation?user_id=${edUid}`, { token: aToken })).json ?? []).find((x) => x.id === goneSlot.json.id)
  check(
    "booking: deleting a shoot releases its bookings and says when",
    del.status === 204 && afterDel?.status === 'released' && !!afterDel?.released_at && afterDel?.shoot_id === null,
    afterDel,
  )
  // A map link is whatever was pasted -- a venue name shared from WhatsApp
  // as often as a real link. It used to have to be a URL, and the 422 made
  // the project wizard drop the shoot.
  const pastedLink = 'Taj Palace, Jaipur (shared from WhatsApp)'
  const mehendi = await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Mehendi', map_link: pastedLink } })
  const mehendiRow = ((await api(`/shoots?project_id=${pid}`, { token: aToken })).json ?? []).find((x) => x.id === mehendi.json?.id)
  check('shoots: a map link that is not a URL is stored as typed', mehendi.status === 201 && mehendiRow?.map_link === pastedLink, {
    status: mehendi.status,
    row: mehendiRow,
  })
  const blankLink = await api(`/shoots/${mehendi.json.id}`, { token: aToken, method: 'PATCH', body: { map_link: '   ' } })
  const blankRow = ((await api(`/shoots?project_id=${pid}`, { token: aToken })).json ?? []).find((x) => x.id === mehendi.json?.id)
  const mehendiGone = await api(`/shoots/${mehendi.json.id}`, { token: aToken, method: 'DELETE' })
  check('shoots: a blank map link clears it', blankLink.status === 204 && blankRow?.map_link === null && mehendiGone.status === 204, {
    patch: blankLink.status,
    row: blankRow,
    del: mehendiGone.status,
  })

  // ── Data v2 (0173): the board, crew handover, bulk, locations ──
  const pastDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
  const ownerUid = (await api('/auth/session', { token: aToken })).json.user_id
  const reception = await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Reception', shoot_date: pastDay } })
  const bookPast = (user, role, h) =>
    api('/allocation', {
      token: aToken,
      method: 'POST',
      body: { user_id: user, shoot_id: reception.json.id, service_name: role, start_at: `${pastDay}T${h}:00:00.000Z`, end_at: `${pastDay}T${h + 2}:00:00.000Z` },
    })
  const edPast = await bookPast(edUid, 'Candid Photographer', 10)
  const ownerPast = await bookPast(ownerUid, 'Drone Operator', 13)
  const dBoard = await api('/data/board', { token: aToken })
  const dRow = (dBoard.json?.rows ?? []).find((r) => r.slot_id === edPast.json.id)
  check(
    'data v2: the board shows a past booking with no cards as missing, with its age and phone column',
    dBoard.status === 200 && dRow?.stage === 'missing' && dRow?.record === null && dRow?.age_days >= 1 && dRow?.shoot_name === 'Reception',
    dRow ?? dBoard.json,
  )
  const edBoard = await api('/data/board', { token: edToken })
  const edBulk = await api('/data/bulk', { token: edToken, method: 'POST', body: { slot_ids: [edPast.json.id], action: 'received' } })
  check('data v2: a team member cannot open the board or make bulk changes', edBoard.status === 403 && edBulk.status === 403, {
    board: edBoard.status,
    bulk: edBulk.status,
  })
  const notMine = await api(`/data/mine/${ownerPast.json.id}`, { token: edToken, method: 'POST', body: { card_count: 1 } })
  const handed = await api(`/data/mine/${edPast.json.id}`, {
    token: edToken,
    method: 'POST',
    body: { card_count: 2, size_gb: 256, handed_to_uid: ownerUid, notes: 'Both cards in the office drawer' },
  })
  check(
    "data v2: crew hand over their own cards, not someone else's",
    notMine.status === 404 && handed.status === 200 && handed.json.data_status === 'received' && handed.json.card_count === 2 &&
      handed.json.slot_id === edPast.json.id && handed.json.user_id === edUid,
    { notMine: notMine.status, handed: handed.json },
  )
  const edData = await api('/data', { token: edToken })
  const edMine = await api('/data/mine', { token: edToken })
  check(
    'data v2: a team member reads only their own records',
    edData.status === 200 && (edData.json ?? []).length > 0 && (edData.json ?? []).every((r) => r.user_id === edUid) &&
      (edMine.json ?? []).some((r) => r.id === handed.json.id),
    { data: (edData.json ?? []).map((r) => r.user_id), mine: (edMine.json ?? []).length },
  )
  const diskName = `Disk ${rand()}`
  const disk = await api('/data/locations', { token: aToken, method: 'POST', body: { name: diskName } })
  const again = await api('/data/locations', { token: aToken, method: 'POST', body: { name: diskName.toLowerCase() } })
  check('data v2: adding a location name that exists hands back that one', disk.status === 201 && again.status === 200 && again.json.id === disk.json.id, {
    disk: disk.json,
    again: again.json,
  })
  const noWhere = await api('/data/bulk', { token: aToken, method: 'POST', body: { slot_ids: [ownerPast.json.id], action: 'copied' } })
  const copied = await api('/data/bulk', {
    token: aToken,
    method: 'POST',
    body: { slot_ids: [edPast.json.id, ownerPast.json.id], action: 'copied', location_id: disk.json.id, folder: '/2026/Reception' },
  })
  check(
    'data v2: bulk copy needs a location, creates the missing record and moves both',
    noWhere.status === 422 && copied.status === 200 && copied.json.updated === 2 && copied.json.created === 1,
    { noWhere: noWhere.json, copied: copied.json },
  )
  const locs = await api('/data/locations', { token: aToken })
  const used = (locs.json ?? []).find((l) => l.id === disk.json.id)
  const removed = await api(`/data/locations/${disk.json.id}`, { token: aToken, method: 'DELETE' })
  check(
    'data v2: a location shows what is on it, and one in use is archived, not deleted',
    used?.record_count === 2 && used?.used_gb === 256 && removed.status === 200 && removed.json.archived === true,
    { used, removed: removed.json },
  )

  // ── Profile completion (0175) ──
  const pBlank = await api('/settings/profile', { token: edToken })
  const pBadPan = await api('/settings/profile', { token: edToken, method: 'PATCH', body: { pan: 'NOPE' } })
  const pFilled = await api('/settings/profile', {
    token: edToken,
    method: 'PATCH',
    body: { address: 'Jaipur', date_of_birth: '1995-04-02', emergency_name: 'Asha', emergency_phone: '9876500000', upi_id: 'priya@okhdfc', pan: 'abcde1234f' },
  })
  check(
    'profile: says what is missing, refuses a bad PAN, and saves private details',
    pBlank.status === 200 && pBlank.json.completeness.missing.includes('payout') && pBadPan.status === 422 &&
      pFilled.status === 200 && pFilled.json.pan === 'ABCDE1234F' && !pFilled.json.completeness.missing.includes('payout') &&
      pFilled.json.completeness.percent > pBlank.json.completeness.percent,
    { pBlank: pBlank.json.completeness, pBadPan: pBadPan.status, pFilled: pFilled.json.completeness },
  )
  const pGaps = await api('/team/profile-gaps', { token: aToken })
  const pEdGap = (Array.isArray(pGaps.json) ? pGaps.json : []).find((g) => g.user_id === edUid)
  const pEdGaps = await api('/team/profile-gaps', { token: edToken })
  check(
    "profile: the owner sees each member's gaps by name only; a member cannot",
    pGaps.status === 200 && !!pEdGap && pEdGap.percent === pFilled.json.completeness.percent && !('pan' in pEdGap) && pEdGaps.status === 403,
    { gaps: pGaps.status, body: Array.isArray(pGaps.json) ? pGaps.json.length : pGaps.json, pEdGap, edGaps: pEdGaps.status },
  )

  // ── Start reminders (0174) ──
  const reel2 = await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Teaser reel', estimated_date: '2030-01-20', assignee_id: edUid } })
  const mineBefore = ((await api('/projects/deliverables/mine', { token: edToken })).json ?? []).find((d) => d.id === reel2.json.id)
  const notMineStart = await api(`/projects/deliverables/${reel2.json.id}/start`, { token: newPw.json.access_token, method: 'POST' })
  const started = await api(`/projects/deliverables/${reel2.json.id}/start`, { token: edToken, method: 'POST' })
  const mineAfter = ((await api('/projects/deliverables/mine', { token: edToken })).json ?? []).find((d) => d.id === reel2.json.id)
  check(
    'start: the editor sees when to start (due − work − a day for review) and marks it started; nobody else can',
    reel2.status < 300 && mineBefore?.start_by === '2030-01-12' && mineBefore?.work_days === 7 && !mineBefore?.started_at &&
      notMineStart.status === 404 && started.status === 204 && !!mineAfter?.started_at,
    { reel2: reel2.status, mineBefore, notMineStart: notMineStart.status, started: started.status },
  )

  // ── Leave, holidays, weekly off, day fixes (0177) ──
  const lvDay = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10)
  const lvBad = await api('/hr/leave', { token: edToken, method: 'POST', body: { kind: 'casual', start_date: lvDay, end_date: '2020-01-01' } })
  const lvAsk = await api('/hr/leave', { token: edToken, method: 'POST', body: { kind: 'sick', start_date: lvDay, end_date: lvDay, reason: 'Doctor' } })
  const lvTwice = await api('/hr/leave', { token: edToken, method: 'POST', body: { kind: 'casual', start_date: lvDay, end_date: lvDay } })
  const lvSelf = await api(`/hr/leave/${lvAsk.json.id}/decide`, { token: edToken, method: 'POST', body: { approve: true } })
  const lvOther = await api(`/hr/leave/${lvAsk.json.id}/decide`, { token: newPw.json.access_token, method: 'POST', body: { approve: true } })
  const lvTeam = await api('/hr/leave?scope=team&status=pending', { token: aToken })
  const lvEdTeam = await api('/hr/leave?scope=team', { token: edToken })
  const lvNoNote = await api(`/hr/leave/${lvAsk.json.id}/decide`, { token: aToken, method: 'POST', body: { approve: false } })
  const lvOk = await api(`/hr/leave/${lvAsk.json.id}/decide`, { token: aToken, method: 'POST', body: { approve: true } })
  const lvMine = await api('/hr/leave', { token: edToken })
  const lvRow = (lvMine.json ?? []).find((l) => l.id === lvAsk.json.id)
  check(
    'leave: a member asks, cannot approve their own or be approved by another studio; the owner approves',
    lvBad.status === 422 && lvAsk.status === 201 && lvTwice.status === 422 && lvSelf.status === 403 && lvOther.status === 404 &&
      lvTeam.status === 200 && (lvTeam.json ?? []).some((l) => l.id === lvAsk.json.id && l.user_name === 'Priya Editor') &&
      (lvEdTeam.json ?? []).every((l) => l.user_id === edUid) && lvNoNote.status === 422 && lvOk.status === 204 &&
      lvRow?.status === 'approved' && !!lvRow?.decided_by_name,
    { bad: lvBad.status, ask: lvAsk.status, twice: lvTwice.status, self: lvSelf.status, other: lvOther.status, noNote: lvNoNote.status, ok: lvOk.status, row: lvRow },
  )
  const lvRoster = await api(`/hr/attendance?date=${lvDay}`, { token: aToken })
  const lvEdRow = (lvRoster.json ?? []).find((r) => r.user_id === edUid)
  check('leave: the roster marks the member on leave that day', lvEdRow?.on_leave === true, { row: lvEdRow })

  const hDay = new Date(Date.now() + 50 * 864e5).toISOString().slice(0, 10)
  const hEd = await api('/hr/holidays', { token: edToken, method: 'POST', body: { holiday_date: hDay, name: 'Not mine to add' } })
  const hAdd = await api('/hr/holidays', { token: aToken, method: 'POST', body: { holiday_date: hDay, name: 'Studio day' } })
  const hDup = await api('/hr/holidays', { token: aToken, method: 'POST', body: { holiday_date: hDay, name: 'Studio day off' } })
  const hList = await api(`/hr/holidays?year=${hDay.slice(0, 4)}`, { token: edToken })
  const hOther = await api(`/hr/holidays?year=${hDay.slice(0, 4)}`, { token: newPw.json.access_token })
  const hRoster = await api(`/hr/attendance?date=${hDay}`, { token: aToken })
  const pol = await api('/hr/policy', { token: aToken, method: 'PATCH', body: { weekly_off: [0] } })
  const polEd = await api('/hr/policy', { token: edToken, method: 'PATCH', body: { weekly_off: [] } })
  check(
    'holidays: the owner adds one (the same date again renames it), the studio sees it and nobody else; weekly off is the owner’s call',
    hEd.status === 403 && hAdd.status === 201 && hDup.status === 201 && hDup.json.id === hAdd.json.id &&
      (hList.json ?? []).filter((h) => h.holiday_date === hDay).length === 1 &&
      !(hOther.json ?? []).some((h) => h.holiday_date === hDay) && (hRoster.json ?? []).every((r) => r.day_off === 'Studio day off') &&
      pol.status === 200 && pol.json.weekly_off.join() === '0' && polEd.status === 403,
    { ed: hEd.status, add: hAdd.status, dup: hDup.status, other: hOther.json?.length, pol: pol.status, polEd: polEd.status },
  )

  const fixDay = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)
  const fixAsk = await api('/hr/corrections', {
    token: edToken,
    method: 'POST',
    body: { a_date: fixDay, check_in_at: `${fixDay}T10:05:00+05:30`, check_out_at: `${fixDay}T19:00:00+05:30`, reason: 'At the venue all day' },
  })
  const fixOld = await api('/hr/corrections', {
    token: edToken,
    method: 'POST',
    body: { a_date: '2020-01-01', check_in_at: '2020-01-01T10:00:00+05:30', reason: 'Long ago' },
  })
  const fixSelf = await api(`/hr/corrections/${fixAsk.json.id}/decide`, { token: edToken, method: 'POST', body: { approve: true } })
  const fixOk = await api(`/hr/corrections/${fixAsk.json.id}/decide`, { token: aToken, method: 'POST', body: { approve: true } })
  const fixDayRoster = await api(`/hr/attendance?date=${fixDay}`, { token: aToken })
  const fixRow = (fixDayRoster.json ?? []).find((r) => r.user_id === edUid)
  check(
    'day fix: a member asks to fix a recent day; only a manager applies it, and the day then shows the times',
    fixAsk.status === 201 && fixOld.status === 422 && fixSelf.status === 403 && fixOk.status === 204 &&
      !!fixRow?.check_in_at && !!fixRow?.check_out_at && ['present', 'late'].includes(fixRow?.status),
    { ask: fixAsk.status, old: fixOld.status, self: fixSelf.status, ok: fixOk.status, row: fixRow },
  )

  // ── The member page (one person, seen from every side) ──
  const ovOwner = await api(`/team/members/${edUid}/overview`, { token: aToken })
  const ovSelf = await api(`/team/members/${edUid}/overview`, { token: edToken })
  const aOwnerUid = (await api('/auth/session', { token: aToken })).json.user_id
  const ovUp = await api(`/team/members/${aOwnerUid}/overview`, { token: edToken })
  const ovOther = await api(`/team/members/${edUid}/overview`, { token: newPw.json.access_token })
  check(
    'member page: the owner sees work, attendance, leave and private details (masked); the member sees their own; nobody else',
    ovOwner.status === 200 && ovOwner.json.member.name === 'Priya Editor' && ovOwner.json.private?.upi_id === 'priya@okhdfc' &&
      ovOwner.json.private?.pan_on_file === true && !('pan' in (ovOwner.json.private ?? {})) &&
      Array.isArray(ovOwner.json.work?.deliverables) && ovOwner.json.work.deliverables.some((d) => d.title === 'Teaser reel') &&
      ovOwner.json.attendance !== null && (ovOwner.json.leave ?? []).some((l) => l.status === 'approved') &&
      ovOwner.json.can.manage_access === true &&
      ovSelf.status === 200 && ovSelf.json.private?.upi_id === 'priya@okhdfc' && Array.isArray(ovSelf.json.salaries) &&
      ovSelf.json.can.edit === false && ovUp.status === 403 && ovOther.status === 404,
    { owner: ovOwner.status, self: ovSelf.status, up: ovUp.status, other: ovOther.status, priv: ovOwner.json.private, work: ovOwner.json.work && Object.keys(ovOwner.json.work) },
  )

  // ── Delegated team management: a Team Manager runs the team, within limits ──
  const tmEmail = `team-mgr-${rand()}@example.com`
  const tmInv = await api('/team/invitations', { token: aToken, method: 'POST', body: { name: 'Tara Manager', email: tmEmail, role: 'manager' } })
  const tmJoin = await api('/auth/accept-invite', {
    method: 'POST',
    body: { token: /[?&]token=([^&]+)/.exec(tmInv.json.invite_link ?? '')?.[1] ?? '', password: 'Manager12345!' },
  })
  const tmToken = tmJoin.json.access_token
  const tmUid = (await api('/auth/session', { token: tmToken })).json.user_id
  // A plain employee has no Team Directory rights at all.
  const tmBefore = await api('/team/members', { token: edToken, method: 'POST', body: { name: 'Early Try', phone: randPhone(), create_login: false } })
  const tmGrant = await api(`/access/${tmUid}`, { token: aToken, method: 'PUT', body: { profile_key: 'team_manager', overrides: [] } })
  const tmAdd = await api('/team/members', { token: tmToken, method: 'POST', body: { name: 'Ravi Assistant', phone: randPhone(), create_login: false } })
  const tmAddMgr = await api('/team/members', { token: tmToken, method: 'POST', body: { name: 'Another Manager', phone: randPhone(), create_login: false, role: 'manager' } })
  const tmAddPay = await api('/team/members', { token: tmToken, method: 'POST', body: { name: 'Paid Person', phone: randPhone(), create_login: false, salary: 50000 } })
  check(
    'delegation: a Team Manager adds people (an employee cannot), never a manager or anyone with pay',
    tmJoin.status === 200 && tmBefore.status === 403 && tmGrant.status === 204 && tmAdd.status === 201 &&
      tmAddMgr.status === 403 && tmAddPay.status === 403,
    { join: tmJoin.status, before: tmBefore.status, grant: tmGrant.status, add: tmAdd.status, mgr: tmAddMgr.status, pay: tmAddPay.status },
  )
  const raviUid = tmAdd.json.user_id
  const tmEdit = await api(`/team/members/${raviUid}`, { token: tmToken, method: 'PATCH', body: { phone: '9876543210' } })
  const tmEditPay = await api(`/team/members/${raviUid}`, { token: tmToken, method: 'PATCH', body: { salary: null } })
  const tmPromote = await api(`/team/members/${edUid}`, { token: tmToken, method: 'PATCH', body: { role: 'admin' } })
  const tmOwner = await api(`/team/members/${aOwnerUid}`, { token: tmToken, method: 'PATCH', body: { name: 'Hijacked' } })
  const tmSelf = await api(`/team/members/${tmUid}`, { token: tmToken, method: 'PATCH', body: { status: 'active' } })
  const tmOwnerReset = await api(`/team/members/${aOwnerUid}/reset-password`, { token: tmToken, method: 'POST' })
  const tmOtherStudio = await api(`/team/members/${(await api('/auth/session', { token: newPw.json.access_token })).json.user_id}`, {
    token: tmToken, method: 'PATCH', body: { name: 'Across' },
  })
  check(
    'delegation: edits people below them; never pay, never an admin, never the owner, never themselves, never another studio',
    tmEdit.status === 200 && tmEditPay.status === 403 && tmPromote.status === 403 && tmOwner.status === 403 &&
      tmSelf.status === 409 && tmOwnerReset.status === 403 && tmOtherStudio.status === 404,
    { edit: tmEdit.status, pay: tmEditPay.status, promote: tmPromote.status, owner: tmOwner.status, self: tmSelf.status, reset: tmOwnerReset.status, other: tmOtherStudio.status },
  )
  // Usual rates (0233) are pay: a Team Manager without salary rights can neither set nor see them.
  const tmRate = await api(`/team/members/${raviUid}`, { token: tmToken, method: 'PATCH', body: { rate_wedding_day: 12000 } })
  const ownerRate = await api(`/team/members/${raviUid}`, { token: aToken, method: 'PATCH', body: { freelancer_rate: 8000, rate_wedding_day: 12000, rate_half_day: 4500 } })
  const ownerDir = ((await api('/team/directory', { token: aToken })).json ?? []).find?.((m) => m.user_id === raviUid)
  const tmDir = ((await api('/team/directory', { token: tmToken })).json ?? []).find?.((m) => m.user_id === raviUid)
  const negRate = await api(`/team/members/${raviUid}`, { token: aToken, method: 'PATCH', body: { rate_half_day: -5 } })
  check(
    'usual rates: the owner sets a wedding-day and a half-day rate; a Team Manager can neither set nor see them; a negative is refused',
    tmRate.status === 403 && ownerRate.status === 200 && ownerDir?.rate_wedding_day === 12000 && ownerDir?.rate_half_day === 4500 &&
      tmDir && tmDir.rate_wedding_day === null && tmDir.freelancer_rate === null && negRate.status === 422,
    { tmRate: tmRate.status, ownerRate: ownerRate.status, ownerDir: ownerDir && { w: ownerDir.rate_wedding_day, h: ownerDir.rate_half_day }, tmDir: tmDir && { w: tmDir.rate_wedding_day, f: tmDir.freelancer_rate }, neg: negRate.status },
  )
  const tmInvite = await api('/team/invitations', { token: tmToken, method: 'POST', body: { name: 'Neha Editor', email: `neha-${rand()}@example.com`, role: 'employee' } })
  const tmInviteAdmin = await api('/team/invitations', { token: tmToken, method: 'POST', body: { name: 'Big Boss', email: `boss-${rand()}@example.com`, role: 'admin' } })
  const tmInvites = await api('/team/invitations', { token: tmToken })
  const tmOv = await api(`/team/members/${raviUid}/overview`, { token: tmToken })
  const tmOvOwner = await api(`/team/members/${aOwnerUid}/overview`, { token: tmToken })
  const tmRemove = await api(`/team/members/${raviUid}`, { token: tmToken, method: 'DELETE' })
  const tmRemoveOwner = await api(`/team/members/${aOwnerUid}`, { token: tmToken, method: 'DELETE' })
  const ownerStill = await api(`/team/members/${aOwnerUid}/overview`, { token: aToken })
  check(
    'delegation: invites employees (not admins), sees only those invitations, removes people below them but not the owner',
    tmInvite.status === 201 && tmInviteAdmin.status === 403 && tmInvites.status === 200 &&
      (tmInvites.json ?? []).length > 0 && (tmInvites.json ?? []).every((i) => i.role === 'employee') &&
      tmOv.json?.can?.edit === true && tmOvOwner.json?.can?.edit === false && tmOvOwner.json?.can?.manage_access === false &&
      tmRemove.status === 200 && tmRemoveOwner.status === 403 && ownerStill.json?.member?.name !== 'Hijacked',
    { invite: tmInvite.status, admin: tmInviteAdmin.status, list: tmInvites.json?.map?.((i) => i.role), ov: tmOv.json?.can, ovOwner: tmOvOwner.json?.can, remove: tmRemove.status, removeOwner: tmRemoveOwner.status },
  )

  // ── ID proof, payment details, Team Terms switch (0178) ──
  const idForm = new FormData()
  idForm.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' }), 'aadhaar.jpg')
  idForm.append('kind', 'aadhaar')
  const idUp = await fetch(`${API}/settings/profile/documents`, { method: 'POST', headers: { Authorization: `Bearer ${edToken}` }, body: idForm })
  const idDoc = await idUp.json()
  const badForm = new FormData()
  badForm.append('file', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'x.exe')
  const idBad = await fetch(`${API}/settings/profile/documents`, { method: 'POST', headers: { Authorization: `Bearer ${edToken}` }, body: badForm })
  const idOwnerList = await api(`/team/members/${edUid}/documents`, { token: aToken })
  const idOwnerGet = await fetch(`${API}/team/members/${edUid}/documents/${idDoc.id}`, { headers: { Authorization: `Bearer ${aToken}` } })
  const idMgrList = await api(`/team/members/${edUid}/documents`, { token: tmToken })
  const idMgrGet = await fetch(`${API}/settings/profile/documents/${idDoc.id}`, { headers: { Authorization: `Bearer ${tmToken}` } })
  const idSelfProfile = await api('/settings/profile', { token: edToken })
  check(
    'ID proof: the member uploads it (a photo or PDF only); the owner can open it; a manager cannot, even with its id',
    idUp.status === 201 && idDoc.kind === 'aadhaar' && idBad.status === 422 && idOwnerList.status === 200 &&
      (idOwnerList.json ?? []).some((d) => d.id === idDoc.id) && idOwnerGet.status === 200 &&
      idOwnerGet.headers.get('cache-control') === 'private, no-store' && idMgrList.status === 403 && idMgrGet.status === 404 &&
      !idSelfProfile.json.completeness.missing.includes('id_document'),
    { up: idUp.status, bad: idBad.status, list: idOwnerList.status, get: idOwnerGet.status, mgrList: idMgrList.status, mgrGet: idMgrGet.status },
  )
  const payOwner = await api(`/team/members/${edUid}/pay-to`, { token: aToken })
  const payMgr = await api(`/team/members/${edUid}/pay-to`, { token: tmToken })
  const paySelfOther = await api(`/team/members/${aOwnerUid}/pay-to`, { token: edToken })
  check(
    'pay-to: whoever pays sees where to send it; nobody else does',
    payOwner.status === 200 && payOwner.json.upi_id === 'priya@okhdfc' && payMgr.status === 403 && paySelfOther.status === 403,
    { owner: payOwner.status, mgr: payMgr.status, other: paySelfOther.status },
  )
  // ── Stored files: not everyone's by id any more (0183) ──
  const upAs = async (tok, name) => {
    const fd = new FormData()
    fd.append('file', new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), name)
    return (await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })).json()
  }
  const ownerFile = await upAs(aToken, 'salary-sheet.pdf')
  const edFile = await upAs(edToken, 'my-bill.pdf')
  const fGet = async (tok, id) => (await fetch(`${API}/files/${id}`, { headers: { Authorization: `Bearer ${tok}` } })).status
  const fDel = async (tok, id) => (await fetch(`${API}/files/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } })).status
  const edReadsOwners = await fGet(edToken, ownerFile.id)
  const ownerReads = await fGet(aToken, ownerFile.id)
  const edReadsOwn = await fGet(edToken, edFile.id)
  const ownerReadsEds = await fGet(aToken, edFile.id)
  const edDeletesOwners = await fDel(edToken, ownerFile.id)
  const stillThere = await fGet(aToken, ownerFile.id)
  check(
    "files: a member opens their own uploads, not someone else's by id, and can't delete them; the owner opens both",
    edReadsOwners === 404 && ownerReads === 200 && edReadsOwn === 200 && ownerReadsEds === 200 && edDeletesOwners === 404 && stillThere === 200,
    { edReadsOwners, ownerReads, edReadsOwn, ownerReadsEds, edDeletesOwners, stillThere },
  )


  // ── Monthly payroll run (0185) ──
  const prNow = new Date(Date.now() + 5.5 * 3600e3)
  const prYear = prNow.getUTCFullYear()
  const prMonth = prNow.getUTCMonth() + 1
  const prSalary = await api(`/team/members/${edUid}`, { token: aToken, method: 'PATCH', body: { salary: 30000, engagement_type: 'in_house' } })
  // Joined long before this month (0187): paid the whole month, as before pro-rata.
  const prJoinedEarly = await api('/settings/profile', { token: edToken, method: 'PATCH', body: { joined_on: `${prYear - 1}-01-15` } })
  const prEdGen = await api('/payroll/runs/generate', { token: edToken, method: 'POST', body: { year: prYear, month: prMonth } })
  const prMgrGen = await api('/payroll/runs/generate', { token: tmToken, method: 'POST', body: { year: prYear, month: prMonth } })
  const prGen = await api('/payroll/runs/generate', { token: aToken, method: 'POST', body: { year: prYear, month: prMonth } })
  const prMonthRes = await api(`/payroll/runs?year=${prYear}&month=${prMonth}`, { token: aToken })
  const prLine = (prMonthRes.json.lines ?? []).find((l) => l.user_id === edUid)
  check(
    'payroll: the owner works out the month (a member or a manager without salaries cannot); the member is on it at their salary',
    prSalary.status < 300 && prJoinedEarly.status < 300 && prEdGen.status === 403 && prMgrGen.status === 403 && prGen.status === 201 &&
      prMonthRes.status === 200 && prMonthRes.json.run?.status === 'draft' && prLine?.base_amount === 30000 &&
      prLine.working_days > 0 && prLine.payable_days === prLine.working_days && prLine.prorated_base === 30000 &&
      prLine.period_start === `${prYear}-${String(prMonth).padStart(2, '0')}-01` && prLine.net_pay === 30000 - prLine.deduction,
    { salary: prSalary.status, joined: prJoinedEarly.status, ed: prEdGen.status, mgr: prMgrGen.status, gen: prGen.status, month: prMonthRes.status, line: prLine },
  )
  const prRunId = prMonthRes.json.run?.id
  const prNoNote = await api(`/payroll/lines/${prLine?.id}`, { token: aToken, method: 'PATCH', body: { additions: 1500, additions_note: '', other_deductions: 0 } })
  const prEdit = await api(`/payroll/lines/${prLine?.id}`, {
    token: aToken,
    method: 'PATCH',
    body: { additions: 1500, additions_note: 'Festival bonus', other_deductions: 500, other_deductions_note: 'Advance' },
  })
  const prEdEdit = await api(`/payroll/lines/${prLine?.id}`, { token: edToken, method: 'PATCH', body: { additions: 99999, additions_note: 'Mine', other_deductions: 0 } })
  const prRegen = await api('/payroll/runs/generate', { token: aToken, method: 'POST', body: { year: prYear, month: prMonth } })
  const prAfter = ((await api(`/payroll/runs?year=${prYear}&month=${prMonth}`, { token: aToken })).json.lines ?? []).find((l) => l.user_id === edUid)
  const prSlipsBefore = await api('/payroll/payslips', { token: edToken })
  const prSlipBefore = await api(`/payroll/payslips/${prLine?.id}`, { token: edToken })
  check(
    'payroll: a bonus and an advance need a note and survive working the month out again; the member sees nothing before approval',
    prNoNote.status === 422 && prEdit.status === 200 && prEdit.json.net_pay === 30000 - prLine.deduction + 1000 && prEdEdit.status === 403 &&
      prRegen.status === 201 && prAfter?.additions === 1500 && prAfter?.additions_note === 'Festival bonus' && prAfter?.other_deductions === 500 &&
      prSlipsBefore.status === 200 && (prSlipsBefore.json ?? []).length === 0 && prSlipBefore.status === 404,
    { noNote: prNoNote.status, edit: prEdit.json, edEdit: prEdEdit.status, regen: prRegen.status, after: prAfter, before: prSlipsBefore.json, one: prSlipBefore.status },
  )
  // Pro-rata (0187): the member's joining date moves to the 12th of this month;
  // working the month out again pays only the working days since then.
  const prMid = `${prYear}-${String(prMonth).padStart(2, '0')}-12`
  const prJoinedMid = await api('/settings/profile', { token: edToken, method: 'PATCH', body: { joined_on: prMid } })
  const prProRegen = await api('/payroll/runs/generate', { token: aToken, method: 'POST', body: { year: prYear, month: prMonth } })
  const prFinal = ((await api(`/payroll/runs?year=${prYear}&month=${prMonth}`, { token: aToken })).json.lines ?? []).find((l) => l.user_id === edUid)
  const prWant = prFinal && prFinal.payable_days >= prFinal.working_days ? 30000 : Math.round((30000 * (prFinal?.payable_days ?? 0)) / (prFinal?.working_days || 1) + 1e-9)
  check(
    'payroll: joining on the 12th pays the working days since then; the bonus and advance stay',
    prJoinedMid.status < 300 && prProRegen.status === 201 && prFinal?.period_start === prMid && prFinal?.base_amount === 30000 &&
      prFinal.payable_days < prAfter.payable_days && prFinal.prorated_base === prWant && prFinal.prorated_base < 30000 &&
      prFinal.net_pay === Math.max(0, prWant - prFinal.deduction + 1500 - 500) && prFinal.additions_note === 'Festival bonus',
    { joined: prJoinedMid.status, regen: prProRegen.status, line: prFinal, want: prWant },
  )
  const prEdApprove = await api(`/payroll/runs/${prRunId}/approve`, { token: edToken, method: 'POST' })
  const prApprove = await api(`/payroll/runs/${prRunId}/approve`, { token: aToken, method: 'POST' })
  const prApprove2 = await api(`/payroll/runs/${prRunId}/approve`, { token: aToken, method: 'POST' })
  const prLockedGen = await api('/payroll/runs/generate', { token: aToken, method: 'POST', body: { year: prYear, month: prMonth } })
  const prLockedEdit = await api(`/payroll/lines/${prLine?.id}`, { token: aToken, method: 'PATCH', body: { additions: 0, other_deductions: 0 } })
  check(
    'payroll: only the owner approves; an approved month is locked',
    prEdApprove.status === 403 && prApprove.status === 204 && prApprove2.status === 422 && prLockedGen.status === 422 && prLockedEdit.status === 422,
    { ed: prEdApprove.status, ok: prApprove.status, again: prApprove2.status, gen: prLockedGen.status, edit: prLockedEdit.status },
  )
  const prSlips = await api('/payroll/payslips', { token: edToken })
  const prSlip = await api(`/payroll/payslips/${prLine?.id}`, { token: edToken })
  const prEdRuns = await api(`/payroll/runs?year=${prYear}&month=${prMonth}`, { token: edToken })
  const prEdOthers = await api(`/payroll/payslips?user_id=${aOwnerUid}`, { token: edToken })
  const prOtherStudio = await api(`/payroll/payslips/${prLine?.id}`, { token: newPw.json.access_token })
  const prOtherPay = await api(`/payroll/runs/${prRunId}/pay`, { token: newPw.json.access_token, method: 'POST', body: {} })
  check(
    'payroll: after approval the member sees their own payslip only; nobody else and no other studio',
    prSlips.status === 200 && (prSlips.json ?? []).length === 1 && prSlips.json[0].id === prLine?.id &&
      prSlip.status === 200 && prSlip.json.name === 'Priya Editor' && prSlip.json.additions_note === 'Festival bonus' && !!prSlip.json.company_name &&
      prSlip.json.period_start === prMid && prSlip.json.payable_days === prFinal?.payable_days && prSlip.json.prorated_base === prFinal?.prorated_base &&
      prEdRuns.status === 403 && prEdOthers.status === 403 && prOtherStudio.status === 404 && prOtherPay.status === 404,
    { slips: prSlips.json, slip: prSlip.status, runs: prEdRuns.status, others: prEdOthers.status, otherStudio: prOtherStudio.status, otherPay: prOtherPay.status },
  )
  const prEdPay = await api(`/payroll/runs/${prRunId}/pay`, { token: edToken, method: 'POST', body: { line_id: prLine?.id } })
  const prPay = await api(`/payroll/runs/${prRunId}/pay`, { token: aToken, method: 'POST', body: { line_id: prLine?.id, payment_mode: 'UPI', reference: 'UTR123' } })
  const prPay2 = await api(`/payroll/runs/${prRunId}/pay`, { token: aToken, method: 'POST', body: { line_id: prLine?.id, payment_mode: 'UPI' } })
  const prLedger = await api(`/team/monthly-salaries?month=${prMonth}&year=${prYear}&user_id=${edUid}`, { token: aToken })
  const prLedgerRow = (prLedger.json.items ?? []).find((r) => r.user_id === edUid)
  const prNotes = await api('/notifications?type=payroll.payslip', { token: edToken })
  const prExport = await api(`/payroll/runs/${prRunId}/export`, { token: aToken })
  const prEdExport = await api(`/payroll/runs/${prRunId}/export`, { token: edToken })
  check(
    'payroll: the owner marks the member paid once; the salaries ledger says paid; the member is told; the bank sheet is for the owner only',
    prEdPay.status === 403 && prPay.status === 200 && prPay.json.paid_count === 1 && prPay2.status === 422 &&
      prLedgerRow?.status === 'paid' && prLedgerRow?.paid_amount === prFinal?.net_pay &&
      (prNotes.json ?? []).some((n) => /^Payslip for .+ is ready$/.test(n.title)) &&
      prExport.status === 200 && (prExport.json ?? []).some((r) => r.name === 'Priya Editor' && r.upi_id === 'priya@okhdfc' && r.net_pay === prFinal?.net_pay && r.payable_days === prFinal?.payable_days) &&
      prEdExport.status === 403,
    { edPay: prEdPay.status, pay: prPay.json, again: prPay2.status, ledger: prLedgerRow, notes: (prNotes.json ?? []).map((n) => n.title), export: prExport.status, edExport: prEdExport.status },
  )
  const termsEd = await api('/team-terms/templates', { token: edToken })
  const termsMgr = await api('/team-terms/templates', { token: tmToken })
  check('team terms: gated on the Team Terms module, not just on projects', termsEd.status === 403 && termsMgr.status === 200, {
    ed: termsEd.status,
    mgr: termsMgr.status,
  })

  // ── Tracking health from the server (Tracking v2) ──
  const trk = await api('/projects/tracking', { token: aToken })
  const trkRow = (trk.json ?? []).find((r) => r.id === pid)
  const trkEd = await api('/projects/tracking', { token: edToken })
  const trkOne = await api(`/projects/tracking/${pid}`, { token: aToken })
  check(
    'tracking: each project carries its health and reasons; money only for Billing; the breakdown lists late work and shoots',
    trk.status === 200 && !!trkRow?.health?.band && Array.isArray(trkRow?.health?.reasons) && trkRow.total_cost !== null &&
      (trkEd.status === 403 || (trkEd.json ?? []).every((r) => r.total_cost === null && r.received === null)) &&
      trkOne.status === 200 && Array.isArray(trkOne.json.deliverables) && Array.isArray(trkOne.json.shoots) && trkOne.json.money !== null,
    { row: trkRow?.health, trEd: trkEd.status, one: trkOne.status },
  )

  // A project template creates a real project now -- and asks for a client.
  const tpl = await api('/projects/templates', {
    token: aToken,
    method: 'POST',
    body: { name: `Wedding ${rand()}`, deliverables_json: [{ name: 'Album', quantity: 2 }, { name: 'Teaser' }], shoots_json: [{ name: 'Haldi' }, { name: 'Wedding' }], tasks_json: [{ title: 'Call client' }] },
  })
  const noClient = await api(`/projects/templates/${tpl.json.id}/apply`, { token: aToken, method: 'POST', body: { name: 'From template' } })
  const applied = await api(`/projects/templates/${tpl.json.id}/apply`, {
    token: aToken,
    method: 'POST',
    body: { name: 'From template', client_id: client.json.id, start_date: '2026-12-01' },
  })
  const made = await api(`/projects/${applied.json.project_id}`, { token: aToken })
  check(
    'templates: applying trkOne makes the project with its deliverables',
    noClient.status === 422 && applied.status === 201 && made.json.deliverables?.some((d) => d.title === 'Album ×2'),
    { noClient: noClient.status, applied: applied.json, made: made.json.deliverables },
  )
  // Its deliverables are dated as the wizard would: a teaser 7 days after the
  // wedding (the template's shoots start on the chosen day), anything else by
  // the usual 30 days.
  const dueOf = (t) => made.json.deliverables?.find((d) => d.title === t)?.estimated_date?.slice(0, 10)
  check(
    'templates: a project from a template gets its due dates, counted from the wedding day',
    dueOf('Teaser') === '2026-12-08' && dueOf('Album ×2') === '2026-12-31',
    { teaser: dueOf('Teaser'), album: dueOf('Album ×2') },
  )
}

// ── Client terms: send, send again, cancel, agree (0163) ────────────────
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Terms Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: 'Terms project', client_id: client.json.id, package_cost: 90000 } })
  const pid = project.json.id
  const tokenOf = (url) => new URL(url, 'http://x').searchParams.get('token') ?? ''

  const sent = await api('/terms/issue', {
    token: aToken,
    method: 'POST',
    body: {
      project_id: pid,
      rendered_body: 'Booking is confirmed on payment.',
      title: 'Wedding terms',
      payment_terms: [{ label: 'Advance', mode: 'percent', value: 50, due_trigger: 'On signing' }],
      total_cost: 90000,
      legal_note: 'Tap I agree to accept.',
      expiry_days: 30,
    },
  })
  const first = await api(`/public/terms/${sent.json.token}/payload`)
  check(
    'terms: the client sees the payment plan and legal note',
    sent.status === 201 && !!sent.json.url && first.status === 200 && first.json.payment_terms?.length === 1 && first.json.legal_note === 'Tap I agree to accept.',
    { sent: sent.json, first: first.json },
  )

  const again = await api(`/terms/documents/${sent.json.document_id}/link`, { token: aToken, method: 'POST', body: {} })
  const oldLink = await api(`/public/terms/${sent.json.token}/payload`)
  const newLink = await api(`/public/terms/${tokenOf(again.json.url)}/payload`)
  check('terms: a new link stops the old one, and the old one says it was replaced (410)', again.status === 200 && oldLink.status === 410 && /newer version/.test(oldLink.json?.error?.message ?? oldLink.json?.message ?? JSON.stringify(oldLink.json)) && newLink.status === 200, {
    again: again.status, old: oldLink.status, fresh: newLink.status,
  })

  // The studio's own words for the email are taken as given (no mail
  // provider here, so it reports that rather than pretending it went).
  const worded = await api(`/terms/documents/${sent.json.document_id}/email`, {
    token: aToken,
    method: 'POST',
    body: { token: tokenOf(again.json.url), to_email: 'client@example.com', subject: 'Our terms for your wedding', message: 'Hello Priya,\nPlease read and agree.' },
  })
  const tooLong = await api(`/terms/documents/${sent.json.document_id}/email`, {
    token: aToken, method: 'POST', body: { token: tokenOf(again.json.url), subject: 'x'.repeat(201) },
  })
  check(
    'terms: the email can carry the studio’s own subject and message',
    worded.status === 200 && ['provider_missing', 'sent', 'failed'].includes(worded.json.status) && tooLong.status === 422,
    { worded: worded.json, tooLong: tooLong.status },
  )
  const cancelled = await api(`/terms/documents/${sent.json.document_id}/revoke`, { token: aToken, method: 'POST' })
  const afterCancel = await api(`/public/terms/${tokenOf(again.json.url)}/payload`)
  const legacy = await api(`/public/terms/${tokenOf(again.json.url)}`)
  const lateAgree = await api(`/public/terms/${tokenOf(again.json.url)}/ack`, { method: 'POST', body: { name: 'Priya' } })
  check('terms: a cancelled link does not open, on either reader, and cannot be agreed', cancelled.status === 200 && afterCancel.status === 410 && legacy.status === 410 && lateAgree.status === 409, {
    cancelled: cancelled.status, afterCancel: afterCancel.status, legacy: legacy.status, lateAgree: lateAgree.status,
  })

  const v2 = await api('/terms/issue', { token: aToken, method: 'POST', body: { project_id: pid, rendered_body: 'Version two.' } })
  const agreed = await api(`/public/terms/${v2.json.token}/ack`, { method: 'POST', body: { name: 'Priya Sharma' } })
  const twice = await api(`/public/terms/${v2.json.token}/ack`, { method: 'POST', body: { name: 'Someone' } })
  const reread = await api(`/public/terms/${v2.json.token}/payload`)
  const list = await api(`/terms/projects/${pid}/documents`, { token: aToken })
  check(
    'terms: agreeing works once, the client can re-read it, and the studio sees who agreed',
    agreed.status === 200 && twice.status === 409 && reread.status === 200 && list.json[0]?.acknowledged_by_name === 'Priya Sharma' && list.json.length === 2,
    { agreed: agreed.status, twice: twice.status, reread: reread.status, list: list.json },
  )
  const other = await api(`/terms/projects/${pid}/documents`, { token: newPw.json.access_token })
  check("terms: another studio sees none of this project's terms", Array.isArray(other.json) && other.json.length === 0, other.json)

  // ── 0215: the same link again, the email with it, and why a link fails ──
  const v3 = await api('/terms/issue', {
    token: aToken,
    method: 'POST',
    body: { project_id: pid, rendered_body: 'Version three.', email: true, to_email: 'client@example.com' },
  })
  const listed3 = await api(`/terms/projects/${pid}/documents`, { token: aToken })
  const cur = listed3.json[0] ?? {}
  check(
    'terms 0215: "share again" hands out the same link the client already has',
    v3.status === 201 && tokenOf(cur.share_url ?? '') === v3.json.token,
    { share_url: cur.share_url, token: v3.json.token },
  )
  // No mail provider here: the send says so, and the card shows that answer.
  check(
    'terms 0215: sending with email on reports what happened to the email',
    ['provider_missing', 'sent', 'failed'].includes(v3.json.email_status) && cur.last_email?.status === v3.json.email_status,
    { email_status: v3.json.email_status, last_email: cur.last_email },
  )
  const stored = await api(`/terms/documents/${v3.json.document_id}/email`, { token: aToken, method: 'POST', body: { to_email: 'client@example.com' } })
  const stillLive = await api(`/public/terms/${v3.json.token}/payload`)
  check(
    'terms 0215: emailing again uses the kept link and does not break it',
    stored.status === 200 && stillLive.status === 200,
    { stored: stored.status, live: stillLive.status },
  )
  const bogus = await api('/public/terms/not-a-real-link-at-all/payload')
  check('terms 0215: a link that never existed is a plain 404 that says so', bogus.status === 404, { status: bogus.status })
  const agreed3 = await api(`/public/terms/${v3.json.token}/ack`, { method: 'POST', body: { name: 'Priya Sharma' } })
  const after3 = await api(`/terms/projects/${pid}/documents`, { token: aToken })
  check(
    'terms 0215: once agreed there is no link to share again',
    agreed3.status === 200 && after3.json[0]?.share_url === null && !!after3.json[0]?.acknowledged_at,
    { share_url: after3.json[0]?.share_url },
  )

  // Invoices: the customer's own projects, for anyone who may make invoices.
  const cp = await api(`/clients/${client.json.id}/projects`, { token: aToken })
  check('invoice: picking a customer lists that customer’s projects', cp.status === 200 && cp.json.some((x) => x.id === pid), {
    status: cp.status,
    ids: Array.isArray(cp.json) ? cp.json.map((x) => x.id) : cp.json,
  })
}

// ── Project money: promised is not received; a payment can be changed ───
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Money Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Money project ${rand()}`, client_id: client.json.id, package_cost: 100000 } })
  const pid = project.json.id
  const zero = await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 0 } })
  await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 30000, mode: 'UPI' } })
  const promised = await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 20000, status: 'pending' } })
  const listed = async () => {
    const page = await api(`/projects?q=${encodeURIComponent(project.json.id ? 'Money project' : '')}&page_size=100`, { token: aToken })
    const items = Array.isArray(page.json) ? page.json : (page.json.items ?? [])
    return items.find((x) => x.id === pid)
  }
  const before = await listed()
  check('money: a ₹0 payment is refused, and a promised one is not counted as received', zero.status === 422 && Number(before?.received) === 30000, {
    zero: zero.status, before,
  })
  const marked = await api(`/projects/${pid}/payments/${promised.json.id}`, { token: aToken, method: 'PATCH', body: { status: 'paid' } })
  // The studio's own receipt page reads the payment as the client sees it.
  const rc = await api(`/billing/payments/${promised.json.id}/receipt`, { token: aToken })
  const rcOther = await api(`/billing/payments/${promised.json.id}/receipt`, { token: newPw.json.access_token })
  check(
    'receipt: the studio reads a payment as its receipt, with number and project value; another studio cannot',
    rc.status === 200 && /^RCP-\d{4}-\d{2}-\d{4}$/.test(rc.json.receipt_number ?? '') && Number(rc.json.amount) === 20000 &&
      Number(rc.json.total_cost) > 0 && rc.json.project_id === pid && rcOther.status === 404,
    { rc: rc.json, other: rcOther.status },
  )
  const after = await listed()
  const detail = await api(`/projects/${pid}`, { token: aToken })
  check(
    'money: marking a promised payment received counts it',
    marked.status === 204 && Number(after?.received) === 50000 && detail.json.payments.every((x) => x.status === 'paid'),
    { marked: marked.status, after },
  )

  // Profit & Loss (0167): the project's 50,000 received shows as income for
  // today, in its own row; the other studio's statement does not include it.
  // Today is India's: the API dates a payment there, and from 6:30 pm UTC the
  // UTC date is still yesterday.
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
  const pnl = await api(`/financials/pnl?from=${today}&to=${today}&basis=cash`, { token: aToken })
  const row = (pnl.json.projects ?? []).find((x) => x.project_id === pid)
  check(
    'p&l: payments received today are income, in that project’s row, over twelve months of trend',
    pnl.status === 200 && pnl.json.lines.income >= 50000 && row?.income === 50000 && row?.to_collect === 50000 && pnl.json.monthly.length === 12,
    { status: pnl.status, lines: pnl.json.lines, row },
  )
  const theirs = await api(`/financials/pnl?from=${today}&to=${today}&basis=cash`, { token: newPw.json.access_token })
  check(
    'p&l: another studio’s statement has none of it',
    theirs.status === 200 && !(theirs.json.projects ?? []).some((x) => x.project_id === pid),
    { status: theirs.status, projects: theirs.json.projects?.length },
  )
  const one = await api(`/financials/pnl?from=2000-01-01&to=2100-12-31&basis=booked&project_id=${pid}`, { token: aToken })
  check('p&l: one project over its life, for its Billing tab', one.status === 200 && one.json.projects[0]?.income === 100000, one.json.projects)
  const bad = await api(`/financials/pnl?from=${today}&to=2000-01-01`, { token: aToken })
  check('p&l: a backwards period is refused (422)', bad.status === 422, bad.json)
}

// ── Work to review: work sent straight to the client still lists ─────────
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Work Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Work project ${rand()}`, client_id: client.json.id } })
  const pid = project.json.id
  const sub = await api('/work/submissions', { token: aToken, method: 'POST', body: { project_id: pid, title: 'Album first cut', submission_link: 'https://example.test/album' } })
  const sent = await api(`/work/submissions/${sub.json.id}/deliver`, { token: aToken, method: 'POST', body: { channel: 'whatsapp' } })
  const listed = await api(`/work/submissions?project_id=${pid}`, { token: aToken })
  const row = Array.isArray(listed.json) ? listed.json[0] : null
  check(
    'work: a submission sent to the client still lists, with who handed it in',
    sent.status === 200 && listed.status === 200 && row?.status === 'sent' && typeof row?.submitted_by_name === 'string',
    { sub: sub.status, sent: sent.status, listed: listed.status, row },
  )
}

// ── Every studio starts with a sample project template (0232) ───────────
{
  const tpl = await api('/projects/templates', { token: aToken })
  const samples = (tpl.json.items ?? []).filter((t) => t.is_sample)
  check(
    'templates: a studio has its sample wedding template',
    tpl.status === 200 && samples.length === 1 && samples[0].name === 'Sample — Wedding' && samples[0].shoots_json.length === 3,
    { status: tpl.status, samples: samples.map((t) => t.name) },
  )
  const edited = await api(`/projects/templates/${samples[0]?.id}`, {
    token: aToken, method: 'PATCH',
    body: { name: 'Our wedding', deliverables_json: samples[0]?.deliverables_json ?? [], shoots_json: samples[0]?.shoots_json ?? [], tasks_json: [] },
  })
  const again = await api('/projects/templates', { token: aToken })
  const mine = (again.json.items ?? []).find((t) => t.id === samples[0]?.id)
  check('templates: editing the sample makes it the studio\'s own', edited.status === 200 && mine?.is_sample === false && mine?.name === 'Our wedding', { edited: edited.status, mine })
}

// ── Terms drafts: half-written terms are kept ───────────────────────────
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Draft Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Draft project ${rand()}`, client_id: client.json.id } })
  const pid = project.json.id
  const saved = await api('/terms/draft', { token: aToken, method: 'PUT', body: { project_id: pid, rendered_body: 'Half written', title: 'Terms' } })
  const again = await api('/terms/draft', {
    token: aToken, method: 'PUT',
    body: { project_id: pid, rendered_body: 'Half written, more', payment_terms: [{ label: 'Advance', mode: 'percent', value: 50 }] },
  })
  const read = await api(`/terms/draft?project_id=${pid}`, { token: aToken })
  check(
    'terms: a draft saves with no plan yet, saves again, and reads back',
    saved.status === 200 && again.status === 200 && read.json?.rendered_body === 'Half written, more' && read.json?.payment_terms?.length === 1,
    { saved: saved.status, again: again.status, read: read.json },
  )
  const plan = await api(`/projects/${pid}/billing`, { token: aToken })
  check('terms: a draft is not the payment plan', plan.status === 200 && plan.json.plan === null, { status: plan.status, plan: plan.json?.plan })
  const sent = await api('/terms/issue', { token: aToken, method: 'POST', body: { project_id: pid, rendered_body: 'Final words' } })
  const gone = await api(`/terms/draft?project_id=${pid}`, { token: aToken })
  check('terms: sending clears the draft', sent.status === 201 && gone.json === null, { sent: sent.status, gone: gone.json })
}

// ── Create Project: a promised advance stays promised ───────────────────
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Wizard Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', {
    token: aToken, method: 'POST',
    body: {
      name: `Wizard project ${rand()}`, client_id: client.json.id, package_cost: 100000,
      payments: [
        { amount: 25000, mode: 'UPI' },
        { amount: 25000, status: 'pending', description: 'Before the shoot' },
      ],
    },
  })
  const detail = await api(`/projects/${project.json.id}`, { token: aToken })
  const pays = detail.json.payments ?? []
  const promised = pays.find((x) => x.status === 'pending')
  check(
    'create project: a promised advance is saved as promised, with its client',
    project.status === 201 && pays.length === 2 && !!promised && promised.description === 'Before the shoot' && pays.every((x) => x.client_id === client.json.id || x.client_id === undefined),
    { status: project.status, pays },
  )
  const page = await api(`/projects?q=Wizard%20project&page_size=100`, { token: aToken })
  const items = Array.isArray(page.json) ? page.json : (page.json.items ?? [])
  const row = items.find((x) => x.id === project.json.id)
  check('create project: only the paid advance counts as received', Number(row?.received) === 25000, { row })
}

// ── Tracking: a cancelled task is not owed ──────────────────────────────
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Track Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Track project ${rand()}`, client_id: client.json.id, package_cost: 1000, payments: [{ amount: 400 }] } })
  const pid = project.json.id
  const mk = (title, status) => api('/tasks', { token: aToken, method: 'POST', body: { project_id: pid, title, status, priority: 'medium', assignees: [] } })
  const t1 = await mk('Done one', 'completed')
  const t2 = await mk('Dropped one', 'cancelled')
  const tracking = await api('/projects/tracking', { token: aToken })
  const row = (tracking.json ?? []).find((r) => r.id === pid)
  check(
    'tracking: a cancelled task does not hold the project short, and received is paid money',
    t1.status < 300 && t2.status < 300 && row?.tasks_total === 1 && row?.tasks_done === 1 && Number(row?.received) === 400,
    { t1: t1.status, t2: t2.status, row },
  )
}


// ── Invoice editor: HSN/SAC, subject, terms, saved items, files, paid on creation ──
{
  const bTok = newPw.json.access_token
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `GST Co ${rand()}`, phone: randPhone(), gstin: '09ABWFA5316N1ZQ' } })
  // Saved items: one studio's catalogue, invisible to another.
  const item = await api('/billing/items', { token: aToken, method: 'POST', body: { name: `Drone coverage ${rand()}`, rate: 15000, hsn_sac: '998383', gst_rate: 18, kind: 'service' } })
  const mine = await api('/billing/items', { token: aToken })
  const theirs = await api('/billing/items', { token: bTok })
  const theirEdit = await api(`/billing/items/${item.json.id}`, { token: bTok, method: 'PATCH', body: { name: 'Stolen', rate: 1 } })
  check(
    'items: a saved item is kept with its SAC and rate; another studio neither sees nor edits it',
    item.status === 201 && mine.json.some((x) => x.id === item.json.id && x.hsn_sac === '998383' && x.rate === 15000) &&
      !theirs.json.some((x) => x.id === item.json.id) && theirEdit.status === 404,
    { item: item.status, theirs: theirs.json?.length, theirEdit: theirEdit.status },
  )

  // A quotation PDF goes out with the invoice.
  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
  const fd = new FormData()
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'quotation.pdf')
  const up = await (await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${aToken}` }, body: fd })).json()
  const fdB = new FormData()
  fdB.append('file', new Blob([pdf], { type: 'application/pdf' }), 'other.pdf')
  const upB = await (await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${bTok}` }, body: fdB })).json()

  const body = {
    client_id: client.json.id,
    place_of_supply: '09',
    intra_state: false,
    gst_number: '09ABWFA5316N1ZQ',
    subject: 'Wedding coverage, December',
    payment_terms: 'Net 15',
    status: 'sent',
    lines: [
      { description: 'Candid photography', quantity: 1, rate: 100000, gst_rate: 18, hsn_sac: '998383' },
      { description: 'Album', quantity: 1, rate: 20000, gst_rate: 12, hsn_sac: '4911' },
    ],
  }
  const borrowed = await api('/billing/invoices', { token: aToken, method: 'POST', body: { ...body, attachment_file_ids: [upB.id] } })
  const made = await api('/billing/invoices', {
    token: aToken,
    method: 'POST',
    body: { ...body, attachment_file_ids: [up.id], payment: { amount: 50000, mode: 'UPI', reference: 'UTR123' } },
  })
  const inv = await api(`/billing/invoices/${made.json.id}`, { token: aToken })
  check(
    'invoice: HSN/SAC per line in typed order, subject, terms, IGST, the file and the payment are all saved in one go',
    made.status === 201 && inv.json.items.map((i) => i.hsn_sac).join(',') === '998383,4911' && inv.json.subject === 'Wedding coverage, December' &&
      inv.json.payment_terms === 'Net 15' && inv.json.intra_state === false && inv.json.items[0].igst === 18000 &&
      inv.json.attachments.length === 1 && inv.json.attachments[0].name === 'quotation.pdf' && inv.json.amount_paid === 50000 && inv.json.status === 'partial',
    { made: made.status, inv: { ...inv.json, template_layout: undefined } },
  )
  check("invoice: another studio's file cannot be attached", borrowed.status === 422 || borrowed.status === 400, { borrowed: borrowed.status, body: borrowed.json })

  // The client's link carries the file, and downloads it without an account.
  const share = await api(`/billing/invoices/${made.json.id}/share`, { token: aToken, method: 'POST', body: {} })
  const token = /[?&]token=([^&]+)/.exec(share.json.link ?? '')?.[1] ?? ''
  const pub = await api(`/public/invoice/${token}`)
  const dl = await fetch(`${API}/public/invoice/${token}/files/${up.id}`)
  const dlBytes = new Uint8Array(await dl.arrayBuffer())
  const wrongFile = await fetch(`${API}/public/invoice/${token}/files/${upB.id}`)
  const badToken = await fetch(`${API}/public/invoice/nope-${rand()}/files/${up.id}`)
  check(
    'public invoice: shows HSN and the attachment, downloads it by the link, and nothing else',
    pub.status === 200 && pub.json.invoice.items[1].hsn_sac === '4911' && pub.json.invoice.attachments.length === 1 &&
      dl.status === 200 && dlBytes.length === pdf.length && wrongFile.status === 404 && badToken.status === 404,
    { pub: pub.status, dl: dl.status, wrong: wrongFile.status, bad: badToken.status },
  )

  // Editing replaces the files; an invoice with a payment can no longer be edited.
  const draft = await api('/billing/invoices', { token: aToken, method: 'POST', body: { ...body, status: 'draft', attachment_file_ids: [up.id] } })
  const edited = await api(`/billing/invoices/${draft.json.id}`, { token: aToken, method: 'PATCH', body: { ...body, status: 'draft', attachment_file_ids: [] } })
  const afterEdit = await api(`/billing/invoices/${draft.json.id}`, { token: aToken })
  const draftPaid = await api('/billing/invoices', { token: aToken, method: 'POST', body: { ...body, status: 'draft', payment: { amount: 1000 } } })
  const dp = await api(`/billing/invoices/${draftPaid.json.id}`, { token: aToken })
  // A draft is sent with one action; another studio cannot send it.
  const theirSend = await api(`/billing/invoices/${draft.json.id}/send`, { token: bTok, method: 'POST', body: {} })
  const sent = await api(`/billing/invoices/${draft.json.id}/send`, { token: aToken, method: 'POST', body: {} })
  const afterSend = await api(`/billing/invoices/${draft.json.id}`, { token: aToken })
  check(
    'invoice: a draft is sent in one step, and only by its own studio',
    theirSend.status === 404 && sent.status === 200 && afterSend.json.status === 'sent',
    { theirs: theirSend.status, sent: sent.status, status: afterSend.json.status },
  )
  check(
    'invoice: an edit can remove the files; money recorded at creation makes it a sent invoice, never a paid draft',
    edited.status === 200 && afterEdit.json.attachments.length === 0 && dp.json.status !== 'draft' && dp.json.amount_paid === 1000,
    { edited: edited.status, n: afterEdit.json.attachments?.length, dp: dp.json.status },
  )
}

// ── Client portal: one private link per project, for the client ──
{
  const bTok = newPw.json.access_token
  const coupleName = `Portal Couple ${rand()}`
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: coupleName, phone: randPhone() } })
  const projectName = `Portal wedding ${rand()}`
  const project = await api('/projects', {
    token: aToken,
    method: 'POST',
    body: { name: projectName, client_id: client.json.id, package_cost: 100000, payments: [{ amount: 40000 }] },
  })
  const pid = project.json.id
  const shoot = await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Haldi', location: 'Jaipur' } })
  const album = await api(`/projects/${pid}/deliverables`, {
    token: aToken,
    method: 'POST',
    body: { title: 'Wedding album', visibility_scope: 'client', internal_notes: 'SECRET-NOTE', status: 'completed', delivery_link: 'https://drive.example.com/album' },
  })
  const cull = await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Culling (team only)', visibility_scope: 'internal' } })
  const made = await api(`/client-portal/projects/${pid}`, { token: aToken, method: 'POST', body: { show_payments: true } })
  const token = /\/p\/([^/?#]+)$/.exec(made.json.url ?? '')?.[1] ?? ''
  check('portal: the owner makes a link, returned once', made.status === 201 && token.length >= 60 && made.json.link?.view_count === 0, made.json)

  const pub = await api(`/public/portal/${token}`)
  const raw = JSON.stringify(pub.json)
  const titles = (pub.json.deliverables ?? []).map((d) => d.title)
  const albumRow = (pub.json.deliverables ?? []).find((d) => d.id === album.json.id)
  check(
    'portal: opens without a login, for this project and this couple',
    pub.status === 200 && pub.json.project?.name === projectName && pub.json.project?.client_name === coupleName,
    { status: pub.status, project: pub.json.project },
  )
  check(
    'portal: client deliverables with status and link; internal work, notes and prices are not there',
    titles.includes('Wedding album') && !titles.includes('Culling (team only)') && albumRow?.status === 'ready' &&
      albumRow?.delivery_link === 'https://drive.example.com/album' && !raw.includes('SECRET-NOTE') && !raw.includes(cull.json.id) &&
      !raw.includes('additional_charge') && !raw.includes('internal_notes') && !raw.includes('estimated_cost'),
    { titles, albumRow },
  )
  check(
    'portal: shoots and money (package, received, balance)',
    (pub.json.shoots ?? []).some((s) => s.id === shoot.json.id && s.location === 'Jaipur') &&
      pub.json.money?.total === 100000 && pub.json.money?.received === 40000 && pub.json.money?.balance === 60000,
    { shoots: pub.json.shoots, money: pub.json.money },
  )

  // The studio sees the open; money can be hidden.
  const status = await api(`/client-portal/projects/${pid}`, { token: aToken })
  const hide = await api(`/client-portal/projects/${pid}`, { token: aToken, method: 'PATCH', body: { show_payments: false } })
  const hidden = await api(`/public/portal/${token}`)
  check(
    'portal: the studio sees when the client opened it; hiding payments hides the money',
    status.status === 200 && status.json.link?.view_count >= 1 && !!status.json.link?.last_viewed_at &&
      hide.status === 200 && hidden.status === 200 && hidden.json.money === null,
    { status: status.json, hide: hide.status, money: hidden.json.money },
  )

  // Feedback reaches the studio as a notification.
  const fb = await api(`/public/portal/${token}/feedback`, {
    method: 'POST',
    body: { deliverable_id: album.json.id, kind: 'change_requested', message: 'Please brighten page 4' },
  })
  const fbInternal = await api(`/public/portal/${token}/feedback`, { method: 'POST', body: { deliverable_id: cull.json.id, kind: 'approved' } })
  const notes = await api('/notifications', { token: aToken })
  const told = JSON.stringify(notes.json).includes('asked for a change to Wedding album')
  check(
    'portal: a client note on a deliverable notifies the studio; an internal item takes none',
    fb.status === 200 && fbInternal.status === 409 && told,
    { fb: fb.status, fbInternal: fbInternal.status, told },
  )

  // Another studio can neither read, make nor stop it.
  const bRead = await api(`/client-portal/projects/${pid}`, { token: bTok })
  const bRevoke = await api(`/client-portal/projects/${pid}`, { token: bTok, method: 'DELETE' })
  const bMake = await api(`/client-portal/projects/${pid}`, { token: bTok, method: 'POST', body: {} })
  const stillOpen = await api(`/public/portal/${token}`)
  check(
    "portal: another studio cannot see, make or revoke this project's link",
    bRead.status === 404 && bRevoke.status === 404 && bMake.status === 404 && stillOpen.status === 200,
    { bRead: bRead.status, bRevoke: bRevoke.status, bMake: bMake.status, open: stillOpen.status },
  )

  // An employee without projects edit cannot make or stop one.
  const eInv = await api('/team/invitations', {
    token: aToken,
    method: 'POST',
    body: { name: 'Portal Viewer', email: `pv-${rand()}@example.com`, role: 'employee' },
  })
  const eRaw = /[?&]token=([^&]+)/.exec(eInv.json.invite_link ?? '')?.[1] ?? ''
  const eJoin = await api('/auth/accept-invite', { method: 'POST', body: { token: eRaw, password: 'Viewer12345!' } })
  const eMake = await api(`/client-portal/projects/${pid}`, { token: eJoin.json.access_token, method: 'POST', body: {} })
  const eRevoke = await api(`/client-portal/projects/${pid}`, { token: eJoin.json.access_token, method: 'DELETE' })
  check(
    'portal: an employee without project edit cannot make or stop a link',
    eJoin.status === 200 && eMake.status === 403 && eRevoke.status === 403,
    { join: eJoin.status, make: eMake.status, revoke: eRevoke.status },
  )

  // A new link retires the old; revoking stops it; a made-up token is a miss.
  const again = await api(`/client-portal/projects/${pid}`, { token: aToken, method: 'POST', body: {} })
  const token2 = /\/p\/([^/?#]+)$/.exec(again.json.url ?? '')?.[1] ?? ''
  const oldGone = await api(`/public/portal/${token}`)
  const revoke = await api(`/client-portal/projects/${pid}`, { token: aToken, method: 'DELETE' })
  const newGone = await api(`/public/portal/${token2}`)
  const bogus = await api(`/public/portal/${rand()}${rand()}`)
  const afterRevoke = await api(`/client-portal/projects/${pid}`, { token: aToken })
  check(
    'portal: a new link retires the old one; a revoked link and a made-up one are 404',
    again.status === 201 && oldGone.status === 404 && revoke.status === 200 && newGone.status === 404 && bogus.status === 404 &&
      afterRevoke.json.link === null,
    { again: again.status, old: oldGone.status, revoke: revoke.status, gone: newGone.status, bogus: bogus.status },
  )
}

// ── Messaging wallet: balance, recharge request, settings, no-balance skip ──
{
  const bTok = newPw.json.access_token
  const start = await api('/messaging', { token: aToken })
  check(
    'messaging: the owner sees a wallet at ₹0, 100 free emails a month, and every event off',
    start.status === 200 && start.json.wallet?.balance_paise === 0 &&
      start.json.prices?.some((p) => p.channel === 'email' && p.free_monthly === 100 && p.price_paise > 0) &&
      start.json.usage?.email_monthly_cap === 10000 &&
      start.json.settings?.length === 5 && start.json.settings.every((s) => !s.whatsapp && !s.email) &&
      start.json.settings.some((s) => s.event === 'client_payment_due'),
    { status: start.status, wallet: start.json.wallet, prices: start.json.prices, settings: start.json.settings },
  )
  // WhatsApp is set aside for now (0188): a studio sees nothing of it.
  check(
    'messaging: while the platform has WhatsApp off, settings show no WhatsApp price, toggle or message',
    start.json.whatsapp_enabled === false && start.json.wallet?.whatsapp_enabled === false &&
      start.json.prices.every((p) => p.channel === 'email') && start.json.recent.every((m) => m.channel === 'email'),
    { whatsapp_enabled: start.json.whatsapp_enabled, prices: start.json.prices },
  )
  const platformSettings = await api('/platform/messaging/settings', { token: aToken })
  const platformFlip = await api('/platform/messaging/settings', { token: aToken, method: 'PUT', body: { whatsapp_enabled: true } })
  const platformCap = await api('/platform/messaging/email-cap', {
    token: aToken, method: 'POST', body: { company_id: '00000000-0000-4000-8000-000000000001', email_monthly_cap: 5 },
  })
  check(
    'messaging: a studio owner cannot read or flip the platform WhatsApp switch, or set an email limit',
    platformSettings.status === 403 && platformFlip.status === 403 && platformCap.status === 403,
    { read: platformSettings.status, flip: platformFlip.status, cap: platformCap.status },
  )
  check(
    'messaging: a studio sees its price, never the platform cost or markup',
    start.status === 200 && start.json.prices.every((p) => !('meta_cost_paise' in p) && !('markup_pct' in p)),
    start.json.prices,
  )

  const tooSmall = await api('/messaging/recharge-requests', { token: aToken, method: 'POST', body: { amount_paise: 500 } })
  const req = await api('/messaging/recharge-requests', { token: aToken, method: 'POST', body: { amount_paise: 100000, note: 'UPI done' } })
  const twice = await api('/messaging/recharge-requests', { token: aToken, method: 'POST', body: { amount_paise: 50000 } })
  const afterReq = await api('/messaging', { token: aToken })
  check(
    'messaging: the owner asks for a ₹1,000 recharge; it shows as pending, and a second one waits for the first',
    tooSmall.status === 422 && req.status === 201 && twice.status === 422 &&
      afterReq.json.requests?.some((r) => r.id === req.json.id && r.status === 'pending' && r.amount_paise === 100000),
    { tooSmall: tooSmall.status, req: req.json, twice: twice.json, requests: afterReq.json.requests },
  )

  const selfCredit = await api('/platform/messaging/credit', {
    token: aToken, method: 'POST', body: { company_id: '00000000-0000-4000-8000-000000000001', amount_paise: 100000, reference: 'x', request_id: req.json.id },
  })
  const wallets = await api('/platform/messaging/wallets', { token: aToken })
  const afterTry = await api('/messaging/wallet', { token: aToken })
  check(
    'messaging: a studio owner (not a platform admin) cannot credit a wallet or read the platform wallets',
    selfCredit.status === 403 && wallets.status === 403 && afterTry.json.balance_paise === 0,
    { selfCredit: selfCredit.status, wallets: wallets.status, balance: afterTry.json },
  )

  const toggle = await api('/messaging/settings', {
    token: aToken, method: 'PATCH', body: { events: [{ event: 'start_reminder', whatsapp: true, email: true }], low_balance_paise: 20000 },
  })
  const afterToggle = await api('/messaging', { token: aToken })
  const theirs = await api('/messaging', { token: bTok })
  const toggled = afterToggle.json.settings?.find((s) => s.event === 'start_reminder')
  check(
    'messaging: switching email on for start reminders saves (WhatsApp stays off), and does not touch another studio',
    toggle.status === 200 && toggled?.email === true && toggled?.whatsapp === false &&
      afterToggle.json.wallet.low_balance_paise === 20000 && afterToggle.json.wallet.low === true &&
      theirs.status === 200 && theirs.json.settings.every((s) => !s.whatsapp) && !theirs.json.requests.some((r) => r.id === req.json.id),
    { toggle: toggle.status, mine: afterToggle.json.settings, wallet: afterToggle.json.wallet, theirs: theirs.json.settings },
  )

  const waTest = await api('/messaging/test', { token: aToken, method: 'POST', body: { channel: 'whatsapp' } })
  const test = await api('/messaging/test', { token: aToken, method: 'POST', body: { channel: 'email' } })
  const afterTest = await api('/messaging', { token: aToken })
  check(
    'messaging: a WhatsApp test is refused while WhatsApp is off; with ₹0 an email still goes, free inside the allowance',
    waTest.status === 422 && test.status === 201 && test.json.status === 'queued' && afterTest.json.wallet.balance_paise === 0 &&
      afterTest.json.recent.some((m) => m.id === test.json.id && m.channel === 'email' && m.cost_paise === 0) &&
      afterTest.json.usage.email_free_used >= 1 && afterTest.json.usage.email_month_count >= 1,
    { wa: waTest.json, test: test.json, recent: afterTest.json.recent?.slice(0, 2), usage: afterTest.json.usage },
  )

  const ledger = await api('/messaging/ledger', { token: aToken })
  const worker = await fetch(`${API}/cron/messages`, { method: 'POST', headers: { 'x-cron-secret': 'wrong' } })
  check(
    'messaging: the ledger is empty until money moves, and the worker needs the cron secret',
    ledger.status === 200 && Array.isArray(ledger.json) && ledger.json.length === 0 && worker.status === 401,
    { ledger: ledger.json, worker: worker.status },
  )

  // A team member is not the owner: the wallet is not theirs to see.
  const mEmail = `msg-${rand()}@example.com`
  const inv = await api('/team/invitations', { token: aToken, method: 'POST', body: { name: 'Wallet Member', email: mEmail, role: 'employee' } })
  const invTok = /[?&]token=([^&]+)/.exec(inv.json.invite_link ?? '')?.[1] ?? ''
  const joined = await api('/auth/accept-invite', { method: 'POST', body: { token: invTok, password: 'Member12345!' } })
  const memberView = await api('/messaging', { token: joined.json.access_token })
  const memberReq = await api('/messaging/recharge-requests', { token: joined.json.access_token, method: 'POST', body: { amount_paise: 50000 } })
  check(
    'messaging: a team member cannot see the wallet or ask for a recharge',
    joined.status === 200 && memberView.status === 403 && memberReq.status === 403,
    { joined: joined.status, view: memberView.status, req: memberReq.status },
  )

  // Payment reminder to a client, by hand from the invoice (0188).
  const payClient = await api('/clients', { token: aToken, method: 'POST', body: { name: 'Reminder Client', email: `client-${rand()}@example.com` } })
  const noMailClient = await api('/clients', { token: aToken, method: 'POST', body: { name: 'No Mail Client' } })
  const invBody = (clientId) => ({
    client_id: clientId,
    place_of_supply: '27',
    intra_state: true,
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    discount: 0,
    discount_type: 'flat',
    status: 'sent',
    lines: [{ description: 'Wedding album', quantity: 1, rate: 12500, gst_rate: 0 }],
  })
  const payInv = await api('/billing/invoices', { token: aToken, method: 'POST', body: invBody(payClient.json.id) })
  const noMailInv = await api('/billing/invoices', { token: aToken, method: 'POST', body: invBody(noMailClient.json.id) })
  const quote = await api(`/billing/invoices/${payInv.json.id}/remind`, { token: aToken })
  const remind = await api(`/billing/invoices/${payInv.json.id}/remind`, { token: aToken, method: 'POST', body: {} })
  const again = await api(`/billing/invoices/${payInv.json.id}/remind`, { token: aToken, method: 'POST', body: {} })
  const quoteAfter = await api(`/billing/invoices/${payInv.json.id}/remind`, { token: aToken })
  check(
    'reminder: the owner sees it is free, sends a payment reminder, and a double click sends once',
    payInv.status === 201 && quote.status === 200 && quote.json.free_monthly === 100 && quote.json.last_sent_at === null &&
      remind.status === 201 && remind.json.status === 'queued' && remind.json.cost_paise === 0 && remind.json.free_allowance === true &&
      again.status === 200 && again.json.repeated === true && again.json.id === remind.json.id &&
      quoteAfter.json.last_sent_at !== null && quoteAfter.json.reminders_sent === 1,
    { inv: payInv.status, quote: quote.json, remind: remind.json, again: again.json, after: quoteAfter.json },
  )
  const memberRemind = await api(`/billing/invoices/${payInv.json.id}/remind`, { token: joined.json.access_token, method: 'POST', body: {} })
  const otherRemind = await api(`/billing/invoices/${payInv.json.id}/remind`, { token: bTok, method: 'POST', body: {} })
  const otherQuote = await api(`/billing/invoices/${payInv.json.id}/remind`, { token: bTok })
  const noMail = await api(`/billing/invoices/${noMailInv.json.id}/remind`, { token: aToken, method: 'POST', body: {} })
  check(
    'reminder: an employee without billing edit gets 403, another studio 404, and a client with no email is said plainly',
    memberRemind.status === 403 && otherRemind.status === 404 && otherQuote.status === 404 &&
      noMail.status === 200 && noMail.json.status === 'no_email',
    { member: memberRemind.status, other: otherRemind.status, otherQuote: otherQuote.status, noMail: noMail.json },
  )

  const cancel = await api(`/messaging/recharge-requests/${req.json.id}/cancel`, { token: aToken, method: 'POST', body: {} })
  const theirCancel = await api(`/messaging/recharge-requests/${req.json.id}/cancel`, { token: bTok, method: 'POST', body: {} })
  check(
    'messaging: the owner can take back a pending request; another studio cannot',
    theirCancel.status === 422 && cancel.status === 204,
    { cancel: cancel.status, theirs: theirCancel.status },
  )

  // The WhatsApp webhook handshake refuses a wrong token.
  const hook = await fetch(`${API}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123`)
  check('messaging: the WhatsApp webhook handshake refuses a wrong token', hook.status === 403, { status: hook.status })
}

// ── Reports (0189): the owner reads all four tabs; an employee none ──
{
  const range = 'from=2026-04-01&to=2027-03-31'
  const tabs = ['sales', 'money', 'delivery', 'team']
  const owner = await Promise.all(tabs.map((t) => api(`/reports/${t}?${range}`, { token: aToken })))
  check(
    'reports: the owner opens Sales, Money, Delivery and Team (200)',
    owner.every((r) => r.status === 200) &&
      typeof owner[0].json.enquiries === 'number' && typeof owner[1].json.billed === 'number' &&
      typeof owner[2].json.delivered === 'number' && Array.isArray(owner[3].json.members),
    owner.map((r) => r.status),
  )
  const bad = await api('/reports/sales?from=2026-06-30&to=2026-06-01', { token: aToken })
  const none = await api('/reports/sales', { token: aToken })
  check('reports: a backwards or missing period is refused (422)', bad.status === 422 && none.status === 422, { bad: bad.status, none: none.status })

  // A plain employee has no Reports module, no money module, no Team Directory.
  const empEmail = `reports-emp-${rand()}@example.com`
  const inv = await api('/team/invitations', { token: aToken, method: 'POST', body: { name: 'Report Employee', email: empEmail, role: 'employee' } })
  const joinedEmp = await api('/auth/accept-invite', {
    method: 'POST',
    body: { token: /[?&]token=([^&]+)/.exec(inv.json.invite_link ?? '')?.[1] ?? '', password: 'Employee12345!' },
  })
  const empToken = joinedEmp.json.access_token
  const emp = await Promise.all(tabs.map((t) => api(`/reports/${t}?${range}`, { token: empToken })))
  check(
    'reports: an employee without access gets 403 on every tab',
    joinedEmp.status === 200 && emp.every((r) => r.status === 403),
    { joined: joinedEmp.status, tabs: emp.map((r) => r.status) },
  )
  // Setup (0191): only the owner or an admin may close a studio's setup.
  const empSetup = await api('/settings/company/setup', { token: empToken, method: 'PATCH', body: { action: 'skip' } })
  check('setup: an employee cannot close setup (403)', empSetup.status === 403, { status: empSetup.status })
  const anonReport = await api(`/reports/sales?${range}`)
  check('reports: no token, no report (401)', anonReport.status === 401, { status: anonReport.status })
}

// ── Project quotation link (0190): carries the project's terms, display
// options and shoot schedule, and follows the "Show to client" switch ──
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Quote Co ${rand()}`, phone: randPhone(), email: 'quote@example.com' } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Quote project ${rand()}`, client_id: client.json.id, package_cost: 150000 } })
  const pid = project.json.id
  const tokenOf = (url) => new URL(url, 'http://x').searchParams.get('token') ?? ''
  const schedule = [{ title: 'Haldi', date: '2026-12-01', time: '10:30', city: 'Jaipur', services: [{ name: 'Drone', quantity: 2 }] }]

  const issued = await api('/documents/quotations', {
    token: aToken,
    method: 'POST',
    body: {
      project_id: pid,
      terms_text: 'Clause A\nClause B',
      display_prefs: { showTerms: true, showBillTo: false },
      shoots_schedule: schedule,
    },
  })
  const tok = tokenOf(issued.json.link ?? '')
  const pub = await api(`/public/quotation/${tok}`)
  check(
    'quotation: the link carries the terms, display options and shoot schedule',
    issued.status === 201 && /^[0-9a-f-]{36}$/.test(issued.json.id ?? '') && pub.status === 200 &&
      pub.json.show_quotation === true && pub.json.terms_text === 'Clause A\nClause B' &&
      pub.json.display_prefs?.showBillTo === false && pub.json.shoots_schedule?.[0]?.city === 'Jaipur' &&
      pub.json.shoots_schedule?.[0]?.services?.[0]?.quantity === 2 && pub.json.snapshot?.total === 150000,
    { issued: issued.json, pub: pub.json },
  )
  const shown = await api(`/projects/${pid}`, { token: aToken })
  check('quotation: sending a link switches "Show to client" on', shown.json.show_quotation === true, shown.json.show_quotation)
  check(
    'journey: the project knows its quotation went out (the first step is ticked)',
    project.json.id && typeof shown.json.quotation_issued_at === 'string' && !Number.isNaN(Date.parse(shown.json.quotation_issued_at)),
    shown.json.quotation_issued_at,
  )

  const hide = await api(`/projects/${pid}/quotation`, { token: aToken, method: 'PATCH', body: { show_quotation: false } })
  const hidden = await api(`/public/quotation/${tok}`)
  const hiddenAccept = await api(`/public/quotation/${tok}/respond`, { method: 'POST', body: { accept: true, name: 'Priya Sharma' } })
  check(
    'quotation: switching "Show to client" off hides a link already sent, and it cannot be accepted',
    hide.status < 300 && hidden.status === 200 && hidden.json.show_quotation === false &&
      hidden.json.client_name === null && hidden.json.terms_text === null && hidden.json.snapshot?.total === 0 &&
      hiddenAccept.status === 409,
    { hide: hide.status, hidden: hidden.json, accept: hiddenAccept.status },
  )

  await api(`/projects/${pid}/quotation`, { token: aToken, method: 'PATCH', body: { show_quotation: true, quotation_terms: 'Project clause' } })
  const accepted = await api(`/public/quotation/${tok}/respond`, { method: 'POST', body: { accept: true, name: 'Priya Sharma' } })
  const after = await api(`/projects/${pid}`, { token: aToken })
  check(
    'quotation: shown again, the client can accept and the studio sees who did',
    accepted.status === 200 && after.json.quotation_accepted_by === 'Priya Sharma' && !!after.json.quotation_accepted_at,
    { accepted: accepted.status, after: { at: after.json.quotation_accepted_at, by: after.json.quotation_accepted_by } },
  )

  const bell = await api('/notifications?type=quotation_accepted', { token: aToken })
  const rang = (bell.json.items ?? bell.json ?? []).filter?.((n) => n.entity_id === pid) ?? []
  check(
    'quotation: the owner is told when the client accepts (0231)',
    bell.status === 200 && rang.length === 1 && /accepted the quotation/.test(rang[0]?.title ?? ''),
    { status: bell.status, n: rang.length, title: rang[0]?.title },
  )

  // A link sent without terms or display options shows the project's own.
  const bare = await api('/documents/quotations', { token: aToken, method: 'POST', body: { project_id: pid } })
  const barePub = await api(`/public/quotation/${tokenOf(bare.json.link ?? '')}`)
  check(
    'quotation: a link sent without terms shows the project terms',
    bare.status === 201 && barePub.status === 200 && barePub.json.terms_text === 'Project clause',
    { bare: bare.status, terms: barePub.json.terms_text },
  )

  // What the client did (0235): the client's opens are counted, a refresh is
  // not a second visit, the studio opening its own link is not counted, and
  // staff cannot read it.
  const mineLink = await api('/documents/quotations', { token: aToken, method: 'POST', body: { project_id: pid } })
  await api(`/public/quotation/${tokenOf(mineLink.json.link ?? '')}`, { token: aToken })
  const activity = await api(`/projects/${pid}/client-activity`, { token: aToken })
  const firstQuote = activity.json.views?.find((v) => v.subject_id === issued.json.id)
  const ownOpen = activity.json.views?.find((v) => v.subject_id === mineLink.json.id)
  const staffEmail = `ca-${rand()}@madeup.test`
  await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Curious Staff', phone: randPhone(), email: staffEmail, password: 'Ca-pass-1234', create_login: true } })
  const staffTok = (await api('/auth/login', { ip: `203.0.113.${1 + Math.floor(Math.random() * 250)}`, method: 'POST', body: { email: staffEmail, password: 'Ca-pass-1234' } })).json.access_token
  const staffRead = await api(`/projects/${pid}/client-activity`, { token: staffTok })
  check(
    'client activity: the client opening the quotation shows once per visit, the studio opening it does not, staff get 403',
    activity.status === 200 && firstQuote?.views === 1 && !ownOpen && activity.json.accepted_by === 'Priya Sharma' &&
      staffRead.status === 403,
    { ids: [issued.json.id, mineLink.json.id], views: activity.json.views?.map((v) => [v.subject_id, v.views]), accepted: activity.json.accepted_by, staff: staffRead.status },
  )

  // The studio's own subject and note (no mail provider here, so it says so).
  const mailed = await api(`/documents/quotations/${issued.json.id}/send-email`, {
    token: aToken,
    method: 'POST',
    body: { to_email: 'quote@example.com', subject: 'Your quotation', message: 'Hello Priya,\n<b>Please</b> have a look.' },
  })
  const tooLong = await api(`/documents/quotations/${issued.json.id}/send-email`, { token: aToken, method: 'POST', body: { subject: 'x'.repeat(201) } })
  const theirs = await api(`/documents/quotations/${issued.json.id}/send-email`, { token: newPw.json.access_token, method: 'POST', body: {} })
  check(
    'quotation: the email takes the studio’s subject and note; another studio cannot send it',
    mailed.status === 200 && ['provider_missing', 'sent', 'failed'].includes(mailed.json.status) && tooLong.status === 422 && theirs.status === 404,
    { mailed: mailed.json, tooLong: tooLong.status, theirs: theirs.status },
  )
}

// ── Task delegation (0192): assign → told → submit → review → done ──
{
  const email = `tasks-emp-${rand()}@example.com`
  const inv = await api('/team/invitations', { token: aToken, method: 'POST', body: { name: 'Task Taker', email, role: 'employee' } })
  const joined = await api('/auth/accept-invite', {
    method: 'POST',
    body: { token: /[?&]token=([^&]+)/.exec(inv.json.invite_link ?? '')?.[1] ?? '', password: 'Employee12345!' },
  })
  const tToken = joined.json.access_token
  const tUid = (await api('/auth/session', { token: tToken })).json.user_id

  const made = await api('/tasks', {
    token: aToken,
    method: 'POST',
    body: { title: `Edit teaser ${rand()}`, priority: 'high', tag: 'Editing', assignees: [tUid] },
  })
  const told = await api(`/notifications?type=task.assigned`, { token: tToken })
  const note = Array.isArray(told.json) ? told.json.find((n) => n.entity_id === made.json.id) : undefined
  const ownerTold = await api(`/notifications?type=task.assigned`, { token: aToken })
  check(
    'tasks: assigning tells the assignee (task.assigned, opens the task), not the assigner',
    made.status === 201 && note?.deep_link === `/tasks?open=${made.json.id}` &&
      Array.isArray(ownerTold.json) && !ownerTold.json.some((n) => n.entity_id === made.json.id),
    { made: made.status, told: told.json },
  )

  const cantClose = await api(`/tasks/my/${made.json.id}/status`, { token: tToken, method: 'PATCH', body: { status: 'completed' } })
  const badLink = await api(`/tasks/${made.json.id}/submit`, { token: tToken, method: 'POST', body: { link: 'javascript:alert(1)' } })
  const submitted = await api(`/tasks/${made.json.id}/submit`, {
    token: tToken,
    method: 'POST',
    body: { link: 'https://drive.example.com/teaser-v1', note: 'First cut' },
  })
  const afterSubmit = await api(`/tasks/${made.json.id}`, { token: aToken })
  const ownerSubmitted = await api(`/notifications?type=task.submitted`, { token: aToken })
  check(
    'tasks: the assignee cannot mark it done, but submitting a link moves it to Review and tells the owner',
    cantClose.status === 422 && badLink.status === 422 && submitted.status === 201 &&
      afterSubmit.json.status === 'review' && afterSubmit.json.tag === 'Editing' &&
      afterSubmit.json.latest_submission?.link === 'https://drive.example.com/teaser-v1' &&
      Array.isArray(ownerSubmitted.json) && ownerSubmitted.json.some((n) => n.entity_id === made.json.id),
    { cantClose: cantClose.status, badLink: badLink.status, submitted: submitted.status, task: afterSubmit.json },
  )

  const selfReview = await api(`/tasks/${made.json.id}/review`, { token: tToken, method: 'POST', body: { approve: true } })
  const noNote = await api(`/tasks/${made.json.id}/review`, { token: aToken, method: 'POST', body: { approve: false } })
  const approved = await api(`/tasks/${made.json.id}/review`, { token: aToken, method: 'POST', body: { approve: true } })
  const afterApprove = await api(`/tasks/${made.json.id}`, { token: aToken })
  const activity = await api(`/tasks/${made.json.id}/activity`, { token: tToken })
  check(
    'tasks: only the person who gave it reviews; approving completes it, and the history says so',
    selfReview.status === 403 && noNote.status === 422 && approved.status === 204 &&
      afterApprove.json.status === 'completed' &&
      Array.isArray(activity.json) && activity.json.some((a) => a.action === 'approved the work') &&
      activity.json.some((a) => a.action === 'submitted work'),
    { selfReview: selfReview.status, noNote: noNote.status, approved: approved.status, status: afterApprove.json.status, activity: activity.json },
  )

  // Sent back: in progress again, with the note.
  const second = await api('/tasks', { token: aToken, method: 'POST', body: { title: `Album ${rand()}`, assignees: [tUid] } })
  await api(`/tasks/${second.json.id}/submit`, { token: tToken, method: 'POST', body: { link: 'https://drive.example.com/album' } })
  const sentBack = await api(`/tasks/${second.json.id}/review`, { token: aToken, method: 'POST', body: { approve: false, note: 'Fix page 3' } })
  const afterBack = await api(`/tasks/${second.json.id}`, { token: tToken })
  const blocked = await api(`/tasks/${second.json.id}/block`, { token: tToken, method: 'POST', body: { reason: 'Waiting for client photos' } })
  const afterBlock = await api(`/tasks/${second.json.id}`, { token: tToken })
  check(
    'tasks: sending back returns it to In progress; the assignee can mark it Blocked with a reason',
    sentBack.status === 204 && afterBack.json.status === 'in_progress' &&
      blocked.status === 204 && afterBlock.json.status === 'blocked' && afterBlock.json.blocked_reason === 'Waiting for client photos',
    { sentBack: sentBack.status, back: afterBack.json.status, blocked: blocked.status, afterBlock: afterBlock.json },
  )

  // An employee adds a task for themselves, but cannot give one to someone else.
  const own = await api('/tasks', { token: tToken, method: 'POST', body: { title: `Clean lenses ${rand()}`, tag: 'Office' } })
  const mine = await api('/tasks/my', { token: tToken })
  const ownerUid = (await api('/auth/session', { token: aToken })).json.user_id
  const delegate = await api('/tasks', { token: tToken, method: 'POST', body: { title: 'Not mine to give', assignees: [ownerUid] } })
  const overdue = await api('/tasks/my/overdue?today=2099-01-01', { token: tToken })
  check(
    'tasks: an employee adds a task for themselves, may not assign others, and sees their overdue count',
    own.status === 201 && Array.isArray(mine.json) &&
      mine.json.some((t) => t.id === own.json.id && t.tag === 'Office' && t.assignee_ids.includes(tUid)) &&
      delegate.status === 403 && overdue.status === 200 && typeof overdue.json.count === 'number',
    { own: own.status, delegate: delegate.status, overdue: overdue.json },
  )

  // Studio B cannot see A's task or its history.
  const bTask = await api(`/tasks/${made.json.id}`, { token: newPw.json.access_token })
  const bActivity = await api(`/tasks/${made.json.id}/activity`, { token: newPw.json.access_token })
  check(
    "tasks: another studio cannot open A's task or read its history",
    bTask.status === 404 && Array.isArray(bActivity.json) && bActivity.json.length === 0,
    { task: bTask.status, activity: bActivity.json },
  )
}

// ── Onboarding emails (0194) ─────────────────────────────────────────────
{
  const { createHmac } = await import('node:crypto')
  const dry = await fetch(`${API}/cron/reminders?dry=1`, {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? 'ci-cron' },
  })
  const dryJson = await dry.json().catch(() => ({}))
  check(
    'onboarding emails: the hourly cron reports how many nudges are due',
    dry.status === 200 && typeof dryJson.onboarding_emails?.due === 'number' && dryJson.onboarding_emails?.sent === 0,
    { status: dry.status, onboarding: dryJson.onboarding_emails },
  )

  // Studio A's own link; stopping its setup emails touches nothing else.
  const companyId = (await api('/auth/session', { token: aToken })).json.company_id
  const sign = (id) =>
    createHmac('sha256', process.env.JWT_SECRET ?? 'ci-test-secret').update(`onboarding-stop:${id}`).digest('hex').slice(0, 40)
  const forged = await api('/public/onboarding-emails/stop', { method: 'POST', body: { c: companyId, t: 'f'.repeat(40) } })
  const other = await api('/public/onboarding-emails/stop', {
    method: 'POST',
    body: { c: '00000000-0000-4000-8000-000000000001', t: sign(companyId) },
  })
  const stopped = await api('/public/onboarding-emails/stop', { method: 'POST', body: { c: companyId, t: sign(companyId) } })
  check(
    'onboarding emails: the stop link works only with its own signature, for its own studio',
    forged.status === 400 && other.status === 400 && stopped.status === 200 && stopped.json.ok === true,
    { forged: forged.status, other: other.status, stopped: stopped.status },
  )
}

// ── Enquiry forms (0195): a QR per vendor, leads credited to it ──
{
  const made = await api('/enquiry-forms', { token: aToken, method: 'POST', body: { name: 'Riya Boutique', kind: 'Boutique', phone: '9876500000' } })
  check('enquiry forms: a studio makes one, with a short code and a public link', made.status === 201 && /^[a-z2-9]{7}$/.test(made.json.code) && made.json.form_url.endsWith(`/enquire/${made.json.code}`), { status: made.status, body: made.json })
  const f = made.json

  const open = await api(`/public/enquiry/${f.code}`)
  check('enquiry forms: the public form names the studio and the vendor', open.status === 200 && open.json.form_name === 'Riya Boutique' && open.json.is_open === true, open.json)

  const phone = `9${String(Date.now()).slice(-9)}`
  const sent = await api(`/public/enquiry/${f.code}`, { method: 'POST', body: { name: 'Neha Sharma', phone, event_type: 'Wedding', event_date: '2027-02-14', city: 'Jaipur' } })
  const again = await api(`/public/enquiry/${f.code}`, { method: 'POST', body: { name: 'Neha S', phone } })
  const bot = await api(`/public/enquiry/${f.code}`, { method: 'POST', body: { name: 'Bot', phone: '9000000009', website: 'http://spam' } })
  const leads = await api(`/enquiry-forms/${f.id}/leads`, { token: aToken })
  check(
    'enquiry forms: a submission is one lead credited to the QR; a repeat number and a bot add nothing',
    sent.status === 200 && again.status === 200 && bot.status === 200 && leads.status === 200 && leads.json.length === 1 && leads.json[0].event_type === 'Wedding',
    { sent: sent.status, leads: leads.json },
  )
  const allLeads = await api('/crm/leads?source=enquiry', { token: aToken })
  const leadRow = (Array.isArray(allLeads.json) ? allLeads.json : allLeads.json?.items ?? []).find((l) => l.id === leads.json[0]?.id)
  check('enquiry forms: the lead says which QR it came from', allLeads.status === 200 && leadRow?.source === 'enquiry' && leadRow?.source_label === 'Riya Boutique', { status: allLeads.status, lead: leadRow })

  const listed = await api('/enquiry-forms', { token: aToken })
  const row = listed.json.find?.((x) => x.id === f.id)
  check('enquiry forms: the list counts the scan and the enquiry', row?.scans === 1 && row?.enquiries === 1 && row?.page_url === null, row)

  const on = await api(`/enquiry-forms/${f.id}/page`, { token: aToken, method: 'POST', body: { on: true } })
  const token = on.json.page_url?.split('/enquiry-view/')[1]
  const view = await api(`/public/enquiry-view/${token}`)
  check(
    "enquiry forms: the vendor's page lists the lead with the phone masked",
    on.status === 200 && view.status === 200 && view.json.enquiries === 1 && view.json.leads[0].phone === `${phone.slice(0, 2)}xxxxx${phone.slice(-3)}` && view.json.leads[0].status === 'New',
    { on: on.status, view: view.json },
  )
  await api(`/enquiry-forms/${f.id}`, { token: aToken, method: 'PATCH', body: { show_phone: true } })
  const full = await api(`/public/enquiry-view/${token}`)
  check("enquiry forms: 'show full numbers' shows them", full.json.leads?.[0]?.phone === phone, full.json.leads?.[0])

  // B's first session died with its password reset above; this is the live one.
  const bLive = reset.json.access_token
  const other = await api(`/enquiry-forms/${f.id}`, { token: bLive })
  const otherEdit = await api(`/enquiry-forms/${f.id}/page`, { token: bLive, method: 'POST', body: { on: false } })
  check('enquiry forms: another studio cannot see or change it', other.status === 404 && otherEdit.status === 404, { get: other.status, edit: otherEdit.status })

  await api(`/enquiry-forms/${f.id}/page`, { token: aToken, method: 'POST', body: { on: false } })
  const stopped = await api(`/public/enquiry-view/${token}`)
  await api(`/enquiry-forms/${f.id}`, { token: aToken, method: 'PATCH', body: { is_active: false } })
  const closed = await api(`/public/enquiry/${f.code}`, { method: 'POST', body: { name: 'Late', phone: '9000000008' } })
  const closedView = await api(`/public/enquiry/${f.code}`)
  check(
    'enquiry forms: a stopped page and a switched-off form refuse',
    stopped.status === 404 && closed.status === 404 && closedView.json.is_open === false,
    { stopped: stopped.status, closed: closed.status, view: closedView.json },
  )
}

// ── 0198: overdue alerts and the morning email ───────────────────
{
  const dry = await fetch(`${API}/cron/reminders?dry=1`, {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? 'ci-cron' },
  })
  const j = await dry.json().catch(() => ({}))
  check(
    'cron: the dry run reports overdue invoices and morning emails',
    dry.status === 200 && typeof j.invoice_overdue?.due === 'number' && typeof j.morning_emails?.due === 'number' && j.morning_emails?.sent === 0,
    { status: dry.status, overdue: j.invoice_overdue, morning: j.morning_emails },
  )

  const setting = await api('/settings/morning-email', { token: aToken })
  const off = await api('/settings/morning-email', { token: aToken, method: 'PUT', body: { on: false } })
  const after = await api('/settings/morning-email', { token: aToken })
  await api('/settings/morning-email', { token: aToken, method: 'PUT', body: { on: true } })
  check(
    'morning email: an owner sees the switch and can turn it off and on',
    setting.status === 200 && setting.json.on === true && setting.json.applies === true && off.status === 200 && after.json.on === false,
    { setting: setting.json, after: after.json },
  )

  const me = (await api('/auth/session', { token: aToken })).json.user_id
  const { createHmac } = await import('node:crypto')
  const sign = (id) => createHmac('sha256', process.env.JWT_SECRET ?? 'ci-test-secret').update(`morning-stop:${id}`).digest('hex').slice(0, 40)
  const forged = await api('/public/morning-email/stop', { method: 'POST', body: { u: me, t: 'f'.repeat(40) } })
  const wrongUser = await api('/public/morning-email/stop', { method: 'POST', body: { u: '00000000-0000-4000-8000-000000000001', t: sign(me) } })
  const stopped = await api('/public/morning-email/stop', { method: 'POST', body: { u: me, t: sign(me) } })
  const nowOff = await api('/settings/morning-email', { token: aToken })
  check(
    'morning email: the stop link works only with its own signature',
    forged.status === 400 && wrongUser.status === 400 && stopped.status === 200 && nowOff.json.on === false,
    { forged: forged.status, wrongUser: wrongUser.status, stopped: stopped.status },
  )
}

// ── 0201: call outcomes and the call queue ─────────────────────
{
  const me = (await api('/auth/session', { token: aToken })).json.user_id
  const made = await api('/crm/leads', { token: aToken, method: 'POST', body: { name: 'Queue Test', phone: `9${String(Date.now()).slice(-9)}`, assigned_to: me } })
  const id = made.json.id ?? made.json.lead?.id
  const q1 = await api('/crm/queue', { token: aToken })
  const row = q1.json.items?.find?.((r) => r.id === id)
  check('calls: a new lead nobody has rung is in my queue, with a reason', q1.status === 200 && row?.reason === 'New enquiry, not called yet', { status: q1.status, row, made: made.status })

  for (const outcome of ['no_answer', 'busy', 'switched_off']) {
    await api('/crm/activities', { token: aToken, method: 'POST', body: { lead_id: id, type: 'call', direction: 'out', outcome } })
  }
  const leads = await api('/crm/leads?include_archived=true', { token: aToken })
  const list = Array.isArray(leads.json) ? leads.json : leads.json?.items ?? []
  const after = list.find((l) => l.id === id)
  check('calls: three misses in a row make the lead unreachable', after?.contacted_status === 'unreachable', { contacted: after?.contacted_status })

  const everyone = await api('/crm/queue?scope=all', { token: aToken })
  const bad = await api('/crm/queue?scope=nobody', { token: aToken })
  check('calls: owners can see everyone\'s queue; a bad scope is refused', everyone.status === 200 && everyone.json.scope === 'all' && bad.status === 422, { all: everyone.json.scope, bad: bad.status })
}

// ── 0202: sequences, Send now, feature switches, branding ────────
{
  const me = (await api('/auth/session', { token: aToken })).json.user_id
  const starters = await api('/crm/sequences/starters', { token: aToken, method: 'POST' })
  const again = await api('/crm/sequences/starters', { token: aToken, method: 'POST' })
  const list = await api('/crm/sequences', { token: aToken })
  const names = (list.json ?? []).map?.((x) => x.name) ?? []
  check(
    'sequences: the ready-made ones are added once',
    starters.json.added === 3 && again.json.added === 0 && ['New enquiry', 'Quotation sent', 'After the shoot'].every((n) => names.includes(n)),
    { first: starters.json, again: again.json, names },
  )

  const noSubject = await api('/crm/sequences', { token: aToken, method: 'POST', body: { name: 'Bad one', steps: [{ day_offset: 0, channel: 'email', body: 'Hi' }] } })
  check('sequences: an email step without a subject is refused', noSubject.status === 422, { status: noSubject.status })

  const made = await api('/crm/sequences', {
    token: aToken,
    method: 'POST',
    body: { name: `Live ${rand()}`, auto_start: true, source_filter: 'referral', steps: [{ day_offset: 0, channel: 'whatsapp', body: 'Hi {{first_name}}' }] },
  })
  const lead = await api('/crm/leads', { token: aToken, method: 'POST', body: { name: 'Seq Person', phone: `9${String(Date.now()).slice(-9)}`, source: 'referral', assigned_to: me } })
  const leadId = lead.json.id ?? lead.json.lead?.id
  const on = await api(`/crm/leads/${leadId}/sequence`, { token: aToken })
  check(
    'sequences: a new lead from the right source starts the automatic one',
    made.status === 201 && on.status === 200 && on.json.current?.cadence_id === made.json.id && on.json.current?.next_channel === 'whatsapp',
    { made: made.status, current: on.json.current },
  )

  await api('/crm/activities', { token: aToken, method: 'POST', body: { lead_id: leadId, type: 'whatsapp', direction: 'in', body: 'Yes please' } })
  const replied = await api(`/crm/leads/${leadId}/sequence`, { token: aToken })
  check('sequences: a reply stops it', replied.json.current?.stopped_reason === 'replied', replied.json.current)

  const sends = await api('/crm/sequences/sends', { token: aToken })
  const bLive = reset.json.access_token
  const bSends = await api('/crm/sequences/sends', { token: bLive })
  const bLead = await api(`/crm/leads/${leadId}/sequence`, { token: bLive })
  check(
    'sequences: Send now loads, and another studio sees none of it',
    sends.status === 200 && Array.isArray(sends.json.items) && bSends.status === 200 && !bSends.json.items.some((x) => x.lead_id === leadId) && bLead.json.current === null,
    { mine: sends.status, theirs: bSends.json.items?.length, bLead: bLead.json.current },
  )

  const features = await api('/features', { token: aToken })
  const locked = await api('/features/branding', { token: aToken, method: 'PUT', body: { from_name: 'Asha Studio' } })
  const studio = (await api('/auth/session', { token: aToken })).json.company_id
  const selfGrant = await api(`/platform/studios/${studio}/features`, { token: aToken, method: 'PUT', body: { key: 'white_label', enabled: true } })
  check(
    'features: a studio reads its switches but cannot turn one on, and branding stays locked without it',
    features.status === 200 && Array.isArray(features.json.keys) && locked.status === 403 && selfGrant.status === 403,
    { features: features.json, locked: locked.status, selfGrant: selfGrant.status },
  )
}

// ── 0203: the studio's own WhatsApp number ───────────────────────
{
  const status = await api('/whatsapp', { token: aToken })
  check(
    'whatsapp: the status reads, with no connection and no token in it',
    status.status === 200 && typeof status.json.entitled === 'boolean' && status.json.connection === null && !JSON.stringify(status.json).includes('access_token'),
    status.json,
  )
  const locked = await api('/whatsapp/connect', {
    token: aToken,
    method: 'POST',
    body: { phone_number_id: '1098765432', waba_id: '2233445566', access_token: 'EAAG-not-a-real-token-0000000000' },
  })
  check('whatsapp: connecting needs the higher plan', locked.status === 403, { status: locked.status })
  const templates = await api('/whatsapp/templates', { token: aToken })
  check('whatsapp: templates list is empty before connecting', templates.status === 200 && Array.isArray(templates.json.items) && templates.json.items.length === 0, templates.json)
  const unknown = await fetch(`${API}/webhooks/whatsapp/studio/not-a-real-key-${rand()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const handshake = await fetch(`${API}/webhooks/whatsapp/studio/not-a-real-key?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y`)
  check('whatsapp: an unknown studio address is refused', unknown.status === 404 && handshake.status === 403, { post: unknown.status, get: handshake.status })
}

// ── 0212: several functions per lead, labels on add, functions become shoots ──
{
  const tag = await api('/crm/tags', { token: aToken, method: 'POST', body: { name: `VIP ${rand()}`, color: 'violet' } })
  const made = await api('/crm/leads', {
    token: aToken,
    method: 'POST',
    body: {
      name: 'Two Functions',
      phone: `9${String(Date.now()).slice(-9)}`,
      tag_ids: [tag.json.id],
      functions: [
        { event_type: 'Wedding', event_date: '2027-02-14', location: 'Jaipur' },
        { event_type: 'Haldi', event_date: '2027-02-12' },
      ],
    },
  })
  const lead = made.json.lead
  check(
    'functions: a lead keeps every function, earliest first, and its label',
    made.status === 201 &&
      lead?.functions?.map?.((f) => f.event_type).join(',') === 'Haldi,Wedding' &&
      lead?.event_type === 'Haldi' && lead?.event_date === '2027-02-12' &&
      lead?.tags?.some?.((t) => t.id === tag.json.id),
    { status: made.status, functions: lead?.functions, event: lead?.event_type, tags: lead?.tags },
  )

  const patched = await api(`/crm/leads/${lead?.id}`, {
    token: aToken,
    method: 'PATCH',
    body: { functions: [{ event_type: 'Reception', event_date: '2027-02-15' }, { event_type: 'Haldi', event_date: '2027-02-12' }, { event_type: 'Wedding', event_date: '2027-02-14' }] },
  })
  const all = await api('/crm/leads?include_archived=true', { token: aToken })
  const after = (Array.isArray(all.json) ? all.json : all.json?.items ?? []).find((l) => l.id === lead?.id)
  check(
    'functions: an edit replaces the list and the lead still shows the first',
    patched.status === 204 && after?.functions?.length === 3 && after?.event_type === 'Haldi',
    { status: patched.status, functions: after?.functions },
  )

  const conv = await api(`/crm/leads/${lead?.id}/convert`, { token: aToken, method: 'POST', body: { project: { name: 'Two Functions wedding' } } })
  const shoots = conv.json.project_id ? (await api(`/shoots?project_id=${conv.json.project_id}`, { token: aToken })).json ?? [] : []
  check(
    'functions: converting turns each function into a shoot on the new project',
    conv.status === 201 && shoots.map?.((x) => x.name).sort().join(',') === 'Haldi,Reception,Wedding',
    { status: conv.status, shoots: shoots.map?.((x) => [x.name, x.shoot_date]) },
  )
  const leadsNow = await api('/crm/leads?include_archived=true', { token: aToken })
  const booked = (Array.isArray(leadsNow.json) ? leadsNow.json : leadsNow.json.items ?? []).find((l) => l.id === lead?.id)
  check(
    'leads: a booked lead carries its project\'s name, for "Booked — project X"',
    leadsNow.status === 200 && booked?.converted_project_id === conv.json.project_id && booked?.converted_project_name === 'Two Functions wedding',
    { status: leadsNow.status, name: booked?.converted_project_name },
  )

  const bList = await api('/crm/leads?include_archived=true', { token: reset.json.access_token })
  const leaked = (Array.isArray(bList.json) ? bList.json : bList.json?.items ?? []).some((l) => l.id === lead?.id)
  check('functions: another studio never sees them', !leaked)
}

// ── 0213: permanent erasure of leads ─────────────────────────────
{
  const phone = `9${String(Date.now()).slice(-9)}`
  const made = await api('/crm/leads', { token: aToken, method: 'POST', body: { name: 'Erase Me', phone, email: 'erase.me@example.com' } })
  const id = made.json.lead?.id
  const live = await api('/crm/leads/erase', { token: aToken, method: 'POST', body: { ids: [id] } })
  check('erase: a live lead is refused (409)', live.status === 409, { status: live.status })

  await api(`/crm/leads/${id}`, { token: aToken, method: 'PATCH', body: { is_archived: true } })
  const otherStudio = await api('/crm/leads/erase', { token: reset.json.access_token, method: 'POST', body: { ids: [id] } })
  check("erase: another studio cannot delete this studio's lead", otherStudio.status === 409, { status: otherStudio.status })

  const done = await api('/crm/leads/erase', { token: aToken, method: 'POST', body: { ids: [id] } })
  const all = await api('/crm/leads?include_archived=true', { token: aToken })
  const list = Array.isArray(all.json) ? all.json : all.json?.items ?? []
  check(
    'erase: an archived lead is deleted for good',
    done.status === 200 && done.json.erased === 1 && !list.some((l) => l.id === id),
    { status: done.status, body: done.json },
  )

  const nothing = await api('/crm/leads/erase', { token: aToken, method: 'POST', body: { ids: [] } })
  check('erase: an empty request is refused (422)', nothing.status === 422, { status: nothing.status })
}

// ── 0214: IPC Diamond members and outsiders ──────────────────────
{
  const plans = await api('/subscription/plans', { token: aToken })
  const keys = Array.isArray(plans.json) ? plans.json.map((p) => p.key) : []
  check('diamond: a new studio sees only the outsider plan', keys.length === 1 && keys[0] === 'studio_yearly', { keys })

  const status = await api('/subscription/status', { token: aToken })
  check('diamond: a new studio is an outsider', status.status === 200 && status.json.member_tier === 'outsider', status.json)

  // A 1x1 PNG, uploaded the way the verify card does.
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (ch) => ch.charCodeAt(0))
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'group.png')
  const up = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${aToken}` }, body: form })
  const file = await up.json().catch(() => ({}))
  const claim = await api('/subscription/diamond/claim', { token: aToken, method: 'POST', body: { file_id: file.id } })
  // No Anthropic key in CI: nothing can read the screenshot, so a person decides.
  check('diamond: a claim that cannot be read waits for the team', claim.status === 201 && claim.json.status === 'pending', { status: claim.status, body: claim.json })

  const after = await api('/subscription/status', { token: aToken })
  check('diamond: the studio sees its claim waiting', after.json.diamond_claim?.status === 'pending', after.json.diamond_claim)

  const bogus = await api('/subscription/diamond/claim', { token: aToken, method: 'POST', body: { file_id: '00000000-0000-4000-8000-000000000000' } })
  check('diamond: a file that is not the studio\'s image is refused (422)', bogus.status === 422, { status: bogus.status })

  const inbox = await api('/platform/diamond', { token: aToken })
  check('diamond: a studio cannot open the platform inbox', inbox.status === 403, { status: inbox.status })
}

// ── A project's own referral campaign (its Referrals tab) ──
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Refer Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Refer project ${rand()}`, client_id: client.json.id, package_cost: 90000 } })
  const pid = project.json.id
  const first = await api('/referrals/campaigns/for-project', { token: aToken, method: 'POST', body: { project_id: pid } })
  const again = await api('/referrals/campaigns/for-project', { token: aToken, method: 'POST', body: { project_id: pid } })
  check(
    'referrals: a project gets one campaign of its own, however often the tab is opened',
    first.status === 200 && again.status === 200 && first.json.id === again.json.id &&
      first.json.project_id === pid && first.json.client_id === client.json.id && !!first.json.slug,
    { first: first.json, again: again.status },
  )
  // B's first token has long expired by here; B's password was reset above.
  const bLogin = await api('/auth/login', { method: 'POST', body: { email: b.email, password: NEW_PW } })
  const bNow = bLogin.json.access_token ?? newPw.json.access_token
  const other = await api('/referrals/campaigns/for-project', { token: bNow, method: 'POST', body: { project_id: pid } })
  check('referrals: another studio cannot make a campaign on this project (404)', other.status === 404, { status: other.status, login: bLogin.status, err: bLogin.json.error })

  const saved = await api(`/referrals/${first.json.id}`, {
    token: aToken,
    method: 'PATCH',
    body: { name: first.json.name, reward_type: 'custom', reward_value: 0, reward_title: 'Free album', reward_description: 'A 20-page album' },
  })
  const listed = await api('/referrals/campaigns', { token: aToken })
  const mine = (listed.json.campaigns ?? []).find((x) => x.id === first.json.id)
  check(
    'referrals: the list shows the project and the reward title the tab saved',
    saved.status === 200 && mine?.project_id === pid && mine?.reward_title === 'Free album',
    mine,
  )
  // The Referrals page's own form sends no title: saving it keeps the tab's.
  await api(`/referrals/${first.json.id}`, {
    token: aToken,
    method: 'PATCH',
    body: { name: first.json.name, reward_type: 'custom', reward_value: 0, reward_description: 'A 20-page album' },
  })
  const kept = (await api('/referrals/campaigns', { token: aToken })).json.campaigns?.find((x) => x.id === first.json.id)
  check('referrals: saving without a title leaves the title alone', kept?.reward_title === 'Free album', kept?.reward_title)

  const sub = await api(`/public/referrals/submit?campaign_id=${first.json.id}`, {
    method: 'POST',
    body: { referrer_name: 'Pulkit', client_name: 'Friend Of Pulkit', client_phone: randPhone() },
  })
  const subs = await api(`/referrals/submissions?campaign_id=${first.json.id}`, { token: aToken })
  const got = (subs.json.items ?? []).find((x) => x.campaign_id === first.json.id)
  check('referrals: a friend sent through the link shows on the project', sub.status < 300 && !!got, { sub: sub.status, got })
  if (got) {
    const booked = await api(`/referrals/submissions/${got.id}/status`, { token: aToken, method: 'PATCH', body: { status: 'converted', reward_status: 'due' } })
    const given = await api(`/referrals/submissions/${got.id}/status`, { token: aToken, method: 'PATCH', body: { reward_status: 'given' } })
    const after = ((await api(`/referrals/submissions?campaign_id=${first.json.id}`, { token: aToken })).json.items ?? []).find((x) => x.id === got.id)
    check(
      'referrals: booked, then reward given -- the status stays booked, the reward is marked given',
      booked.status === 200 && given.status === 200 && after?.status === 'converted' && after?.reward_status === 'given',
      after,
    )
    const bad = await api(`/referrals/submissions/${got.id}/status`, { token: aToken, method: 'PATCH', body: {} })
    check('referrals: an empty status change is refused (422)', bad.status === 422, { status: bad.status })
  }
}

// ── One-time notes and "last seen" (0216) ──
{
  const empty = await api('/auth/hints', { token: aToken })
  check('hints: a person starts with no notes seen', empty.status === 200 && empty.json.assign_note === undefined, empty.json)
  const set1 = await api('/auth/hints/assign_note', { token: aToken, method: 'PUT', body: { value: { shown: 1, closed: false } } })
  const after = await api('/auth/hints', { token: aToken })
  check(
    'hints: showing the assign note counts it, on the person\'s own row',
    set1.status === 200 && after.json.assign_note?.shown === 1 && after.json.assign_note?.closed === false,
    after.json,
  )
  const closed = await api('/auth/hints/assign_note', { token: aToken, method: 'PUT', body: { value: { shown: 1, closed: true } } })
  check('hints: "don\'t show again" is kept', closed.status === 200 && closed.json.assign_note?.closed === true, closed.json)
  const unknown = await api('/auth/hints/anything_else', { token: aToken, method: 'PUT', body: { value: { shown: 1 } } })
  const bad = await api('/auth/hints/assign_note', { token: aToken, method: 'PUT', body: { value: { shown: -3 } } })
  const anon = await api('/auth/hints')
  check('hints: an unknown note is 404, a bad value 422, no session 401', unknown.status === 404 && bad.status === 422 && anon.status === 401, {
    unknown: unknown.status,
    bad: bad.status,
    anon: anon.status,
  })

  await api('/activity/track', { token: aToken, method: 'POST', body: { route: '/dashboard', module: 'dashboard' } })
  const me = (await api('/auth/session', { token: aToken })).json.user_id
  const team = await api('/team/members', { token: aToken })
  const row = (Array.isArray(team.json) ? team.json : []).find((m) => m.user_id === me)
  check(
    'last seen: the team list says when someone last had the app open, and whether they can log in',
    team.status === 200 && typeof row?.last_seen_at === 'string' && row?.login_enabled === true,
    row,
  )
  const dir = await api('/team/directory', { token: aToken })
  const drow = (Array.isArray(dir.json) ? dir.json : []).find((m) => m.user_id === me)
  check('last seen: the directory carries it too', dir.status === 200 && typeof drow?.last_seen_at === 'string', drow?.last_seen_at)
}

// ── Email log, costs, expenses, Diamond link (0217) ──
{
  const notAdmin = await api('/platform/email', { token: aToken })
  check('email health: a studio owner cannot open the platform email page (403)', notAdmin.status === 403, { status: notAdmin.status })
  const confirmed = await api('/auth/session', { token: aToken })
  check('sign-in: a confirmed owner is not nagged', confirmed.json.email_verified === true, confirmed.json.email_verified)

  const cats = await api('/settings/lookups/active?category=expense_category', { token: aToken })
  const names = (Array.isArray(cats.json) ? cats.json : []).map((x) => String(x.value ?? x.label ?? '').toLowerCase())
  check('expenses: a studio has photography expense categories ready', names.includes('equipment rental') && names.includes('album & printing'), names)

  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Cost Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Cost project ${rand()}`, client_id: client.json.id, package_cost: 200000 } })
  const pid = project.json.id
  const exp = await api('/financials/expenses', { token: aToken, method: 'POST', body: { amount: 4500, category: 'Equipment rental', description: 'Gimbal', project_id: pid, expense_date: '2026-09-01' } })
  const list = await api(`/financials/expenses?project_id=${pid}`, { token: aToken })
  const row = (Array.isArray(list.json) ? list.json : list.json.items ?? []).find((e) => e.id === exp.json.id)
  check('expenses: the list names the project each cost belongs to', exp.status < 300 && /^Cost project /.test(row?.project_name ?? ''), row)

  const me = (await api('/auth/session', { token: aToken })).json.user_id
  // Years out, clear of every other booking this run makes for the owner: two
  // random days that met used to refuse this one as a double booking.
  const day = new Date(Date.now() + (3000 + Math.floor(Math.random() * 3000)) * 86_400_000).toISOString().slice(0, 10)
  const shoot = await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Haldi', shoot_date: day } })
  await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: me, shoot_id: shoot.json.id, service_name: 'Candid Photographer', start_at: `${day}T04:00:00.000Z`, end_at: `${day}T06:00:00.000Z`, estimated_cost: 15000 },
  })
  const costs = await api(`/projects/${pid}/costs`, { token: aToken })
  check(
    'cost sheet: team payouts and expenses add up against the project value',
    costs.status === 200 && costs.json.team_total === 15000 && costs.json.expenses_total === 4500 &&
      costs.json.total_cost === 19500 && costs.json.profit === 180500 && costs.json.team.length === 1,
    costs.json,
  )
  const bNow2 = (await api('/auth/login', { method: 'POST', body: { email: b.email, password: NEW_PW } })).json.access_token ?? newPw.json.access_token
  const otherCosts = await api(`/projects/${pid}/costs`, { token: bNow2 })
  check('cost sheet: another studio gets 404', otherCosts.status === 404 || otherCosts.status === 403, { status: otherCosts.status })

  const status = await api('/subscription/status', { token: aToken })
  check('diamond: the status carries the group link (none set yet)', status.status === 200 && 'diamond_group_link' in status.json, status.json.diamond_group_link)
}

// ── Staff: any email signs in, they see only their own work, the owner sets
// their sign-in, and a removed login is told why ──
{
  const pw = 'Asha-pass-123'
  const phone = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const email = `asha-${rand()}@madeup.test`
  const add = await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Asha Staff', phone: randPhone(), email, password: pw, create_login: true } })
  const asha = add.json.user_id
  const login = await api('/auth/login', { ip: phone, method: 'POST', body: { email, password: pw } })
  const t = login.json.access_token
  check('staff login: a made-up email signs in with its password', add.status === 201 && login.status === 200 && !!t, { add: add.status, login: login.status })
  const sess = await api('/auth/session', { token: t })
  check('staff login: never asked to confirm an email', sess.json.email_verified === true, sess.json.email_verified)

  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Staff Co ${rand()}`, phone: randPhone() } })
  const p1 = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Hers ${rand()}`, client_id: client.json.id, package_cost: 90000 } })).json.id
  const p2 = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Not hers ${rand()}`, client_id: client.json.id, package_cost: 70000 } })).json.id
  const day = new Date(Date.now() + (400 + Math.floor(Math.random() * 300)) * 86_400_000).toISOString().slice(0, 10)
  const s1 = (await api('/shoots', { token: aToken, method: 'POST', body: { project_id: p1, name: 'Engagement', shoot_date: day } })).json.id
  await api('/shoots', { token: aToken, method: 'POST', body: { project_id: p2, name: 'Haldi', shoot_date: day } })
  const booked = await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: asha, shoot_id: s1, service_name: 'Candid Photographer', start_at: `${day}T09:30:00.000Z`, end_at: `${day}T12:30:00.000Z` },
  })
  check('staff: the owner books her on one shoot', booked.status < 300, { status: booked.status, json: booked.json })

  const list = await api('/projects', { token: t })
  const ids = (Array.isArray(list.json) ? list.json : []).map((r) => r.id)
  check('staff: the project list holds only the projects she works on', list.status === 200 && ids.includes(p1) && !ids.includes(p2), { status: list.status, ids })
  const row = (Array.isArray(list.json) ? list.json : []).find((r) => r.id === p1)
  check(
    'staff: no money and no client phone on her projects',
    !!row && row.package_cost === 0 && row.total_cost === 0 && row.received === 0 && row.client_phone === null,
    row,
  )
  const paged = await api('/projects?page=1&page_size=50', { token: t })
  check(
    'staff: the paged list is scoped too, with no money summary',
    paged.status === 200 && paged.json.items.every((r) => r.id === p1) && paged.json.summary.value === 0,
    { status: paged.status, n: paged.json.items?.length, summary: paged.json.summary },
  )
  const closed = [`/projects/${p1}`, `/projects/${p1}/billing`, '/projects/tracking', '/projects/board', `/client-portal/projects/${p1}`, '/terms/documents', `/terms/projects/${p1}/documents`, '/team-terms/sends']
  const denied = await Promise.all(closed.map((path) => api(path, { token: t })))
  check("staff: 403 on the studio's project screens", denied.every((r) => r.status === 403), Object.fromEntries(closed.map((path, i) => [path, denied[i].status])))
  const shoots = await api('/shoots', { token: t })
  check('staff: the shoots list holds only her bookings', shoots.status === 200 && shoots.json.length === 1 && shoots.json[0].id === s1, { status: shoots.status, n: shoots.json.length })
  const ownPaths = ['/shoots/my', '/tasks/my', '/projects/deliverables/mine', '/allocation', '/me/follow-ups', '/data/mine']
  const own = await Promise.all(ownPaths.map((path) => api(path, { token: t })))
  check('staff: her own work still opens', own.every((r) => r.status === 200), Object.fromEntries(ownPaths.map((path, i) => [path, own[i].status])))
  const ownerStill = await api(`/projects/${p1}`, { token: aToken })
  const ownerList = await api('/projects', { token: aToken })
  check(
    'staff: the owner still sees every project, with its money',
    ownerStill.status === 200 && ownerList.json.some((r) => r.id === p2 && r.package_cost === 70000),
    { detail: ownerStill.status },
  )

  // Sign-in details: the owner sets her password; the old one and its session stop.
  const newPw = 'Asha-new-456'
  const notHers = await api(`/team/members/${asha}/sign-in`, { token: t, method: 'POST', body: { password: newPw } })
  check('sign-in details: staff cannot set anyone\'s sign-in (403)', notHers.status === 403 || notHers.status === 409, { status: notHers.status })
  const set = await api(`/team/members/${asha}/sign-in`, { token: aToken, method: 'POST', body: { password: newPw } })
  check('sign-in details: the owner sets a new password', set.status === 200 && set.json.email === email, set.json)
  const oldPw = await api('/auth/login', { ip: phone, method: 'POST', body: { email, password: pw } })
  const oldSession = await api('/auth/session', { token: t })
  check('sign-in details: the old password and her old session stop working', oldPw.status === 401 && oldSession.status === 401, { login: oldPw.status, session: oldSession.status })
  const email2 = `asha-${rand()}@madeup.test`
  const moved = await api(`/team/members/${asha}/sign-in`, { token: aToken, method: 'POST', body: { email: email2, password: newPw } })
  const onNew = await api('/auth/login', { ip: phone, method: 'POST', body: { email: email2, password: newPw } })
  check('sign-in details: a mistyped email is fixed and signs in', moved.status === 200 && onNew.status === 200, { moved: moved.status, login: onNew.status })
  const taken = await api(`/team/members/${asha}/sign-in`, { token: aToken, method: 'POST', body: { email: a.email, password: newPw } })
  check("sign-in details: someone else's email is refused (409)", taken.status === 409, { status: taken.status })

  // Removed: she is told her sign-in is off, not "wrong password".
  await api(`/team/members/${asha}`, { token: aToken, method: 'DELETE' })
  const gone = await api('/auth/login', { ip: phone, method: 'POST', body: { email: email2, password: newPw } })
  check('staff login: a removed person is told their sign-in is turned off (403)', gone.status === 403 && /turned off/.test(JSON.stringify(gone.json)), { status: gone.status, json: gone.json })
}

// ── Attendance v2 (0224): off until the owner turns it on, then done properly ──
{
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const mk = async (name) => {
    const email = `att-${rand()}@madeup.test`
    const added = await api('/team/members', { token: aToken, method: 'POST', body: { name, phone: randPhone(), email, password: 'Att-pass-123', create_login: true } })
    const login = await api('/auth/login', { ip, method: 'POST', body: { email, password: 'Att-pass-123' } })
    return { id: added.json.user_id, token: login.json.access_token }
  }
  const ravi = await mk('Ravi Att')
  const meera = await mk('Meera Att')
  const STUDIO = { lat: 19.076, lng: 72.8777 }

  // Make sure it starts off (an earlier block may have set a location).
  await api('/hr/policy', { token: aToken, method: 'PATCH', body: { enabled: false } })
  const off = await api('/hr/check-in', { token: ravi.token, method: 'POST', body: STUDIO })
  check('attendance v2: nobody checks in while it is off', off.status === 422 && /not switched on/.test(off.json.error ?? ''), off)
  const meOff = await api('/hr/attendance/me', { token: ravi.token })
  check('attendance v2: the app is told it is off', meOff.status === 200 && meOff.json.enabled === false, meOff.json)

  const staffSet = await api('/hr/policy', { token: ravi.token, method: 'PATCH', body: { enabled: true } })
  check('attendance v2: only the owner turns it on (403)', staffSet.status === 403, { status: staffSet.status })
  const on = await api('/hr/policy', { token: aToken, method: 'PATCH', body: { enabled: true, day_start: '00:00', grace_min: 0, day_end: '23:30', half_day_hours: 4 } })
  check('attendance v2: the owner turns it on with working hours', on.status === 200 && on.json.enabled === true && on.json.day_start === '00:00' && on.json.half_day_hours === 4, on.json)
  const bad = await api('/hr/policy', { token: aToken, method: 'PATCH', body: { day_start: '19:00', day_end: '10:00' } })
  check('attendance v2: a day that ends before it starts is refused (422)', bad.status === 422, bad)
  const pinned = await api('/hr/location', {
    token: aToken,
    method: 'PATCH',
    body: { ...STUDIO, radius_m: 150, timezone: 'Asia/Kolkata', is_active: true, expected_checkin_time: '00:00', late_grace_minutes: 0, missed_cutoff_time: null },
  })
  check('attendance v2: the owner pins the studio', pinned.status === 200, pinned)

  const rough = await api('/hr/check-in', { token: ravi.token, method: 'POST', body: { ...STUDIO, accuracy_m: 2000 } })
  check('attendance v2: a rough fix is refused, saying how rough', rough.status === 422 && /too rough right now \(±2\.0 km\)/.test(rough.json.error ?? ''), rough.json)
  const far = await api('/hr/check-in', { token: ravi.token, method: 'POST', body: { lat: 28.6, lng: 77.2, accuracy_m: 10 } })
  check('attendance v2: outside the circle is refused with the distance', far.status === 422 && /from Studio \(allowed 150 m\)/.test(far.json.error ?? ''), far.json)
  const inside = await api('/hr/check-in', { token: ravi.token, method: 'POST', body: { ...STUDIO, accuracy_m: 12 } })
  check('attendance v2: inside, checked in -- and late against a 00:00 start', inside.status === 201 && inside.json.status === 'late' && inside.json.place_name === 'Studio', inside.json)
  await api('/hr/check-out', { token: ravi.token, method: 'POST', body: STUDIO })
  const after = await api('/hr/attendance/me', { token: ravi.token })
  check('attendance v2: out within the half-day hours is a half day', after.json.today?.status === 'half_day' && after.json.today?.accuracy_m === 12, after.json.today)

  // A selfie, when asked for.
  await api('/hr/policy', { token: aToken, method: 'PATCH', body: { selfie_required: true } })
  const noSelfie = await api('/hr/check-in', { token: meera.token, method: 'POST', body: STUDIO })
  check('attendance v2: with a selfie asked for, none is refused', noSelfie.status === 422 && /selfie/.test(noSelfie.json.error ?? ''), noSelfie.json)
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (ch) => ch.charCodeAt(0))
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'selfie.png')
  const up = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${meera.token}` }, body: form })
  const upJson = await up.json().catch(() => ({}))
  const withSelfie = await api('/hr/check-in', { token: meera.token, method: 'POST', body: { ...STUDIO, selfie_file_id: upJson.id } })
  check('attendance v2: with her own fresh selfie she is in', up.ok && withSelfie.status === 201, { up: up.status, json: withSelfie.json })
  const ownerSees = await api(`/files/${upJson.id}`, { token: aToken })
  const otherSees = await api(`/files/${upJson.id}`, { token: ravi.token })
  check('attendance v2: the owner can open the selfie, a teammate cannot', ownerSees.status === 200 && otherSees.status !== 200, { owner: ownerSees.status, other: otherSees.status })
  await api('/hr/policy', { token: aToken, method: 'PATCH', body: { selfie_required: false } })

  // The owner's screens.
  const today = await api('/hr/today', { token: aToken })
  const names = (today.json.rows ?? []).map((r) => r.name)
  check('attendance v2: the Today board lists who is tracked, with today’s marks', today.status === 200 && today.json.enabled === true && names.includes('Ravi Att') && names.includes('Meera Att'), { status: today.status, names })
  const todayStaff = await api('/hr/today', { token: ravi.token })
  check('attendance v2: staff cannot open the Today board (403)', todayStaff.status === 403, { status: todayStaff.status })
  const month = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7)
  const reg = await api(`/hr/register?month=${month}`, { token: aToken })
  const regStaff = await api(`/hr/register?month=${month}`, { token: ravi.token })
  const regMine = await api(`/hr/register?month=${month}&user=me`, { token: ravi.token })
  check(
    'attendance v2: the month register is the owner’s; a person sees only their own',
    reg.status === 200 && reg.json.people.length >= 2 && regStaff.status === 403 && regMine.status === 200 && regMine.json.people.length === 1,
    { owner: reg.status, staff: regStaff.status, mine: regMine.status },
  )
  const plain = await api('/hr/places/resolve-link', { token: aToken, method: 'POST', body: { url: 'https://www.google.com/maps/place/x/@19.07,72.87,17z/data=!3d19.0760!4d72.8777' } })
  const nopin = await api('/hr/places/resolve-link', { token: aToken, method: 'POST', body: { url: 'Bandra West, Mumbai' } })
  check('attendance v2: a Maps link becomes a pin; a link with none says so', plain.status === 200 && plain.json.lat === 19.076 && nopin.status === 422 && /no pin/.test(nopin.json.error ?? ''), { plain: plain.json, nopin: nopin.json })
  const cron = await fetch(`${API}/cron/messages`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET ?? 'ci-cron' } })
  check('attendance v2: the five-minute cron runs the reminders', cron.status === 200, { status: cron.status })
  await api('/hr/policy', { token: aToken, method: 'PATCH', body: { enabled: false } })
}

// ── Step 1 screens: the API behind them, end to end ──────────────────────
{
  // Make tasks for the deliverables that have none.
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Gen Co ${rand()}`, phone: randPhone() } })
  const project = await api('/projects', { token: aToken, method: 'POST', body: { name: `Gen project ${rand()}`, client_id: client.json.id } })
  const pid = project.json.id
  await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Album' } })
  await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Teaser' } })
  const before = await api(`/tasks?project_id=${pid}`, { token: aToken })
  const linkedBefore = (Array.isArray(before.json) ? before.json : before.json.items ?? []).filter((t) => t.deliverable_id).length
  const gen = await api('/tasks/generate', { token: aToken, method: 'POST', body: { project_id: pid } })
  const again = await api('/tasks/generate', { token: aToken, method: 'POST', body: { project_id: pid } })
  check(
    'step 1: "Make tasks" makes one per deliverable without a task, and nothing twice',
    gen.status === 201 && gen.json.created === 2 - linkedBefore && again.status === 201 && again.json.created === 0,
    { gen: gen.json, again: again.json, linkedBefore },
  )

  // Data helpers: rename and archive.
  const helper = await api('/data/people', { token: aToken, method: 'POST', body: { name: `Helper ${rand()}` } })
  const renamed = await api(`/data/people/${helper.json.id}`, { token: aToken, method: 'PATCH', body: { name: `${helper.json.name} DIT`, phone: '9810000000' } })
  const archived = await api(`/data/people/${helper.json.id}`, { token: aToken, method: 'PATCH', body: { is_active: false } })
  const people = await api('/data/people', { token: aToken })
  const row = people.json.find((p) => p.id === helper.json.id)
  check(
    'step 1: a data helper can be renamed and archived, and stays listed as archived',
    renamed.status === 200 && archived.status === 200 && row?.is_active === false && row?.phone === '9810000000',
    { renamed: renamed.status, archived: archived.status, row },
  )

  // Vendors: full details, archived ones filtered.
  const vendor = await api('/parties', { token: aToken, method: 'POST', body: { name: `Albums ${rand()}`, kind: 'vendor', gstin: '27ABCDE1234F1Z5', phone: '9820000001', state: 'Maharashtra' } })
  await api(`/parties/${vendor.json.id}`, { token: aToken, method: 'PATCH', body: { is_active: false } })
  const active = await api('/parties?active=true', { token: aToken })
  const gone = await api('/parties?active=false', { token: aToken })
  check(
    'step 1: a vendor keeps GSTIN and phone, and leaves the active list when archived',
    vendor.status === 201 && vendor.json.gstin === '27ABCDE1234F1Z5' && !active.json.some((p) => p.id === vendor.json.id) && gone.json.some((p) => p.id === vendor.json.id),
    { vendor: vendor.json },
  )

  // Item lines round-trip; a line without a title or amount shape is refused.
  const exp = await api('/financials/expenses', {
    token: aToken,
    method: 'POST',
    body: { amount: 9250, itemize_json: [{ title: 'Album 12x36', amount: 9000, qty: 2 }, { title: 'Courier', amount: 250 }] },
  })
  const bad = await api('/financials/expenses', { token: aToken, method: 'POST', body: { amount: 10, itemize_json: [{ amount: 'ten' }] } })
  const cleared = await api(`/financials/expenses/${exp.json.id}`, { token: aToken, method: 'PATCH', body: { itemize_json: [] } })
  check(
    'step 1: expense item lines are saved, malformed ones refused, and they can be cleared',
    exp.status === 201 && exp.json.itemize_json?.length === 2 && bad.status === 422 && cleared.status === 200 && (cleared.json.itemize_json ?? []).length === 0,
    { exp: exp.status, lines: exp.json.itemize_json, bad: bad.status, cleared: cleared.status },
  )

  // The reports the new cards read.
  const stats = await api('/crm/stats', { token: aToken })
  const month = new Date().toISOString().slice(0, 7)
  const summary = await api(`/financials/monthly-profit-summary?month=${month}-01`, { token: aToken })
  check(
    'step 1: lead reports carry follow-up health and trends; the month summary carries the team-cost split',
    stats.status === 200 && typeof stats.json.follow_up_health?.overdue === 'number' && Array.isArray(stats.json.activity_trend) &&
      summary.status === 200 && Array.isArray(summary.json.salary_buckets),
    { stats: stats.status, summary: summary.status },
  )
}

// ── Step 2: referral rewards, money checks, tax rates, platform plans and payments ──
{
  const campaign = await api('/referrals/campaigns', { token: aToken, method: 'POST', body: { name: `Thank you ${rand()}`, reward_type: 'fixed', reward_value: 2500 } })
  await api(`/public/referrals/submit?campaign_id=${campaign.json.id}`, { method: 'POST', body: { referrer_name: 'Neha', client_name: 'Friend of Neha', client_phone: randPhone() } })
  const sub = ((await api(`/referrals/submissions?campaign_id=${campaign.json.id}`, { token: aToken })).json.items ?? [])[0]
  await api(`/referrals/submissions/${sub?.id}/status`, { token: aToken, method: 'PATCH', body: { status: 'converted', reward_status: 'due' } })
  const due = await api('/referrals/submissions?reward_status=due', { token: aToken })
  const given = await api(`/referrals/submissions/${sub?.id}/status`, { token: aToken, method: 'PATCH', body: { reward_status: 'given', reward_amount: 2500 } })
  const givenList = await api('/referrals/submissions?reward_status=given', { token: aToken })
  const row = (givenList.json.items ?? []).find((x) => x.id === sub?.id)
  const badFilter = await api('/referrals/submissions?reward_status=maybe', { token: aToken })
  check(
    'step 2: the rewards board lists due and given apart, and keeps what was given',
    (due.json.items ?? []).some((x) => x.id === sub?.id) && given.status === 200 && row?.reward_amount === 2500 && badFilter.status === 422,
    { due: due.status, given: given.status, row, badFilter: badFilter.status },
  )

  // Expenses with no category, and a studio's own tax rate.
  await api('/financials/expenses', { token: aToken, method: 'POST', body: { amount: 120 } })
  const missing = await api('/financials/expenses/summary?missing=category', { token: aToken })
  const wrong = await api('/financials/expenses?missing=project', { token: aToken })
  check('step 2: expenses with no category can be counted and listed; an unknown filter is refused', missing.status === 200 && missing.json.count >= 1 && wrong.status === 422, { missing: missing.json, wrong: wrong.status })

  const rateName = `GST ${rand().slice(0, 4)} 3%`
  const rate = await api('/financials/tax-rates', { token: aToken, method: 'POST', body: { name: rateName, rate: 3 } })
  const dupe = await api('/financials/tax-rates', { token: aToken, method: 'POST', body: { name: rateName.toLowerCase(), rate: 3 } })
  const listed = await api('/financials/tax-rates', { token: aToken })
  const exp = await api('/financials/expenses', {
    token: aToken,
    method: 'POST',
    body: { amount: 10000, gst_treatment: 'gst_applicable', gst_rate: 3, tax_name: rateName, tax_amount: 300 },
  })
  check(
    'step 2: a studio adds its own tax rate once, and an expense at 3% keeps the rate and its name',
    rate.status === 201 && dupe.status === 409 && listed.json.some((r) => r.name === rateName) && exp.status === 201 && Number(exp.json.gst_rate) === 3 && exp.json.tax_name === rateName,
    { rate: rate.status, dupe: dupe.status, exp: exp.status, body: exp.json },
  )

  // The platform's screens are the platform admin's alone.
  const plans = await api('/platform/plans', { token: aToken })
  const assign = await api(`/platform/studios/${crypto.randomUUID()}/assign-plan`, { token: aToken, method: 'POST', body: { plan_key: 'x' } })
  const recovery = await api('/platform/payments/recovery', { token: aToken })
  check(
    'step 2: plans, assigning one and the payments to check answer 403 to a studio owner',
    plans.status === 403 && assign.status === 403 && recovery.status === 403,
    { plans: plans.status, assign: assign.status, recovery: recovery.status },
  )
}

// ── Step 3 (0227): shared terms presets, one deliverable from several shoots, alert emails ──
{
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const email = `s3-${rand()}@madeup.test`
  await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Step Three Staff', phone: randPhone(), email, password: 'S3-pass-1234', create_login: true } })
  const staff = (await api('/auth/login', { ip, method: 'POST', body: { email, password: 'S3-pass-1234' } })).json.access_token

  const title = `Wedding terms ${rand().slice(0, 5)}`
  const made = await api('/projects/quotation-terms', { token: aToken, method: 'POST', body: { title, body: '50% advance to hold the date.', is_default: true } })
  const dupe = await api('/projects/quotation-terms', { token: aToken, method: 'POST', body: { title: title.toUpperCase(), body: 'again' } })
  const other = await api('/projects/quotation-terms', { token: aToken, method: 'POST', body: { title: `${title} B`, body: 'Full payment upfront.' } })
  const moved = await api(`/projects/quotation-terms/${other.json.id}`, { token: aToken, method: 'PATCH', body: { is_default: true } })
  const list = await api('/projects/quotation-terms', { token: aToken })
  const defaults = (list.json ?? []).filter((p) => p.is_default).map((p) => p.id)
  const staffWrite = await api('/projects/quotation-terms', { token: staff, method: 'POST', body: { title: 'Mine', body: 'x' } })
  const gone = await api(`/projects/quotation-terms/${made.json.id}`, { token: aToken, method: 'DELETE' })
  check(
    'step 3: terms presets are the studio’s, one default at a time; a name twice is 409; staff cannot write them',
    made.status === 201 && made.json.is_default === true && dupe.status === 409 && moved.status === 200 && defaults.length === 1 && defaults[0] === other.json.id &&
      staffWrite.status === 403 && gone.status === 204,
    { made: made.status, dupe: dupe.status, moved: moved.status, defaults, staffWrite: staffWrite.status, gone: gone.status },
  )
  await api(`/projects/quotation-terms/${other.json.id}`, { token: aToken, method: 'DELETE' })

  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `S3 Co ${rand()}`, phone: randPhone() } })
  const pid = (await api('/projects', { token: aToken, method: 'POST', body: { name: `S3 project ${rand()}`, client_id: client.json.id } })).json.id
  const haldi = (await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Haldi', shoot_date: '2027-01-10' } })).json.id
  const wedding = (await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Wedding', shoot_date: '2027-01-12' } })).json.id
  const otherPid = (await api('/projects', { token: aToken, method: 'POST', body: { name: `S3 other ${rand()}`, client_id: client.json.id } })).json.id
  const elsewhere = (await api('/shoots', { token: aToken, method: 'POST', body: { project_id: otherPid, name: 'Elsewhere' } })).json.id
  const dl = await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Highlights', shoot_ids: [wedding, haldi] } })
  const detail = await api(`/projects/${pid}`, { token: aToken })
  const d = (detail.json.deliverables ?? []).find((x) => x.id === dl.json.id)
  const bad = await api(`/projects/${pid}/deliverables/${dl.json.id}`, { token: aToken, method: 'PATCH', body: { shoot_ids: [haldi, elsewhere] } })
  const one = await api(`/projects/${pid}/deliverables/${dl.json.id}`, { token: aToken, method: 'PATCH', body: { shoot_ids: [haldi] } })
  const after = ((await api(`/projects/${pid}`, { token: aToken })).json.deliverables ?? []).find((x) => x.id === dl.json.id)
  check(
    'step 3: a deliverable keeps several shoots (shoot_id on the last); a shoot from another project is refused; one shoot is plain again',
    dl.status === 201 && d?.shoot_id === wedding && JSON.stringify(d?.shoot_ids) === JSON.stringify([haldi, wedding]) &&
      JSON.stringify(d?.shoot_names) === JSON.stringify(['Haldi', 'Wedding']) && d?.start_rule === 'specific_shoots' &&
      bad.status === 422 && one.status === 204 && after?.shoot_id === haldi && after?.shoot_ids?.length === 1 && after?.start_rule === 'whole_project',
    { dl: dl.status, d: d && { shoot_id: d.shoot_id, shoot_ids: d.shoot_ids, names: d.shoot_names, rule: d.start_rule }, bad: bad.status, one: one.status, after: after && { shoot_id: after.shoot_id, ids: after.shoot_ids } },
  )

  const mine = await api('/me/alert-emails', { token: staff })
  const off = await api('/me/alert-emails', { token: staff, method: 'PUT', body: { on: false } })
  const again = await api('/me/alert-emails', { token: staff })
  const cron = await fetch(`${API}/cron/reminders?dry=1`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET ?? 'ci-cron' } })
  const cronJson = await cron.json().catch(() => ({}))
  check(
    'step 3: a person turns their alert emails off; the hourly cron counts the alert emails',
    mine.status === 200 && mine.json.on === true && mine.json.email === email && off.json.on === false && again.json.on === false &&
      cron.status === 200 && JSON.stringify(cronJson).includes('alert_emails'),
    { mine: mine.json, off: off.json, again: again.json, cron: cron.status },
  )
}

// ── Payouts: pay as the cards come in, the project's payouts, a freelancer's own ──
{
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const email = `fl-${rand()}@madeup.test`
  const added = await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Free Lancer', phone: randPhone(), email, password: 'Fl-pass-1234', create_login: true, engagement_type: 'freelancer' } })
  const fl = (await api('/auth/login', { ip, method: 'POST', body: { email, password: 'Fl-pass-1234' } })).json.access_token
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Pay Co ${rand()}`, phone: randPhone() } })
  const pid = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Pay project ${rand()}`, client_id: client.json.id } })).json.id
  const day = '2027-02-10'
  const shoot = (await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Wedding', shoot_date: day } })).json.id
  const booked = await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: added.json.user_id, shoot_id: shoot, service_name: 'Candid Photographer', start_at: `${day}T10:00:00.000Z`, end_at: `${day}T16:00:00.000Z`, estimated_cost: 6000, cost_status: 'tentative' },
  })
  const slotId = booked.json.id ?? booked.json.slot_id
  const status = await api(`/team-payouts/slot/${slotId}`, { token: aToken })
  // The cards come in: the payout is raised to 6,500 and 4,000 is paid on the spot.
  const paid = await api(`/team-payouts/slot/${slotId}/pay`, { token: aToken, method: 'POST', body: { amount: 6500, paid_now: 4000, payment_mode: 'UPI' } })
  const over = await api(`/team-payouts/slot/${slotId}/pay`, { token: aToken, method: 'POST', body: { paid_now: 5000 } })
  const rows = await api(`/team-payouts/project/${pid}`, { token: aToken })
  const row = (rows.json ?? []).find((r) => r.slot_id === slotId)
  check(
    'payouts: the amount and a part payment are saved together; paying past it is 409; the project lists it',
    status.status === 200 && status.json.amount === 6000 && paid.status === 200 && paid.json.amount === 6500 && paid.json.paid === 4000 &&
      paid.json.cost_status === 'final' && over.status === 409 && row?.paid === 4000 && row?.amount === 6500,
    { status: status.json, paid: paid.json, over: over.status, row },
  )

  const mine = await api('/me/payouts', { token: fl })
  const ownerSees = await api('/me/payouts', { token: aToken })
  const flProject = await api(`/team-payouts/project/${pid}`, { token: fl })
  const flPay = await api(`/team-payouts/slot/${slotId}/pay`, { token: fl, method: 'POST', body: { paid_now: 100 } })
  check(
    'payouts: a freelancer sees their own shoot, 2,500 still to come, the 4,000 payment; not the studio’s payouts, and cannot pay',
    mine.status === 200 && mine.json.bookings.length === 1 && mine.json.owed === 2500 && mine.json.paid === 4000 &&
      mine.json.payments[0]?.amount === 4000 && mine.json.has_pay_details === false &&
      !(ownerSees.json.bookings ?? []).some((b) => b.slot_id === slotId) && flProject.status === 403 && flPay.status === 403,
    { mine: mine.json, flProject: flProject.status, flPay: flPay.status },
  )
}

// ── Crew money: Owed now · Upcoming, "Who you owe", a person's statement ──
{
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const email = `cm-${rand()}@madeup.test`
  const added = await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Crew Money', phone: randPhone(), email, password: 'Cm-pass-1234', create_login: true, engagement_type: 'freelancer' } })
  const uid = added.json.user_id
  const cm = (await api('/auth/login', { ip, method: 'POST', body: { email, password: 'Cm-pass-1234' } })).json.access_token
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Crew Co ${rand()}`, phone: randPhone() } })
  const pid = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Crew money ${rand()}`, client_id: client.json.id } })).json.id
  const book = async (day, cost) => {
    const shoot = (await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: `Shoot ${day}`, shoot_date: day } })).json.id
    const b = await api('/allocation', {
      token: aToken,
      method: 'POST',
      body: { user_id: uid, shoot_id: shoot, service_name: 'Candid Photographer', start_at: `${day}T06:00:00.000Z`, end_at: `${day}T12:00:00.000Z`, estimated_cost: cost, cost_status: 'final' },
    })
    return b.json.id ?? b.json.slot_id
  }
  // A shoot done last year (5,000, 1,000 paid) and one next year paid in full ahead (3,000).
  const past = await book('2025-06-10', 5000)
  const ahead = await book('2027-03-01', 3000)
  await api(`/team-payouts/slot/${past}/pay`, { token: aToken, method: 'POST', body: { paid_now: 1000 } })
  await api(`/team-payouts/slot/${ahead}/pay`, { token: aToken, method: 'POST', body: { paid_now: 3000 } })

  const theirs = await api(`/team-payouts/shoots?user_id=${uid}`, { token: aToken })
  const all = await api('/team-payouts/shoots', { token: aToken })
  const owed = await api('/team-payouts/owed', { token: aToken })
  const person = (owed.json.people ?? []).find((p) => p.user_id === uid)
  check(
    'crew money: a past shoot is owed less what was paid; money paid ahead is never taken off it; the dashboard sum equals the page headline',
    theirs.status === 200 && theirs.json.rows.length === 2 && theirs.json.owed_now === 4000 && theirs.json.upcoming === 0 &&
      theirs.json.paid === 4000 && theirs.json.paid_ahead === 3000 &&
      theirs.json.rows.find((r) => r.slot_id === past)?.shoot_date === '2025-06-10' &&
      owed.status === 200 && person?.owed === 4000 && person?.bookings === 1 &&
      all.status === 200 && all.json.owed_now === owed.json.owed_now && all.json.paid === owed.json.paid,
    { theirs: theirs.json && { owed_now: theirs.json.owed_now, upcoming: theirs.json.upcoming, paid: theirs.json.paid, ahead: theirs.json.paid_ahead, n: theirs.json.rows?.length }, owed: owed.status, person, all: all.json?.owed_now, dash: owed.json?.owed_now },
  )

  const mine = await api('/me/payouts', { token: cm })
  const cmOwed = await api('/team-payouts/owed', { token: cm })
  const cmRows = await api('/team-payouts/shoots', { token: cm })
  check(
    'crew money: the freelancer sees 4,000 due for shoots done and 3,000 paid in advance; the studio’s crew money is 403 to them',
    mine.status === 200 && mine.json.owed_now === 4000 && mine.json.upcoming === 0 && mine.json.paid_ahead === 3000 &&
      cmOwed.status === 403 && cmRows.status === 403,
    { mine: mine.json && { owed_now: mine.json.owed_now, upcoming: mine.json.upcoming, ahead: mine.json.paid_ahead }, cmOwed: cmOwed.status, cmRows: cmRows.status },
  )
}

// ── Payments received tiles: Overdue · Due in 30 days · Later, each rupee once ──
{
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Due Co ${rand()}`, phone: randPhone() } })
  const pid = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Due project ${rand()}`, client_id: client.json.id, package_cost: 100000 } })).json.id
  const soon = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10)
  const paid = await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 30000, status: 'paid', mode: 'UPI' } })
  const promise = await api(`/projects/${pid}/payments`, { token: aToken, method: 'POST', body: { amount: 10000, status: 'pending', paid_on: soon, mode: 'UPI' } })
  const due = await api('/billing/due?from=2000-01-01&to=2099-12-31', { token: aToken })
  const mine = (due.json.lines ?? []).filter((l) => l.project_id === pid)
  const sum = (b) => (due.json.lines ?? []).filter((l) => l.bucket === b).reduce((n, l) => n + l.amount, 0)
  const se = `due-${rand()}@madeup.test`
  await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Due Staff', phone: randPhone(), email: se, password: 'Due-pass-1234', create_login: true } })
  const st = (await api('/auth/login', { ip: `203.0.113.${1 + Math.floor(Math.random() * 250)}`, method: 'POST', body: { email: se, password: 'Due-pass-1234' } })).json.access_token
  const staff = await api('/billing/due', { token: st })
  check(
    'payments received: a project’s 70,000 still to come is counted once -- the promise in 30 days, the rest Later; tiles add up; staff 403',
    paid.status < 300 && promise.status < 300 && due.status === 200 &&
      mine.reduce((n, l) => n + l.amount, 0) === 70000 &&
      mine.some((l) => l.kind === 'promise' && l.amount === 10000 && l.bucket === 'soon') &&
      mine.some((l) => l.kind === 'rest' && l.amount === 60000 && l.bucket === 'later') &&
      Math.abs(sum('overdue') - due.json.overdue.amount) < 1 && Math.abs(sum('soon') - due.json.soon.amount) < 1 && Math.abs(sum('later') - due.json.later.amount) < 1 &&
      due.json.received.amount >= 30000 && staff.status === 403,
    { paid: paid.status, promise: promise.status, due: due.status, mine, staff: staff.status },
  )
}

// ── A lead can start with just a name; booking it still asks for a number ──
{
  const named = await api('/crm/leads', { token: aToken, method: 'POST', body: { name: `Name Only ${rand()}` } })
  const neither = await api('/crm/leads', { token: aToken, method: 'POST', body: { notes: 'nothing to go on' } })
  const book = await api(`/crm/leads/${named.json.lead?.id}/convert`, { token: aToken, method: 'POST', body: { project: { name: 'Name only wedding' } } })
  const fixed = await api(`/crm/leads/${named.json.lead?.id}`, { token: aToken, method: 'PATCH', body: { phone: randPhone() } })
  const bookNow = await api(`/crm/leads/${named.json.lead?.id}/convert`, { token: aToken, method: 'POST', body: { project: { name: 'Name only wedding' } } })
  check(
    'leads: a name alone is enough to add one; neither name nor number is 422; booking without a number is 422 until one is added',
    named.status === 201 && named.json.lead?.phone === null && neither.status === 422 &&
      book.status === 422 && /phone number/.test(book.json.error ?? '') && fixed.status < 300 && bookNow.status === 201,
    { named: named.status, phone: named.json.lead?.phone, neither: neither.status, book: book.status, err: book.json.error, fixed: fixed.status, bookNow: bookNow.status },
  )
}

// ── Getting started: each step is read from the studio's own data ──
{
  const gs = await api('/settings/getting-started', { token: aToken })
  check(
    'getting started: the studio with leads, bookings and quotations has those steps ticked',
    gs.status === 200 && gs.json.enquiry === true && gs.json.booking === true && gs.json.quotation === true &&
      typeof gs.json.started_at === 'string',
    gs.json,
  )
}

// ── Help (0236): anyone can read it, only a platform admin changes it ──
{
  const open = await api('/public/help')
  check(
    'help: signed out, /public/help answers with the questions studios ask',
    open.status === 200 && Array.isArray(open.json.faqs) && open.json.faqs.length > 0 && Array.isArray(open.json.videos) &&
      'support_whatsapp' in open.json,
    { status: open.status, faqs: open.json.faqs?.length },
  )
  const read = await api('/platform/help', { token: aToken })
  const write = await api('/platform/help/contacts', { token: aToken, method: 'PUT', body: { support_whatsapp: '919999999999', support_email: null } })
  const faq = await api('/platform/help/faqs', { token: aToken, method: 'POST', body: { question: 'Is this mine?', answer: 'No.' } })
  const anon = await api('/platform/help/faqs', { method: 'POST', body: { question: 'Is this mine?', answer: 'No.' } })
  check(
    'help: a studio owner cannot read or change the Help console (403), signed out is 401',
    read.status === 403 && write.status === 403 && faq.status === 403 && anon.status === 401,
    { read: read.status, write: write.status, faq: faq.status, anon: anon.status },
  )
}

// ── A lead's quote on the studio's letterhead: the public link carries it ──
{
  await api('/settings/company', { token: aToken, method: 'PATCH', body: { invoice_phone: '022 4000 1234' } })
  const lead = await api('/crm/leads', { token: aToken, method: 'POST', body: { name: `Letterhead ${rand()}`, phone: randPhone() } })
  const q = await api('/crm/quotes', {
    token: aToken,
    method: 'POST',
    body: { lead_id: lead.json.lead?.id, title: 'Wedding cover', lines: [{ description: 'Candid photography', quantity: 1, rate: 85000, gst_rate: 18 }] },
  })
  const sent = await api(`/crm/quotes/${q.json.id}/send`, { token: aToken, method: 'POST', body: {} })
  const tok = new URL(sent.json.url ?? '/', 'http://x').searchParams.get('token')
  const pub = await api(`/public/quote/${encodeURIComponent(tok ?? '')}`)
  check(
    "lead quote: the client's link carries the studio's letterhead (name, phone, issued date)",
    pub.status === 200 && typeof pub.json.letterhead?.name === 'string' && pub.json.letterhead?.phone === '022 4000 1234' &&
      typeof pub.json.letterhead?.issued_at === 'string',
    { q: q.status, sent: sent.status, pub: pub.status, head: pub.json.letterhead },
  )
}

// ── Refer a studio (0237): a studio that signs up with a code is listed for the one that sent it ──
{
  const mine = await api('/studio-referrals', { token: aToken })
  const name = `Referred ${rand()}`
  const ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}`
  const reg = await api('/auth/register', {
    ip,
    method: 'POST',
    body: { company_name: name, admin_name: 'Bina', email: `ref-${rand()}@madeup.test`, phone: randPhone(), password: 'Testpass12345!', studio_ref: mine.json.code },
  })
  const bad = await api('/auth/register', {
    ip,
    method: 'POST',
    body: { company_name: `Bad ref ${rand()}`, admin_name: 'Chitra', email: `ref-${rand()}@madeup.test`, phone: randPhone(), password: 'Testpass12345!', studio_ref: 'NOPE0000' },
  })
  const after = await api('/studio-referrals', { token: aToken })
  check(
    'refer a studio: the owner has a link, and a studio that signs up with the code shows on their list (a wrong code still signs up)',
    mine.status === 200 && /\?studio_ref=[A-Z0-9]{8}$/.test(mine.json.link) && reg.status === 200 && bad.status === 200 &&
      after.json.referrals?.some((r) => r.studio_name === name && r.paid_at === null),
    { mine: mine.status, reg: reg.status, bad: bad.status, list: after.json.referrals?.length },
  )
  const console_ = await api('/platform/studio-referrals', { token: aToken })
  const terms = await api('/platform/studio-referrals/terms', { token: aToken, method: 'PUT', body: { reward: 1, discount_pct: null, hold_days: null } })
  check('refer a studio: a studio owner cannot open the platform console or set the terms (403)', console_.status === 403 && terms.status === 403, {
    console: console_.status,
    terms: terms.status,
  })
}

// ── Simple delivery (0234): handed in is delivered; a Full studio always reviews ──
{
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const email = `sd-${rand()}@madeup.test`
  const added = await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Simran Editor', phone: randPhone(), email, password: 'Sd-pass-1234', create_login: true } })
  const sd = (await api('/auth/login', { ip, method: 'POST', body: { email, password: 'Sd-pass-1234' } })).json.access_token
  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Simple Co ${rand()}`, phone: randPhone() } })
  const pid = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Simple project ${rand()}`, client_id: client.json.id } })).json.id
  const mkD = async (title) => (await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title, assignee_id: added.json.user_id } })).json.id
  const full = await mkD('Full film')
  const skip = await api('/work/submissions', { token: sd, method: 'POST', body: { project_id: pid, deliverable_id: full, submission_link: 'https://drive.example.com/full-v1', review_required: false } })
  const fullD = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === full)
  const staffFlow = await api('/settings/company', { token: sd, method: 'PATCH', body: { delivery_flow: 'simple' } })
  const toSimple = await api('/settings/company', { token: aToken, method: 'PATCH', body: { delivery_flow: 'simple' } })
  const teaser = await mkD('Teaser')
  const handed = await api('/work/submissions', { token: sd, method: 'POST', body: { project_id: pid, deliverable_id: teaser, submission_link: 'https://drive.example.com/teaser-v1' } })
  const fix = await api(`/work/submissions/${handed.json.id}`, { token: sd, method: 'PATCH', body: { submission_link: 'https://drive.example.com/teaser-v2' } })
  const teaserD = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === teaser)
  const back = await api(`/work/submissions/${handed.json.id}/review`, { token: aToken, method: 'POST', body: { approve: false, review_notes: 'Colour is off' } })
  const reopened = (await api(`/projects/${pid}`, { token: aToken })).json.deliverables.find((d) => d.id === teaser)
  await api('/settings/company', { token: aToken, method: 'PATCH', body: { delivery_flow: 'full' } })
  check(
    'simple delivery: Full still reviews a hand-in that asks to skip it; only the owner switches; Simple delivers, the editor fixes the link, send back reopens Editing',
    skip.status === 201 && fullD?.status === 'review' && staffFlow.status === 403 &&
      toSimple.status === 200 && toSimple.json.delivery_flow === 'simple' &&
      handed.status === 201 && fix.status === 204 && teaserD?.status === 'completed' &&
      teaserD?.delivery_link === 'https://drive.example.com/teaser-v2' &&
      back.status === 204 && reopened?.status === 'in_progress',
    { skip: skip.status, full: fullD?.status, staffFlow: staffFlow.status, toSimple: toSimple.status, handed: handed.status, fix: fix.status, teaser: [teaserD?.status, teaserD?.custom_status_code, teaserD?.delivery_link], back: back.status, reopened: [reopened?.status, reopened?.custom_status_code] },
  )
}

// ── Leave balances (0228): days a year, what is left, approve as unpaid ──
{
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const email = `lv-${rand()}@madeup.test`
  await api('/team/members', { token: aToken, method: 'POST', body: { name: 'Leave Taker', phone: randPhone(), email, password: 'Lv-pass-1234', create_login: true } })
  const lt = (await api('/auth/login', { ip, method: 'POST', body: { email, password: 'Lv-pass-1234' } })).json.access_token
  const set = await api('/hr/leave/allowances', { token: aToken, method: 'PUT', body: { allowances: [{ kind: 'casual', days_per_year: 2 }, { kind: 'sick', days_per_year: 6 }] } })
  const staffSet = await api('/hr/leave/allowances', { token: lt, method: 'PUT', body: { allowances: [{ kind: 'casual', days_per_year: 99 }] } })
  const year = new Date().getFullYear() + 1
  const asked = await api('/hr/leave', { token: lt, method: 'POST', body: { kind: 'casual', start_date: `${year}-01-05`, end_date: `${year}-01-07`, half_day: false, reason: 'Wedding' } })
  const pending = (await api('/hr/leave?scope=team&status=pending', { token: aToken })).json.find((l) => l.id === asked.json.id)
  const mine = await api(`/hr/leave/balances?year=${year}`, { token: lt })
  const casual = mine.json.find((b) => b.kind === 'casual')
  const decided = await api(`/hr/leave/${asked.json.id}/decide`, { token: aToken, method: 'POST', body: { approve: true, note: 'Casual is used up', as_unpaid: true } })
  const all = (await api('/hr/leave', { token: lt })).json
  const after = all.find((l) => l.id === asked.json.id)
  const extra = all.find((l) => l.kind === 'unpaid' && l.status === 'approved' && l.start_date > after?.end_date)
  check(
    'leave balances: the owner sets days a year, staff cannot; a 3-day ask on 2 days left keeps 2 casual and the extra day unpaid',
    set.status === 204 && staffSet.status === 403 && asked.status === 201 && Number(pending?.days) === 3 &&
      mine.json.every((b) => b.user_name === 'Leave Taker') && casual?.allowance === 2 && casual?.pending === 3 &&
      decided.status === 204 && after?.kind === 'casual' && after?.status === 'approved' && Number(after?.days) === 2 &&
      Number(extra?.days) === 1,
    { set: set.status, staffSet: staffSet.status, pending, casual, decided: decided.status, after, extra },
  )
  await api('/hr/leave/allowances', { token: aToken, method: 'PUT', body: { allowances: [{ kind: 'casual', days_per_year: null }, { kind: 'sick', days_per_year: null }] } })
}

// ── Give work (0229): who is busy, what is due, a team member's project page, money for money access ──
{
  const ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
  const mk = async (name, extra = {}) => {
    const email = `gw-${rand()}@madeup.test`
    const added = await api('/team/members', { token: aToken, method: 'POST', body: { name, phone: randPhone(), email, password: 'Gw-pass-1234', create_login: true, ...extra } })
    const token = (await api('/auth/login', { ip, method: 'POST', body: { email, password: 'Gw-pass-1234' } })).json.access_token
    return { uid: added.json.user_id, token }
  }
  const ed = await mk('Neha Editor')
  const shooter = await mk('Ravi Shooter', { engagement_type: 'freelancer' })
  const pm = await mk('Pooja Manager')
  await api(`/access/${pm.uid}`, { token: aToken, method: 'PUT', body: { profile_key: 'project_manager', overrides: [] } })

  const client = await api('/clients', { token: aToken, method: 'POST', body: { name: `Give Co ${rand()}`, phone: randPhone() } })
  const pid = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Give project ${rand()}`, client_id: client.json.id, package_cost: 90000 } })).json.id
  const other = (await api('/projects', { token: aToken, method: 'POST', body: { name: `Not hers ${rand()}`, client_id: client.json.id } })).json.id
  const day = '2027-03-10'
  const haldi = (await api('/shoots', { token: aToken, method: 'POST', body: { project_id: pid, name: 'Haldi', shoot_date: day } })).json.id
  const booked = await api('/allocation', {
    token: aToken,
    method: 'POST',
    body: { user_id: shooter.uid, shoot_id: haldi, service_name: 'Candid Photographer', start_at: `${day}T10:00:00.000Z`, end_at: `${day}T16:00:00.000Z`, estimated_cost: 5000, cost_status: 'tentative' },
  })
  const slotId = booked.json.id ?? booked.json.slot_id
  const diskName = `WD Red ${rand()}`
  const loc = await api('/data/locations', { token: aToken, method: 'POST', body: { name: diskName, kind: 'drive' } })
  const rec = await api('/data', {
    token: aToken,
    method: 'POST',
    body: { shoot_id: haldi, project_id: pid, slot_id: slotId, data_label: 'Camera A', primary_location_id: loc.json.id, folder_path: '/2027/Give/Haldi', primary_status: 'copied', card_count: 2 },
  })
  const tomorrow = new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10)
  const dl = await api(`/projects/${pid}/deliverables`, { token: aToken, method: 'POST', body: { title: 'Wedding Teaser', shoot_id: haldi } })
  const gave = await api(`/projects/${pid}/deliverables/${dl.json.id}`, { token: aToken, method: 'PATCH', body: { assignee_id: ed.uid, estimated_date: tomorrow } })

  const load = await api('/projects/deliverables/workload', { token: aToken })
  const edLoad = (load.json ?? []).find((w) => w.user_id === ed.uid)
  const due = await api('/me/due', { token: ed.token })
  const dueRow = (due.json ?? []).find((i) => i.id === dl.json.id)
  const staffLoad = await api('/projects/deliverables/workload', { token: ed.token })
  check(
    'give work: the owner sees how busy Neha is; Neha sees the edit due tomorrow in her top bar; staff cannot see the workload',
    rec.status === 201 && gave.status === 204 && edLoad?.open === 1 && dueRow?.days === 1 && dueRow?.mine === true && staffLoad.status === 403,
    { rec: rec.status, gave: gave.status, edLoad, dueRow, staffLoad: staffLoad.status },
  )

  const page = await api(`/me/projects/${pid}`, { token: ed.token })
  const sh = (page.json?.shoots ?? []).find((x) => x.id === haldi)
  const raw = JSON.stringify(page.json ?? {})
  const notHers = await api(`/me/projects/${other}`, { token: ed.token })
  const mine = (await api('/projects/deliverables/mine', { token: ed.token })).json.find((d) => d.id === dl.json.id)
  check(
    'team project page: Neha sees the Haldi crew and where its data is (disk name, folder), her edit with data ready; no money, no phone; not a project she is not on',
    page.status === 200 && sh?.crew.some((c) => c.name === 'Ravi Shooter' && c.role === 'Candid Photographer') &&
      sh?.data[0]?.main === diskName && sh?.data[0]?.folder_path === '/2027/Give/Haldi' &&
      !raw.includes('5000') && !raw.includes(client.json.phone ?? 'no-phone') && !raw.includes('estimated_cost') &&
      page.json.deliverables.some((d) => d.id === dl.json.id) && notHers.status === 404 &&
      mine?.shoots?.[0]?.data_ready === true && (mine?.data_where ?? '').includes(diskName) && !!mine?.assigned_by_name,
    { page: page.status, crew: sh?.crew, data: sh?.data?.[0], notHers: notHers.status, mine: mine && { shoots: mine.shoots, where: mine.data_where, by: mine.assigned_by_name } },
  )

  const handed = await api('/work/submissions', { token: ed.token, method: 'POST', body: { project_id: pid, deliverable_id: dl.json.id, submission_link: 'https://drive.example.com/teaser-v1' } })
  const ownerNotes = await api('/notifications?type=deliverable_submitted', { token: aToken })
  const edNotes = await api('/notifications?type=deliverable_assigned', { token: ed.token })
  check(
    'hand-in: the owner who gave the work hears "Neha Editor handed in Wedding Teaser"; her assignment alert opens the item',
    handed.status === 201 &&
      (ownerNotes.json ?? []).some((n) => n.entity_id === dl.json.id && n.title === 'Neha Editor handed in Wedding Teaser' && n.deep_link === `/projects/${pid}?tab=completed_work`) &&
      (edNotes.json ?? []).some((n) => n.entity_id === dl.json.id && n.deep_link === `/my-work?d=${dl.json.id}`),
    { handed: handed.status, owner: (ownerNotes.json ?? []).map((n) => n.title), ed: (edNotes.json ?? []).map((n) => n.deep_link) },
  )

  const pmProject = await api(`/projects/${pid}`, { token: pm.token })
  const pmBilling = await api(`/projects/${pid}/billing`, { token: pm.token })
  const pmCosts = await api(`/projects/${pid}/costs`, { token: pm.token })
  const ownerProject = await api(`/projects/${pid}`, { token: aToken })
  const pmList = (await api('/projects', { token: pm.token })).json.find((x) => x.id === pid)
  check(
    'money: a Project Manager runs the project but sees no money (value 0, billing and cost sheet 403); the owner sees it',
    pmProject.status === 200 && pmProject.json.total_cost === 0 && pmProject.json.payments.length === 0 && pmBilling.status === 403 &&
      pmCosts.status === 403 && pmList?.total_cost === 0 && ownerProject.json.total_cost > 0,
    { pm: pmProject.status, pmTotal: pmProject.json?.total_cost, pmBilling: pmBilling.status, pmCosts: pmCosts.status, owner: ownerProject.json?.total_cost },
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
