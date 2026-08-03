export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentHHMM(): string {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function currentWeekday(): number {
  return new Date().getUTCDay();
}

/**
 * Parses "HH:MM" (today at that UTC time, rolled to tomorrow if already past)
 * or a relative offset like "+30m" / "+2h" / "+45min" / "+1д". Returns an ISO
 * timestamp, or null if the input doesn't match either form.
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
    const target = new Date(now);
    target.setUTCHours(parseInt(clockMatch[1], 10), parseInt(clockMatch[2], 10), 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.toISOString();
  }

  return null;
}
