import { describe, it, expect } from 'vitest'
import { registerRequest, loginRequest, forgotPasswordRequest, createLeadRequest } from '@ipc/contracts'
import { fieldErrors } from './field-errors'

/**
 * These run against the REAL auth contracts, not a copy — if a rule changes
 * server-side and the form stops matching it, these fail.
 */
const REGISTER_LABELS = {
  company_name: 'Company name',
  admin_name: 'Your name',
  email: 'Email',
  password: 'Password',
  phone: 'Phone',
} as const

const REGISTER_OVERRIDES = {
  phone: 'Enter a valid phone number — 10 digits, or with a country code.',
} as const

const valid = {
  company_name: 'Aperture Studios',
  admin_name: 'Priya Sharma',
  email: 'priya@aperture.in',
  password: 'correct-horse',
  // Phone is required on register (contract + form both enforce it).
  phone: '9876543210',
}

const register = (patch: Record<string, unknown>) =>
  fieldErrors(
    registerRequest,
    { ...valid, ...patch },
    {
      labels: REGISTER_LABELS,
      overrides: REGISTER_OVERRIDES,
    },
  )

describe('fieldErrors — register', () => {
  it('passes valid input with a phone', () => {
    expect(register({})).toEqual({})
  })

  it('names the field and the limit for a short password', () => {
    expect(register({ password: 'short' }).password).toBe('Password must be at least 8 characters.')
  })

  it('says required — not "too short" — when a field is left blank', () => {
    expect(register({ company_name: '' }).company_name).toBe('Company name is required.')
    expect(register({ password: '' }).password).toBe('Password is required.')
    expect(register({ password: '   ' }).password).toBe('Password is required.')
  })

  it('distinguishes blank from too short', () => {
    expect(register({ company_name: 'A' }).company_name).toBe(
      'Company name must be at least 2 characters.',
    )
  })

  it('explains an email format failure with an example', () => {
    expect(register({ email: 'priya@' }).email).toBe(
      'Enter a valid email address, like you@studio.in.',
    )
    expect(register({ email: 'not-an-email' }).email).toBe(
      'Enter a valid email address, like you@studio.in.',
    )
  })

  it('uses the override for a phone that will not normalise', () => {
    expect(register({ phone: '123' }).phone).toBe(REGISTER_OVERRIDES.phone)
  })

  it('accepts phone formats the normaliser handles', () => {
    for (const phone of ['9876543210', '98765 43210', '+91 98765 43210', '0091 9876543210']) {
      expect(register({ phone })).toEqual({})
    }
  })

  it('reports a too-long value against the contract maximum', () => {
    expect(register({ company_name: 'x'.repeat(121) }).company_name).toBe(
      'Company name must be 120 characters or fewer.',
    )
  })

  it('reports every bad field at once, one message each', () => {
    const errors = register({ company_name: '', email: 'nope', password: 'short' })
    expect(errors).toEqual({
      company_name: 'Company name is required.',
      email: 'Enter a valid email address, like you@studio.in.',
      password: 'Password must be at least 8 characters.',
    })
  })

  it('treats a missing key the same as a blank one', () => {
    const errors = fieldErrors(
      registerRequest,
      { email: 'a@b.in', password: 'longenough' },
      {
        labels: REGISTER_LABELS,
      },
    )
    expect(errors.company_name).toBe('Company name is required.')
    expect(errors.admin_name).toBe('Your name is required.')
  })
})

describe('fieldErrors — sign in', () => {
  const labels = { email: 'Email', password: 'Password' } as const
  const login = (patch: Record<string, unknown>) =>
    fieldErrors(loginRequest, { email: 'priya@aperture.in', password: 'x', ...patch }, { labels })

  it('passes valid credentials', () => {
    expect(login({})).toEqual({})
  })

  it('does not impose a length rule sign-in does not have', () => {
    // loginRequest is min(1): an existing short password must still be submittable.
    expect(login({ password: 'abc' })).toEqual({})
  })

  it('requires both fields', () => {
    expect(login({ email: '', password: '' })).toEqual({
      email: 'Email is required.',
      password: 'Password is required.',
    })
  })
})

describe('fieldErrors — forgot password', () => {
  it('validates the email on its own', () => {
    const labels = { email: 'Email' } as const
    expect(fieldErrors(forgotPasswordRequest, { email: '' }, { labels }).email).toBe(
      'Email is required.',
    )
    expect(fieldErrors(forgotPasswordRequest, { email: 'bad' }, { labels }).email).toBe(
      'Enter a valid email address, like you@studio.in.',
    )
  })
})

describe('a cross-field rule on a blank field', () => {
  it('keeps the rule’s own words: a lead needs a name or a phone, not a phone', () => {
    const labels = { name: 'Name', phone: 'Phone', email: 'Email' }
    expect(fieldErrors(createLeadRequest, {}, { labels }).phone).toBe('Add a name or a phone number.')
    expect(fieldErrors(createLeadRequest, { name: 'Aanya' }, { labels })).toEqual({})
  })
})
