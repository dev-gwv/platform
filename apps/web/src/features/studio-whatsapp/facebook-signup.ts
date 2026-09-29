/**
 * Meta's Embedded Signup: the owner logs in to Facebook in a popup, picks or
 * creates the WhatsApp Business number, and we get back a one-time code plus
 * the ids of the number they chose. The API trades the code for the token;
 * nothing secret passes through the page.
 */
interface FB {
  init(o: { appId: string; version: string; xfbml?: boolean; cookie?: boolean }): void
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void
}
declare global {
  interface Window {
    FB?: FB
    fbAsyncInit?: () => void
  }
}

const SDK = 'https://connect.facebook.net/en_US/sdk.js'

function loadSdk(appId: string): Promise<FB> {
  if (window.FB) return Promise.resolve(window.FB)
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, version: 'v24.0', xfbml: false, cookie: false })
      resolve(window.FB!)
    }
    const s = document.createElement('script')
    s.src = SDK
    s.async = true
    s.crossOrigin = 'anonymous'
    s.onerror = () => reject(new Error('Facebook could not be reached. Check your connection and try again.'))
    document.body.appendChild(s)
  })
}

export async function facebookSignup(appId: string, configId: string): Promise<{ code: string; phone_number_id: string; waba_id: string }> {
  const fb = await loadSdk(appId)
  let ids: { phone_number_id?: string; waba_id?: string } = {}
  const onMessage = (e: MessageEvent) => {
    if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return
    try {
      const d = typeof e.data === 'string' ? (JSON.parse(e.data) as { type?: string; event?: string; data?: typeof ids }) : null
      if (d?.type === 'WA_EMBEDDED_SIGNUP' && d.event === 'FINISH' && d.data) ids = d.data
    } catch {
      /* other Facebook messages */
    }
  }
  window.addEventListener('message', onMessage)
  try {
    const code = await new Promise<string>((resolve, reject) =>
      fb.login(
        (r) => (r.authResponse?.code ? resolve(r.authResponse.code) : reject(new Error('The Facebook window was closed before it finished.'))),
        { config_id: configId, response_type: 'code', override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: '3' } },
      ),
    )
    // The ids arrive as a message just before or after the login callback.
    for (let i = 0; i < 20 && !(ids.phone_number_id && ids.waba_id); i++) await new Promise((r) => setTimeout(r, 150))
    if (!ids.phone_number_id || !ids.waba_id) throw new Error('Facebook did not say which number you picked. Please try again.')
    return { code, phone_number_id: ids.phone_number_id, waba_id: ids.waba_id }
  } finally {
    window.removeEventListener('message', onMessage)
  }
}
