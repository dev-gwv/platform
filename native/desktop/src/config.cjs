'use strict'

/**
 * Which site the app opens. The installed app always opens the live site, so
 * every change to Studio AutoPilot reaches it on the next launch without a new
 * installer. STUDIO_AUTOPILOT_URL points a test run at another copy (a local
 * build at http://localhost:5199, a preview deploy).
 */
const DEFAULT_URL = 'https://studioautopilot.in'
const START_PATH = '/dashboard'

function appOrigin(env = process.env) {
  const raw = (env.STUDIO_AUTOPILOT_URL || DEFAULT_URL).trim()
  try {
    return new URL(raw).origin
  } catch {
    return DEFAULT_URL
  }
}

module.exports = { DEFAULT_URL, START_PATH, appOrigin }
