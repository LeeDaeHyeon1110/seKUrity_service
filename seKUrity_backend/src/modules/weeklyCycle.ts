const SUNDAY = 0;
const MONDAY = 1;
const TUESDAY = 2;
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const WEEKLY_REPORT_DEADLINE_HOUR = 19;

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

function getKstClock(value: Date | string): Date {
  if (typeof value === 'string') {
    const date = parseDateOnly(value);
    date.setUTCHours(12);
    return date;
  }

  return new Date(value.getTime() + KST_OFFSET_MS);
}

export function getWeeklyReportCycleEnd(
  value: Date | string = new Date(),
): string {
  const current = getKstClock(value);
  const day = current.getUTCDay();
  const beforeTuesdayDeadline = day === MONDAY
    || (day === TUESDAY
      && current.getUTCHours() < WEEKLY_REPORT_DEADLINE_HOUR);
  const daysToSunday = day === SUNDAY
    ? 0
    : beforeTuesdayDeadline
      ? -day
      : (SUNDAY - day + 7) % 7;

  current.setUTCDate(current.getUTCDate() + daysToSunday);
  return current.toISOString().slice(0, 10);
}

export function getWeeklyCycleEnd(
  value: Date | string = new Date(),
): string {
  return getWeeklyReportCycleEnd(value);
}

export function isWeeklyReportDeadlineClosed(
  weekEnd: string,
  value: Date | string = new Date(),
): boolean {
  const deadline = parseDateOnly(weekEnd);
  deadline.setUTCDate(deadline.getUTCDate() + 2);
  deadline.setUTCHours(WEEKLY_REPORT_DEADLINE_HOUR);

  return getKstClock(value).getTime() >= deadline.getTime();
}

export function isWeeklyReportReminderWindow(
  weekEnd: string,
  value: Date | string = new Date(),
): boolean {
  const current = getKstClock(value);
  const hour = current.getUTCHours();

  return current.getUTCDay() === TUESDAY
    && hour >= 12
    && hour < WEEKLY_REPORT_DEADLINE_HOUR
    && getWeeklyReportCycleEnd(value) === weekEnd;
}
