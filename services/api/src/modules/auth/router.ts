import { Hono, type Context } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  registerRequest,
  registerResult,
  loginRequest,
  verifyEmailRequest,
  resendVerificationRequest,
  forgotPasswordRequest,
  forgotPasswordResult,
  resetPasswordRequest,
  changePasswordRequest,
  refreshRequest,
  logoutRequest,
  acceptInvitationRequest,
  invitationPreview,
  authToken,
  sessionState,
  completeSetupRequest,
  switchStudioRequest,
  studioMembership,
  type AuthToken,
  type PlanGate,
} from '@ipc/contracts'
import { serializeAccess, resolveAccess, type AppRole } from '@ipc/permissions'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { isDevLike } from '../../lib/env'
import { issueToken, hashPassword, verifyPassword, verifyToken, TTL_SECONDS } from '../../lib/auth-token'
import { clearRefreshCookie, cookieMode, readRefreshCookie, setRefreshCookie } from '../../lib/session-cookie'
import { originAllowed } from '../../lib/allowed-origins'
import { sendVerificationEmail, sendPasswordResetEmail } from '../../lib/email'

/**
 * A throwaway hash to verify against when no account matches, so a miss costs
 * the same argon2 work as a hit. Computed once, on first use.
 */
let decoy: string | null = null
async function decoyHash(): Promise<string> {
  decoy ??= await hashPassword(crypto.randomUUID())
  return decoy
}

/**
 * The version stamped into a freshly minted token (see issueToken). A studio
 * profile shares its login's version (0159), so one password change or
 * "sign out everywhere" strands every studio's tokens at once.
 */
async function passwordVersion(sql: TransactionSql, uid: string): Promise<number> {
  const [r] = await sql<{ password_version: number }[]>`
    select password_version from auth.users where id = auth_identity_of(${uid})`
  return r?.password_version ?? 0
}

/**
 * The one place a session is minted. Every sign-in path (login, verify, reset)
 * returns this pair: a short access token stamped with the caller's current
 * password_version, and a fresh refresh-token family.
 *
 * `uid` is a login; the session is for one of its studios. Which one is
 * `profile` when the caller already knows (a studio switch, accepting an
 * invitation into a particular studio), else the studio they were last in
 * (pick_login_profile). A person on one studio's team gets that studio, as
 * before.
 */
async function signIn(c: Context<AppEnv>, uid: string, profile?: string): Promise<AuthToken> {
  const env = c.env
  const minted = await withService(env, async (sql) => {
    const [p] = await sql<{ id: string | null }[]>`
      select pick_login_profile(${uid}, ${profile ?? null}) as id`
    const target = p?.id
    if (!target) return null
    await sql`select remember_login_profile(${target})`
    const pwv = await passwordVersion(sql, target)
    const [r] = await sql<{ token: string }[]>`select issue_refresh_token(${target}) as token`
    return { target, pwv, refresh: r!.token }
  })
  if (!minted) fail(403, 'You are not a member of that studio.')
  return pair(c, await issueToken(env, minted.target, minted.pwv), minted.refresh)
}

/** Every studio the caller's login can open, for the switcher. */
async function studiosOf(sql: TransactionSql, uid: string) {
  const rows = await sql`
    select profile_id, company_id, company_name, role, is_owner
      from list_login_profiles(auth_identity_of(${uid}))`
  return studioMembership.array().parse(rows)
}

/**
 * The wire shape of a session. In cookie mode the refresh token goes into the
 * HttpOnly cookie and the body carries an empty string in its place, so no
 * script on the page ever sees the 30-day credential.
 */
function pair(c: Context<AppEnv>, accessToken: string, refresh: string): AuthToken {
  const viaCookie = cookieMode(c.env)
  if (viaCookie) setRefreshCookie(c, refresh)
  return authToken.parse({
    access_token: accessToken,
    refresh_token: viaCookie ? '' : refresh,
    token_type: 'bearer',
    expires_in: TTL_SECONDS,
  })
}

/**
 * Whether it is safe to hand a raw token back in the response body, which the
 * automated suites rely on. Fails CLOSED: an unset or unrecognised ENVIRONMENT
 * withholds the token (see lib/env.ts).
 */
