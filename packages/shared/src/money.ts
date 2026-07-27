/**
 * All currency in this system is an integer count of fils. 1 AED = 100 fils.
 * Every rounding decision lives in this file and nowhere else — if a monetary
 * calculation appears elsewhere, it is a bug.
 */

/**
 * Above this, `amountFils * bps` could exceed Number.MAX_SAFE_INTEGER and lose
 * precision silently. 9e11 fils is 9 billion AED — far beyond any real booking,
 * so a value this large is a bug upstream, not a large rental.
 */
const MAX_AMOUNT_FILS = Math.floor(Number.MAX_SAFE_INTEGER / 10_000)

function assertAmount(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of fils, got ${value}`)
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative, got ${value}`)
  }
  if (value > MAX_AMOUNT_FILS) {
    throw new Error(
      `${label} must not exceed ${MAX_AMOUNT_FILS} fils (${MAX_AMOUNT_FILS / 100} AED), got ${value}. ` +
      `This limit prevents integer overflow during calculations.`,
    )
  }
}

function assertBps(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of basis points, got ${value}`)
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative, got ${value}`)
  }
}

/** Basis points expressing a proportion of a whole: 0-10000, i.e. 0%-100%. */
function assertProportionBps(value: number, label: string): void {
  assertBps(value, label)
  if (value > 10_000) {
    throw new Error(
      `${label} must not exceed 10000 basis points (100%), got ${value}. ` +
      `A portion cannot be larger than the amount it is taken from.`,
    )
  }
}

/** Rounds half away from zero. Inputs here are non-negative, so this is half-up. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5)
}

/** VAT payable on a net amount. `vatBps` is always supplied — never assumed to be 500. */
export function addVat(netFils: number, vatBps: number): number {
  assertAmount(netFils, 'netFils')
  assertBps(vatBps, 'vatBps')
  return roundHalfUp((netFils * vatBps) / 10_000)
}

/** The portion of an amount represented by `bps`. 1500 bps of 84000 is 12600. */
export function applyBps(amountFils: number, bps: number): number {
  assertAmount(amountFils, 'amountFils')
  assertProportionBps(bps, 'bps')
  return roundHalfUp((amountFils * bps) / 10_000)
}

/** Scales an amount by a multiplier. 13000 bps means 1.3x; 10000 bps is identity. */
export function applyMultiplierBps(amountFils: number, multiplierBps: number): number {
  assertAmount(amountFils, 'amountFils')
  assertBps(multiplierBps, 'multiplierBps')
  return roundHalfUp((amountFils * multiplierBps) / 10_000)
}

/**
 * Display only. Never feed the result back into a calculation.
 * Note: This function rejects negative input. Callers formatting a negative line
 * (e.g., a discount shown as negative) must handle the sign themselves.
 */
export function filsToAed(fils: number): string {
  assertAmount(fils, 'fils')
  return (fils / 100).toFixed(2)
}
