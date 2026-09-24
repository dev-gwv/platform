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

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  // Login is refused until verified.
  const blocked = await api('/auth/login', { method: 'POST', body: { email, password: 'Testpass12345!' } })
  check(`${label}: login blocked before verification (403)`, blocked.status === 403)

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
check('refresh: the spent token is refused (401)', spent.status === 401)

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

  const inD = await api('/team/members', { token: d.token, method: 'POST', body: member('Ignored12345!') })
  check(
    'multi: studio B adds the same email -- linked to the existing login, not refused',
    inD.status === 201 && inD.json.linked_existing_login === true && inD.json.user_id !== inC.json.user_id,
    inD.json,
  )

  // D's typed password was not used: it is the freelancer's own that works.
  const wrong = await api('/auth/login', { method: 'POST', body: { email: shared, password: 'Ignored12345!' } })
  check("multi: the password studio B typed does not sign in", wrong.status === 401, wrong.json)
  const login = await api('/auth/login', { method: 'POST', body: { email: shared, password: 'Freelance12345!' } })
  check('multi: the freelancer signs in with their own password', login.status === 200, login.json)

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

  const added = await api(`/projects/${pid}/deliverables`, {
    token: aToken,
    method: 'POST',
    body: { title: 'Highlight film', shoot_id: shoot.json.id, assignee_id: edUid, visibility_scope: 'client' },
  })
  const detail = await api(`/projects/${pid}`, { token: aToken })
  const film = (detail.json.deliverables ?? []).find((d) => d.id === added.json.id)
  check(
    'deliverables: one is tied to its shoot and its editor',
    added.status === 201 && film?.shoot_name === 'Wedding day' && film?.assignee_name === 'Priya Editor' && film?.status === 'pending',
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

  // A project template creates a real project now -- and asks for a client.
  const tpl = await api('/projects/templates', {
    token: aToken,
    method: 'POST',
    body: { name: `Wedding ${rand()}`, deliverables_json: [{ name: 'Album', quantity: 2 }], shoots_json: [{ name: 'Haldi' }], tasks_json: [{ title: 'Call client' }] },
  })
  const noClient = await api(`/projects/templates/${tpl.json.id}/apply`, { token: aToken, method: 'POST', body: { name: 'From template' } })
  const applied = await api(`/projects/templates/${tpl.json.id}/apply`, {
    token: aToken,
    method: 'POST',
    body: { name: 'From template', client_id: client.json.id, start_date: '2026-12-01' },
  })
  const made = await api(`/projects/${applied.json.project_id}`, { token: aToken })
  check(
    'templates: applying one makes the project with its deliverables',
    noClient.status === 422 && applied.status === 201 && made.json.deliverables?.[0]?.title === 'Album ×2',
    { noClient: noClient.status, applied: applied.json, made: made.json.deliverables },
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
  check('terms: sending again makes a new link and stops the old one', again.status === 200 && oldLink.status === 404 && newLink.status === 200, {
    again: again.status, old: oldLink.status, fresh: newLink.status,
  })

  const cancelled = await api(`/terms/documents/${sent.json.document_id}/revoke`, { token: aToken, method: 'POST' })
  const afterCancel = await api(`/public/terms/${tokenOf(again.json.url)}/payload`)
  const legacy = await api(`/public/terms/${tokenOf(again.json.url)}`)
  const lateAgree = await api(`/public/terms/${tokenOf(again.json.url)}/ack`, { method: 'POST', body: { name: 'Priya' } })
  check('terms: a cancelled link does not open, on either reader, and cannot be agreed', cancelled.status === 200 && afterCancel.status === 404 && legacy.status === 404 && lateAgree.status === 409, {
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
  const after = await listed()
  const detail = await api(`/projects/${pid}`, { token: aToken })
  check(
    'money: marking a promised payment received counts it',
    marked.status === 204 && Number(after?.received) === 50000 && detail.json.payments.every((x) => x.status === 'paid'),
    { marked: marked.status, after },
  )
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
