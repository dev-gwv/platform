import type { Env } from '../context'
import { timingSafeEqual, toHex } from './crypto'

/**
 * Onboarding emails for a new studio, under the Studio AutoPilot name: a
 * welcome when the owner confirms their email, then short nudges on day 1, 3
 * and 7 while setup is unfinished (migration 0194 decides who is due).
 *
 * Built like FotoOwl's welcome mail the owner liked: a header, one line of
 * welcome, a card per setup step with a picture and two buttons ("Watch
 * tutorial" and "Do it now"), a help block and a footer with a way out.
 * Tables and inline styles only, because Gmail and Outlook drop <style>.
 *
 * Email cannot play video, so "Watch tutorial" opens /help/setup at that
 * step, where the short screen recordings live.
 */

export type SetupStep = 1 | 2 | 3
export type NudgeKind = 'day1' | 'day3' | 'day7'

const GOLD = '#f2a618'
const NAVY = '#1b2a4a'
const INK = '#111827'
const MUTED = '#4b5563'

interface StepCopy {
  key: 'team' | 'client' | 'project'
  title: string
  line: string
  path: string
}

export const STEPS: Record<SetupStep, StepCopy> = {
  1: {
    key: 'team',
    title: 'Add your team',
    line: 'The people who shoot and edit with you. Name and phone are enough.',
    path: '/employees?add=choose&from=setup',
  },
  2: {
    key: 'client',
    title: 'Add your first client',
    line: 'The couple or family you are shooting for. About a minute.',
    path: '/clients?add=new&from=setup',
  },
  3: {
    key: 'project',
    title: 'Create your first project',
    line: 'Shoots, dates, deliverables and price, all in one place.',
    path: '/projects/new?from=setup',
  },
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there'

const base = (env: Env) => (env.APP_URL || 'https://ipcstudios.in').replace(/\/+$/, '')

/** A signed "stop these emails" link, good for this studio only. */
export async function stopToken(env: Env, companyId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`onboarding-stop:${companyId}`))
  return toHex(sig).slice(0, 40)
}

export async function stopTokenValid(env: Env, companyId: string, token: string): Promise<boolean> {
  return timingSafeEqual(await stopToken(env, companyId), token)
}

function button(label: string, href: string, solid: boolean): string {
  const style = solid
    ? `background:${GOLD};color:${INK};border:1px solid ${GOLD};`
    : `background:#ffffff;color:${NAVY};border:1px solid #d1d5db;`
  return `<a href="${esc(href)}" style="${style}display:inline-block;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">${esc(label)}</a>`
}

