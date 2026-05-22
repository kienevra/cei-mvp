/**
 * Locale-aware date formatting utility.
 * EN (US): MM/DD/YYYY  e.g. 05/21/2026
 * IT (EU): DD/MM/YYYY  e.g. 21/05/2026
 *
 * Accepts:
 *   - ISO date strings "YYYY-MM-DD"
 *   - ISO datetime strings "YYYY-MM-DDTHH:MM:SS..."
 *   - Date objects
 *   - Fallback: returns the original value as string if parsing fails
 */
export function fmtDate(date: string | Date | null | undefined, lang: string): string {
  if (!date) return "—";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return String(date);
    const locale = lang.toLowerCase().startsWith("it") ? "it-IT" : "en-US";
    return d.toLocaleDateString(locale, {
      day:   "2-digit",
      month: "2-digit",
      year:  "numeric",
    });
  } catch {
    return String(date);
  }
}

/**
 * Locale-aware datetime formatting (date + time).
 * EN: 05/21/2026, 09:32 PM
 * IT: 21/05/2026, 21:32
 */
export function fmtDateTime(date: string | Date | null | undefined, lang: string): string {
  if (!date) return "—";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return String(date);
    const locale = lang.toLowerCase().startsWith("it") ? "it-IT" : "en-US";
    return d.toLocaleString(locale, {
      day:    "2-digit",
      month:  "2-digit",
      year:   "numeric",
      hour:   "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(date);
  }
}