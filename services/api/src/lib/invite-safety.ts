/**
 * Who an invitation link may sign in as (audit, 21 Nov).
 *
 * The link proves only that someone holds the link -- and the studio that
 * sent it can hold it too. So the link alone may only ever make a NEW login.
 * An email that already has a login joins with that login's own password; a
 * login with no password (Google-only, imported from the old app, or someone's
 * offline directory entry) is refused until its owner sets one through Forgot
 * password, which proves the mailbox, or joins while signed in.
 */
export type InviteLogin = { encrypted_password: string | null } | null | undefined

export type InviteAccept = 'new' | 'check_password' | 'no_password'

export function inviteAcceptPath(login: InviteLogin): InviteAccept {
  if (!login) return 'new'
  return login.encrypted_password ? 'check_password' : 'no_password'
}

export const NO_PASSWORD_MESSAGE =
  'This email already has a Studio AutoPilot login without a password. ' +
  'Use Forgot password on the sign-in page to set one, then open this invitation link again and enter it. ' +
  'If you sign in with Google and have no studio yet, you can join this studio right after signing in.'

/**
 * The link goes back to the studio only for an email with no login yet. For
 * an existing login only its mailbox gets it, so the studio can never open the
 * link as that person.
 */
export function shareableInviteLink(link: string, emailHasLogin: boolean): string | null {
  return emailHasLogin ? null : link
}
