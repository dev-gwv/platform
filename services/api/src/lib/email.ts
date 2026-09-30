import type { Env } from '../context'
import { withService } from './db'

/** What the email service is asked to send. */
export interface Outgoing {
  from?: string
  to: string
  subject: string
  html: string
  text?: string
  reply_to?: string
}

export type DeliveryResult = { status: 'sent' | 'provider_missing' | 'failed'; id?: string; error?: string }

/**
 * Every email the app sends goes through here (0217): one call to Resend, and
 * one row in email_log saying what Resend answered. Before this, sign-up and
 * password emails only wrote a failure to the server log, so "the mail did not
 * arrive" could not be told apart from "the mail was never sent". Never throws.
 */
export async function deliver(env: Env, mail: Outgoing, meta: { kind: string; companyId?: string | null }): Promise<DeliveryResult> {
  let result: DeliveryResult
  if (!env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY unset — skipping "${mail.subject}" to ${mail.to}`)
    result = { status: 'provider_missing', error: 'Email is not set up on the server (RESEND_API_KEY is empty).' }
  } else if (!(mail.from ?? env.EMAIL_FROM)) {
    result = { status: 'failed', error: 'Email not sent: the server has no sender address (EMAIL_FROM is empty).' }
  } else {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...mail, from: mail.from ?? env.EMAIL_FROM }),
      })
      if (!res.ok) {
        result = { status: 'failed', error: await providerRefusal(res) }
      } else {
        const json = (await res.json().catch(() => ({}))) as { id?: string }
        result = { status: 'sent', ...(json.id ? { id: json.id } : {}) }
      }
    } catch (e) {
      console.error('[email] send threw', e)
      result = { status: 'failed', error: 'Email not sent: could not reach the email service.' }
    }
  }
  await logDelivery(env, mail, meta, result)
  return result
}

/** One row per send. A log that cannot be written never costs the email. */
async function logDelivery(env: Env, mail: Outgoing, meta: { kind: string; companyId?: string | null }, r: DeliveryResult) {
  if (!env.DATABASE_URL) return
  try {
    await withService(env, (sql) => sql`
      insert into email_log (company_id, kind, to_address, subject, status, provider_message_id, error)
      values (${meta.companyId ?? null}, ${meta.kind.slice(0, 40)}, ${mail.to.slice(0, 320)}, ${mail.subject.slice(0, 300)},
              ${r.status === 'sent' ? 'sent' : r.status === 'provider_missing' ? 'skipped' : 'failed'},
              ${r.id ?? null}, ${r.error?.slice(0, 500) ?? null})`)
  } catch (e) {
    console.error('[email] could not write email_log', e)
  }
}

/**
 * Transactional email. Non-fatal by design: the studio still exists and the
 * user can ask for it again. The outcome is in email_log either way.
 */
async function send(env: Env, to: string, subject: string, html: string, kind = 'notice'): Promise<void> {
  await deliver(env, { to, subject, html }, { kind })
}

export function sendVerificationEmail(env: Env, to: string, link: string): Promise<void> {
  return send(
    env,
    to,
    'Verify your Studio AutoPilot email',
    brandedHtml({
      title: 'Verify your email',
      preheader: 'Confirm your email to activate your Studio AutoPilot workspace.',
      body: 'Welcome! Confirm your email address to activate your studio workspace.',
      cta: 'Verify email',
      link,
      footer: "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    }),
    'verification',
  )
}

export function sendPasswordResetEmail(env: Env, to: string, link: string): Promise<void> {
  return send(
    env,
    to,
    'Reset your Studio AutoPilot password',
    brandedHtml({
      title: 'Reset your password',
      preheader: 'Choose a new password for your Studio AutoPilot account.',
      body: 'We received a request to reset your password. Choose a new one to get back in.',
      cta: 'Reset password',
      link,
      footer:
        "This link expires in 1 hour and can be used once. If you didn't request a reset, ignore this email — your password stays unchanged.",
    }),
    'password_reset',
  )
}

/**
 * The studio's name leads, not ours: to the invitee this is "Sharma Studios
 * added me", and an email that opens with a vendor they've never heard of reads
 * like phishing.
 */
export function sendInvitationEmail(
  env: Env,
  to: string,
  link: string,
  companyName: string,
): Promise<void> {
  return send(
    env,
    to,
    `${companyName} invited you to Studio AutoPilot`,
    brandedHtml({
      title: `Join ${companyName}`,
      preheader: `${companyName} added you to their studio on Studio AutoPilot.`,
      body: `${companyName} has added you to their team. Set a password to open your dashboard and see the work assigned to you.`,
      cta: 'Accept invitation',
      link,
      footer:
        "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.",
    }),
    'invitation',
  )
}

interface MailCopy {
  title: string
  preheader: string
  body: string
  /** Without both, the email has no button (a client's payment reminder). */
  cta?: string | undefined
  link?: string | undefined
  footer: string
  /** Mail a studio sends to its own client wears the studio's name. */
  brand?: StudioBrand | undefined
}

/**
 * Who a studio's email is from. Every studio's mail to its clients leads with
 * the studio; with white_label (0202) nothing in it says Studio AutoPilot at all,
 * and the studio chooses the sender name, reply-to and footer.
 */
export interface StudioBrand {
  name: string
  logoUrl: string | null
  replyTo: string | null
  fromName: string | null
  footerLine: string | null
  whiteLabel: boolean
}

/** "Asha Studio via Studio AutoPilot <noreply@…>", or with white label "Asha Studio <noreply@…>". */
export function studioFrom(envFrom: string, brand: StudioBrand): string {
  const address = /<([^>]+)>/.exec(envFrom)?.[1] ?? envFrom.trim()
  const clean = (t: string) => t.replace(/["<>\r\n\\]/g, '').trim().slice(0, 60)
  const name = brand.whiteLabel ? clean(brand.fromName || brand.name) : `${clean(brand.name)} via Studio AutoPilot`
  return `"${name}" <${address}>`
}

/** The footer line under a studio's email. */
export function studioFooter(brand: StudioBrand): string {
  if (brand.whiteLabel) return brand.footerLine ? esc(brand.footerLine) : esc(brand.name)
  return `Sent for ${esc(brand.name)} by Studio AutoPilot.`
}

/** Branded, email-client-safe HTML (table layout + inline styles). */
function brandedHtml({ title, preheader, body, cta, link, footer, brand }: MailCopy): string {
  const navy = '#1b2a4a' // navy (badge + button)
  const accent = '#f2a618' // gold (wordmark "AutoPilot")
  const studio = brand
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <!-- preheader (hidden) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${preheader}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0"
                 style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <!-- header -->
            <tr>
              <td align="center" style="padding:32px 32px 8px;">
                ${studio ? studioHeader(studio) : `<table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:44px;height:44px;background:${navy};border-radius:12px;text-align:center;vertical-align:middle;font-size:22px;line-height:44px;">📷</td>
                  </tr>
                </table>
                <div style="margin-top:12px;font-size:18px;font-weight:800;letter-spacing:-0.02em;"><span style="color:#1b2a4a;">Studio</span><span style="color:${accent};">AutoPilot</span></div>`}
              </td>
            </tr>
            <!-- body -->
            <tr>
              <td style="padding:8px 32px 4px;">
                <h1 style="margin:16px 0 8px;font-size:20px;font-weight:600;color:#111827;text-align:center;">${title}</h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;text-align:center;">
                  ${body}
                </p>
                ${cta && link ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="padding:4px 0 8px;">
                      <a href="${link}"
                         style="display:inline-block;background:${navy};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">
                        ${cta}
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 6px;font-size:12px;color:#6b7280;text-align:center;">Or paste this link into your browser:</p>
                <p style="margin:0 0 8px;font-size:12px;text-align:center;word-break:break-all;">
                  <a href="${link}" style="color:${navy};text-decoration:none;">${link}</a>
                </p>` : ''}
              </td>
            </tr>
            <!-- footer -->
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #f3f4f6;">
                <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
                  ${footer}
                </p>
              </td>
            </tr>
          </table>
          ${studio?.whiteLabel ? '' : '<div style="margin-top:16px;font-size:11px;color:#9ca3af;">© Studio AutoPilot</div>'}
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/**
 * Why the email service said no, in words a studio can act on -- and the
 * full answer in the server log. "Email failed to send." told nobody that
 * the sending domain was not verified, which is the usual reason.
 */
export async function providerRefusal(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '')
  console.error(`[email] provider refused ${res.status}: ${raw.slice(0, 500)}`)
  let said = ''
  try {
    said = String((JSON.parse(raw) as { message?: unknown }).message ?? '')
  } catch {
    said = raw
  }
  const why =
    res.status === 403
      ? 'the email service does not allow this sender yet (the sending domain needs verifying in Resend)'
      : res.status === 429
        ? 'too many emails at once, try again in a minute'
        : res.status === 422 || res.status === 400
          ? 'the email service rejected the message'
          : `the email service answered ${res.status}`
  return `Email not sent: ${why}${said ? ` (${said.replace(/\s+/g, ' ').trim().slice(0, 160)})` : ''}.`
}

