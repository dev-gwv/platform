import type { Env } from '../context'

/**
 * Twilio Programmable Voice. With an account SID, auth token and a caller id
 * configured, "Call" rings the agent's phone and bridges the lead when they
 * pick up; without them the call is logged as one made by hand from the
 * agent's own phone, so the timeline is the same either way.
 */
const API = 'https://api.twilio.com/2010-04-01'

type TwilioEnv = Pick<Env, 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_FROM_NUMBER'>

export const twilioConfigured = (env: TwilioEnv): boolean =>
  !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN && !!env.TWILIO_FROM_NUMBER

/** E.164 from a normalised number (digits, country code first). */
export const e164 = (norm: string): string => (norm.startsWith('+') ? norm : `+${norm}`)

const escapeXml = (v: string) => v.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch] ?? ch)

/**
 * Ring `agent` first; when they answer, dial `lead`. Twilio calls this a
 * click-to-call. Throws on a non-2xx so attempt() logs it with the request id.
 */
export async function placeCall(env: TwilioEnv, agent: string, lead: string): Promise<{ sid: string; status: string }> {
  const twiml = `<Response><Say>Connecting your call.</Say><Dial callerId="${escapeXml(env.TWILIO_FROM_NUMBER)}">${escapeXml(e164(lead))}</Dial></Response>`
  const form = new URLSearchParams({ To: e164(agent), From: env.TWILIO_FROM_NUMBER, Twiml: twiml })
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)
  const res = await fetch(`${API}/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Calls.json`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`twilio call failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { sid?: string; status?: string }
  return { sid: json.sid ?? '', status: json.status ?? 'queued' }
}
