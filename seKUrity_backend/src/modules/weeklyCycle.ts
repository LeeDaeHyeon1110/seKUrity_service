const SUNDAY = 0;

function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid weekly cycle date: ${value}`);
  }

  return parsed;
}

export function getWeeklyCycleEnd(date: string): string {
  const current = parseDateOnly(date);
  const daysUntilSunday = (SUNDAY - current.getUTCDay() + 7) % 7;

  current.setUTCDate(current.getUTCDate() + daysUntilSunday);
  return current.toISOString().slice(0, 10);
}
