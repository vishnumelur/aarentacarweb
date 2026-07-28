/**
 * Normalises the phone numbers UAE customers actually type into the E.164 form
 * `requestOtp`'s `PHONE_PATTERN` requires.
 *
 * Real customers type `0501234567` (local), `971501234567` (country code, no
 * plus) and `+971501234567` (full E.164), often with spaces or dashes for
 * readability. `requestOtp` only accepts the last of those, so without this
 * normalisation step every local-format number a customer actually uses would
 * be rejected as `invalid_phone`. Both the request and verify routes call this
 * so they agree on what number is being verified — a customer who typed
 * `0501234567` to request a code must be able to verify it having typed the
 * same local form again.
 *
 * Returns `null` for anything that is not a plausible UAE mobile number after
 * normalisation, rather than guessing.
 */
export function normalizeUaePhone(raw: string): string | null {
  const stripped = raw.replace(/[\s-]/g, '')
  const digits = stripped.startsWith('+') ? stripped.slice(1) : stripped
  if (digits.length === 0 || !/^\d+$/.test(digits)) return null

  // Reduce to the 9-digit national number (starts with 5 for a UAE mobile),
  // whichever of the three accepted prefixes it arrived with.
  let national: string
  if (digits.startsWith('971')) {
    national = digits.slice(3)
  } else if (digits.startsWith('0')) {
    national = digits.slice(1)
  } else {
    national = digits
  }

  if (!/^5\d{8}$/.test(national)) return null
  return `+971${national}`
}
