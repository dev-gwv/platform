/**
 * The help content the product ships: the /learn guide and the tutorials.
 *
 * It lives in a package rather than in apps/web because the API reads it too --
 * the assistant answers from this corpus, and a copy on the server would drift
 * from the one studios actually see within a release or two.
 *
 * Plain data and pure functions only. Nothing here may import React or touch
 * the DOM, or the API cannot load it.
 */
export * from './guide'
export * from './tutorials'
