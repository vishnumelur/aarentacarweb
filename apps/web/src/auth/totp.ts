import * as OTPAuth from 'otpauth'

const ISSUER = 'AA Rentals'
const DIGITS = 6
const PERIOD_SECONDS = 30
/** One period either side, tolerating modest clock skew on a staff member's phone. */
const WINDOW = 1

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32
}

export function totpUri(secret: string, accountName: string): string {
  return new OTPAuth.TOTP({
    issuer: ISSUER, label: accountName,
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: DIGITS, period: PERIOD_SECONDS,
  }).toString()
}

/**
 * `now` is a parameter, not `Date.now()`, so skew and expiry are testable without
 * sleeping. Returns false on any malformed input rather than throwing.
 */
export function verifyTotp(secret: string, token: string, now: Date): boolean {
  if (!/^\d{6}$/.test(token)) return false
  try {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER, label: 'verify',
      secret: OTPAuth.Secret.fromBase32(secret),
      digits: DIGITS, period: PERIOD_SECONDS,
    })
    return totp.validate({ token, timestamp: now.getTime(), window: WINDOW }) !== null
  } catch {
    return false
  }
}
