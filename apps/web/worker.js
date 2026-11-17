/**
 * Runs in front of /assets/* only (wrangler.jsonc `run_worker_first`); every other path is the static assets
 * with the single-page fallback, as before.
 *
 * A code file the build does not have must be a plain 404 that nobody keeps. Without this the fallback answered
 * it with index.html and the year-long cache header of /assets (_headers), and a browser kept that page under the
 * code file's name for a year: every page then failed to load for that person (owner, 17 Nov).
 */
/* global Response */
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request)
    if ((res.headers.get('content-type') || '').includes('text/html')) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } })
    }
    return res
  },
}
