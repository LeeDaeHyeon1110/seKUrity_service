function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error('WEEKLY_TEST_DATE must use the YYYY-MM-DD format.');
  }

  return date;
}

export function resolveWeeklyTestDate(
  nodeEnv: string | undefined,
  value: string | undefined,
): string | null {
  const testDate = value?.trim();

  if (!testDate) {
    return null;
  }

  if (nodeEnv !== 'test') {
    throw new Error('WEEKLY_TEST_DATE can only be used when NODE_ENV=test.');
  }

  parseDate(testDate);

  return testDate;
}

export function getConfiguredWeeklyTestDate(): string | null {
  return resolveWeeklyTestDate(
    process.env.NODE_ENV?.trim(),
    process.env.WEEKLY_TEST_DATE,
  );
}
