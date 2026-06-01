/**
 * Pakistani phone-number utilities.
 *
 * Accepted input formats (all map to +92XXXXXXXXXX):
 *   03001234567     → +923001234567
 *   923001234567    → +923001234567
 *   +923001234567   → +923001234567  (already correct)
 *   3001234567      → +923001234567  (10-digit without leading 0)
 *
 * Non-Pakistani numbers (e.g. international) are returned unchanged
 * so we don't break data for users who explicitly enter a +1 / +44 number.
 */

/** Strip every character that is not a digit or a leading '+'. */
function stripFormatting(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, '');
}

/**
 * Attempt to normalise a phone number to E.164 (+92...) for Pakistan.
 * Returns the cleaned string if it cannot be identified as Pakistani.
 */
export function normalizePhone(raw: string): string {
  if (!raw) return raw;
  const cleaned = stripFormatting(raw);

  // Already E.164 +92
  if (/^\+92\d{10}$/.test(cleaned)) return cleaned;

  // Already E.164 but different country – leave alone
  if (cleaned.startsWith('+') && !cleaned.startsWith('+92')) return cleaned;

  // 92XXXXXXXXXX (12 digits, no +)
  if (/^92\d{10}$/.test(cleaned)) return `+${cleaned}`;

  // 03XXXXXXXXX (11 digits, local format)
  if (/^0[3]\d{9}$/.test(cleaned)) return `+92${cleaned.slice(1)}`;

  // 3XXXXXXXXX (10 digits – missing leading 0)
  if (/^3\d{9}$/.test(cleaned)) return `+92${cleaned}`;

  // Cannot identify – return as-is so we don't corrupt the value
  return cleaned;
}

/**
 * Zod refinement that validates a Pakistani mobile number.
 * Also accepts empty/undefined (use .optional() separately).
 */
export function isValidPakistaniPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  return /^\+92[3][0-9]{9}$/.test(normalized);
}
