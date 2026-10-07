// A small square "MS" logo for the studio tutorial, drawn once in Chromium.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
const HERE = new URL('.', import.meta.url).pathname
export async function studioLogo() {
  const dir = join(HERE, 'out'); mkdirSync(dir, { recursive: true })
  const file = join(dir, 'studio-logo.png')
  if (existsSync(file)) return file
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const p = await b.newPage({ viewport: { width: 256, height: 256 } })
  await p.setContent(`<body style="margin:0"><div id="l" style="width:256px;height:256px;border-radius:44px;background:#1b2a4a;display:flex;align-items:center;justify-content:center;
    font:800 112px Georgia,serif;color:#f2a618;letter-spacing:-6px">MS</div></body>`)
  await p.locator('#l').screenshot({ path: file, omitBackground: true })
  await b.close()
  return file
}
