import assert from 'node:assert/strict';
import { ButtonStyle, ComponentType, TextInputStyle } from 'discord.js';
import {
  buildApprovalDecisionRow,
  buildAdminEditScrumModal,
  buildAdminDeleteExtraModal,
  buildAdminMarkIncompleteModal,
  buildAdminMarkIncompleteTaskRow,
  buildAbandonScrumModal,
  buildCarryoverTodosModal,
  buildCompletionContinueRow,
  buildCompletionTodoPreview,
  buildCompletionTodoModal,
  buildContinueRow,
  buildEntryDetailRows,
  buildEntryEditActionRow,
  buildEntryExtraDeleteSelectRow,
  buildEntryExtraModal,
  buildEntryItemSelectRow,
  buildEntryItemEditModal,
  buildEntryNextTodosModal,
  buildEntryNextTodosRequiredRow,
  buildExtraDecisionRow,
  buildExtraDetailModal,
  buildInitialTodosEditModal,
  buildNewScrumContinueRow,
  buildNewScrumDetailsModal,
  buildNewScrumLaunchRow,
  buildNewScrumPlanningContinueRow,
  buildNewScrumPlanningModal,
  buildNewScrumTodosModal,
  buildNextTodosModal,
  buildRejectRequestModal,
  buildScrumCompletionRow,
  buildScrumEntryRows,
  buildScrumSelectRow,
  buildScrumStartRow,
  buildScrumWriteRow,
  buildTodoModal,
  buildTodoPreview,
  buildTodoStepPreview,
} from '../src/scrums/components';
import {
  buildApprovalRejectionEmbed,
  buildApprovalSuccessEmbed,
  buildScrumCompletionSummaryEmbed,
  buildScrumRequestEmbed,
  buildScrumEntrySummaryEmbed,
  buildScrumIntroEmbed,
  buildScrumItemDetailContent,
  buildScrumTodoEmbed,
  formatTaskRecordSaved,
} from '../src/scrums/formatters';
import {
  formatScrumDate,
  getCurrentWeeklyCycleEndKstDateString,
  getKstDateString,
  getScrumCycleDateString,
  getScrumDeadlineDateString,
} from '../src/scrums/dateUtils';
import { resolveWeeklyTestDate } from '../src/config/weeklyTestDate';
import { ScrumCategory } from '../src/scrums/categories';
import {
  SCRUM_CATEGORY_TAG_NAMES,
  SCRUM_GUIDE_TAG_NAME,
} from '../src/scrums/forumTags';
import { SCRUM_GUIDE_CONTENT } from '../src/scrums/forumGuide';
import {
  validatePlanningDocument,
  validateProjectDocuments,
  validateProjectScoreDocument,
} from '../src/scrums/planningDocument';
import {
  formatApprovalThreadName,
  formatScrumThreadName,
  replaceApprovalThreadStatus,
  replaceScrumThreadStatus,
  hasEvidenceOrComment,
  parseHttpLinks,
} from '../src/scrums/text';
import type {
  Scrum,
  ScrumEntry,
  ScrumRequest,
} from '../src/scrums/types';
import {
  buildWeeklyAdminDeleteExtraModal,
  buildWeeklyAdminDeleteExtraRow,
  buildWeeklyDecisionRow,
  buildWeeklyDeleteModal,
  buildWeeklyExtraEditModal,
  buildWeeklyExtraEditSelectRow,
  buildWeeklyExtraModal,
  buildWeeklyReportExtraModal,
  buildWeeklyReportRow,
  buildWeeklyStartRow,
  WeeklyInputId,
} from '../src/weekly/components';
import {
  buildWeeklyReportEmbed,
  buildWeeklyStarterContent,
} from '../src/weekly/formatters';
import { hasWeeklyCompletedWork } from '../src/weekly/syncService';
import {
  getCurrentWeeklyPeriodKst,
  isWeeklyReportOpen,
} from '../src/weekly/dateUtils';
import type { WeeklyReport } from '../src/weekly/types';
import { getLatestClosedSundayKst } from '../src/weekly/missScheduler';
import { getDueWeeklyReminderWeekEnd } from '../src/weekly/reminderScheduler';

const LABEL_CHILD_TYPES = new Set<number>([
  ComponentType.TextInput,
  ComponentType.StringSelect,
  ComponentType.UserSelect,
  ComponentType.RoleSelect,
  ComponentType.MentionableSelect,
  ComponentType.ChannelSelect,
  ComponentType.FileUpload,
  ComponentType.RadioGroup,
  ComponentType.CheckboxGroup,
  ComponentType.Checkbox,
]);

const SELECT_COMPONENT_TYPES = new Set<number>([
  ComponentType.StringSelect,
  ComponentType.UserSelect,
  ComponentType.RoleSelect,
  ComponentType.MentionableSelect,
  ComponentType.ChannelSelect,
]);

function validateStringLength(
  value: unknown,
  name: string,
  minLength: number,
  maxLength: number,
): asserts value is string {
  assert(typeof value === 'string', `${name}: expected a string`);
  assert(
    value.length >= minLength && value.length <= maxLength,
    `${name}: expected ${minLength}-${maxLength} characters, got ${value.length}`,
  );
}

function validateCustomId(
  component: Record<string, unknown>,
  seen: Set<string>,
  name: string,
  required = true,
): void {
  if (component.custom_id === undefined && !required) {
    return;
  }

  validateStringLength(component.custom_id, `${name}.custom_id`, 1, 100);
  assert(!seen.has(component.custom_id), `${name}: duplicate custom_id ${component.custom_id}`);
  seen.add(component.custom_id);
}

function validateLabel(component: Record<string, unknown>, seen: Set<string>): void {
  assert.equal(component.type, ComponentType.Label);
  validateStringLength(component.label, 'label.label', 1, 45);

  if (component.description !== undefined) {
    validateStringLength(component.description, 'label.description', 1, 100);
  }

  const child = component.component as Record<string, unknown>;
  assert(child && LABEL_CHILD_TYPES.has(child.type as number));
  validateCustomId(child, seen, 'label.component');

  if (child.type === ComponentType.TextInput) {
    assert(
      child.style === TextInputStyle.Short || child.style === TextInputStyle.Paragraph,
      'text input: unsupported style',
    );

    const minLength = child.min_length ?? 0;
    const maxLength = child.max_length ?? 4_000;
    assert(Number.isInteger(minLength) && (minLength as number) >= 0 && (minLength as number) <= 4_000);
    assert(Number.isInteger(maxLength) && (maxLength as number) >= 1 && (maxLength as number) <= 4_000);
    assert((minLength as number) <= (maxLength as number), 'text input: min_length exceeds max_length');

    if (child.placeholder !== undefined) {
      validateStringLength(child.placeholder, 'text input.placeholder', 0, 100);
    }

    if (child.value !== undefined) {
      validateStringLength(child.value, 'text input.value', 0, 4_000);
    }

    if (child.required !== undefined) {
      assert.equal(typeof child.required, 'boolean');
    }
  }

  if (SELECT_COMPONENT_TYPES.has(child.type as number)) {
    const minValues = child.min_values ?? 1;
    const maxValues = child.max_values ?? 1;
    assert(Number.isInteger(minValues) && (minValues as number) >= 0 && (minValues as number) <= 25);
    assert(Number.isInteger(maxValues) && (maxValues as number) >= 1 && (maxValues as number) <= 25);
    assert((minValues as number) <= (maxValues as number), 'select: min_values exceeds max_values');
    assert(child.disabled === undefined, 'select: disabled is not valid inside a modal');

    if (child.required !== undefined) {
      assert.equal(typeof child.required, 'boolean');
    }

    if (child.required !== false) {
      assert((minValues as number) >= 1, 'select: required inputs need min_values >= 1');
    }

    if (child.placeholder !== undefined) {
      validateStringLength(child.placeholder, 'select.placeholder', 0, 150);
    }
  }

  if (child.type === ComponentType.FileUpload) {
    const minValues = child.min_values ?? 1;
    const maxValues = child.max_values ?? 1;
    assert(Number.isInteger(minValues) && (minValues as number) >= 0 && (minValues as number) <= 10);
    assert(Number.isInteger(maxValues) && (maxValues as number) >= 1 && (maxValues as number) <= 10);
    assert((minValues as number) <= (maxValues as number), 'file upload: min_values exceeds max_values');
    assert.equal(maxValues, 1, 'evidence file uploads must accept at most one file');

    if (child.required !== false) {
      assert((minValues as number) >= 1, 'file upload: required inputs need min_values >= 1');
    }
  }
}