/** The plain-text twin of an email body: some inboxes read only this, and spam filters like to see it. */
const plainText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/**
 * Client document emails (receipt / quotation / terms / delivery).
 * Returns 'sent' | 'provider_missing' so the studio UI can fall back to
 * mailto:/copy-link instead of claiming an email went; on 'sent' the email
 * service's message id, so a send can be looked up. Never throws.
 */
export async function sendClientDocEmail(
  env: Env,
  to: string | null | undefined,
  subject: string,
  link: string,
  intro: string,
  brand?: StudioBrand | null,
): Promise<{ status: 'sent' | 'provider_missing' | 'failed'; error?: string; id?: string; url: string }> {
  if (!env.RESEND_API_KEY) return { status: 'provider_missing', url: link }
  if (!to) return { status: 'failed', error: 'Client email not found for this project.', url: link }
  // A link without the site in front of it opens nothing from an inbox.
  if (!/^https?:\/\//.test(link)) {
    console.error('[email] refusing to email a relative link; set APP_URL on the server')
    return { status: 'failed', error: 'Email not sent: the server does not know its own web address (APP_URL is not set).', url: link }
  }
  const footer = brand ? studioFooter(brand) : 'If you were not expecting this, you can ignore this email.'
  const r = await deliver(
    env,
    {
      ...(brand ? { from: studioFrom(env.EMAIL_FROM, brand) } : {}),
      to,
      subject,
      ...(brand?.replyTo ? { reply_to: brand.replyTo } : {}),
      text: `${plainText(intro)}\n\nOpen it here: ${link}\n\n${plainText(footer)}`,
      html: brandedHtml({
        title: esc(subject),
        preheader: plainText(intro).slice(0, 140),
        body: intro,
        cta: 'Open document',
        link,
        footer,
        brand: brand ?? undefined,
      }),
    },
    { kind: 'client_doc' },
  )
  return { ...r, url: link }
}

