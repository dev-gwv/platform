'use strict'

/**
 * Where a link goes when the desktop app meets it. Pure, so it is tested
 * without Electron (test/links.test.ts).
 *
 * The app is Studio AutoPilot's live website in a window of its own, so every
 * feature the web app has is here the moment it ships. What the shell decides
 * is only where each address opens:
 *
 *   'app'      our own site: stays in the app (a new app window for _blank).
 *   'sign-in'  Facebook and Google sign-in, which must open inside the app so
 *              they can hand the answer back to the page that asked (Connect
 *              with Facebook for lead ads, WhatsApp signup, Google sign-in).
 *   'blank'    window.open('') -- the web app opens an empty tab first and
 *              points it somewhere once the server answers (browsers block a
 *              window opened after a wait). Decided on its first navigation.
 *   'external' everything else people expect in their own browser or app:
 *              WhatsApp (wa.me), mailto:, tel:, UPI, Google Maps, the photo
 *              gallery, a file on the API.
 *   'blocked'  file:, javascript:, data: and anything unknown. Never opened.
 */

const SIGN_IN_HOSTS = [
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'business.facebook.com',
  'connect.facebook.net',
  'accounts.google.com',
  'checkout.razorpay.com',
  'api.razorpay.com',
]

/** Schemes the operating system opens: a mail app, the dialler, WhatsApp, a UPI app. */
const OS_SCHEMES = ['mailto:', 'tel:', 'sms:', 'whatsapp:', 'upi:', 'webcal:', 'maps:', 'geo:']

function parse(raw) {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * @param {string} raw the address
 * @param {string} appOrigin e.g. https://studioautopilot.in
 * @returns {'app' | 'sign-in' | 'blank' | 'external' | 'blocked'}
 */
function classify(raw, appOrigin) {
  if (!raw || raw === 'about:blank') return 'blank'
  const url = parse(raw)
  if (!url) return 'blocked'
  if (OS_SCHEMES.includes(url.protocol)) return 'external'
  // A file the page made itself (an ID proof, a CSV): blob:https://studioautopilot.in/…
  if (url.protocol === 'blob:') return url.origin === parse(appOrigin)?.origin ? 'app' : 'blocked'
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'blocked'
  const app = parse(appOrigin)
  if (app && url.origin === app.origin) return 'app'
  // A local test build (http://localhost) is still "our site".
  if (app && app.hostname === url.hostname && (app.hostname === 'localhost' || app.hostname === '127.0.0.1')) return 'app'
  if (url.protocol === 'https:' && SIGN_IN_HOSTS.includes(url.hostname)) return 'sign-in'
  return 'external'
}

/** Is this origin ours (camera, microphone, location and notifications are granted to it alone)? */
function isAppOrigin(raw, appOrigin) {
  return classify(raw, appOrigin) === 'app'
}

/**
 * studioautopilot://open/leads?view=list  ->  https://studioautopilot.in/leads?view=list
 * Anything that does not resolve to a path on our own site gives null.
 */
function deepLinkTarget(raw, appOrigin) {
  const url = parse(raw)
  if (!url || url.protocol !== 'studioautopilot:') return null
  // studioautopilot://open/leads parses host "open", path "/leads".
  const path = url.host === 'open' || url.host === '' ? url.pathname : `/${url.host}${url.pathname}`
  const target = parse(`${appOrigin}${path.startsWith('/') ? path : `/${path}`}${url.search}${url.hash}`)
  if (!target || classify(target.href, appOrigin) !== 'app') return null
  return target.href
}

module.exports = { classify, isAppOrigin, deepLinkTarget, SIGN_IN_HOSTS, OS_SCHEMES }