const echoesTokens = isDevLike

const verifyLink = (env: AppEnv['Bindings'], raw: string) => `${env.APP_URL}/verify?token=${raw}`
const resetLink = (env: AppEnv['Bindings'], raw: string) => `${env.APP_URL}/reset-password?token=${raw}`

/**
 * Auth router (self-issued, no GoTrue). Register creates the auth user + studio
 * and emails a verification link; sign-in is refused until the email is verified.
 */
export const authRouter = new Hono<AppEnv>()
  .post('/register', async (c) => {
    const parsed = registerRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the form and try again.')
    const { email, password, company_name, admin_name, phone } = parsed.data

    const pwHash = await hashPassword(password)

    // One transaction: create the auth user, bootstrap the studio, mint a
    // verification token. Rolls back together on any failure.
    const token = await attempt(
      c,
      'auth.register',
      () =>
        withService(c.env, async (sql) => {
          // Someone who has been invited to a studio must join it through their
          // link. Registering here would hand them a brand-new studio of their
          // own -- as its super_admin, on its own trial -- while the invitation
          // sat unaccepted and the studio that invited them saw nobody arrive.
          // We do not auto-accept: the emailed token is the only proof that the
          // person registering is the person who was invited.
          const [invited] = await sql<{ one: number }[]>`
            select 1 as one
              from user_invitations
             where email = ${email}
               and accepted_at is null
               and revoked_at is null
               and expires_at > now()
             limit 1`
          if (invited) return 'invited'

          const [u] = await sql<{ id: string }[]>`
            insert into auth.users (email, encrypted_password)
            values (${email}, ${pwHash})
            returning id`
          await sql`select set_config('request.jwt.claim.sub', ${u!.id}, true)`
          await sql`select register_company_and_admin(${company_name}, ${admin_name}, ${phone ?? null})`
          const [t] = await sql<{ token: string }[]>`select issue_email_verification(${u!.id}) as token`
          return t!.token
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (token === 'invited') {
      fail(
        409,
        'You have already been invited to a studio. Open the invitation link in your email to join it, rather than creating a new studio here.',
      )
    }
    if (token === 'taken') fail(409, 'An account with this email already exists.')
    if (!token) fail(400, 'We could not create your studio. Please try again.')

    await sendVerificationEmail(c.env, email, verifyLink(c.env, token))

    return c.json(
      registerResult.parse({
        verification_required: true,
        email,
        // Expose the token in test environments so automated suites can verify.
        ...(echoesTokens(c.env) ? { verification_token: token } : {}),
      }),
    )
  })

  .post('/verify', async (c) => {
    const parsed = verifyEmailRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid verification link.')

    const uid = await attempt(c, 'auth.verify', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql<{ uid: string | null }[]>`
          select consume_email_verification(${parsed.data.token}) as uid`
        return r?.uid ?? null
      }),
    )
    if (!uid) fail(400, 'This verification link is invalid or has expired.')

    // Verified → sign them straight in.
    return c.json(await signIn(c, uid))
  })

  .post('/resend-verification', async (c) => {
    const parsed = resendVerificationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email.')

    const raw = await attempt(c, 'auth.resend_verification', () =>
      withService(c.env, async (sql) => {
        const [u] = await sql<{ id: string; email_verified: boolean }[]>`
          select id, email_verified from auth.users where email = ${parsed.data.email}`
        if (!u || u.email_verified) return null
        const [t] = await sql<{ token: string }[]>`select issue_email_verification(${u.id}) as token`
        return t!.token
      }),
    )
    // Dispatched, not awaited: waiting on the mail provider only when the
    // account exists turns the uniform 200 into a timing oracle.
    if (raw) void sendVerificationEmail(c.env, parsed.data.email, verifyLink(c.env, raw))
    // Always 200 — never leak whether an account exists.
    return c.json({ ok: true })
  })

  .post('/login', async (c) => {
    const parsed = loginRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email and password.')
    const { email, password } = parsed.data

    const rows = await attempt(c, 'auth.login', () =>
      withService(
        c.env,
        (sql) =>
          sql<{ id: string; encrypted_password: string | null; email_verified: boolean }[]>`
            select id, encrypted_password, email_verified from auth.users where email = ${email}`,
      ),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const row = rows[0]
    // Always spend a verification, even for an unknown address: short-circuiting
    // here made a miss answer an order of magnitude faster than a hit, which
    // enumerates the customer base by latency alone.
    const ok = await verifyPassword(password, row?.encrypted_password ?? (await decoyHash()))
    if (!row?.encrypted_password || !ok) {
      fail(401, 'Invalid email or password.')
    }
    if (!row.email_verified) {
      fail(403, 'Please verify your email before signing in. Check your inbox for the link.')
    }

    return c.json(await signIn(c, row.id))
  })

  .post('/google', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const token = typeof body.id_token === 'string' ? body.id_token.trim() : ''
    if (!token) fail(422, 'Missing Google token.')
    if (!c.env.GOOGLE_CLIENT_ID) fail(503, 'Google login is not configured on this server.')

    // Verify via Google tokeninfo (no secret needed for GIS id_token)
    let info: Record<string, string>
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`)
      if (!res.ok) fail(401, 'Invalid Google token. Please try again.')
      info = (await res.json()) as Record<string, string>
    } catch {
      fail(401, 'Could not verify Google token. Please try again.')
    }
    if (info.aud !== c.env.GOOGLE_CLIENT_ID) fail(401, 'Google token audience mismatch.')
    if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') {
      fail(401, 'Invalid Google token issuer.')
    }
    if (info.email_verified !== 'true') fail(401, 'Your Google email is not verified.')
    const email = (info.email ?? '').toLowerCase().trim()
    if (!email) fail(401, 'No email in Google token.')

    const rows = await attempt(c, 'auth.google.lookup', () =>
      withService(c.env, (sql) => sql<{ id: string; email_verified: boolean }[]>`select id, email_verified from auth.users where lower(email) = ${email}`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const row = rows[0]

    // No account with this email at all: Google already proved mailbox control,
    // so this is a first-time sign-in, not a dead end -- create the identity and
    // send them to /complete-setup to name their studio, the same as the original
    // app's Google flow. No company exists yet, so nothing else is created here.
    if (!row) {
      const created = await attempt(c, 'auth.google.create', () =>
        withService(c.env, async (sql) => {
          const [u] = await sql<{ id: string }[]>`
            insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
            values (${email}, null, true, now())
            returning id`
          return u!.id
        }),
      )
      if (!created) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
      return c.json({ ...(await signIn(c, created)), needs_setup: true })
    }

    // Google proves mailbox control: auto-verify if still pending
    if (!row.email_verified) {
      await attempt(c, 'auth.google.verify', () =>
        withService(c.env, (sql) => sql`update auth.users set email_verified = true where id = ${row.id}`),
      )
    }

    return c.json(await signIn(c, row.id))
  })

  // Second half of the Google-signup path: the identity already exists (just
  // minted by /google above), but no studio does yet. Deliberately NOT behind
  // requireAuth -- that requires get_auth_context() to already resolve a
  // company, which is exactly what does not exist until this call succeeds.
  .post('/complete-setup', async (c) => {
    const auth = c.req.header('Authorization') ?? ''
    const [scheme, token] = auth.split(' ')
    if (scheme !== 'Bearer' || !token) fail(401, 'Please sign in to continue.')
    const claims = await verifyToken(c.env, token)
    if (!claims) fail(401, 'Your session has expired. Please sign in again.')

    const parsed = completeSetupRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the form and try again.')
    const { company_name, admin_name, phone } = parsed.data

    const result = await attempt(c, 'auth.complete_setup', () =>
      withService(c.env, async (sql) => {
        const [u] = await sql<{ email: string }[]>`select email from auth.users where id = ${claims.uid}`
        if (!u) return 'no_user'
        // Same guard as /register: someone already invited to a studio joins it
        // through their link, not by naming a brand-new one here.
        const [invited] = await sql<{ one: number }[]>`
          select 1 as one
            from user_invitations
           where email = ${u.email}
             and accepted_at is null
             and revoked_at is null
             and expires_at > now()
           limit 1`
        if (invited) return 'invited'
        await sql`select set_config('request.jwt.claim.sub', ${claims.uid}, true)`
        await sql`select register_company_and_admin(${company_name}, ${admin_name}, ${phone ?? null})`
        return 'ok'
      }),
    )
    if (result === 'no_user') fail(401, 'Your session has expired. Please sign in again.')
    if (result === 'invited') {
      fail(
        409,
        'You have already been invited to a studio. Open the invitation link in your email to join it, rather than creating a new studio here.',
      )
    }
    if (!result) fail(400, 'We could not set up your studio. Please try again.')

    // The studio exists now -- hydrate the same session shape GET /session returns.
    const row = await attempt(c, 'auth.complete_setup_session', () =>
      withUser(c.env, claims.uid, async (sql) => {
        const rows = await sql<
          {
            company_id: string
            role: AppRole
            is_owner: boolean
            is_platform_admin: boolean
            display_name: string
            email: string
            plan_expiry: string | null
            plan_gate: PlanGate
            profile_key: string | null
            overrides: { permission_key: string; enabled: boolean }[] | null
          }[]
        >`select * from get_auth_context()`
        return rows[0]
      }),
    )
    if (!row) fail(400, 'Your studio was created, but we could not load your session. Please sign in again.')
    const access = resolveAccess({
      role: row.role,
      isOwner: row.is_owner,
      profileKey: row.profile_key,
      overrides: row.overrides ?? [],
    })
    return c.json(
      sessionState.parse({
        user_id: claims.uid,
        company_id: row.company_id,
        role: row.role,
        is_owner: row.is_owner,
        is_platform_admin: row.is_platform_admin ?? false,
        display_name: row.display_name,
        email: row.email,
        plan_gate: row.plan_gate,
        plan_expiry: row.plan_expiry,
        permissions: serializeAccess(access),
      }),
    )
  })

  .post('/forgot-password', async (c) => {
    const parsed = forgotPasswordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your email.')

    const raw = await attempt(c, 'auth.forgot_password', () =>
      withService(c.env, async (sql) => {
        const [u] = await sql<{ id: string }[]>`
          select id from auth.users where email = ${parsed.data.email}`
        if (!u) return null
        const [t] = await sql<{ token: string }[]>`select issue_password_reset(${u.id}) as token`
        return t!.token
      }),
    )
    // Dispatched, not awaited: waiting on the mail provider only when the
    // account exists turns the uniform 200 into a timing oracle.
    if (raw) void sendPasswordResetEmail(c.env, parsed.data.email, resetLink(c.env, raw))

    // Always 200 — never leak whether an account exists.
    return c.json(
      forgotPasswordResult.parse({
        ok: true,
        // Expose the token in test environments so automated suites can reset.
        ...(raw && echoesTokens(c.env) ? { reset_token: raw } : {}),
      }),
    )
  })

  .post('/reset-password', async (c) => {
    const parsed = resetPasswordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please choose a password of at least 8 characters.')

    // Hash first (Bun-side argon2id), then swap it in as the token is consumed —
    // one transaction, so a half-done reset can't leave the account unusable.
    const pwHash = await hashPassword(parsed.data.password)
    const uid = await attempt(c, 'auth.reset_password', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql<{ uid: string | null }[]>`
          select consume_password_reset(${parsed.data.token}, ${pwHash}) as uid`
        // Refresh tokens are revoked here, not in SQL: the reset RPC predates
        // them and stays focused on the password.
        if (r?.uid) await sql`select revoke_all_sessions(${r.uid})`
        return r?.uid ?? null
      }),
    )
    if (!uid) fail(400, 'This reset link is invalid or has expired. Please request a new one.')

    // Reset proves mailbox control → sign them straight in. Every session issued
    // before it now carries a stale password_version and is refused.
    return c.json(await signIn(c, uid))
  })

  // Change the password from inside a signed-in session. The current password
  // is the proof; every other device is signed out, and this one gets a fresh
  // pair so it is not stranded by its own version bump.
  .post('/change-password', requireAuth, async (c) => {
    const parsed = changePasswordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Use at least 8 characters, and not the current password.')
    // The password belongs to the login, not to the studio this session is
    // in: a person on three studios' teams has one password.
    const uid = c.get('auth').userId

    const rows = await attempt(c, 'auth.change_password.lookup', () =>
      withService(
        c.env,
        (sql) => sql<{ encrypted_password: string | null }[]>`
          select encrypted_password from auth.users where id = auth_identity_of(${uid})`,
      ),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const current = rows[0]?.encrypted_password
    const ok = await verifyPassword(parsed.data.current_password, current ?? (await decoyHash()))
    if (!current || !ok) fail(401, 'Your current password is incorrect.')

    const pwHash = await hashPassword(parsed.data.new_password)
    const done = await attempt(c, 'auth.change_password', () =>
      withService(c.env, async (sql) => {
        await sql`
          update auth.users
             set encrypted_password = ${pwHash}, password_changed_at = now()
           where id = auth_identity_of(${uid})`
        // Bumps password_version and revokes every refresh family, in every
        // studio this login belongs to.
        await sql`select revoke_all_sessions(${uid})`
        return true
      }),
    )
    if (!done) fail(400, 'We could not change your password. Please try again.')

    await audit(c, { action: 'account.password_changed', entityType: 'user', entityId: uid })
    return c.json(await signIn(c, uid, uid))
  })

  // ── Invitations ─────────────────────────────────────────────
  // Both halves are public: the invitee has no session until they accept. The
  // token in the link is the only credential, and it is matched against a hash.
  .get('/invite', async (c) => {
    const token = c.req.query('token')
    if (!token) fail(422, 'This invitation link is incomplete.')

    const rows = await attempt(c, 'auth.peek_invite', () =>
      withService(
        c.env,
        (sql) => sql<
          { email: string; name: string; company_name: string; role: string; expires_at: string }[]
        >`select * from peek_user_invitation(${token})`,
      ),
    )
    // A database failure is an outage, not a bad link.
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const row = rows[0]
    if (!row) fail(404, 'This invitation is invalid, revoked, or has expired.')

    return c.json(invitationPreview.parse(row))
  })

  .post('/accept-invite', async (c) => {
    const parsed = acceptInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter a password.')

    // Someone already signing in to IPC -- on another studio's team, or with a
    // studio of their own -- joins with that login, not a second one. Their
    // existing password is the proof here, on top of the link: the link alone
    // proves the mailbox, and the page told them which password it wants.
    const existing = await attempt(c, 'auth.accept_invite.lookup', () =>
      withService(
        c.env,
        (sql) => sql<{ id: string; encrypted_password: string | null; email_verified: boolean }[]>`
          select au.id, au.encrypted_password, au.email_verified
            from peek_user_invitation(${parsed.data.token}) i
            join auth.users au on lower(au.email) = lower(i.email) and au.identity_id is null`,
      ),
    )
    if (!existing) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const login = existing[0]
    const isLogin = !!login && (!!login.encrypted_password || login.email_verified)
    if (isLogin && login.encrypted_password) {
      const ok = await verifyPassword(parsed.data.password, login.encrypted_password)
      if (!ok) fail(401, 'That is not the password for your existing IPC login.')
    } else if (!isLogin && parsed.data.password.length < 8) {
      fail(422, 'Please choose a password of at least 8 characters.')
    }

    // Hash first, then consume: the SQL side creates the identity and the tenant
    // row in one transaction, so a failure leaves no half-built member behind.
    const pwHash = await hashPassword(parsed.data.password)
    const uid = await attempt(
      c,
      'auth.accept_invite',
      () =>
        withService(c.env, async (sql) => {
          const [r] = await sql<{ uid: string | null }[]>`
            select consume_user_invitation(${parsed.data.token}, ${pwHash}) as uid`
          return r?.uid ?? null
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (uid === 'taken') fail(409, 'An account with this email already exists. Please sign in instead.')
    if (!uid) fail(400, 'This invitation is invalid, revoked, or has expired.')

    // Following the link proves mailbox control, so acceptance signs them in --
    // into the studio that invited them, whichever others they belong to.
    return c.json(await signIn(c, uid, uid))
  })

  .post('/refresh', async (c) => {
    const parsed = refreshRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Missing refresh token.')
    // A cookie-presented token arrives without the page's involvement, so a
    // forged cross-site POST must not spend it: browsers always send Origin
    // on POST, and only allowlisted origins may rotate by cookie.
    const fromCookie = parsed.data.refresh_token == null && readRefreshCookie(c) != null
    if (fromCookie && !originAllowed(c.env, c.req.header('origin'))) {
      fail(403, 'Your session has expired. Please sign in again.')
    }
    // Body first (the client that holds one), else the HttpOnly cookie.
    const presented = parsed.data.refresh_token ?? readRefreshCookie(c)
    if (!presented) fail(422, 'Missing refresh token.')

    const rotated = await attempt(c, 'auth.refresh', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql<{ user_id: string | null; token: string | null }[]>`
          select * from rotate_refresh_token(${presented})`
        if (!r?.user_id || !r.token) return 'refused' as const
        return { uid: r.user_id, refresh: r.token, pwv: await passwordVersion(sql, r.user_id) }
      }),
    )
    // An outage must not read as "session over" — the client would drop
    // perfectly good tokens on a blip.
    if (!rotated) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (rotated === 'refused') {
      if (cookieMode(c.env)) clearRefreshCookie(c)
      fail(401, 'Your session has expired. Please sign in again.')
    }

    return c.json(pair(c, await issueToken(c.env, rotated.uid, rotated.pwv), rotated.refresh))
  })

  .post('/logout', async (c) => {
    const parsed = logoutRequest.safeParse(await c.req.json().catch(() => ({})))
    // Sign-out never fails: the client has already dropped its tokens.
    const raw = (parsed.success ? parsed.data.refresh_token : undefined) ?? readRefreshCookie(c)
    if (raw) {
      await attempt(c, 'auth.logout', () =>
        withService(c.env, (sql) => sql`select revoke_refresh_family(${raw})`),
      )
    }
    if (cookieMode(c.env)) clearRefreshCookie(c)
    return c.json({ ok: true })
  })

  // Sign out everywhere, this device included: revokes every refresh family and
  // bumps password_version, which strands the access tokens already out there.
  .post('/logout-all', requireAuth, async (c) => {
    const uid = c.get('auth').userId
    // Unlike /logout, the server-side revocation IS the feature — a swallowed
    // error here would tell the user every device was signed out when none was.
    const revoked = await attempt(c, 'auth.logout_all', () =>
      withService(c.env, (sql) => sql`select revoke_all_sessions(${uid})`),
    )
    if (!revoked) fail(400, 'We could not sign out your other devices. Please try again.')
    if (cookieMode(c.env)) clearRefreshCookie(c)
    await audit(c, { action: 'account.signed_out_everywhere', entityType: 'user', entityId: uid })
    return c.json({ ok: true })
  })

  // Open another studio this login belongs to. A fresh pair for that studio's
  // profile; the session being left gives up its refresh family, so switching
  // back and forth does not pile up live tokens.
  .post('/switch', requireAuth, async (c) => {
    const parsed = switchStudioRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please choose a studio.')
    const uid = c.get('auth').userId
    const token = await signIn(c, uid, parsed.data.profile_id)
    const leaving = parsed.data.refresh_token ?? readRefreshCookie(c)
    if (leaving && parsed.data.profile_id !== uid) {
      await attempt(c, 'auth.switch.revoke', () =>
        withService(c.env, (sql) => sql`select revoke_refresh_family(${leaving})`),
      )
    }
    await audit(c, {
      action: 'account.studio_switched',
      entityType: 'user',
      entityId: uid,
      after: { to_profile: parsed.data.profile_id },
    })
    return c.json(token)
  })

  // Whole-session hydration for an established tenant.
  .get('/session', requireAuth, async (c) => {
    const a = c.get('auth')
    // A failure here costs the switcher, not the session.
    const studios = (await attempt(c, 'auth.session.studios', () =>
      withService(c.env, (sql) => studiosOf(sql, a.userId)),
    )) ?? []
    return c.json(
      sessionState.parse({
        user_id: a.userId,
        company_id: a.companyId,
        role: a.role,
        is_owner: a.isOwner,
        is_platform_admin: a.isPlatformAdmin,
        display_name: a.displayName,
        email: a.email,
        plan_gate: a.planGate,
        plan_expiry: a.planExpiry,
        permissions: serializeAccess(a.access),
        studios,
      }),
    )
  })