/**
 * The studio owner hears when a client agrees -- by email as well as the bell,
 * because the owner is often not in the app when it happens.
 */
export function sendTermsAgreedEmail(
  env: Env,
  to: string,
  about: { clientName: string; projectName: string | null; agreedBy: string; link: string },
): Promise<void> {
  const what = about.projectName ? `the terms for ${esc(about.projectName)}` : 'your terms'
  return send(
    env,
    to,
    `${about.agreedBy} agreed to ${about.projectName ? `the terms for ${about.projectName}` : 'your terms'}`,
    brandedHtml({
      title: `${esc(about.agreedBy)} agreed`,
      preheader: `${about.clientName} agreed to ${what}.`,
      body: `${esc(about.agreedBy)} (${esc(about.clientName)}) read and agreed to ${what}. Their name, the time and their IP address are on record.`,
      cta: 'Open the project',
      link: about.link,
      footer: 'You get this email each time a client agrees to terms you sent from Studio AutoPilot.',
    }),
    'terms_agreed',
  )
}

/**
 * A message a studio's sequence writes to its lead (0202): plain words, the
 * studio's name on it, replies going to the studio. Never throws.
 */
export async function sendStudioEmail(
  env: Env,
  m: { to: string; subject: string; text: string; brand: StudioBrand },
): Promise<{ status: 'sent' | 'provider_missing' | 'failed'; id?: string; error?: string }> {
  if (!env.RESEND_API_KEY) return { status: 'provider_missing' }
  return deliver(
    env,
    {
      from: studioFrom(env.EMAIL_FROM, m.brand),
      to: m.to,
      subject: m.subject,
      ...(m.brand.replyTo ? { reply_to: m.brand.replyTo } : {}),
      text: m.text,
      html: brandedHtml({
        title: esc(m.subject),
        preheader: esc(m.text.slice(0, 120)),
        body: `<span style="display:block;text-align:left;">${linkify(esc(m.text)).replace(/\n/g, '<br>')}</span>`,
        footer: studioFooter(m.brand),
        brand: m.brand,
      }),
    },
    { kind: 'sequence' },
  )
}

