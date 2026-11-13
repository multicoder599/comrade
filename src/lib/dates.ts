// Nairobi time (EAT, UTC+3) day boundaries as ISO strings for report queries.

export function eatDayRange(daysBack: number): { from: string; to: string } {
  const now = new Date();
  const eatNow = new Date(now.getTime() + 3 * 3600_000);
  const dayStartUtc = Date.UTC(
    eatNow.getUTCFullYear(),
    eatNow.getUTCMonth(),
    eatNow.getUTCDate(),
  );
  const start = dayStartUtc - 3 * 3600_000 - daysBack * 86400_000;
  const end = dayStartUtc - 3 * 3600_000 + 86400_000;
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  };
}

export function eatDateInputValue(daysBack: number): string {
  const { from } = eatDayRange(daysBack);
  const eat = new Date(new Date(from).getTime() + 3 * 3600_000);
  return eat.toISOString().slice(0, 10);
}

/** Convert a yyyy-mm-dd input value (interpreted in EAT) to [from, to) ISO. */
export function eatRangeFromInputs(
  fromDate: string,
  toDate: string,
): { from: string; to: string } {
  const from = new Date(`${fromDate}T00:00:00+03:00`).toISOString();
  const to = new Date(
    new Date(`${toDate}T00:00:00+03:00`).getTime() + 86400_000,
  ).toISOString();
  return { from, to };
}
