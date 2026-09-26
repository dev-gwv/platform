import type { Env } from '../context'

/**
 * Transactional email via Resend. Non-fatal by design: if it fails (or no key is
 * configured in dev), we log and move on — the studio still exists and the user
 * can request a resend. Never let a mail hiccup fail a request.
 */
async function send(env: Env, to: string, subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY unset — skipping "${subject}" to ${to}`)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
    })
    if (!res.ok) {
      console.error(`[email] send failed ${res.status}: ${await res.text().catch(() => '')}`)
    }
  } catch (e) {
    console.error('[email] send threw', e)
  }
}

export function sendVerificationEmail(env: Env, to: string, link: string): Promise<void> {
  return send(
    env,
    to,
    'Verify your IPC Studios email',
    brandedHtml({
      title: 'Verify your email',
      preheader: 'Confirm your email to activate your IPC Studios workspace.',
      body: 'Welcome! Confirm your email address to activate your studio workspace.',
      cta: 'Verify email',
      link,
      footer: "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    }),
  )
}

export function sendPasswordResetEmail(env: Env, to: string, link: string): Promise<void> {
  return send(
    env,
    to,
    'Reset your IPC Studios password',
    brandedHtml({
      title: 'Reset your password',
      preheader: 'Choose a new password for your IPC Studios account.',
      body: 'We received a request to reset your password. Choose a new one to get back in.',
      cta: 'Reset password',
      link,
      footer:
        "This link expires in 1 hour and can be used once. If you didn't request a reset, ignore this email — your password stays unchanged.",
    }),
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
    `${companyName} invited you to IPC Studios`,
    brandedHtml({
      title: `Join ${companyName}`,
      preheader: `${companyName} added you to their studio on IPC Studios.`,
      body: `${companyName} has added you to their team. Set a password to open your dashboard and see the work assigned to you.`,
      cta: 'Accept invitation',
      link,
      footer:
        "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.",
    }),
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
}

/** Branded, email-client-safe HTML (table layout + inline styles). */
function brandedHtml({ title, preheader, body, cta, link, footer }: MailCopy): string {
  const brand = '#1b2a4a' // navy (badge + button)
  const accent = '#f2a618' // gold (wordmark "IPC")
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
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:44px;height:44px;background:${brand};border-radius:12px;text-align:center;vertical-align:middle;font-size:22px;line-height:44px;">📷</td>
                  </tr>
                </table>
                <div style="margin-top:12px;font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#111827;"><span style="color:${accent};">IPC</span> Studios</div>
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
                         style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">
                        ${cta}
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 6px;font-size:12px;color:#6b7280;text-align:center;">Or paste this link into your browser:</p>
                <p style="margin:0 0 8px;font-size:12px;text-align:center;word-break:break-all;">
                  <a href="${link}" style="color:${brand};text-decoration:none;">${link}</a>
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
          <div style="margin-top:16px;font-size:11px;color:#9ca3af;">© IPC Studios</div>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/**
 * Client document emails (receipt / quotation / terms / delivery).
 * Returns 'sent' | 'provider_missing' so the studio UI can fall back to
 * mailto:/copy-link instead of claiming an email went. Never throws.
 */
export async function sendClientDocEmail(
  env: Env,
  to: string | null | undefined,
  subject: string,
  link: string,
  intro: string,
): Promise<{ status: 'sent' | 'provider_missing' | 'failed'; error?: string; url: string }> {
  if (!env.RESEND_API_KEY) return { status: 'provider_missing', url: link }
  if (!to) return { status: 'failed', error: 'Client email not found for this project.', url: link }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to,
        subject,
        html: brandedHtml({ title: subject, preheader: intro, body: intro, cta: 'Open document', link, footer: 'If you were not expecting this, you can ignore this email.' }),
      }),
    })
    if (!res.ok) return { status: 'failed', error: 'Email failed to send.', url: link }
    return { status: 'sent', url: link }
  } catch (e) {
    console.error('[email] client doc send threw', e)
    return { status: 'failed', error: 'Email failed to send.', url: link }
  }
}

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
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
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
      }),
    })
    if (!res.ok) {
      console.error(`[email] team terms send failed ${res.status}`)
      return false
    }
    return true
  } catch (e) {
    console.error('[email] team terms send threw', e)
    return false
  }
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
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: m.to,
        subject: m.subject,
        html: brandedHtml({
          title: esc(m.subject),
          preheader: esc((m.body ?? m.subject).slice(0, 120)),
          body: m.toClient
            ? `<span style="display:block;text-align:left;">${esc(m.body ?? '').replace(/\n/g, '<br>')}</span>`
            : esc(m.body ?? '').replace(/\n/g, '<br>'),
          // A studio's client has no IPC Studios account: no "open the app" button.
          cta: m.toClient ? undefined : 'Open IPC Studios',
          link: m.toClient ? undefined : (link ?? (env.APP_URL || 'https://ipcstudios.in')),
          footer: `Sent for ${esc(m.studio)} by IPC Studios.`,
        }),
      }),
    })
    if (!res.ok) return { status: 'failed', error: `Email provider refused it (${res.status}).` }
    const json = (await res.json().catch(() => ({}))) as { id?: string }
    return { status: 'sent', ...(json.id ? { id: json.id } : {}) }
  } catch (e) {
    console.error('[email] message send threw', e)
    return { status: 'failed', error: 'Email could not be sent.' }
  }
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
  )
}