/** Make the links in already-escaped text clickable. */
const linkify = (escaped: string) =>
  escaped.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1b2a4a;">${u}</a>`)

/**
 * Terms sent to someone the studio has booked.
 *
 * Returns whether it actually went: unlike the others, the caller shows the
 * result on screen ("emailed" vs "copy the link"), so swallowing a failure
 * here would be a lie rather than a graceful degradation.
 */
export async function sendTeamTermsEmail(
  env: Env,
  to: string,
  link: string,
  about: { companyName: string; shootName: string | null; title: string; mustSign: boolean },
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false
  const forShoot = about.shootName ? ` for ${about.shootName}` : ''
  const r = await deliver(
    env,
    {
        to,
        subject: `${about.companyName}: ${about.title}${forShoot}`,
        html: brandedHtml({
          title: about.title,
          preheader: `${about.companyName} sent you the terms${forShoot}.`,
          body: about.mustSign
            ? `${about.companyName} has sent you the terms${forShoot}. Please read them and confirm you agree.`
            : `${about.companyName} has sent you the terms${forShoot}. Please read them before the day.`,
          cta: about.mustSign ? 'Read and agree' : 'Read the terms',
          link,
          footer: 'If you were not expecting this, you can ignore this email.',
        }),
    },
    { kind: 'team_terms' },
  )
  return r.status === 'sent'
}

/**
 * One message from the messaging wallet's outbox (a copy of a notification).
 * Returns what happened rather than throwing, so the worker can refund a
 * failure. 'provider_missing' = RESEND_API_KEY unset (dev/CI).
 */
export async function sendMessageEmail(
  env: Env,
  m: { to: string; subject: string; body: string | null; link: string | null; studio: string; toClient?: boolean },
): Promise<{ status: 'sent' | 'provider_missing' | 'failed'; id?: string; error?: string }> {
  if (!env.RESEND_API_KEY) return { status: 'provider_missing' }
  const link = m.link ? (m.link.startsWith('http') ? m.link : `${(env.APP_URL ?? '').replace(/\/+$/, '')}${m.link}`) : null
  return deliver(
    env,
    {
        to: m.to,
        subject: m.subject,
        html: brandedHtml({
          title: esc(m.subject),
          preheader: esc((m.body ?? m.subject).slice(0, 120)),
          body: m.toClient
            ? `<span style="display:block;text-align:left;">${esc(m.body ?? '').replace(/\n/g, '<br>')}</span>`
            : esc(m.body ?? '').replace(/\n/g, '<br>'),
          // A studio's client has no Studio AutoPilot account: no "open the app" button.
          cta: m.toClient ? undefined : 'Open Studio AutoPilot',
          link: m.toClient ? undefined : (link ?? (env.APP_URL || 'https://studioautopilot.in')),
          footer: `Sent for ${esc(m.studio)} by Studio AutoPilot.`,
        }),
    },
    { kind: 'message' },
  )
}

