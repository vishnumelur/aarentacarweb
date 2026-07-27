import { describe, it, expect } from 'vitest'
import { addVat, applyBps, applyMultiplierBps, filsToAed } from '../src/money.js'

describe('money arithmetic', () => {
  it('adds 5% VAT to a net amount', () => {
    expect(addVat(10000, 500)).toBe(500)
    expect(addVat(24000, 500)).toBe(1200)
  })

  it('rounds VAT half up to the nearest fil', () => {
    // 1234 fils at 5% = 61.7 fils
    expect(addVat(1234, 500)).toBe(62)
    // 1230 fils at 5% = 61.5 fils -> 62, not 61
    expect(addVat(1230, 500)).toBe(62)
  })

  it('never returns a fractional value', () => {
    for (const net of [1, 7, 13, 99, 333, 12345, 999999]) {
      expect(Number.isInteger(addVat(net, 500))).toBe(true)
    }
  })

  it('treats vatBps as an input, never assuming 5%', () => {
    expect(addVat(10000, 0)).toBe(0)
    expect(addVat(10000, 1000)).toBe(1000)
  })

  it('applies a basis-point discount', () => {
    // 15% of 84000 = 12600
    expect(applyBps(84000, 1500)).toBe(12600)
    expect(applyBps(84000, 0)).toBe(0)
    expect(applyBps(84000, 10000)).toBe(84000)
  })

  it('applies a basis-point multiplier', () => {
    // 1.3x of 10000 = 13000
    expect(applyMultiplierBps(10000, 13000)).toBe(13000)
    // 1.0x is identity
    expect(applyMultiplierBps(12345, 10000)).toBe(12345)
    // 1.8x of 999 = 1798.2 -> 1798
    expect(applyMultiplierBps(999, 18000)).toBe(1798)
  })

  it('rejects a non-integer input rather than silently rounding it', () => {
    expect(() => addVat(100.5, 500)).toThrow(/integer/)
    expect(() => applyBps(100.5, 500)).toThrow(/integer/)
    expect(() => applyMultiplierBps(100.5, 10000)).toThrow(/integer/)
  })

  it('rejects a negative amount', () => {
    expect(() => addVat(-1, 500)).toThrow(/negative/)
    expect(() => applyBps(-1, 500)).toThrow(/negative/)
  })

  it('formats fils as AED for display', () => {
    expect(filsToAed(12000)).toBe('120.00')
    expect(filsToAed(5)).toBe('0.05')
    expect(filsToAed(0)).toBe('0.00')
    expect(filsToAed(123456)).toBe('1234.56')
  })
})
