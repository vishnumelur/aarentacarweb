import { describe, it, expect } from 'vitest'
import { normalizeUaePhone } from '../src/auth/phone.js'

describe('normalizeUaePhone', () => {
  it.each([
    ['+971501234567', '+971501234567'],
    ['971501234567', '+971501234567'],
    ['0501234567', '+971501234567'],
    ['+971 50 123 4567', '+971501234567'],
    ['050-123-4567', '+971501234567'],
    ['971-50-123-4567', '+971501234567'],
    ['+971-50-123-4567', '+971501234567'],
    ['  +971501234567  '.trim(), '+971501234567'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeUaePhone(input)).toBe(expected)
  })

  it('rejects letters', () => {
    expect(normalizeUaePhone('nope')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(normalizeUaePhone('')).toBeNull()
  })

  it('rejects a number that is too short after normalisation', () => {
    expect(normalizeUaePhone('+97150123')).toBeNull()
  })

  it('rejects a number that is too long after normalisation', () => {
    expect(normalizeUaePhone('+9715012345678')).toBeNull()
  })

  it('rejects a UAE landline (does not start with 5) after normalisation', () => {
    expect(normalizeUaePhone('+97142345678')).toBeNull()
    expect(normalizeUaePhone('042345678')).toBeNull()
  })

  it('rejects a non-UAE international number', () => {
    expect(normalizeUaePhone('+14155552671')).toBeNull()
  })
})
