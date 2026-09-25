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
  check('receipts: numbered the day it is received, after the one before', !!d3.json.receipt_number && d3.json.receipt_number > d1.json.receipt_number, { before: d1.json.receipt_number, after: d3.json.receipt_number })
  const link = await api('/documents/receipts', { token: aToken, method: 'POST', body: { payment_id: p1.json.id } })
  const rtoken = (link.json.link ?? '').split('token=')[1] ?? ''
  const pub = await api(`/public/receipt/${rtoken}`)
  check('receipts: the client\'s receipt carries the number', pub.status === 200 && pub.json.receipt_number === d1.json.receipt_number, { status: pub.status, n: pub.json.receipt_number })
  const list = await api(`/billing/payments?search=${encodeURIComponent(d1.json.receipt_number ?? '')}&page=1&page_size=5`, { token: aToken })
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
    'templates: applying trkOne makes the project with its deliverables',
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
  const today = new Date().toISOString().slice(0, 10)
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
