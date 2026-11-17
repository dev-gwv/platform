/**
 * Mends a browser that kept a web page in place of one of our code files (17 Nov: the whole app showed "This
 * screen hit a problem" for the owner). The host answered a missing /assets file with index.html and the
 * year-long cache header every /assets file gets, so the browser kept that page for a year under the code
 * file's name, and every import through it failed -- a reload never asked again. The host now says 404 for a
 * missing file (apps/web/worker.js); this mends the browsers that kept a bad copy before that.
 *
 * From the file that failed, it walks the files each one imports, and any that comes back as a web page is
 * asked for again with `cache: 'reload'`, which replaces the kept copy. It answers how many it mended.
 */

/** The `/assets/…js` file named in a "Failed to fetch dynamically imported module: <url>" message. */
export function failedChunk(message: string): string | null {
  const m = /(?:https?:\/\/[^\s/]+)?(\/assets\/[\w.-]+\.js)/.exec(message)
  return m ? m[1]! : null
}

/** The files a built module imports (`from"./x.js"`, `import"./x.js"`), as /assets paths. */
export function importsOf(code: string): string[] {
  const out = new Set<string>()
  for (const m of code.matchAll(/(?:from|import)\s*"\.\/([\w.-]+\.js)"/g)) out.add(`/assets/${m[1]}`)
  return [...out]
}

const isPage = (r: Response) => (r.headers.get('content-type') ?? '').includes('text/html')

export async function repairChunks(start: string[], fetcher: typeof fetch = fetch, most = 150): Promise<number> {
  const seen = new Set<string>()
  const queue = [...start]
  let mended = 0
  while (queue.length && seen.size < most) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    try {
      let r = await fetcher(path)
      if (r.ok && isPage(r)) {
        r = await fetcher(path, { cache: 'reload' })
        if (r.ok && !isPage(r)) mended++
      }
      if (r.ok && !isPage(r)) queue.push(...importsOf(await r.text()))
    } catch {
      /* offline or blocked: leave it to the next try */
    }
  }
  return mended
}

/**
 * Mends what a failed import needs and reloads once a minute at most, so a host that is really down shows the
 * error instead of looping. Answers whether a reload is on its way.
 */
export async function repairAndReload(message: string): Promise<boolean> {
  const KEY = 'chunk-repair-at'
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* storage blocked: mend once anyway */
  }
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
    .map((s) => new URL(s.src).pathname)
    .filter((p) => p.startsWith('/assets/'))
  const failed = failedChunk(message)
  const mended = await repairChunks(failed ? [failed, ...scripts] : scripts)
  if (mended === 0) return false
  window.location.reload()
  return true
}
