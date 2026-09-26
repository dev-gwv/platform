import { describe, expect, it } from 'vitest'
import {
  EMPTY_MEMBER_FORM,
  formErrors,
  isValid,
  suggestPassword,
  toPayload,
  toRequest,
  type MemberForm,
} from './member-form'

const form = (over: Partial<MemberForm> = {}): MemberForm => ({ ...EMPTY_MEMBER_FORM, ...over })

const filled = form({
  name: 'Meera Iyer',
  phone: '9876543210',
  email: 'meera@crew.in',
  password: 'secret123',
})

describe('toPayload', () => {
  it('sends only name, phone, works-as and can-see when sign-in is off', () => {
    const payload = toPayload(form({ ...filled, create_login: false }))
    expect(payload).toEqual({
      engagement_type: 'in_house',
      create_login: false,
      name: 'Meera Iyer',
      phone: '9876543210',
      role: 'employee',
      role_ids: [],
    })
    expect(payload).not.toHaveProperty('email')
    expect(payload).not.toHaveProperty('password')
  })

  it('sends email and password when sign-in is on', () => {
    const payload = toPayload(filled)
    expect(payload.create_login).toBe(true)
    expect(payload.email).toBe('meera@crew.in')
    expect(payload.password).toBe('secret123')
  })

  it('trims what was typed', () => {
    const payload = toPayload(form({ name: ' Meera ', phone: ' 9876543210 ', email: ' meera@crew.in ', password: 'x' }))
    expect(payload.name).toBe('Meera')
    expect(payload.phone).toBe('9876543210')
    expect(payload.email).toBe('meera@crew.in')
  })

  it('maps "Per shoot" to freelancer and "On salary" to in_house', () => {
    expect(toPayload(form({ engagement_type: 'freelancer' })).engagement_type).toBe('freelancer')
    expect(toPayload(EMPTY_MEMBER_FORM).engagement_type).toBe('in_house')
  })

  it('maps "Team member" to employee and keeps manager and admin', () => {
    expect(toPayload(EMPTY_MEMBER_FORM).role).toBe('employee')
    expect(toPayload(form({ role: 'manager' })).role).toBe('manager')
    expect(toPayload(form({ role: 'admin' })).role).toBe('admin')
  })

  it('never sends pay, address or ID fields', () => {
    const keys = Object.keys(toPayload(filled))
    for (const k of ['salary', 'freelancer_rate', 'address', 'payment_type', 'payout_type']) {
      expect(keys).not.toContain(k)
    }
  })
})

describe('formErrors', () => {
  it('needs a name and a phone, and email + password only with sign-in', () => {
    const errors = formErrors(EMPTY_MEMBER_FORM)
    expect(errors.name).toBe('Name is required.')
    expect(errors.phone).toBe('Phone is required.')
    expect(errors.email).toBe('Email is required.')
    expect(errors.password).toBe('Password is required.')

    expect(formErrors(form({ create_login: false, name: 'Imran', phone: '9844444444' }))).toEqual({})
  })

  it('says a short password is short, in plain words', () => {
    expect(formErrors(form({ ...filled, password: 'abc' })).password).toBe('Password must be at least 6 characters.')
  })

  it('catches a mistyped email', () => {
    expect(formErrors(form({ ...filled, email: 'meera@' })).email).toMatch(/valid email/)
  })

  it('accepts a filled form and the contract agrees', () => {
    expect(isValid(filled)).toBe(true)
    expect(() => toRequest(filled)).not.toThrow()
    expect(() => toRequest(form({ ...filled, email: '' }))).toThrow()
  })
})

describe('suggestPassword', () => {
  it('is 8 characters of letters and digits', () => {
    const pw = suggestPassword()
    expect(pw).toHaveLength(8)
    expect(pw).toMatch(/^[A-Za-z0-9]{8}$/)
  })

  it('leaves out characters that are misread when read out', () => {
    let i = 0
    const seq = () => ((i += 0.01) % 1)
    const many = suggestPassword(200, seq)
    expect(many).not.toMatch(/[0O1lI]/)
  })

  it('passes the contract as a password', () => {
    expect(isValid(form({ ...filled, password: suggestPassword() }))).toBe(true)
  })
})
