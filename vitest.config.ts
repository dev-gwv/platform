import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * One suite for the whole monorepo (packages, services, supabase, web). The
 * only thing it has to add is the web app's `@/` alias — without it a test can
 * only reach source that never imports across the app, which quietly pushes
 * logic out of shared modules to keep it testable.
 *
 * `hookTimeout` is raised because every file under `supabase/tests` boots a
 * Postgres in WebAssembly and applies all 142 migrations in its `beforeAll`.
 * That takes a couple of seconds alone and rather longer when a dozen of them
 * are doing it at once on the same cores — so with the default ten seconds,
 * suites started failing on a busy machine and passing on a quiet one, with
 * "Hook timed out" and every test in the file reported as skipped. Nothing
 * about the code under test had changed. A flaky suite is worse than a slow
 * one: it teaches you to re-run instead of to read.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'apps/web/src') },
  },
  test: {
    hookTimeout: 120_000,
    testTimeout: 60_000,
    /*
     * Vitest's default exclude covers node_modules and dist, not a reference
     * checkout dropped in the working tree. Git ignores those and eslint has
     * its own list, so without this a folder read for design reference is
     * collected as thousands of test files belonging to someone else's
     * project -- every one of them failing, and burying our own result.
     */
    exclude: ['**/node_modules/**', '**/dist/**', 'twenty-orbitcrew-main/**', 'ipc-control-center-main/**'],
  },
})
