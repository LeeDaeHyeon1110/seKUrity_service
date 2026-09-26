import type { WeeklyScrumResult } from '../../contracts';

// The first cycle covered by the new policy ends on 2026-09-29 at 19:00 KST.
export const QUALIFYING_SCRUM_POLICY_WEEK_END = '2026-09-27';

export function requiresQualifyingScrum(weekEnd: string): boolean {
  return weekEnd >= QUALIFYING_SCRUM_POLICY_WEEK_END;
}

export function isQualifyingScrumResult(
  item: Pick<WeeklyScrumResult, 'scrumCategory'>,
): boolean {
  return item.scrumCategory === 'project'
    || item.scrumCategory === 'study'
    || item.scrumCategory === 'personal_study';
}
