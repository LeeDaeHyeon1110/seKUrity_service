export enum ScrumCategory {
  Project = 'project',
  Study = 'study',
  PersonalStudy = 'personal_study',
  Personal = 'personal',
}

export const SCRUM_CATEGORY_LABELS: Record<ScrumCategory, string> = {
  [ScrumCategory.Project]: '프로젝트',
  [ScrumCategory.Study]: '스터디',
  [ScrumCategory.PersonalStudy]: '개인 스터디',
  [ScrumCategory.Personal]: '개인 활동',
};

export function isScrumCategory(value: string): value is ScrumCategory {
  return Object.values(ScrumCategory).includes(value as ScrumCategory);
}
