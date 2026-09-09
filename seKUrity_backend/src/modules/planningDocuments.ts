import type {
  ScrumAttachment,
  ScrumCategory,
} from '../contracts';
import { ApiError } from '../errors';

const MAX_PLANNING_DOCUMENT_BYTES = 24 * 1024 * 1024;

interface PlanningDocumentRow {
  planningDocumentId: string | null;
  planningDocumentName: string | null;
  planningDocumentUrl: string | null;
  planningDocumentContentType: string | null;
  planningDocumentSize: number | null;
}

interface ProjectScoreDocumentRow {
  projectScoreDocumentId: string | null;
  projectScoreDocumentName: string | null;
  projectScoreDocumentUrl: string | null;
  projectScoreDocumentContentType: string | null;
  projectScoreDocumentSize: number | null;
}

export function assertPlanningDocument(
  category: ScrumCategory,
  document: ScrumAttachment | null,
): void {
  if (
    (category === 'project' || category === 'personal_study')
    && !document
  ) {
    throw new ApiError(
      400,
      'PLANNING_DOCUMENT_REQUIRED',
      'Project and personal study scrums require a planning document PDF.',
    );
  }

  if (!document) {
    return;
  }

  if (
    !document.name.toLowerCase().endsWith('.pdf')
    || document.contentType?.toLowerCase() !== 'application/pdf'
    || document.size > MAX_PLANNING_DOCUMENT_BYTES
  ) {
    throw new ApiError(
      400,
      'INVALID_PLANNING_DOCUMENT',
      'The planning document must be a PDF no larger than 24MB.',
    );
  }
}

export function assertProjectScoreDocument(
  category: ScrumCategory,
  document: ScrumAttachment | null,
): void {
  if (category === 'project' && !document) {
    throw new ApiError(
      400,
      'PROJECT_SCORE_DOCUMENT_REQUIRED',
      'Project scrums require a PROJECT:SCORE Markdown result file.',
    );
  }

  if (!document) {
    return;
  }

  if (
    !document.name.toLowerCase().endsWith('.md')
    || document.size > MAX_PLANNING_DOCUMENT_BYTES
  ) {
    throw new ApiError(
      400,
      'INVALID_PROJECT_SCORE_DOCUMENT',
      'The PROJECT:SCORE result must be a Markdown file no larger than 24MB.',
    );
  }
}

export function assertProjectDocuments(
  category: ScrumCategory,
  planningDocument: ScrumAttachment | null,
  projectScoreDocument: ScrumAttachment | null,
): void {
  assertPlanningDocument(category, planningDocument);
  assertProjectScoreDocument(category, projectScoreDocument);
}

export function mapPlanningDocument(
  row: PlanningDocumentRow,
): ScrumAttachment | null {
  if (
    !row.planningDocumentId
    || !row.planningDocumentName
    || !row.planningDocumentUrl
    || row.planningDocumentSize === null
  ) {
    return null;
  }

  return {
    id: row.planningDocumentId,
    name: row.planningDocumentName,
    url: row.planningDocumentUrl,
    contentType: row.planningDocumentContentType,
    size: row.planningDocumentSize,
  };
}

export function planningDocumentColumns(
  document: ScrumAttachment | null,
): PlanningDocumentRow {
  return {
    planningDocumentId: document?.id ?? null,
    planningDocumentName: document?.name ?? null,
    planningDocumentUrl: document?.url ?? null,
    planningDocumentContentType: document?.contentType ?? null,
    planningDocumentSize: document?.size ?? null,
  };
}

export function mapProjectScoreDocument(
  row: ProjectScoreDocumentRow,
): ScrumAttachment | null {
  if (
    !row.projectScoreDocumentId
    || !row.projectScoreDocumentName
    || !row.projectScoreDocumentUrl
    || row.projectScoreDocumentSize === null
  ) {
    return null;
  }

  return {
    id: row.projectScoreDocumentId,
    name: row.projectScoreDocumentName,
    url: row.projectScoreDocumentUrl,
    contentType: row.projectScoreDocumentContentType,
    size: row.projectScoreDocumentSize,
  };
}

export function projectScoreDocumentColumns(
  document: ScrumAttachment | null,
): ProjectScoreDocumentRow {
  return {
    projectScoreDocumentId: document?.id ?? null,
    projectScoreDocumentName: document?.name ?? null,
    projectScoreDocumentUrl: document?.url ?? null,
    projectScoreDocumentContentType: document?.contentType ?? null,
    projectScoreDocumentSize: document?.size ?? null,
  };
}
