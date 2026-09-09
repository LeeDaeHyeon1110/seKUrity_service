import { ScrumCategory } from './categories';
import type { ScrumAttachment } from './types';

export const MAX_PLANNING_DOCUMENT_BYTES = 24 * 1024 * 1024;
export const MAX_PROJECT_SCORE_DOCUMENT_BYTES = 24 * 1024 * 1024;

export function requiresPlanningDocument(category: ScrumCategory): boolean {
  return category === ScrumCategory.Project
    || category === ScrumCategory.PersonalStudy;
}

export function isPdfPlanningDocument(
  attachment: ScrumAttachment,
): boolean {
  return attachment.name.toLowerCase().endsWith('.pdf')
    && attachment.contentType?.toLowerCase() === 'application/pdf';
}

export function validatePlanningDocument(
  category: ScrumCategory,
  attachments: ScrumAttachment[],
): string | null {
  if (attachments.length > 1) {
    return '기획서는 PDF 파일 1개만 업로드할 수 있습니다.';
  }

  const [attachment] = attachments;

  if (!attachment) {
    if (category === ScrumCategory.Project) {
      return '프로젝트 스크럼은 기획서 PDF를 반드시 업로드해야 합니다.';
    }

    return category === ScrumCategory.PersonalStudy
      ? '개인 스터디 스크럼은 기획서 PDF를 반드시 업로드해야 합니다.'
      : null;
  }

  if (!isPdfPlanningDocument(attachment)) {
    return '기획서는 PDF 형식의 파일만 업로드할 수 있습니다.';
  }

  if (attachment.size > MAX_PLANNING_DOCUMENT_BYTES) {
    return '기획서 PDF는 24MB 이하여야 합니다.';
  }

  return null;
}

export function validateProjectScoreDocument(
  category: ScrumCategory,
  attachments: ScrumAttachment[],
): string | null {
  if (attachments.length > 1) {
    return 'PROJECT:SCORE 결과는 Markdown 파일 1개만 업로드할 수 있습니다.';
  }

  const [attachment] = attachments;

  if (!attachment) {
    return category === ScrumCategory.Project
      ? '프로젝트 스크럼은 PROJECT:SCORE 결과 Markdown 파일을 반드시 업로드해야 합니다.'
      : null;
  }

  if (!attachment.name.toLowerCase().endsWith('.md')) {
    return 'PROJECT:SCORE 결과는 `.md` 형식의 파일만 업로드할 수 있습니다.';
  }

  if (attachment.size > MAX_PROJECT_SCORE_DOCUMENT_BYTES) {
    return 'PROJECT:SCORE 결과 Markdown 파일은 24MB 이하여야 합니다.';
  }

  return null;
}

export function validateProjectDocuments(
  category: ScrumCategory,
  planningDocuments: ScrumAttachment[],
  projectScoreDocuments: ScrumAttachment[],
): string | null {
  return validatePlanningDocument(category, planningDocuments)
    ?? validateProjectScoreDocument(category, projectScoreDocuments);
}