function validateModal(name: string, json: Record<string, unknown>): void {
  validateStringLength(json.custom_id, `${name}.custom_id`, 1, 100);
  validateStringLength(json.title, `${name}.title`, 1, 45);

  const components = json.components as Record<string, unknown>[];
  assert(Array.isArray(components), `${name}: missing components`);
  assert(
    components.length >= 1 && components.length <= 5,
    `${name}: modals require 1-5 top-level components, got ${components.length}`,
  );

  const seen = new Set<string>();

  for (const component of components) {
    assert(
      component.type === ComponentType.Label || component.type === ComponentType.TextDisplay,
      `${name}: unsupported top-level modal component ${String(component.type)}`,
    );

    if (component.type === ComponentType.Label) {
      validateLabel(component, seen);
      continue;
    }

    validateStringLength(component.content, `${name}.text_display.content`, 1, 4_000);
  }
}

function validateActionRow(
  name: string,
  json: Record<string, unknown>,
  seen = new Set<string>(),
): void {
  assert.equal(json.type, ComponentType.ActionRow);
  const components = json.components as Record<string, unknown>[];
  assert(Array.isArray(components), `${name}: missing components`);
  assert(components.length >= 1 && components.length <= 5, `${name}: invalid action row size`);

  if (components[0].type === ComponentType.Button) {
    assert(
      components.every((component) => component.type === ComponentType.Button),
      `${name}: buttons and select menus cannot share an action row`,
    );
  } else {
    assert.equal(components.length, 1, `${name}: a select menu must be the only row component`);
  }

  for (const component of components) {
    if (component.type === ComponentType.Button) {
      assert(
        Number.isInteger(component.style)
          && (component.style as number) >= ButtonStyle.Primary
          && (component.style as number) <= ButtonStyle.Premium,
        `${name}: invalid button style`,
      );

      if (component.label !== undefined) {
        validateStringLength(component.label, `${name}.button.label`, 1, 80);
      }

      if (component.style === ButtonStyle.Link) {
        validateStringLength(component.url, `${name}.button.url`, 1, 512);
        assert.equal(component.custom_id, undefined, `${name}: link buttons cannot have custom_id`);
        assert.equal(component.sku_id, undefined, `${name}: link buttons cannot have sku_id`);
      } else if (component.style === ButtonStyle.Premium) {
        validateStringLength(component.sku_id, `${name}.button.sku_id`, 1, 100);
        assert.equal(component.custom_id, undefined, `${name}: premium buttons cannot have custom_id`);
        assert.equal(component.label, undefined, `${name}: premium buttons cannot have a label`);
        assert.equal(component.url, undefined, `${name}: premium buttons cannot have a URL`);
        assert.equal(component.emoji, undefined, `${name}: premium buttons cannot have an emoji`);
      } else {
        validateCustomId(component, seen, `${name}.button`);
        assert.equal(component.url, undefined, `${name}: interactive buttons cannot have a URL`);
        assert.equal(component.sku_id, undefined, `${name}: interactive buttons cannot have sku_id`);
      }

      if (component.style !== ButtonStyle.Premium) {
        assert(
          component.label !== undefined || component.emoji !== undefined,
          `${name}: buttons need a label or emoji`,
        );
      }

      if (component.disabled !== undefined) {
        assert.equal(typeof component.disabled, 'boolean');
      }

      continue;
    }

    assert.equal(component.type, ComponentType.StringSelect);
    validateCustomId(component, seen, `${name}.select`);

    if (component.placeholder !== undefined) {
      validateStringLength(component.placeholder, `${name}.select.placeholder`, 0, 150);
    }

    const minValues = component.min_values ?? 1;
    const maxValues = component.max_values ?? 1;
    assert(Number.isInteger(minValues) && (minValues as number) >= 0 && (minValues as number) <= 25);
    assert(Number.isInteger(maxValues) && (maxValues as number) >= 1 && (maxValues as number) <= 25);
    assert((minValues as number) <= (maxValues as number), `${name}: min_values exceeds max_values`);

    if (component.disabled !== undefined) {
      assert.equal(typeof component.disabled, 'boolean');
    }

    const options = component.options as Record<string, unknown>[];
    assert(Array.isArray(options), `${name}: string select is missing options`);
    assert(options.length >= 1 && options.length <= 25);

    for (const option of options) {
      validateStringLength(option.label, `${name}.select.option.label`, 1, 100);
      validateStringLength(option.value, `${name}.select.option.value`, 1, 100);

      if (option.description !== undefined) {
        validateStringLength(option.description, `${name}.select.option.description`, 0, 100);
      }
    }
  }
}

function validateMessageActionRows(
  name: string,
  rows: Record<string, unknown>[],
): void {
  assert(rows.length >= 1 && rows.length <= 5, `${name}: messages support at most 5 action rows`);
  const seen = new Set<string>();

  for (const [index, row] of rows.entries()) {
    validateActionRow(`${name} row ${index + 1}`, row, seen);
  }
}

