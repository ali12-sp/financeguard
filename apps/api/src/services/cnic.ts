/**
 * Pakistani CNIC utilities.
 *
 * A valid CNIC is exactly 13 digits, optionally with dashes in the
 * format XXXXX-XXXXXXX-X.
 *
 * This module provides:
 *  - normalizeCnic  – strips dashes, trims, returns raw 13-digit string
 *  - formatCnic     – formats as XXXXX-XXXXXXX-X for display
 *  - isValidCnic    – true when the input is a 13-digit CNIC
 */

/** Strip whitespace and dashes, return digits only. */
export function normalizeCnic(raw: string): string {
  if (!raw) return raw;
  return raw.trim().replace(/[-\s]/g, '');
}

/**
 * Format a 13-digit string as XXXXX-XXXXXXX-X.
 * Returns the input unchanged if it is not exactly 13 digits.
 */
export function formatCnic(raw: string): string {
  const digits = normalizeCnic(raw);
  if (!/^\d{13}$/.test(digits)) return raw;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/**
 * Returns true when `raw` is a valid 13-digit CNIC
 * (with or without formatting dashes).
 */
export function isValidCnic(raw: string): boolean {
  return /^\d{13}$/.test(normalizeCnic(raw));
}
