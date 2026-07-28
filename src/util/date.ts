export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentHHMM(): string {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
