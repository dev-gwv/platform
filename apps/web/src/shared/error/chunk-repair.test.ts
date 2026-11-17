import { describe, expect, it } from 'vitest'
import { failedChunk, importsOf, repairChunks } from './chunk-repair'

const js = (body: string) => new Response(body, { headers: { 'content-type': 'text/javascript' } })
const page = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })

describe('mending a browser that kept a web page as a code file (17 Nov)', () => {
  it('reads the failed file and what a file imports', () => {
    expect(failedChunk('TypeError: Failed to fetch dynamically imported module: https://studioautopilot.in/assets/dashboard-BiLhTx7C.js')).toBe('/assets/dashboard-BiLhTx7C.js')
    expect(failedChunk('TypeError: Failed to fetch')).toBeNull()
    expect(importsOf('import{j as e}from"./react-Dx.js";import"./a-1.js";import{x}from "./b_2.js"')).toEqual(['/assets/react-Dx.js', '/assets/a-1.js', '/assets/b_2.js'])
  })

  it('asks again, past the kept copy, for every file that comes back as a page', async () => {
    const asked: string[] = []
    const fetcher = (async (path: string, init?: RequestInit) => {
      asked.push(`${path}${init?.cache === 'reload' ? ' (again)' : ''}`)
      if (path === '/assets/dash.js') return js('import"./api.js";import{x}from"./ok.js"')
      if (path === '/assets/api.js') return init?.cache === 'reload' ? js('') : page()
      return js('')
    }) as typeof fetch
    expect(await repairChunks(['/assets/dash.js'], fetcher)).toBe(1)
    expect(asked).toEqual(['/assets/dash.js', '/assets/api.js', '/assets/api.js (again)', '/assets/ok.js'])
  })

  it('mends nothing when every file is fine', async () => {
    expect(await repairChunks(['/assets/a.js'], (async () => js('')) as typeof fetch)).toBe(0)
  })
})
