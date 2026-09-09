import { getNextSundayKstDateString } from '../scrums/dateUtils';

export interface WeeklyPeriod {
  weekStart: string;
  weekEnd: string;
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid weekly date: ${value}`);
  }

  return date;
}

export function getCurrentWeeklyPeriodKst(
  date?: Date,
): WeeklyPeriod {
  const weekEnd = getNextSundayKstDateString(date);
  const end = parseDate(weekEnd);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);

  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd,
  };
}

export function isWeeklyReportOpen(
  weekEnd: string,
  date?: Date,
): boolean {
  return getCurrentWeeklyPeriodKst(date).weekEnd === weekEnd;
}
