import type { DiamondPhoneResult } from '@ipc/contracts'

/** What the "IPC Diamond member?" card says after a check (0262). */
export function diamondOutcomeWords(o: DiamondPhoneResult['outcome']): { ok: boolean; line: string } {
  switch (o) {
    case 'verified':
    case 'already':
      return { ok: true, line: 'Verified. You see the IPC Diamond member prices now, and your trial runs 30 days from sign-up.' }
    case 'taken':
      return { ok: false, line: 'This number has already opened another studio. If that is a mistake, message us and we will sort it out.' }
    case 'too_many':
      return { ok: false, line: 'That was too many tries for today. Message us and we will check your number for you.' }
    default:
      return { ok: false, line: 'We could not find this number on the IPC Diamond list. If you are a member, message us and we will check it.' }
  }
}
