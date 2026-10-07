/**
 * The /learn guide now lives in `@ipc/help`, because the API reads the same
 * content to answer questions in the assistant and a second copy would drift.
 *
 * Re-exported from here so every screen that already imports
 * `@/features/help/guide` keeps working untouched.
 */
export * from '@ipc/help/guide'
