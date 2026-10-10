/**
 * Whether the DEV-only UI preview (VITE_MOCK=1) is on, kept apart from the
 * fixtures in ./mock: everything that only asks the question imports this,
 * and the fixtures are loaded with import() behind it, so a production build
 * (where it is false) never carries them. They used to ride in the main
 * bundle -- their objects are built by function calls, which a bundler keeps.
 */
export const MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1'

/** Sentinel: this path is not mocked → fall through to the real fetch. */
export const NOT_MOCKED = Symbol('not-mocked')
