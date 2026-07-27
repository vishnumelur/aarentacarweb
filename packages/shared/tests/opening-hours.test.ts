import { describe, it, expect } from 'vitest'
import {
  isWithinOpeningHours, dubaiWeekday, dubaiTimeOfDay, type OpeningInterval,
} from '../src/availability/opening-hours.js'

// The real AA Rentals schedule: Sat-Thu 08:00-21:30, Fri 08:30-12:00 and 17:00-21:30.
const HOURS: OpeningInterval[] = [
  { weekday: 0, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 1, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 2, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 3, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 4, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 5, opensAt: '08:30', closesAt: '12:00' },
  { weekday: 5, opensAt: '17:00', closesAt: '21:30' },
  { weekday: 6, opensAt: '08:00', closesAt: '21:30' },
]

describe('Dubai timezone helpers', () => {
  it('converts UTC to the Dubai weekday', () => {
    // 2026-08-01 is a Saturday. 04:00Z is 08:00 in Dubai (UTC+4).
    expect(dubaiWeekday(new Date('2026-08-01T04:00:00Z'))).toBe(6)
  })

  it('rolls the weekday over when UTC and Dubai differ in date', () => {
    // 2026-08-01 21:00Z is 2026-08-02 01:00 in Dubai — Saturday becomes Sunday.
    expect(dubaiWeekday(new Date('2026-08-01T21:00:00Z'))).toBe(0)
  })

  it('renders the Dubai wall-clock time', () => {
    expect(dubaiTimeOfDay(new Date('2026-08-01T04:00:00Z'))).toBe('08:00')
    expect(dubaiTimeOfDay(new Date('2026-08-01T17:30:00Z'))).toBe('21:30')
    expect(dubaiTimeOfDay(new Date('2026-08-01T20:00:00Z'))).toBe('00:00')
  })
})

describe('opening hours', () => {
  it('accepts a time inside a weekday interval', () => {
    // Saturday 10:00 Dubai = 06:00Z
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T06:00:00Z'))).toBe(true)
  })

  it('rejects a time before opening', () => {
    // Saturday 07:00 Dubai = 03:00Z
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T03:00:00Z'))).toBe(false)
  })

  it('rejects a time after closing', () => {
    // Saturday 22:00 Dubai = 18:00Z
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T18:00:00Z'))).toBe(false)
  })

  it('accepts both Friday intervals and rejects the gap between them', () => {
    // 2026-08-07 is a Friday.
    // 09:00 Dubai = 05:00Z — inside the morning interval
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-07T05:00:00Z'))).toBe(true)
    // 14:00 Dubai = 10:00Z — the Friday prayer gap
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-07T10:00:00Z'))).toBe(false)
    // 18:00 Dubai = 14:00Z — inside the evening interval
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-07T14:00:00Z'))).toBe(true)
  })

  it('treats opening time as inclusive and closing time as exclusive', () => {
    // Saturday 08:00 Dubai = 04:00Z — exactly opening
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T04:00:00Z'))).toBe(true)
    // Saturday 21:30 Dubai = 17:30Z — exactly closing
    expect(isWithinOpeningHours(HOURS, new Date('2026-08-01T17:30:00Z'))).toBe(false)
  })

  it('rejects everything when a branch has no hours for that day', () => {
    const closedFriday = HOURS.filter((h) => h.weekday !== 5)
    expect(isWithinOpeningHours(closedFriday, new Date('2026-08-07T05:00:00Z'))).toBe(false)
  })

  it('rejects everything when the interval list is empty', () => {
    expect(isWithinOpeningHours([], new Date('2026-08-01T06:00:00Z'))).toBe(false)
  })

  it('tolerates seconds in the stored time', () => {
    const withSeconds: OpeningInterval[] = [{ weekday: 6, opensAt: '08:00:00', closesAt: '21:30:00' }]
    expect(isWithinOpeningHours(withSeconds, new Date('2026-08-01T06:00:00Z'))).toBe(true)
  })
})
