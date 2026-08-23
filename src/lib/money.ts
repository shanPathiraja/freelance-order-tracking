/**
 * Money helpers. Amounts live as integer cents — hundredths of a rupee — and
 * these are the only places that convert to or from the decimal strings a
 * human types or reads.
 */

/**
 * Parse user input ('400', '1,000.50', '$400.00') into cents.
 * Returns null for anything that isn't a non-negative amount, so callers can
 * show a validation message rather than silently storing NaN.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned)) return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null

  // Round rather than truncate so '0.015' becomes 2c, not 1c.
  return Math.round(value * 100)
}

/**
 * Currency symbol shown throughout the app and on printed invoices.
 *
 * Deliberately not `Intl` currency formatting: with LKR that renders the ISO
 * code ("LKR 12,278.00"), whereas Sri Lankan invoices are written "Rs".
 */
export const CURRENCY_SYMBOL = 'Rs'

/** Digits only, grouped, always two decimals: 1227800 -> '12,278.00'. */
export function formatCentsPlain(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Format cents for display: 1227800 -> 'Rs 12,278.00'. */
export function formatCents(cents: number): string {
  return `${CURRENCY_SYMBOL} ${formatCentsPlain(cents)}`
}

/** Format cents for an editable input field: 40000 -> '400.00'. */
export function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Split a total into `parts` whole-cent shares that add back to the total
 * exactly. The remainder lands on the earliest parts, so a $100 three-way
 * split is 33.34 / 33.33 / 33.33 rather than losing a cent.
 */
export function splitCents(totalCents: number, parts: number): number[] {
  if (parts < 1) return []

  const base = Math.floor(totalCents / parts)
  const remainder = totalCents - base * parts

  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0))
}

/** Apply a percentage to cents, rounding to the nearest whole cent. */
export function percentOfCents(cents: number, rate: number): number {
  return Math.round(cents * rate)
}
