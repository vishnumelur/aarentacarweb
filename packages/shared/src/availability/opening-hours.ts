/**
 * Branch trading hours.
 *
 * NFR-5: timestamps are stored UTC and rendered Asia/Dubai. Opening hours are
 * wall-clock times in Dubai, so every comparison converts first. Dubai has no
 * daylight saving, but `Intl` is used rather than a fixed +4 offset so this stays
 * correct if that ever changes.
 *
 * `weekday` is 0=Sunday..6=Saturday, matching Postgres DOW and the seed data.
 * A weekday may have several intervals — Friday has two, either side of prayers.
 */

const DUBAI = 'Asia/Dubai'

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

export interface OpeningInterval {
  readonly weekday: number
  /** `HH:MM` or `HH:MM:SS`, Dubai wall-clock. */
  readonly opensAt: string
  readonly closesAt: string
}

export function dubaiWeekday(at: Date): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: DUBAI, weekday: 'short',
  }).format(at)
  const index = WEEKDAY_INDEX[short]
  if (index === undefined) throw new Error(`Unrecognised weekday: ${short}`)
  return index
}

/**
 * The Asia/Dubai calendar date of a UTC instant, as `YYYY-MM-DD`.
 *
 * Business dates — a maintenance block, a document expiry, a trading day — are Dubai
 * dates. Slicing `toISOString()` gives the UTC date instead, which is one day behind
 * for any instant from 20:00Z onward, so a car in the workshop on its actual return
 * day would read as available.
 */
export function dubaiDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

export function dubaiTimeOfDay(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)
}

/** `HH:MM` or `HH:MM:SS` to minutes since midnight, so comparison is numeric. */
function toMinutes(time: string): number {
  const parts = time.split(':')
  const hours = Number(parts[0])
  const minutes = Number(parts[1] ?? '0')
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Invalid time: ${time}`)
  }
  return hours * 60 + minutes
}

/**
 * Whether the branch is open at this instant. Opening is inclusive, closing is
 * exclusive — a branch closing at 21:30 is shut at 21:30, so no pickup slot is
 * offered for a moment nobody is there.
 */
export function isWithinOpeningHours(
  intervals: readonly OpeningInterval[],
  at: Date,
): boolean {
  const weekday = dubaiWeekday(at)
  const minutes = toMinutes(dubaiTimeOfDay(at))
  return intervals.some(
    (i) =>
      i.weekday === weekday &&
      minutes >= toMinutes(i.opensAt) &&
      minutes < toMinutes(i.closesAt),
  )
}
