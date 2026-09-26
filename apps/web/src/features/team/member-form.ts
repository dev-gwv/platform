import { addMemberRequest, type AddMemberRequest } from '@ipc/contracts'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'

/**
 * "Add one person", as data: one short form instead of six steps.
 *
 * Only what the API needs to add someone is asked for -- name, phone, how
 * they work, whether they sign in, what they can see. Pay, address and ID
 * proof are set later from their profile. Every rule here is checked again
 * by `addMemberRequest` on the way out and by the API on the way in; this
 * only decides when to show the message.
 */
export interface MemberForm {
  name: string
  phone: string
  /** The studio's job roles (Photographer, Editor…) this person does. */
  role_ids: string[]
  /** "Works as": on salary (in_house) or per shoot (freelancer). */
  engagement_type: 'in_house' | 'freelancer'
  /** "Can they sign in to the app?" With it, email and password are needed. */
  create_login: boolean
  email: string
  password: string
  /** "What can they see?": team member (employee), manager or admin. */
  role: 'employee' | 'manager' | 'admin'
}

export const EMPTY_MEMBER_FORM: MemberForm = {
  name: '',
  phone: '',
  role_ids: [],
  engagement_type: 'in_house',
  create_login: true,
  email: '',
  password: '',
  role: 'employee',
}

export type MemberFormField = keyof MemberForm

const LABELS: Record<MemberFormField, string> = {
  name: 'Name',
  phone: 'Phone',
  role_ids: 'Job role',
  engagement_type: 'Works as',
  create_login: 'Sign in',
  email: 'Email',
  password: 'Password',
  role: 'What they can see',
}

/**
 * Form (all strings, as typed) → the shape the contract expects. With sign-in
 * off, no email or password is sent at all: the person is directory-only.
 */
export function toPayload(f: MemberForm): Record<string, unknown> {
  return {
    engagement_type: f.engagement_type,
    create_login: f.create_login,
    name: f.name.trim(),
    phone: f.phone.trim(),
    role: f.role,
    role_ids: f.role_ids,
    ...(f.create_login && f.email.trim() ? { email: f.email.trim() } : {}),
    ...(f.create_login && f.password ? { password: f.password } : {}),
  }
}

/** One plain sentence per field that needs fixing; empty when it is all good. */
export function formErrors(f: MemberForm): FieldErrors<MemberFormField> {
  return fieldErrors<MemberFormField>(addMemberRequest, toPayload(f), {
    labels: LABELS,
    overrides: {
      phone: 'Enter a phone number with at least 6 digits.',
      email: 'Enter a valid email address, like asha@studio.in.',
    },
  })
}

export const isValid = (f: MemberForm): boolean => Object.keys(formErrors(f)).length === 0

/** Final parse. Throws if the form is incomplete — the button gates it. */
export const toRequest = (f: MemberForm): AddMemberRequest => addMemberRequest.parse(toPayload(f))

/** Letters and digits that are not easily misread when read out: no 0/O, 1/l/I. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A starting password the owner can read out over the phone. */
export function suggestPassword(length = 8, random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)]
  return out
}