function stepCard(env: Env, n: SetupStep, done: boolean): string {
  const s = STEPS[n]
  const img = `${base(env)}/email/${s.key}.png`
  const actions = done
    ? `<p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#15803d;">&#10003; Done</p>`
    : `<p style="margin:14px 0 0;">${button('Watch tutorial', `${base(env)}/help/setup#${s.key}`, true)}
         &nbsp; <a href="${esc(base(env) + s.path)}" style="font-size:14px;font-weight:600;color:${NAVY};text-decoration:none;">Do it now &rarr;</a></p>`
  return `
  <tr><td style="padding:14px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${done ? 'opacity:0.6;' : ''}">
      <tr>
        <td width="170" valign="top" style="padding-right:16px;">
          <img src="${img}" width="170" alt="" style="display:block;width:170px;max-width:100%;height:auto;border-radius:10px;border:0;" />
        </td>
        <td valign="middle">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.06em;color:${GOLD};text-transform:uppercase;">Step ${n}</p>
          <h2 style="margin:4px 0 6px;font-size:19px;font-weight:700;color:${INK};">${esc(s.title)}</h2>
          <p style="margin:0;font-size:14px;line-height:1.55;color:${MUTED};">${esc(s.line)}</p>
          ${actions}
        </td>
      </tr>
    </table>
  </td></tr>`
}

function layout(
  env: Env,
  o: { preheader: string; heading: string; intro: string; cards: string; stopLink: string },
): string {
  const call = env.ONBOARDING_CALL_URL?.trim()
  const callBlock = call
    ? `<tr><td align="center" style="padding:6px 28px 22px;">${button('Book an onboarding call', call, true)}</td></tr>`
    : ''
  const help = call
    ? `<p style="margin:0 0 16px;font-size:14px;color:${MUTED};">We will set it up with you on a short call.</p>${button('Book a call', call, false)}`
    : `<p style="margin:0;font-size:14px;color:${MUTED};">Press “Suggest a feature” at the top of the app. A real person reads every one.</p>`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${esc(o.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 10px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td style="padding:22px 28px;border-bottom:1px solid #f1f1f1;">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${NAVY};">Studio</span><span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${GOLD};">AutoPilot</span>
          </td></tr>
          <tr><td align="center" style="padding:30px 28px 10px;">
            <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:${NAVY};">${esc(o.heading)}</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${o.intro}</p>
          </td></tr>
          ${callBlock}
          <tr><td style="padding:0 28px;"><div style="border-top:3px dotted #d1d5db;height:1px;line-height:1px;">&nbsp;</div></td></tr>
          ${o.cards}
          <tr><td align="center" style="padding:26px 28px 30px;background:#fdf6e3;">
            <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:${INK};">Still need help?</h2>
            ${help}
          </td></tr>
          <tr><td style="padding:18px 28px 24px;font-size:12px;line-height:1.6;color:#6b7280;">
            <a href="${esc(base(env))}" style="color:${NAVY};font-weight:600;text-decoration:none;">Open Studio AutoPilot</a><br />
            You are getting this because you created a studio. <a href="${esc(o.stopLink)}" style="color:#6b7280;">Stop these emails</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

export interface OnboardingMail {
  subject: string
  html: string
}

async function stopLink(env: Env, companyId: string) {
  return `${base(env)}/stop-emails?c=${companyId}&t=${await stopToken(env, companyId)}`
}

/** The welcome: all three steps, in order. */
export async function welcomeMail(env: Env, o: { companyId: string; name: string | null }): Promise<OnboardingMail> {
  return {
    subject: "Welcome to Studio AutoPilot — 3 steps and you're set",
    html: layout(env, {
      preheader: 'Add your team, your first client and your first project. A few minutes in all.',
      heading: `Welcome aboard, ${firstName(o.name)}!`,
      intro:
        'Studio AutoPilot keeps your shoots, team, deliveries and payments in one place. Three quick steps and your studio runs itself.',
      cards: [1, 2, 3].map((n) => stepCard(env, n as SetupStep, false)).join(''),
      stopLink: await stopLink(env, o.companyId),
    }),
  }
}

const NUDGE_SUBJECT: Record<SetupStep, string> = {
  1: 'Add your team — it takes a minute',
  2: 'Next: add your first client',
  3: 'One step left: create your first project',
}

const NUDGE_INTRO: Record<SetupStep, string> = {
  1: 'Your studio is ready. Add the people who shoot and edit with you, and the rest falls into place.',
  2: 'Your team is in. Add the client you are shooting for next. About a minute.',
  3: 'Team and client are in. Create the project and every shoot, delivery and payment is tracked for you.',
}

/** A nudge: only the step that is next, with the done ones ticked above it. */
export async function nudgeMail(
  env: Env,
  o: { companyId: string; name: string | null; step: SetupStep },
): Promise<OnboardingMail> {
  const cards = ([1, 2, 3] as SetupStep[])
    .filter((n) => n <= o.step)
    .map((n) => stepCard(env, n, n < o.step))
    .join('')
  return {
    subject: NUDGE_SUBJECT[o.step],
    html: layout(env, {
      preheader: NUDGE_INTRO[o.step],
      heading: `Hi ${firstName(o.name)}, one quick step`,
      intro: esc(NUDGE_INTRO[o.step]),
      cards,
      stopLink: await stopLink(env, o.companyId),
    }),
  }
}

/** Send through Resend. Never throws: a mail hiccup must not fail sign-in or the cron. */
export async function sendOnboardingMail(env: Env, to: string, mail: OnboardingMail): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY unset — skipping "${mail.subject}" to ${to}`)
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject: mail.subject, html: mail.html }),
    })
    if (!res.ok) console.error(`[email] onboarding send failed ${res.status}: ${await res.text().catch(() => '')}`)
    return res.ok
  } catch (e) {
    console.error('[email] onboarding send threw', e)
    return false
  }
}
