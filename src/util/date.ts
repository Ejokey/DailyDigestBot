// Russia abolished DST in 2014, so Moscow time is a fixed UTC+3 offset year-round —
// no timezone database is needed, just this constant. All bot-facing times (evening
// check-in, /recur, /remind, "today"'s date boundary) are in Moscow time so the user
// never has to mentally convert from UTC.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function toMskShifted(date: Date): Date {
  return new Date(date.getTime() + MSK_OFFSET_MS);
}

export function todayDate(): string {
  return toMskShifted(new Date()).toISOString().slice(0, 10);
}

export function currentHHMM(): string {
  const shifted = toMskShifted(new Date());
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function currentWeekday(): number {
  return toMskShifted(new Date()).getUTCDay();
}

/** Formats a real (UTC) ISO instant as its Moscow-time date and HH:MM, for display. */
export function formatMskDateTime(iso: string): string {
  const shifted = toMskShifted(new Date(iso));
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.toISOString().slice(0, 10)} ${hh}:${mm}`;
}

/**
 * Parses "HH:MM" (Moscow time, today, rolled to tomorrow if already past)
 * or a relative offset like "+30m" / "+2h" / "+45min" / "+1д". Returns a
 * real (UTC) ISO timestamp, or null if the input doesn't match either form.
 */
export function parseReminderTime(input: string, now: Date = new Date()): string | null {
  const trimmed = input.trim();

  const relativeMatch = trimmed.match(/^\+(\d+)\s*(m|min|мин|h|ч|d|д)$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const ms =
      unit === 'h' || unit === 'ч'
        ? amount * 60 * 60 * 1000
        : unit === 'd' || unit === 'д'
        ? amount * 24 * 60 * 60 * 1000
        : amount * 60 * 1000;
    return new Date(now.getTime() + ms).toISOString();
  }

  const clockMatch = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (clockMatch) {
    // Do the "is it already past, roll to tomorrow" comparison entirely in
    // shifted (Moscow wall-clock) space, then convert the result back to a
    // real UTC instant — shifting by a constant offset never changes which
    // side of "now" a moment falls on, so the rollover logic stays correct.
    const shiftedNow = toMskShifted(now);
    const shiftedTarget = new Date(shiftedNow);
    shiftedTarget.setUTCHours(parseInt(clockMatch[1], 10), parseInt(clockMatch[2], 10), 0, 0);
    if (shiftedTarget.getTime() <= shiftedNow.getTime()) {
      shiftedTarget.setUTCDate(shiftedTarget.getUTCDate() + 1);
    }
    return new Date(shiftedTarget.getTime() - MSK_OFFSET_MS).toISOString();
  }

  return null;
}
