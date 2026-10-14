import type { DiamondPhoneResult } from '@ipc/contracts'

/**
 * What the IPC Diamond check says after the number is looked up (0262). Only
 * a verified member goes on to WhatsApp at the member price (owner, 14 Oct);
 * a miss offers the number again or the regular price, never a way round.
 */
export function diamondOutcomeWords(o: DiamondPhoneResult['outcome']): { ok: boolean; line: string } {
  switch (o) {
    case 'verified':
    case 'already':
      return { ok: true, line: "You're an IPC Diamond member. The member prices are yours, and your free trial runs 30 days from sign-up." }
    case 'taken':
      return { ok: false, line: 'This number is already used by another studio on Studio AutoPilot.' }
    case 'too_many':
      return { ok: false, line: 'That was too many tries for today. Please try again tomorrow.' }
    default:
      return { ok: false, line: "We couldn't find this number on the IPC Diamond list. Check the number, or take a regular plan." }
  }
}