const sessionId = '00000000-0000-4000-8000-000000000000';
const planningDocument = {
  id: '5',
  name: 'planning-document.pdf',
  url: 'https://cdn.discordapp.com/attachments/1/2/planning-document.pdf',
  contentType: 'application/pdf',
  size: 1_024,
};
const projectScoreDocument = {
  id: '8',
  name: 'project-score-result.md',
  url: 'https://cdn.discordapp.com/attachments/1/2/project-score-result.md',
  contentType: 'text/markdown',
  size: 1_024,
};
const scrum: Scrum = {
  id: sessionId,
  guildId: '1',
  scrumChannelId: '2',
  threadId: '3',
  creatorId: '4',
  ownerIds: ['4'],
  projectName: 'component validation',
  overview: 'overview',
  category: ScrumCategory.Project,
  planningDocument,
  projectScoreDocument,
  status: 'active',
  currentTodos: ['first task'],
  nextScrumDate: '2026-07-19',
  completedBy: null,
  completionSummary: null,
  completionResults: null,
  completedAt: null,
  abandonedBy: null,
  abandonmentReason: null,
  abandonedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const scrumRequest: ScrumRequest = {
  id: sessionId,
  guildId: '1',
  approvalChannelId: '6',
  approvalThreadId: '7',
  creatorId: '4',
  projectName: scrum.projectName,
  overview: scrum.overview,
  category: scrum.category,
  planningDocument: scrum.planningDocument,
  projectScoreDocument: scrum.projectScoreDocument,
  currentTodos: scrum.currentTodos,
  status: 'pending',
  scrumId: null,
  reviewedBy: null,
  rejectionReason: null,
  reviewedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const entry: ScrumEntry = {
  id: sessionId,
  scrumId: scrum.id,
  authorId: '4',
  scrumDate: '2026-07-19',
  nextScrumDate: '2026-07-26',
  completedItems: Array.from({ length: 20 }, (_, index) => ({
    title: `planned task ${index + 1} ${'x'.repeat(1_500)}`,
    comment: 'summary-hidden-comment',
    attachments: index === 0
      ? [{
        id: '5',
        name: 'summary-hidden-file.txt',
        url: 'https://cdn.discordapp.com/attachments/1/2/summary-hidden-file.txt',
        contentType: 'text/plain',
        size: 1,
      }]
      : [],
    links: index === 1 ? ['https://example.com/evidence'] : [],
  })),
  extraItems: Array.from({ length: 5 }, (_, index) => ({
    title: `extra task ${index + 1} ${'y'.repeat(1_000)}`,
    comment: 'summary-hidden-extra-comment',
    attachments: [],
    links: [],
  })),
  nextTodos: Array.from(
    { length: 20 },
    (_, index) => `next task ${index + 1} ${'z'.repeat(1_500)}`,
  ),
  discordMessageIds: [],
  createdAt: new Date(0).toISOString(),
};

const modals = [
  ['new scrum details', buildNewScrumDetailsModal()],
  ['new scrum project planning', buildNewScrumPlanningModal(
    sessionId,
    ScrumCategory.Project,
  )],
  ['new scrum personal study planning', buildNewScrumPlanningModal(
    sessionId,
    ScrumCategory.PersonalStudy,
  )],
  ['new scrum todos', buildNewScrumTodosModal(sessionId, '2026-07-19')],
  ['initial todos edit', buildInitialTodosEditModal(scrum)],
  ['todo', buildTodoModal(sessionId, 0, 1, 'first task')],
  ['extra detail', buildExtraDetailModal(sessionId, 0)],
  ['next todos', buildNextTodosModal(sessionId, '2026-07-19')],
  ['reject request', buildRejectRequestModal('123456789012345678')],
  ['complete todo', buildCompletionTodoModal(sessionId, 0, 1, 'first task')],
  ['carryover todos', buildCarryoverTodosModal(
    sessionId,
    ['incomplete task 1', 'incomplete task 2'],
    '2026-07-26',
  )],
  ['abandon scrum', buildAbandonScrumModal('123456789012345678')],
  ['admin edit scrum', buildAdminEditScrumModal(scrum)],
  ['admin mark incomplete', buildAdminMarkIncompleteModal({
    entryId: entry.id,
    index: 0,
    title: entry.completedItems[0]!.title,
  })],
  ['admin delete scrum extra', buildAdminDeleteExtraModal({
    entryId: entry.id,
    index: 0,
    title: entry.extraItems[0]!.title,
  })],
  ['entry item edit', buildEntryItemEditModal({
    sessionId,
    item: entry.completedItems[0]!,
    mode: 'edit',
  })],
  ['entry item edit without file', buildEntryItemEditModal({
    sessionId,
    item: {
      title: 'task without file',
      comment: 'note only',
      attachments: [],
      links: [],
    },
    mode: 'edit',
  })],
  ['entry item incomplete', buildEntryItemEditModal({
    sessionId,
    item: entry.completedItems[0]!,
    mode: 'mark-incomplete',
  })],
  ['entry item completed', buildEntryItemEditModal({
    sessionId,
    item: entry.completedItems[2]!,
    mode: 'mark-completed',
  })],
  ['entry next todos', buildEntryNextTodosModal(sessionId, entry)],
  ['entry extra', buildEntryExtraModal(sessionId)],
  ['weekly extra', buildWeeklyExtraModal(sessionId, 0)],
  ['weekly report extra', buildWeeklyReportExtraModal(sessionId, 0)],
  ['weekly extra edit', buildWeeklyExtraEditModal({
    reportId: sessionId,
    index: 0,
    item: {
      title: 'weekly extra task',
      comment: 'weekly extra note',
      attachments: [planningDocument],
      links: ['https://example.com/weekly-evidence'],
    },
  })],
  ['weekly extra edit without file', buildWeeklyExtraEditModal({
    reportId: sessionId,
    index: 0,
    item: {
      title: 'weekly extra task without file',
      comment: 'weekly extra note',
      attachments: [],
      links: [],
    },
  })],
  ['weekly delete', buildWeeklyDeleteModal(sessionId)],
  ['weekly admin delete extra', buildWeeklyAdminDeleteExtraModal({
    reportId: sessionId,
    index: 0,
    title: 'weekly extra task',
  })],
] as const;

for (const [name, modal] of modals) {
  validateModal(name, modal.toJSON() as unknown as Record<string, unknown>);
}

const newDetailsJson = buildNewScrumDetailsModal().toJSON();
const newDetailsLabels = newDetailsJson.components
  .filter((component) => component.type === ComponentType.Label);
assert.deepEqual(
  newDetailsLabels.map((component) => component.label),
  ['스크럼 구분', '스크럼 제목', '개요'],
);
assert(!newDetailsLabels.some((component) => component.label === '산출물 형식'));
assert(!newDetailsLabels.some((component) => component.label === '추가 참여자'));
assert(!newDetailsLabels.some((component) => component.label === '예상 소요 기간'));
assert(!newDetailsLabels.some((component) => component.label.includes('기획서')));
assert(!JSON.stringify(newDetailsJson).includes('planning_document'));
const categoryLabel = newDetailsLabels.find(
  (component) => component.label === '스크럼 구분',
);
assert(categoryLabel);
assert.equal(categoryLabel.component.type, ComponentType.StringSelect);

if (categoryLabel.component.type !== ComponentType.StringSelect) {
  throw new Error('Scrum category must be a string select.');
}

assert.equal(categoryLabel.component.placeholder, '활동 유형을 선택하세요.');
assert.deepEqual(
  categoryLabel.component.options.map((option) => option.value),
  ['project', 'study', 'personal_study', 'personal'],
);
const titleLabel = newDetailsLabels.find(
  (component) => component.label === '스크럼 제목',
);
const overviewLabel = newDetailsLabels.find(
  (component) => component.label === '개요',
);
assert(titleLabel);
assert(overviewLabel);
assert.equal(titleLabel.component.type, ComponentType.TextInput);
assert.equal(overviewLabel.component.type, ComponentType.TextInput);

if (
  titleLabel.component.type !== ComponentType.TextInput
  || overviewLabel.component.type !== ComponentType.TextInput
) {
  throw new Error('Scrum title and overview must be text inputs.');
}

assert.equal(titleLabel.component.placeholder, '예: 웹 취약점 정복하기');
assert.equal(
  overviewLabel.component.placeholder,
  '스크럼의 목적, 목표 및 예상 산출물의 형식을 간단히 적어 주세요.',
);

const planningModalJson = buildNewScrumPlanningModal(
  sessionId,
  ScrumCategory.Project,
).toJSON();
const planningModalLabels = planningModalJson.components.filter(
  (component) => component.type === ComponentType.Label,
);
const planningDocumentLabel = planningModalLabels.find(
  (component) => component.label === '기획서 PDF',
);
assert(planningDocumentLabel);
assert.equal(planningDocumentLabel.component.type, ComponentType.FileUpload);

if (planningDocumentLabel.component.type !== ComponentType.FileUpload) {
  throw new Error('Planning document must be a file upload.');
}

assert.equal(planningDocumentLabel.component.required, true);
assert.equal(planningDocumentLabel.component.min_values, 1);
assert.equal(planningDocumentLabel.component.max_values, 1);
const projectScoreDocumentLabel = planningModalLabels.find(
  (component) => component.label === 'PROJECT:SCORE 결과 (*.md)',
);
assert(projectScoreDocumentLabel);
assert.equal(projectScoreDocumentLabel.component.type, ComponentType.FileUpload);

if (projectScoreDocumentLabel.component.type !== ComponentType.FileUpload) {
  throw new Error('PROJECT:SCORE result must be a file upload.');
}

assert.equal(projectScoreDocumentLabel.component.required, true);
assert.equal(projectScoreDocumentLabel.component.min_values, 1);
assert.equal(projectScoreDocumentLabel.component.max_values, 1);

const personalStudyPlanningJson = buildNewScrumPlanningModal(
  sessionId,
  ScrumCategory.PersonalStudy,
).toJSON();
const personalStudyPlanningLabels = personalStudyPlanningJson.components
  .filter((component) => component.type === ComponentType.Label);
assert.equal(personalStudyPlanningJson.title, '개인 스터디 제출 파일');
assert.deepEqual(
  personalStudyPlanningLabels.map((component) => component.label),
  ['기획서 PDF'],
);
assert(!JSON.stringify(personalStudyPlanningJson).includes('PROJECT:SCORE'));

const newTodosJson = buildNewScrumTodosModal(
  sessionId,
  '2026-07-19',
).toJSON();
const newTodoLabels = newTodosJson.components
  .filter((component) => component.type === ComponentType.Label)
  .map((component) => component.label);
assert.deepEqual(newTodoLabels, ['첫 스크럼까지 진행할 작업']);
assert(!JSON.stringify(newTodosJson).includes('산출물'));
assert(JSON.stringify(newTodosJson).includes('2026-07-21 (화요일) 19:00'));

const completionModalJson = buildCompletionTodoModal(
  sessionId,
  0,
  1,
  scrum.currentTodos[0],
).toJSON();
const completionLabels = completionModalJson.components
  .filter((component) => component.type === ComponentType.Label)
  .map((component) => component.label);
assert.deepEqual(
  completionLabels,
  ['증빙 파일', '증빙 링크', '메모'],
);
assert(
  JSON.stringify(completionModalJson)
    .includes('증빙 파일 또는 링크를 반드시 첨부해야 합니다.'),
);

const abandonModalJson = buildAbandonScrumModal(
  '123456789012345678',
).toJSON();
const abandonLabels = abandonModalJson.components
  .filter((component) => component.type === ComponentType.Label);
assert.deepEqual(
  abandonLabels.map((component) => component.label),
  ['포기 후 처리', '포기 사유'],
);
const dispositionLabel = abandonLabels[0];
assert(dispositionLabel);
assert.equal(
  dispositionLabel.component.type,
  ComponentType.StringSelect,
);
if (dispositionLabel.component.type !== ComponentType.StringSelect) {
  throw new Error('Abandonment disposition must be a string select.');
}
assert.deepEqual(
  dispositionLabel.component.options.map((option) => option.value),
  ['archive', 'delete'],
);
assert.deepEqual(
  dispositionLabel.component.options.map((option) => option.label),
  ['스크럼 보관', '스크럼 삭제'],
);
assert.deepEqual(
  dispositionLabel.component.options.map((option) => option.description),
  [
    '스크럼 게시물을 보관 처리 해놓습니다.',
    '스크럼 게시물을 삭제합니다.',
  ],
);
assert.equal(dispositionLabel.component.options[0]?.default, true);

for (const modal of [
  buildCompletionTodoModal(sessionId, 0, 1, 'first task'),
  buildTodoModal(sessionId, 0, 1, 'first task'),
  buildExtraDetailModal(sessionId, 0),
]) {
  const labelComponents = modal.toJSON().components
    .filter((component) => component.type === ComponentType.Label);
  const labels = labelComponents.map((component) => component.label);
  const evidenceLinkLabel = labelComponents.find(
    (component) => component.label === '증빙 링크',
  );
  const evidenceFileLabel = labelComponents.find(
    (component) => component.label === '증빙 파일',
  );

  assert(labels.includes('증빙 링크'));
  assert(labels.includes('메모'));
  assert(!labels.includes('코멘트'));
  assert(evidenceFileLabel);
  assert(evidenceLinkLabel);
  assert.equal(evidenceFileLabel.component.type, ComponentType.FileUpload);
  assert.equal(evidenceFileLabel.component.max_values, 1);
  assert.equal(evidenceLinkLabel.component.type, ComponentType.TextInput);

  if (evidenceLinkLabel.component.type !== ComponentType.TextInput) {
    throw new Error('Evidence link input must be a text input.');
  }

  assert.equal(
    evidenceLinkLabel.component.placeholder,
    'HTTP/HTTPS 링크 1개를 입력해 주세요.',
  );
}

const detailRows = buildEntryDetailRows(
  Array.from({ length: 15 }, (_, index) => ({
    label: `task ${index + 1}`,
    url: `https://discord.com/channels/1/2/${index + 1}`,
  })),
);
const standaloneActionRows = [
  ['new scrum launch', buildNewScrumLaunchRow()],
  ['new scrum planning continue', buildNewScrumPlanningContinueRow(sessionId)],
  ['new scrum continue', buildNewScrumContinueRow(sessionId)],
  ['scrum continue', buildContinueRow(sessionId, 'continue')],
  ['extra decision', buildExtraDecisionRow(sessionId)],
  ['scrum select', buildScrumSelectRow([scrum])],
  ['approval decision', buildApprovalDecisionRow()],
  ['scrum completion', buildScrumCompletionRow()],
  ['completed scrum', buildScrumCompletionRow(true)],
  ['write scrum', buildScrumWriteRow()],
  ['scrum start', buildScrumStartRow()],
  ['completion continue', buildCompletionContinueRow(sessionId)],
  ['completion first', buildCompletionContinueRow(sessionId, '작업 기록')],
  ['entry write and delete', buildScrumWriteRow(sessionId)],
  ['entry edit action', buildEntryEditActionRow(sessionId, entry)],
  ['entry extra delete', buildEntryExtraDeleteSelectRow(sessionId, entry)],
  ['entry next todos required', buildEntryNextTodosRequiredRow(sessionId)],
  ['admin mark incomplete task', buildAdminMarkIncompleteTaskRow(entry)],
  ['abandoned scrum', buildScrumCompletionRow(false, true)],
  ['weekly start', buildWeeklyStartRow('123456789012345678')],
  ['weekly decision', buildWeeklyDecisionRow(sessionId, 1, true)],
  ['weekly report', buildWeeklyReportRow({ id: sessionId, extraItems: [] })],
] as const;

for (const [name, row] of standaloneActionRows) {
  validateMessageActionRows(
    name,
    [row.toJSON() as unknown as Record<string, unknown>],
  );
}

validateMessageActionRows(
  'entry details',
  detailRows.map((row) => row.toJSON() as unknown as Record<string, unknown>),
);

for (const [index, row] of [
  buildEntryItemSelectRow(sessionId, entry, 'edit'),
  buildEntryItemSelectRow(sessionId, entry, 'mark-completed'),
  buildEntryItemSelectRow(sessionId, entry, 'mark-incomplete'),
].entries()) {
  validateMessageActionRows(
    `entry edit target row ${index + 1}`,
    [row.toJSON() as unknown as Record<string, unknown>],
  );
}

const editTargetJson = buildEntryItemSelectRow(
  sessionId,
  entry,
  'edit',
).toJSON();
assert(!JSON.stringify(editTargetJson).includes('예정된 작업'));
assert(editTargetJson.components[0]?.options.every(
  (option) => option.description === undefined,
));
assert.deepEqual(
  editTargetJson.components[0]?.options.map((option) => option.value),
  [
    'completed:0',
    'completed:1',
    'extra:0',
    'extra:1',
    'extra:2',
    'extra:3',
    'extra:4',
  ],
);

const adminIncompleteOptions = buildAdminMarkIncompleteTaskRow(entry)
  .toJSON().components[0]?.options;
assert.deepEqual(
  adminIncompleteOptions?.map((option) => option.value),
  [
    'completed:0',
    'completed:1',
    'extra:0',
    'extra:1',
    'extra:2',
    'extra:3',
    'extra:4',
  ],
);
const adminIncompleteLabels = buildAdminMarkIncompleteModal({
  entryId: entry.id,
  index: 0,
  title: entry.completedItems[0]!.title,
}).toJSON().components
  .filter((component) => component.type === ComponentType.Label);
assert.deepEqual(
  adminIncompleteLabels.map((component) => component.label),
  ['미완료 처리 사유'],
);
assert.equal(
  adminIncompleteLabels[0]?.component.type,
  ComponentType.TextInput,
);
if (adminIncompleteLabels[0]?.component.type === ComponentType.TextInput) {
  assert.equal(adminIncompleteLabels[0].component.required, true);
}

const adminDeleteExtraLabels = buildAdminDeleteExtraModal({
  entryId: entry.id,
  index: 0,
  title: entry.extraItems[0]!.title,
}).toJSON().components
  .filter((component) => component.type === ComponentType.Label);
assert.deepEqual(
  adminDeleteExtraLabels.map((component) => component.label),
  ['삭제 사유'],
);
assert.equal(
  adminDeleteExtraLabels[0]?.component.type,
  ComponentType.TextInput,
);
if (adminDeleteExtraLabels[0]?.component.type === ComponentType.TextInput) {
  assert.equal(adminDeleteExtraLabels[0].component.required, true);
}

const incompleteModalLabels = buildEntryItemEditModal({
  sessionId,
  item: entry.completedItems[0]!,
  mode: 'mark-incomplete',
}).toJSON().components
  .filter((component) => component.type === ComponentType.Label)
  .map((component) => component.label);
assert.deepEqual(incompleteModalLabels, ['메모']);

const completedModalLabels = buildEntryItemEditModal({
  sessionId,
  item: entry.completedItems[2]!,
  mode: 'mark-completed',
}).toJSON().components
  .filter((component) => component.type === ComponentType.Label)
  .map((component) => component.label);
assert.deepEqual(
  completedModalLabels,
  ['새 증빙 파일', '증빙 링크', '메모'],
);
assert(!completedModalLabels.includes('기존 증빙 파일'));

const entryEditWithoutFileLabels = buildEntryItemEditModal({
  sessionId,
  item: {
    title: 'task without file',
    comment: 'note only',
    attachments: [],
    links: [],
  },
  mode: 'edit',
}).toJSON().components
  .filter((component) => component.type === ComponentType.Label)
  .map((component) => component.label);
assert.deepEqual(
  entryEditWithoutFileLabels,
  ['새 증빙 파일', '증빙 링크', '메모'],
);

const weeklyEditWithoutFileLabels = buildWeeklyExtraEditModal({
  reportId: sessionId,
  index: 0,
  item: {
    title: 'weekly extra task without file',
    comment: 'weekly extra note',
    attachments: [],
    links: [],
  },
}).toJSON().components
  .filter((component) => component.type === ComponentType.Label)
  .map((component) => component.label);
assert.deepEqual(
  weeklyEditWithoutFileLabels,
  ['완료한 작업', '새 증빙 파일', '증빙 링크', '메모'],
);

const weeklyEditValueLabels = buildWeeklyExtraEditModal({
  reportId: sessionId,
  index: 0,
  item: {
    title: 'weekly extra task',
    comment: 'weekly extra note',
    attachments: [],
    links: ['https://example.com/weekly-evidence'],
  },
}).toJSON().components
  .filter((component) => component.type === ComponentType.Label);
const weeklyEditLinkLabel = weeklyEditValueLabels.find(
  (component) => component.label === '증빙 링크',
);
const weeklyEditCommentLabel = weeklyEditValueLabels.find(
  (component) => component.label === '메모',
);
assert.equal(
  weeklyEditLinkLabel?.component.type,
  ComponentType.TextInput,
);
assert.equal(
  weeklyEditCommentLabel?.component.type,
  ComponentType.TextInput,
);
if (
  weeklyEditLinkLabel?.component.type === ComponentType.TextInput
  && weeklyEditCommentLabel?.component.type === ComponentType.TextInput
) {
  assert.equal(
    weeklyEditLinkLabel.component.custom_id,
    WeeklyInputId.ExtraLinks,
  );
  assert.equal(
    weeklyEditLinkLabel.component.value,
    'https://example.com/weekly-evidence',
  );
  assert.equal(
    weeklyEditCommentLabel.component.custom_id,
    WeeklyInputId.ExtraComment,
  );
  assert.equal(
    weeklyEditCommentLabel.component.value,
    'weekly extra note',
  );
}

const pagedEntryLinks = Array.from({ length: 25 }, (_, index) => ({
  label: `task ${index + 1}`,
  url: `https://discord.com/channels/1/2/${index + 1}`,
}));
const firstEntryPage = buildScrumEntryRows(
  pagedEntryLinks,
  sessionId,
  0,
);
const secondEntryPage = buildScrumEntryRows(
  pagedEntryLinks,
  sessionId,
  1,
);
assert.equal(firstEntryPage.length, 5);
assert.equal(secondEntryPage.length, 2);
validateMessageActionRows(
  'first paged entry details',
  firstEntryPage.map((row) =>
    row.toJSON() as unknown as Record<string, unknown>),
);
validateMessageActionRows(
  'second paged entry details',
  secondEntryPage.map((row) =>
    row.toJSON() as unknown as Record<string, unknown>),
);

const maxDetailRows = buildEntryDetailRows(
  Array.from({ length: 25 }, (_, index) => ({
    label: `task ${index + 1}`,
    url: `https://discord.com/channels/1/2/${index + 1}`,
  })),
);
assert.equal(maxDetailRows.length, 5);
validateMessageActionRows(
  'maximum entry details',
  maxDetailRows.map((row) => row.toJSON() as unknown as Record<string, unknown>),
);
assert.throws(
  () => buildEntryDetailRows(
    Array.from({ length: 26 }, (_, index) => ({
      label: `task ${index + 1}`,
      url: `https://discord.com/channels/1/2/${index + 1}`,
    })),
  ),
  RangeError,
);

const extraDecisionJson = buildExtraDecisionRow(sessionId).toJSON();
const skipExtraButton = extraDecisionJson.components.find(
  (component) =>
    'label' in component
    && component.label === '없음 (진행할 작업 작성)',
);
assert(skipExtraButton);
assert.equal(skipExtraButton.style, ButtonStyle.Danger);
const carryoverDecisionJson = buildExtraDecisionRow(
  sessionId,
  true,
  true,
).toJSON();
const carryoverButton = carryoverDecisionJson.components.find(
  (component) =>
    'label' in component
    && component.label === '없음 (이월할 작업 선택)',
);
assert(carryoverButton);
assert.equal(carryoverButton.style, ButtonStyle.Danger);
const writeExtraButton = extraDecisionJson.components.find(
  (component) => 'label' in component && component.label === '추가 완료 작업 작성',
);
assert(writeExtraButton);
assert.equal(writeExtraButton.style, ButtonStyle.Primary);

const approvalDecisionJson = buildApprovalDecisionRow().toJSON();
const approveButton = approvalDecisionJson.components.find(
  (component) => 'label' in component && component.label === '승인',
);
const rejectButton = approvalDecisionJson.components.find(
  (component) => 'label' in component && component.label === '반려',
);
assert(approveButton);
assert(rejectButton);
assert.equal(approveButton.style, ButtonStyle.Success);
assert.equal(rejectButton.style, ButtonStyle.Danger);

const completionButton = buildScrumCompletionRow().toJSON().components[0];
assert.equal(completionButton.style, ButtonStyle.Success);
assert.equal(completionButton.disabled, false);
assert.equal(completionButton.label, '스크럼 완료');
const completedButton = buildScrumCompletionRow(true).toJSON().components[0];
assert.equal(completedButton.style, ButtonStyle.Secondary);
assert.equal(completedButton.disabled, true);
assert.equal(completedButton.label, '완료됨');
const newScrumButton = buildNewScrumLaunchRow().toJSON().components[0];
assert.equal(newScrumButton.style, ButtonStyle.Primary);
assert.equal(newScrumButton.label, '스크럼 만들기');
const writeScrumButton = buildScrumWriteRow().toJSON().components[0];
assert.equal(writeScrumButton.style, ButtonStyle.Primary);
assert.equal(writeScrumButton.label, '다음 스크럼 작성하기');
const initialTodosEditButton = buildScrumStartRow().toJSON().components[1];
assert('label' in initialTodosEditButton);
assert.equal(initialTodosEditButton.label, '첫 진행할 작업 수정');
const editScrumButton = buildScrumWriteRow(sessionId).toJSON().components[1];
assert('label' in editScrumButton);
assert.equal(editScrumButton.label, '스크럼 수정');
const deleteScrumButton = buildScrumWriteRow(sessionId).toJSON().components[2];
assert('label' in deleteScrumButton);
assert.equal(deleteScrumButton.label, '최근 스크럼 삭제');
assert.equal(buildTodoModal(sessionId, 0, 3, 'task').toJSON().title, '작업 기록');
assert.equal(
  buildNextTodosModal(sessionId, '2026-07-19').toJSON().title,
  '다음 스크럼까지 진행할 작업',
);
assert(SCRUM_GUIDE_CONTENT.includes('`/newscrum`'));
assert(SCRUM_GUIDE_CONTENT.includes('어느 날이든'));
assert(SCRUM_GUIDE_CONTENT.includes('화요일 19:00'));
assert(!SCRUM_GUIDE_CONTENT.includes('월요일 00:00'));
assert(SCRUM_GUIDE_CONTENT.includes('매주마다 주간보고에 올라가게 됩니다'));

const summaryJson = buildScrumEntrySummaryEmbed(entry).toJSON();
assert.equal(summaryJson.color, 0xed4245);
assert(summaryJson.title && summaryJson.title.length <= 256);
assert((summaryJson.description?.length ?? 0) <= 4_096);
assert((summaryJson.fields?.length ?? 0) <= 25);

for (const field of summaryJson.fields ?? []) {
  assert(field.name.length <= 256);
  assert(field.value.length <= 1_024);
}

const summaryCharacterCount = (summaryJson.title?.length ?? 0)
  + (summaryJson.description?.length ?? 0)
  + (summaryJson.fields ?? []).reduce(
    (total, field) => total + field.name.length + field.value.length,
    0,
  );
assert(summaryCharacterCount <= 6_000);

const serializedSummary = JSON.stringify(summaryJson);
assert(!serializedSummary.includes('summary-hidden-comment'));
assert(!serializedSummary.includes('summary-hidden-extra-comment'));
assert(!serializedSummary.includes('summary-hidden-file.txt'));
const completedSummaryFields = summaryJson.fields?.filter((field) =>
  field.name.startsWith('완료한 작업'),
) ?? [];
const nextTodoSummaryFields = summaryJson.fields?.filter((field) =>
  field.name.includes('진행할 작업'),
) ?? [];
assert(completedSummaryFields.length >= 1);
assert(nextTodoSummaryFields.length >= 1);
assert(completedSummaryFields.some((field) => field.value.includes('~~')));
assert(completedSummaryFields.some((field) => field.value.includes('[미완료]')));
assert(!completedSummaryFields.some((field) => field.value.includes('예정 작업')));
assert(!completedSummaryFields.some((field) => field.value.includes('추가 작업')));
assert(!/^\d+\./m.test(summaryJson.fields?.[0].value ?? ''));
assert.equal(
  formatScrumDate('2026-07-19'),
  '2026-07-21 (화요일) 19:00',
);
assert.equal(getScrumDeadlineDateString('2026-07-19'), '2026-07-21');
assert.equal(getScrumCycleDateString('2026-07-21'), '2026-07-19');
assert.equal(getScrumCycleDateString('2026-07-19'), '2026-07-19');
assert.throws(() => getScrumCycleDateString('2026-07-20'));
assert.equal(
  formatTaskRecordSaved('작업명'),
  '**[ 작업명 ]** 에 대한 기록을 저장했습니다.',
);
assert.equal(summaryJson.title, '스크럼 - 2026-07-21');
assert.equal(
  getCurrentWeeklyCycleEndKstDateString(new Date('2026-08-01T03:00:00.000Z')),
  '2026-08-02',
);
assert.equal(
  getCurrentWeeklyCycleEndKstDateString(new Date('2026-08-02T03:00:00.000Z')),
  '2026-08-02',
);
assert.equal(
  getCurrentWeeklyCycleEndKstDateString(new Date('2026-08-04T09:59:59.999Z')),
  '2026-08-02',
);
assert.equal(
  getCurrentWeeklyCycleEndKstDateString(new Date('2026-08-04T10:00:00.000Z')),
  '2026-08-09',
);
assert(!summaryJson.description?.includes('프로젝트'));
assert(!summaryJson.description?.includes('작성자'));
assert(!summaryJson.description?.includes('<@4>'));

const linkOnlySummary = buildScrumEntrySummaryEmbed({
  ...entry,
  completedItems: [{
    title: 'link-only evidence',
    comment: '',
    attachments: [],
    links: ['https://example.com/evidence'],
  }],
  extraItems: [],
}).toJSON();
assert.equal(linkOnlySummary.color, 0x57f287);
assert(!linkOnlySummary.fields?.[0].value.includes('미완료'));

const detailContent = buildScrumItemDetailContent({
  title: 'completed task',
  comment: 'detail memo',
  links: ['https://example.com/evidence'],
  incomplete: false,
});
assert(detailContent.startsWith('## completed task'));
assert(detailContent.includes('<https://example.com/evidence>'));
assert(detailContent.includes('> detail memo'));
assert(!detailContent.includes('**메모**'));

const detailWithoutComment = buildScrumItemDetailContent({
  title: 'attachment-only task',
  comment: '',
  links: [],
  incomplete: false,
});
assert.equal(detailWithoutComment, '## attachment-only task');
assert(!detailWithoutComment.includes('>'));

const incompleteDetailContent = buildScrumItemDetailContent({
  title: 'incomplete task',
  comment: 'reason',
  links: [],
  incomplete: true,
});
assert(incompleteDetailContent.startsWith('## ~~incomplete task~~ **[미완료]**'));
assert(!incompleteDetailContent.includes('첨부 파일 없음'));
assert(incompleteDetailContent.includes('> reason'));
assert(incompleteDetailContent.length <= 1_900);

const validLink = parseHttpLinks('https://example.com/evidence', 1);
assert.equal(validLink.invalidValues.length, 0);
assert.equal(validLink.exceededLimit, false);
assert.equal(validLink.links.length, 1);

const tooManyLinks = parseHttpLinks(
  'https://example.com/evidence\nhttp://example.org/report',
  1,
);
assert.equal(tooManyLinks.exceededLimit, true);
assert.equal(parseHttpLinks('javascript:alert(1)', 1).invalidValues.length, 1);

assert.equal(hasEvidenceOrComment({
  attachmentCount: 0,
  linkCount: 0,
  comment: '',
}), false);
assert.equal(hasEvidenceOrComment({
  attachmentCount: 1,
  linkCount: 0,
  comment: '',
}), true);
assert.equal(hasEvidenceOrComment({
  attachmentCount: 0,
  linkCount: 1,
  comment: '',
}), true);
assert.equal(hasEvidenceOrComment({
  attachmentCount: 0,
  linkCount: 0,
  comment: '진행하지 못한 이유',
}), true);

const introEmbed = buildScrumIntroEmbed(scrum).toJSON();
const todoEmbed = buildScrumTodoEmbed(scrum).toJSON();
const serializedTodoEmbed = JSON.stringify(todoEmbed);
assert.equal(introEmbed.title, scrum.projectName);
assert.equal(introEmbed.description, scrum.overview);
assert.equal(introEmbed.fields?.length, 4);
assert.equal(introEmbed.fields?.[0].name, '작성자');
assert.equal(introEmbed.fields?.[1].name, '구분');
assert.equal(introEmbed.fields?.[2].name, '기획서');
assert.equal(introEmbed.fields?.[3].name, 'PROJECT:SCORE 결과');
assert(!introEmbed.fields?.some((field) => field.name === '요청자'));
assert(!JSON.stringify(introEmbed).includes('first task'));
assert.equal(todoEmbed.color, 0x57f287);
assert.equal(todoEmbed.title, '스크럼 - 시작');
assert.equal(
  todoEmbed.description,
  `**다음 스크럼 마감**: ${formatScrumDate(scrum.nextScrumDate)}`,
);
assert.equal(todoEmbed.fields?.length, 1);
assert.equal(todoEmbed.fields?.[0].name, '다음 스크럼까지 진행할 작업');
assert(serializedTodoEmbed.includes('first task'));
assert(!serializedTodoEmbed.includes(scrum.overview));
assert(!JSON.stringify(introEmbed).includes('예상 소요 기간'));
assert(!JSON.stringify(introEmbed).includes('첫 스크럼 날짜'));
assert(!JSON.stringify(introEmbed).includes(scrum.nextScrumDate));
assert(!JSON.stringify(introEmbed).includes('산출물'));

const completionSummaryEmbed = buildScrumCompletionSummaryEmbed({
  completedBy: '4',
  completedAt: new Date(0).toISOString(),
  completionResults: [{
    title: 'first task',
    comment: 'done',
    attachments: [],
    links: ['https://example.com/evidence'],
  }],
}).toJSON();
assert.equal(completionSummaryEmbed.title, '스크럼 완료');
assert.equal(completionSummaryEmbed.fields?.[0].name, '마지막으로 완료한 작업');
assert(completionSummaryEmbed.fields?.[0].value.includes('first task'));

const approvalSuccessJson = buildApprovalSuccessEmbed({
  projectName: scrum.projectName,
  category: scrum.category,
  guildName: 'validation guild',
  postUrl: 'https://discord.com/channels/1/2/3',
}).toJSON();
assert.equal(approvalSuccessJson.title, '스크럼 승인 완료');
assert.equal(approvalSuccessJson.color, 0x57f287);
assert(approvalSuccessJson.fields?.some((field) => field.name === '스크럼 제목'));
assert(!JSON.stringify(approvalSuccessJson).includes(scrum.nextScrumDate));

const approvalRejectionJson = buildApprovalRejectionEmbed({
  projectName: scrum.projectName,
  category: scrum.category,
  guildName: 'validation guild',
  reason: '요청 내용을 보완해 주세요.',
}).toJSON();
assert.equal(approvalRejectionJson.title, '스크럼 승인 반려');
assert.equal(approvalRejectionJson.color, 0xed4245);
assert(approvalRejectionJson.fields?.some((field) => field.name === '스크럼 제목'));
assert(
  approvalRejectionJson.fields
    ?.some((field) => field.name === '반려 사유' && field.value.includes('보완')),
);

const pendingRequestEmbed = buildScrumRequestEmbed(scrumRequest).toJSON();
assert.equal(pendingRequestEmbed.title, scrumRequest.projectName);
assert.equal(pendingRequestEmbed.description, undefined);
assert.equal(pendingRequestEmbed.color, 0xfee75c);
assert.equal(
  pendingRequestEmbed.fields?.find((field) => field.name === '스크럼 개요')?.value,
  scrumRequest.overview,
);
assert(
  !pendingRequestEmbed.fields?.some((field) => field.name === '스크럼'),
);
assert.equal(
  pendingRequestEmbed.fields?.find((field) => field.name === '상태')?.value,
  '승인 대기',
);
assert.equal(
  pendingRequestEmbed.fields?.find((field) => field.name === '분류')?.value,
  '프로젝트',
);
assert.equal(
  pendingRequestEmbed.fields?.find((field) => field.name === '기획서')?.value,
  '첨부된 PDF 파일',
);
assert(
  pendingRequestEmbed.fields
    ?.some((field) => field.name === '첫 스크럼까지 진행할 작업'),
);
assert(
  pendingRequestEmbed.fields
    ?.every((field) => field.name.length <= 256 && field.value.length <= 1_024),
);
assert(!JSON.stringify(pendingRequestEmbed).includes('예상 소요 기간'));
assert(!JSON.stringify(pendingRequestEmbed).includes('산출물'));
const rejectedRequestEmbed = buildScrumRequestEmbed(scrumRequest, {
  status: 'rejected',
  reviewerId: '8',
  rejectionReason: '요청 내용을 보완해 주세요.',
}).toJSON();
assert.equal(rejectedRequestEmbed.color, 0xed4245);
assert.equal(
  rejectedRequestEmbed.fields?.find((field) => field.name === '상태')?.value,
  '반려됨',
);
assert(
  rejectedRequestEmbed.fields
    ?.some((field) => field.name === '처리자' && field.value === '<@8>'),
);
assert(
  rejectedRequestEmbed.fields?.some((field) =>
    field.name === '반려 사유'
    && field.value === '요청 내용을 보완해 주세요.'
  ),
);
assert.equal(rejectedRequestEmbed.fields?.at(-1)?.name, '반려 사유');
const approvedRequestEmbed = buildScrumRequestEmbed(scrumRequest, {
  status: 'approved',
  reviewerId: '8',
  scrumThreadId: '9',
}).toJSON();
assert.equal(approvedRequestEmbed.color, 0x57f287);
assert(!approvedRequestEmbed.fields?.some(
  (field) => field.name === '반려 사유',
));
assert.equal(
  approvedRequestEmbed.fields?.find((field) => field.name === '상태')?.value,
  '승인됨',
);
assert(
  approvedRequestEmbed.fields
    ?.some((field) => field.name === '스크럼 게시물' && field.value === '<#9>'),
);

const previewScrum: Scrum = {
  ...scrum,
  currentTodos: Array.from(
    { length: 10 },
    (_, index) => `planned task ${index + 1} ${'x'.repeat(120)}`,
  ),
};
const todoPreview = buildTodoPreview(previewScrum);
const overdueTodoPreview = buildTodoPreview(
  previewScrum,
  '2026-07-26',
);
const completionTodoPreview = buildCompletionTodoPreview(previewScrum);
const nextTodoPreview = buildTodoStepPreview(
  previewScrum.currentTodos,
  1,
);
assert(todoPreview.length <= 2_000);
assert(todoPreview.includes('**마감일**:'));
assert(!todoPreview.includes('예정일'));
assert(overdueTodoPreview.includes('2026-07-28 (화요일) 19:00'));
assert(!overdueTodoPreview.includes(previewScrum.nextScrumDate));
assert(todoPreview.includes('기록할 작업 (1/10)'));
assert(todoPreview.includes('- planned task'));
assert(!todoPreview.includes('1. planned task'));
assert(completionTodoPreview.includes('스크럼을 완료합니다.'));
assert(completionTodoPreview.includes('지금 기록할 작업 (1/10)'));
assert(!completionTodoPreview.includes('예정일'));
assert(nextTodoPreview.length <= 2_000);
assert(nextTodoPreview.includes('지금 기록할 작업 (2/10)'));
assert(nextTodoPreview.includes('- **planned task 2'));
assert(nextTodoPreview.includes('** <-'));
assert(nextTodoPreview.includes('- planned task 3'));

assert.equal(
  validatePlanningDocument(ScrumCategory.Project, []),
  '프로젝트 스크럼은 기획서 PDF를 반드시 업로드해야 합니다.',
);
assert.equal(
  validatePlanningDocument(ScrumCategory.Project, [planningDocument]),
  null,
);
assert.equal(
  validateProjectScoreDocument(
    ScrumCategory.Project,
    [projectScoreDocument],
  ),
  null,
);
assert.equal(
  validateProjectDocuments(
    ScrumCategory.Project,
    [planningDocument],
    [],
  ),
  '프로젝트 스크럼은 PROJECT:SCORE 결과 Markdown 파일을 반드시 업로드해야 합니다.',
);
assert.equal(validatePlanningDocument(ScrumCategory.Study, []), null);
assert.equal(
  validatePlanningDocument(ScrumCategory.PersonalStudy, []),
  '개인 스터디 스크럼은 기획서 PDF를 반드시 업로드해야 합니다.',
);
assert.equal(
  validateProjectDocuments(
    ScrumCategory.PersonalStudy,
    [planningDocument],
    [],
  ),
  null,
);
assert.equal(
  validatePlanningDocument(ScrumCategory.Project, [{
    ...planningDocument,
    name: 'planning-document.txt',
    contentType: 'text/plain',
  }]),
  '기획서는 PDF 형식의 파일만 업로드할 수 있습니다.',
);

assert.equal(
  formatScrumThreadName('요청자 이름', '프로젝트 이름'),
  '[요청자 이름] 프로젝트 이름',
);
assert.equal(
  formatApprovalThreadName('요청자 이름', '프로젝트 이름'),
  '[승인 대기] [요청자 이름] 프로젝트 이름',
);
assert.equal(
  formatApprovalThreadName('요청자 이름', '프로젝트 이름', 'rejected'),
  '[반려] [요청자 이름] 프로젝트 이름',
);
assert.equal(
  replaceApprovalThreadStatus(
    '[승인 대기] [요청자 이름] 프로젝트 이름',
    'approved',
  ),
  '[승인] [요청자 이름] 프로젝트 이름',
);
assert.equal(
  replaceApprovalThreadStatus(
    '[승인 대기] [요청자 이름] 프로젝트 이름',
    'rejected',
  ),
  '[반려] [요청자 이름] 프로젝트 이름',
);
assert.equal(
  replaceScrumThreadStatus(
    '[요청자 이름] 프로젝트 이름',
    'completed',
  ),
  '[완료] [요청자 이름] 프로젝트 이름',
);
assert.equal(
  replaceScrumThreadStatus(
    '[완료] [요청자 이름] 프로젝트 이름',
    'abandoned',
  ),
  '[포기] [요청자 이름] 프로젝트 이름',
);
assert(!formatScrumThreadName('requester', 'project').startsWith('scrum-'));
assert.deepEqual(Object.values(SCRUM_CATEGORY_TAG_NAMES), [
  '프로젝트',
  '스터디',
  '개인 스터디',
  '개인 활동',
]);
assert.equal(SCRUM_GUIDE_TAG_NAME, '안내');

const weeklyReport: WeeklyReport = {
  id: sessionId,
  guildId: '1',
  userId: '4',
  threadId: '3',
  weekStart: '2026-07-13',
  weekEnd: '2026-07-19',
  completedItems: entry.completedItems,
  extraItems: [{
    title: 'extra task',
    comment: 'extra note',
    attachments: [],
    links: [],
  }],
  nextTodos: entry.nextTodos,
  pendingTodos: ['pending task'],
  discordMessageIds: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const weeklyStarterContent = buildWeeklyStarterContent('4');
const weeklyReportJson = buildWeeklyReportEmbed(weeklyReport).toJSON();
const categorizedReport: WeeklyReport = {
  ...weeklyReport,
  completedItems: Object.values(ScrumCategory).map((scrumCategory) => ({
    title: 'Source task', scrumCategory, comment: '', attachments: [], links: [],
  })),
};
const categorizedReportJson = buildWeeklyReportEmbed(categorizedReport).toJSON();
for (const category of ['프로젝트', '스터디', '개인 스터디', '개인 활동']) {
  assert(categorizedReportJson.fields?.[0]?.value.includes(`[${category}] Source task`));
}
assert(categorizedReportJson.fields?.[0]?.value.includes('[추가] extra task'));
assert.equal(categorizedReport.completedItems[0]?.title, 'Source task');
const weeklyReportRowJson = buildWeeklyReportRow(weeklyReport).toJSON();
const weeklyAdminDeleteRowJson = buildWeeklyAdminDeleteExtraRow(
  weeklyReport,
).toJSON();
const weeklyExtraEditRowJson = buildWeeklyExtraEditSelectRow(
  weeklyReport,
).toJSON();
validateMessageActionRows(
  'weekly admin delete extra',
  [weeklyAdminDeleteRowJson as unknown as Record<string, unknown>],
);
assert.deepEqual(
  weeklyAdminDeleteRowJson.components[0]?.options.map(
    (option) => option.value,
  ),
  ['0'],
);
validateMessageActionRows(
  'weekly extra edit',
  [weeklyExtraEditRowJson as unknown as Record<string, unknown>],
);
assert(weeklyStarterContent.startsWith('## 주간보고'));
assert(weeklyStarterContent.includes('<@4>님의 주간보고 게시물입니다'));
assert(weeklyStarterContent.includes('자동적으로 동기화됩니다'));
assert(weeklyStarterContent.includes('`/weekly` 명령어'));
assert(weeklyStarterContent.includes('보안과 관련 없는 내용'));
assert(weeklyStarterContent.includes('마감은 매주 화요일 19시'));
assert.equal(weeklyReportJson.title, '주간보고 - 2026-07-19');
assert.equal(weeklyReportJson.fields?.length, 1);
assert(!weeklyReportJson.fields?.some(
  (field) => field.name === '다음 진행할 작업',
));
assert(
  weeklyReportJson.fields
    ?.find((field) => field.name === '완료한 작업')
    ?.value.includes('[추가]'),
);
assert(hasWeeklyCompletedWork(weeklyReport));
assert(!hasWeeklyCompletedWork({
  completedItems: [],
  extraItems: [],
}));
assert.deepEqual(
  weeklyReportRowJson.components.map((component) =>
    'label' in component ? component.label : null,
  ),
  ['추가로 한 작업 작성', '추가 작업 수정', '주간보고 삭제'],
);
assert.equal(
  getLatestClosedSundayKst(new Date('2026-07-31T03:00:00.000Z')),
  '2026-07-26',
);
assert.equal(
  getLatestClosedSundayKst(new Date('2026-08-02T03:00:00.000Z')),
  '2026-07-26',
);
assert.equal(
  getLatestClosedSundayKst(new Date('2026-08-04T09:59:59.000Z')),
  '2026-07-26',
);
assert.equal(
  getLatestClosedSundayKst(new Date('2026-08-04T10:00:00.000Z')),
  '2026-08-02',
);
assert.equal(
  getDueWeeklyReminderWeekEnd(new Date('2026-08-04T02:59:59.000Z')),
  null,
);
assert.equal(
  getDueWeeklyReminderWeekEnd(new Date('2026-08-04T03:00:00.000Z')),
  '2026-08-02',
);
assert.equal(
  getDueWeeklyReminderWeekEnd(new Date('2026-08-04T10:00:00.000Z')),
  null,
);
assert.equal(
  resolveWeeklyTestDate('test', '2026-08-02'),
  '2026-08-02',
);
assert.throws(
  () => resolveWeeklyTestDate('production', '2026-08-02'),
  /NODE_ENV=test/,
);
assert.equal(
  resolveWeeklyTestDate('test', '2026-08-03'),
  '2026-08-03',
);
assert.deepEqual(
  getCurrentWeeklyPeriodKst(new Date('2026-07-31T03:00:00.000Z')),
  {
    weekStart: '2026-07-27',
    weekEnd: '2026-08-02',
  },
);
assert.deepEqual(
  getCurrentWeeklyPeriodKst(new Date('2026-08-02T00:00:00.000Z')),
  {
    weekStart: '2026-07-27',
    weekEnd: '2026-08-02',
  },
);
assert.deepEqual(
  getCurrentWeeklyPeriodKst(new Date('2026-08-04T09:59:59.000Z')),
  {
    weekStart: '2026-07-27',
    weekEnd: '2026-08-02',
  },
);
assert.deepEqual(
  getCurrentWeeklyPeriodKst(new Date('2026-08-04T10:00:00.000Z')),
  {
    weekStart: '2026-08-03',
    weekEnd: '2026-08-09',
  },
);

const originalNodeEnv = process.env.NODE_ENV;
const originalWeeklyTestDate = process.env.WEEKLY_TEST_DATE;

try {
  process.env.NODE_ENV = 'test';
  process.env.WEEKLY_TEST_DATE = '2026-08-02';
  assert.equal(getKstDateString(), '2026-08-02');
  assert.equal(getCurrentWeeklyCycleEndKstDateString(), '2026-08-02');
  assert.deepEqual(getCurrentWeeklyPeriodKst(), {
    weekStart: '2026-07-27',
    weekEnd: '2026-08-02',
  });
  assert(isWeeklyReportOpen('2026-08-02'));

  process.env.WEEKLY_TEST_DATE = '2026-08-03';
  assert.equal(getKstDateString(), '2026-08-03');
  assert.equal(getCurrentWeeklyCycleEndKstDateString(), '2026-08-02');
  assert.deepEqual(getCurrentWeeklyPeriodKst(), {
    weekStart: '2026-07-27',
    weekEnd: '2026-08-02',
  });
  assert(isWeeklyReportOpen('2026-08-02'));
  assert(!isWeeklyReportOpen('2026-08-09'));

  process.env.WEEKLY_TEST_DATE = '2026-08-05';
  assert.equal(getCurrentWeeklyCycleEndKstDateString(), '2026-08-09');
  assert.deepEqual(getCurrentWeeklyPeriodKst(), {
    weekStart: '2026-08-03',
    weekEnd: '2026-08-09',
  });
  assert(!isWeeklyReportOpen('2026-08-02'));
  assert(isWeeklyReportOpen('2026-08-09'));
} finally {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalWeeklyTestDate === undefined) {
    delete process.env.WEEKLY_TEST_DATE;
  } else {
    process.env.WEEKLY_TEST_DATE = originalWeeklyTestDate;
  }
}

for (const field of weeklyReportJson.fields ?? []) {
  assert(field.value.length <= 1_024);
}

console.log(
  `Validated ${modals.length} scrum/weekly modals, ${standaloneActionRows.length + detailRows.length} message action rows, and the summary embeds.`,
);
