/**
 * Time is a dependency, not an ambient fact.
 *
 * Every auth function takes a Clock so expiry, lockout and rate-limit windows can be
 * tested by advancing a fixed date rather than by sleeping. A function calling
 * `Date.now()` internally cannot be tested for what it does five minutes from now.
 */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()
