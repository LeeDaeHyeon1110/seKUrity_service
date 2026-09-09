import { getConfiguredWeeklyTestDate } from '../config/weeklyTestDate';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SUNDAY = 0;

function getKstShiftedDate(date = new Date()): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

function formatDateOnly(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`Invalid scrum date: ${value}`);
  }

  const parsed = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ));

  if (
    formatDateOnly(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth() + 1,
      parsed.getUTCDate(),
    ) !== value
  ) {
    throw new Error(`Invalid scrum date: ${value}`);
  }

  return parsed;
}

export function formatScrumDate(value: string): string {
  const date = parseDateOnly(value);
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date);

  return `${value} (${weekday})`;
}

export function getKstDateString(date?: Date): string {
  if (date === undefined) {
    const testDate = getConfiguredWeeklyTestDate();

    if (testDate) {
      return testDate;
    }
  }

  const shifted = getKstShiftedDate(date ?? new Date());

  return formatDateOnly(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

export function getNextSundayKstDateString(date?: Date): string {
  if (date === undefined) {
    const testDate = getConfiguredWeeklyTestDate();

    if (testDate) {
      const virtualDate = parseDateOnly(testDate);
      const daysUntilSunday = (
        SUNDAY - virtualDate.getUTCDay() + 7
      ) % 7;

      if (daysUntilSunday === 0) {
        return testDate;
      }

      virtualDate.setUTCDate(
        virtualDate.getUTCDate() + daysUntilSunday,
      );
      return formatDateOnly(
        virtualDate.getUTCFullYear(),
        virtualDate.getUTCMonth() + 1,
        virtualDate.getUTCDate(),
      );
    }
  }

  const shifted = getKstShiftedDate(date ?? new Date());
  const currentDay = shifted.getUTCDay();
  const daysUntilSunday = (SUNDAY - currentDay + 7) % 7;

  const nextSunday = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + daysUntilSunday,
  ));

  return formatDateOnly(
    nextSunday.getUTCFullYear(),
    nextSunday.getUTCMonth() + 1,
    nextSunday.getUTCDate(),
  );
}

export function getNextWeeklyScrumDateString(scrumDate: string): string {
  const currentDate = parseDateOnly(scrumDate);

  currentDate.setUTCDate(currentDate.getUTCDate() + 7);

  return formatDateOnly(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth() + 1,
    currentDate.getUTCDate(),
  );
}