/** The studio's logo when it has a web address for one, else its name. */
function studioHeader(b: StudioBrand): string {
  const logo = b.logoUrl && /^https:\/\//.test(b.logoUrl) ? b.logoUrl : null
  return logo
    ? `<img src="${esc(logo)}" alt="${esc(b.name)}" style="max-height:56px;max-width:200px;border:0;display:block;margin:0 auto;" />`
    : `<div style="font-size:20px;font-weight:600;letter-spacing:-0.01em;color:#111827;">${esc(b.name)}</div>`
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A studio's "Suggest a feature", to the platform team's inbox. Non-fatal:
 * the suggestion is already saved, and the platform page lists every one.
 */
export function sendFeatureRequestEmail(
  env: Env,
  s: { studio: string; person: string; page: string | null; text: string | null; hasVoice: boolean; hasScreenshot: boolean; link: string },
): Promise<void> {
  const to = env.PLATFORM_FEEDBACK_EMAIL
  if (!to) return Promise.resolve()
  const extras = [s.hasVoice && 'a voice note', s.hasScreenshot && 'a screenshot'].filter(Boolean).join(' and ')
  const body =
    `<strong>${esc(s.person)}</strong> at <strong>${esc(s.studio)}</strong> suggested:<br><br>` +
    (s.text ? `&ldquo;${esc(s.text).replace(/\n/g, '<br>')}&rdquo;<br><br>` : '') +
    (extras ? `With ${extras}.<br>` : '') +
    (s.page ? `From the page ${esc(s.page)}.` : '')
  return send(
    env,
    to,
    `Feature suggestion from ${s.studio}`,
    brandedHtml({
      title: 'A feature suggestion',
      preheader: s.text ? s.text.slice(0, 120) : `${s.person} sent ${extras || 'a suggestion'}`,
      body,
      cta: 'Open the inbox',
      link: s.link,
      footer: 'Sent from the "Suggest a feature" button.',
    }),
    'feature_request',
  )
}

/**
 * The answer to "I am an IPC Diamond member", to the studio owner. Approved:
 * the trial now runs 30 days and the member prices are on. Not approved: why,
 * and that the team will look at it.
 */
export function sendDiamondResultEmail(
  env: Env,
  to: string,
  r: { studio: string; approved: boolean; reason: string | null; accessUntil: string | null },
): Promise<void> {
  const app = (env.APP_URL || 'https://studioautopilot.in').replace(/\/+$/, '')
  const until = r.accessUntil
    ? new Date(r.accessUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  const body = r.approved
    ? `Welcome, IPC Diamond member. <strong>${esc(r.studio)}</strong> now has the member prices` +
      (until ? `, and its free trial runs until <strong>${until}</strong>.` : '.')
    : `We could not confirm <strong>${esc(r.studio)}</strong> as an IPC Diamond member from that screenshot.` +
      (r.reason ? `<br><br>${esc(r.reason)}` : '') +
      '<br><br>Our team will take a look. You can also upload a clearer screenshot of the IPC Diamonds - Premium group.'
  return send(
    env,
    to,
    r.approved ? 'You are verified as an IPC Diamond member' : 'About your IPC Diamond membership',
    brandedHtml({
      title: r.approved ? 'IPC Diamond member' : 'IPC Diamond membership',
      preheader: r.approved ? 'Member prices and a 30-day trial are on.' : 'We could not confirm it from the screenshot.',
      body,
      cta: r.approved ? 'See your plan' : 'Try again',
      link: `${app}/settings/subscription`,
      footer: 'Sent because someone asked to verify this studio as an IPC Diamond member.',
    }),
    'diamond_result',
  )
}

/** A new Diamond claim, to the platform team, so a doubtful one can be revoked. */
export function sendDiamondClaimNotice(
  env: Env,
  c: { studio: string; outcome: string; title: string | null },
): Promise<void> {
  const to = env.PLATFORM_FEEDBACK_EMAIL
  if (!to) return Promise.resolve()
  const app = (env.APP_URL || 'https://studioautopilot.in').replace(/\/+$/, '')
  return send(
    env,
    to,
    `IPC Diamond claim from ${c.studio}: ${c.outcome}`,
    brandedHtml({
      title: 'An IPC Diamond claim',
      preheader: `${c.studio}: ${c.outcome}`,
      body:
        `<strong>${esc(c.studio)}</strong> sent a screenshot to verify as an IPC Diamond member.<br><br>` +
        `Result: <strong>${esc(c.outcome)}</strong>` +
        (c.title ? `<br>Group name read: &ldquo;${esc(c.title)}&rdquo;` : ''),
      cta: 'Open the claims',
      link: `${app}/platform/diamond`,
      footer: 'Every claim is listed with its screenshot; you can approve, reject or revoke there.',
    }),
    'diamond_notice',
  )
}
