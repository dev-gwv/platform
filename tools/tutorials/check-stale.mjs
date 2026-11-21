#!/usr/bin/env node
/**
 * Which tutorials no longer match their screens.
 *
 * screens.json names, for each tutorial, the files it films; recorded.json
 * keeps a hash of each file as it was when the video was recorded. A file
 * whose hash moved means the screen may have changed since: re-record it
 * (English and Hindi), then `--update <key>`.
 *
 *   node tools/tutorials/check-stale.mjs                 list what to re-record (always exits 0)
 *   node tools/tutorials/check-stale.mjs --update <key>  after re-recording <key>: take today's files
 *   node tools/tutorials/check-stale.mjs --init          rebuild recorded.json from git history
 *
 * A warning, never a failed build: the owner records the videos by hand.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const SCREENS = join(here, 'screens.json')
const RECORDED = join(here, 'recorded.json')
/** Stored when the file was already different from the video's at --init time. */
const STALE = 'stale'

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function screens() {
  const all = readJson(SCREENS)
  return Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('_')))
}

function currentHash(file) {
  const p = join(root, file)
  return existsSync(p) ? hash(readFileSync(p)) : 'missing'
}

/** The commit and date (YYYY-MM-DD) that last shipped the English video. */
function videoCommit(key) {
  try {
    const line = git('log', '-1', '--format=%H %cI', '--', `apps/web/public/help/${key}.mp4`)
    if (!line) return null
    const [commit, when] = line.split(' ')
    return { commit, when }
  } catch {
    return null
  }
}

function writeRecorded(rec) {
  const sorted = Object.fromEntries(Object.keys(rec).sort().map((k) => [k, rec[k]]))
  writeFileSync(RECORDED, `${JSON.stringify(sorted, null, 2)}\n`)
}

function entryNow(key, files) {
  const v = videoCommit(key)
  return {
    video: (v?.when ?? new Date().toISOString()).slice(0, 10),
    files: Object.fromEntries(files.map((f) => [f, currentHash(f)])),
  }
}

/**
 * Honest start: a file changed after the video's commit keeps the hash it had
 * at that commit (or "stale" when it did not exist then), so it shows up now.
 */
function init() {
  const rec = {}
  for (const [key, files] of Object.entries(screens())) {
    const v = videoCommit(key)
    if (!v) {
      rec[key] = { video: null, files: Object.fromEntries(files.map((f) => [f, STALE])) }
      continue
    }
    const out = {}
    for (const f of files) {
      let changed = ''
      try {
        changed = git('log', '-1', '--format=%cI', `${v.commit}..HEAD`, '--', f)
      } catch {
        changed = 'unknown'
      }
      if (!changed) {
        out[f] = currentHash(f)
        continue
      }
      try {
        out[f] = hash(execFileSync('git', ['show', `${v.commit}:${f}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }))
      } catch {
        out[f] = STALE
      }
    }
    rec[key] = { video: v.when.slice(0, 10), files: out }
  }
  writeRecorded(rec)
  console.log(`recorded.json written for ${Object.keys(rec).length} tutorials.`)
}

function update(key) {
  const files = screens()[key]
  if (!files) {
    console.error(`No tutorial "${key}" in screens.json.`)
    process.exit(1)
  }
  const rec = existsSync(RECORDED) ? readJson(RECORDED) : {}
  rec[key] = entryNow(key, files)
  writeRecorded(rec)
  console.log(`${key}: hashes taken from today's files.`)
}

function check() {
  const rec = existsSync(RECORDED) ? readJson(RECORDED) : {}
  const ci = process.env.GITHUB_ACTIONS === 'true'
  const stale = []
  for (const [key, files] of Object.entries(screens())) {
    const was = rec[key]?.files ?? {}
    const changed = files.filter((f) => was[f] !== currentHash(f))
    if (changed.length) stale.push({ key, changed, video: rec[key]?.video ?? null })
  }
  if (!stale.length) {
    console.log('Every tutorial matches its screens.')
    return
  }
  console.log(`${stale.length} tutorial${stale.length === 1 ? '' : 's'} may no longer match the screens they film:`)
  for (const s of stale) {
    const short = s.changed.map((f) => f.replace(/^apps\/web\/src\//, ''))
    const line = `re-record: ${s.key} (changed: ${short.join(', ')})`
    console.log(`  ${line}${s.video ? `  [video ${s.video}]` : ''}`)
    if (ci) console.log(`::warning title=Tutorial out of date::${line}`)
  }
  console.log('\nRe-record each in English and Hindi (tools/tutorials/README.md), then: node tools/tutorials/check-stale.mjs --update <key>')
}

const [mode, arg] = process.argv.slice(2)
if (mode === '--init') init()
else if (mode === '--update') update(arg)
else check()
