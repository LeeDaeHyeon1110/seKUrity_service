import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type {
  Scrum,
  ScrumEntry,
  ScrumTodoResult,
} from './types';
import type { ScrumEntryEditMode } from './sessionStore';
import {
  SCRUM_CATEGORY_LABELS,
  ScrumCategory,
} from './categories';
import { ScrumCustomId, withSession, withSessionAndIndex } from './customIds';
import { formatScrumDate } from './dateUtils';
import { formatList, truncateText } from './text';

export const ScrumInputId = Object.freeze({
  ProjectName: 'project_name',
  Overview: 'overview',
  Category: 'category',
  PlanningDocument: 'planning_document',
  ProjectScoreDocument: 'project_score_document',
  Todos: 'todos',
  TodoFiles: 'todo_files',
  TodoLinks: 'todo_links',
  TodoComment: 'todo_comment',
  ExtraTitle: 'extra_title',
  ExtraFiles: 'extra_files',
  ExtraLinks: 'extra_links',
  ExtraComment: 'extra_comment',
  NextTodos: 'next_todos',
  RejectionReason: 'rejection_reason',
  CarryoverTodos: 'carryover_todos',
  AbandonmentReason: 'abandonment_reason',
  AbandonmentDisposition: 'abandonment_disposition',
  EntryAttachmentDisposition: 'entry_attachment_disposition',
  EntryFiles: 'entry_files',
  EntryLinks: 'entry_links',
  EntryComment: 'entry_comment',
  EntryExtraTitle: 'entry_extra_title',
  EntryNextTodos: 'entry_next_todos',
  InitialTodos: 'initial_todos',
  AdminProjectName: 'admin_project_name',
  AdminOverview: 'admin_overview',
  AdminIncompleteReason: 'admin_incomplete_reason',
  AdminExtraDeletionReason: 'admin_extra_deletion_reason',
});

function textInput(customId: string, style: TextInputStyle, options: {
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  value?: string;
} = {}): TextInputBuilder {
  const builder = new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setRequired(options.required ?? true);

  if (options.placeholder) {
    builder.setPlaceholder(options.placeholder);
  }

  if (options.maxLength) {
    builder.setMaxLength(options.maxLength);
  }

  if (options.value) {
    builder.setValue(options.value);
  }

  return builder;
}

function label(
  labelText: string,
  component: TextInputBuilder | StringSelectMenuBuilder | FileUploadBuilder,
): LabelBuilder {
  const builder = new LabelBuilder().setLabel(labelText);

  if (component instanceof TextInputBuilder) {
    return builder.setTextInputComponent(component);
  }

  if (component instanceof StringSelectMenuBuilder) {
    return builder.setStringSelectMenuComponent(component);
  }

  return builder.setFileUploadComponent(component);
}

export function buildNewScrumDetailsModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ScrumCustomId.NewScrumDetails)
    .setTitle('새 스크럼 만들기')
    .addLabelComponents(
      label('스크럼 구분', new StringSelectMenuBuilder()
        .setCustomId(ScrumInputId.Category)
        .setPlaceholder('활동 유형을 선택하세요.')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(SCRUM_CATEGORY_LABELS[ScrumCategory.Project])
            .setValue(ScrumCategory.Project),
          new StringSelectMenuOptionBuilder()
            .setLabel(SCRUM_CATEGORY_LABELS[ScrumCategory.Study])
            .setValue(ScrumCategory.Study),
          new StringSelectMenuOptionBuilder()
            .setLabel(SCRUM_CATEGORY_LABELS[ScrumCategory.PersonalStudy])
            .setValue(ScrumCategory.PersonalStudy),
          new StringSelectMenuOptionBuilder()
            .setLabel(SCRUM_CATEGORY_LABELS[ScrumCategory.Personal])
            .setValue(ScrumCategory.Personal),
        )),
      label('스크럼 제목', textInput(ScrumInputId.ProjectName, TextInputStyle.Short, {
        maxLength: 80,
        placeholder: '예: 웹 취약점 정복하기',
      })),
      label('개요', textInput(ScrumInputId.Overview, TextInputStyle.Paragraph, {
        maxLength: 1000,
        placeholder: '스크럼의 목적, 목표 및 예상 산출물의 형식을 간단히 적어 주세요.',
      })),
    );
}

export function buildNewScrumPlanningModal(
  draftId: string,
  category: ScrumCategory,
): ModalBuilder {
  const isProject = category === ScrumCategory.Project;

  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.NewScrumPlanning, draftId))
    .setTitle(isProject ? '프로젝트 제출 파일' : '개인 스터디 제출 파일')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isProject
          ? '프로젝트 스크럼은 기획서 PDF와 PROJECT:SCORE 결과 Markdown 파일을 반드시 첨부해야 합니다.'
          : '개인 스터디 스크럼은 기획서 PDF를 반드시 첨부해야 합니다.',
      ),
    )
    .addLabelComponents(
      label('기획서 PDF', new FileUploadBuilder()
        .setCustomId(ScrumInputId.PlanningDocument)
        .setRequired(true)
        .setMinValues(1)
        .setMaxValues(1)),
      ...(isProject
        ? [label('PROJECT:SCORE 결과 (*.md)', new FileUploadBuilder()
          .setCustomId(ScrumInputId.ProjectScoreDocument)
          .setRequired(true)
          .setMinValues(1)
          .setMaxValues(1))]
        : []),
    );
}

export function buildNewScrumTodosModal(
  draftId: string,
  nextScrumDate: string,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.NewScrumTodos, draftId))
    .setTitle('첫 진행할 작업 입력')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `첫 스크럼 마감: **${formatScrumDate(nextScrumDate)}**`,
      ),
    )
    .addLabelComponents(
      label('첫 스크럼까지 진행할 작업', textInput(ScrumInputId.Todos, TextInputStyle.Paragraph, {
        maxLength: 4000,
        placeholder: '줄바꿈으로 구분해 주세요. 최대 20개.',
      })),
    );
}

export function buildNewScrumLaunchRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.OpenNewScrum)
      .setLabel('스크럼 만들기')
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildScrumWriteRow(
  entryId?: string,
  page?: {
    current: number;
    total: number;
  },
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.WriteScrum)
      .setLabel('다음 스크럼 작성하기')
      .setStyle(ButtonStyle.Primary),
  );

  if (entryId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(withSession(ScrumCustomId.EditEntry, entryId))
        .setLabel('스크럼 수정')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(withSession(ScrumCustomId.DeleteEntry, entryId))
        .setLabel('최근 스크럼 삭제')
        .setStyle(ButtonStyle.Danger),
    );
  }

  if (entryId && page && page.total > 1) {
    if (page.current > 0) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(withSessionAndIndex(
            ScrumCustomId.EntryDetailPage,
            entryId,
            page.current - 1,
          ))
          .setLabel('이전')
          .setStyle(ButtonStyle.Secondary),
      );
    }

    if (page.current + 1 < page.total) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(withSessionAndIndex(
            ScrumCustomId.EntryDetailPage,
            entryId,
            page.current + 1,
          ))
          .setLabel('다음')
          .setStyle(ButtonStyle.Secondary),
      );
    }
  }

  return row;
}

export function buildScrumStartRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.WriteScrum)
      .setLabel('다음 스크럼 작성하기')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.EditInitialTodos)
      .setLabel('첫 진행할 작업 수정')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildNewScrumPlanningContinueRow(
  draftId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(withSession(
        ScrumCustomId.NewScrumPlanningContinue,
        draftId,
      ))
      .setLabel('기획서 첨부')
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildNewScrumContinueRow(draftId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(withSession(ScrumCustomId.NewScrumContinue, draftId))
      .setLabel('첫 진행할 작업 입력')
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildScrumSelectRow(scrums: Scrum[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = scrums.slice(0, 25).map((scrum) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncateText(scrum.projectName, 100))
      .setDescription(`다음 마감: ${formatScrumDate(scrum.nextScrumDate)}`)
      .setValue(scrum.id),
  );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ScrumCustomId.SelectScrum)
      .setPlaceholder('작성할 스크럼을 선택하세요.')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options),
  );
}

export function buildContinueRow(sessionId: string, labelText: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(withSession(ScrumCustomId.Continue, sessionId))
      .setLabel(labelText)
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildExtraDecisionRow(
  sessionId: string,
  canAddMore = true,
  needsCarryover = false,
): ActionRowBuilder<ButtonBuilder> {
  const buttons: ButtonBuilder[] = [];

  if (canAddMore) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(withSession(ScrumCustomId.Continue, sessionId))
        .setLabel('추가 완료 작업 작성')
        .setStyle(ButtonStyle.Primary),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(withSession(ScrumCustomId.SkipExtra, sessionId))
      .setLabel(
        needsCarryover
          ? '없음 (이월할 작업 선택)'
          : '없음 (진행할 작업 작성)',
      )
      .setStyle(ButtonStyle.Danger),
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

export function buildApprovalDecisionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.ApproveRequest)
      .setLabel('승인')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.RejectRequest)
      .setLabel('반려')
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildScrumCompletionRow(
  completed = false,
  abandoned = false,
): ActionRowBuilder<ButtonBuilder> {
  const inactive = completed || abandoned;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.CompleteScrum)
      .setLabel(completed ? '완료됨' : '스크럼 완료')
      .setStyle(inactive ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(inactive),
    new ButtonBuilder()
      .setCustomId(ScrumCustomId.AbandonScrum)
      .setLabel(abandoned ? '포기됨' : '스크럼 포기')
      .setStyle(abandoned ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setDisabled(inactive),
  );
}

export function buildAbandonScrumModal(threadId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.AbandonScrumModal, threadId))
    .setTitle('스크럼 포기')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '포기 후 스크럼 게시물을 보관할지 삭제할지 선택해 주세요.',
      ),
    )
    .addLabelComponents(
      label('포기 후 처리', new StringSelectMenuBuilder()
        .setCustomId(ScrumInputId.AbandonmentDisposition)
        .setPlaceholder('게시물 처리 방식을 선택하세요.')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('스크럼 보관')
            .setDescription('스크럼 게시물을 보관 처리 해놓습니다.')
            .setValue('archive')
            .setDefault(true),
          new StringSelectMenuOptionBuilder()
            .setLabel('스크럼 삭제')
            .setDescription('스크럼 게시물을 삭제합니다.')
            .setValue('delete'),
        )),
      label('포기 사유', textInput(
        ScrumInputId.AbandonmentReason,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          placeholder: '스크럼을 포기하는 이유를 작성해 주세요.',
        },
      )),
    );
}

export function buildCompletionContinueRow(
  draftId: string,
  labelText = '작업 기록',
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(withSession(ScrumCustomId.CompleteContinue, draftId))
      .setLabel(labelText)
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildRejectRequestModal(
  approvalThreadId: string,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSession(
      ScrumCustomId.RejectRequestModal,
      approvalThreadId,
    ))
    .setTitle('스크럼 승인 요청 반려')
    .addLabelComponents(
      label('반려 사유', textInput(
        ScrumInputId.RejectionReason,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          placeholder: '신청자에게 전달할 반려 사유를 작성해 주세요.',
        },
      )),
    );
}

export interface ScrumEntryDetailLink {
  label: string;
  url: string;
}

export function buildEntryDetailRows(
  links: ScrumEntryDetailLink[],
): ActionRowBuilder<ButtonBuilder>[] {
  if (links.length > 25) {
    throw new RangeError('A Discord message can contain at most 25 buttons.');
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let index = 0; index < links.length; index += 5) {
    const chunk = links.slice(index, index + 5);
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((link) =>
          new ButtonBuilder()
            .setLabel(truncateText(link.label, 80))
            .setStyle(ButtonStyle.Link)
            .setURL(link.url),
        ),
      ),
    );
  }

  return rows;
}

export function buildScrumEntryRows(
  links: ScrumEntryDetailLink[],
  entryId: string,
  page = 0,
): ActionRowBuilder<ButtonBuilder>[] {
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(links.length / pageSize));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const visibleLinks = links.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  return [
    ...buildEntryDetailRows(visibleLinks),
    buildScrumWriteRow(entryId, {
      current: currentPage,
      total: totalPages,
    }),
  ];
}

function entryItemOptions(
  items: Array<{
    kind: 'completed' | 'extra';
    index: number;
    item: ScrumTodoResult;
  }>,
): StringSelectMenuOptionBuilder[] {
  return items.map(({ kind, index, item }) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncateText(
        `${kind === 'extra' ? '[추가] ' : ''}${item.title}`
          .replace(/\s+/g, ' ')
          .trim(),
        100,
      ))
      .setValue(`${kind}:${index}`));
}

export function buildEntryEditActionRow(
  sessionId: string,
  entry: ScrumEntry,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const completed = entry.completedItems.map((item, index) => ({
    kind: 'completed' as const,
    index,
    item,
  }));
  const extra = entry.extraItems.map((item, index) => ({
    kind: 'extra' as const,
    index,
    item,
  }));
  const editableCompleted = completed.filter(({ item }) =>
    item.attachments.length > 0 || item.links.length > 0,
  );
  const options: StringSelectMenuOptionBuilder[] = [];
  const incomplete = completed.filter(({ item }) =>
    item.attachments.length === 0 && item.links.length === 0,
  );
  const completedWithEvidence = completed.filter(({ item }) =>
    item.attachments.length > 0 || item.links.length > 0,
  );

  if (incomplete.length > 0) {
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel('미완료 작업 완료 처리')
      .setValue('mark-completed'));
  }

  if (completedWithEvidence.length > 0) {
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel('완료 작업을 미완료로 변경')
      .setValue('mark-incomplete'));
  }

  if (editableCompleted.length + extra.length > 0) {
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel('작업 기록 수정')
      .setValue('edit-item'));
  }

  if (entry.extraItems.length < 5) {
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel('추가 완료 작업 작성')
      .setValue('add-extra'));
  }

  if (entry.extraItems.length > 0) {
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel('추가 완료 작업 삭제')
      .setValue('delete-extra'));
  }

  options.push(new StringSelectMenuOptionBuilder()
    .setLabel('다음 스크럼까지 진행할 작업 수정')
    .setValue('edit-next-todos'));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(withSession(ScrumCustomId.EntryEditAction, sessionId))
      .setPlaceholder('수정할 항목을 선택하세요.')
      .addOptions(options),
  );
}

export function buildEntryExtraDeleteSelectRow(
  sessionId: string,
  entry: ScrumEntry,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const extra = entry.extraItems.map((item, index) => ({
    kind: 'extra' as const,
    index,
    item,
  }));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(withSession(ScrumCustomId.DeleteEntryExtra, sessionId))
      .setPlaceholder('삭제할 추가 완료 작업을 선택하세요.')
      .addOptions(entryItemOptions(extra)),
  );
}

export function buildEntryItemSelectRow(
  sessionId: string,
  entry: ScrumEntry,
  mode: ScrumEntryEditMode,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const completed = entry.completedItems.map((item, index) => ({
    kind: 'completed' as const,
    index,
    item,
  }));
  const extra = entry.extraItems.map((item, index) => ({
    kind: 'extra' as const,
    index,
    item,
  }));
  const items = mode === 'mark-completed'
    ? completed.filter(({ item }) =>
      item.attachments.length === 0 && item.links.length === 0)
    : mode === 'mark-incomplete'
      ? completed.filter(({ item }) =>
        item.attachments.length > 0 || item.links.length > 0)
      : [
        ...completed.filter(({ item }) =>
          item.attachments.length > 0 || item.links.length > 0),
        ...extra,
      ];
  const customId = mode === 'mark-completed'
    ? ScrumCustomId.MarkEntryCompleted
    : mode === 'mark-incomplete'
      ? ScrumCustomId.MarkEntryIncomplete
      : ScrumCustomId.EditEntryItem;
  const placeholder = mode === 'mark-completed'
    ? '완료 처리할 작업을 선택하세요.'
    : mode === 'mark-incomplete'
      ? '미완료로 변경할 작업을 선택하세요.'
      : '기록을 수정할 작업을 선택하세요.';

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(withSession(customId, sessionId))
      .setPlaceholder(placeholder)
      .addOptions(entryItemOptions(items)),
  );
}

export function buildEntryItemEditModal(input: {
  sessionId: string;
  item: ScrumTodoResult;
  mode: ScrumEntryEditMode;
}): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.EntryItemModal, input.sessionId))
    .setTitle(input.mode === 'mark-incomplete'
      ? '작업을 미완료로 변경'
      : input.mode === 'mark-completed'
        ? '미완료 작업 완료 처리'
        : '작업 기록 수정')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${truncateText(input.item.title, 900)}`,
      ),
    );

  if (input.mode === 'mark-incomplete') {
    return modal.addLabelComponents(
      label('메모', textInput(
        ScrumInputId.EntryComment,
        TextInputStyle.Paragraph,
        {
          required: true,
          maxLength: 1000,
          placeholder: '미완료로 변경하는 이유를 적어 주세요.',
        },
      )),
    );
  }

  if (input.mode === 'mark-completed') {
    return modal.addLabelComponents(
      label('새 증빙 파일', new FileUploadBuilder()
        .setCustomId(ScrumInputId.EntryFiles)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)),
      label('증빙 링크', textInput(
        ScrumInputId.EntryLinks,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          placeholder: 'HTTP/HTTPS 링크 1개를 입력해 주세요.',
        },
      )),
      label('메모', textInput(
        ScrumInputId.EntryComment,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          value: input.item.comment,
          placeholder: '진행 내용과 참고 사항 등을 적어 주세요.',
        },
      )),
    );
  }

  return modal.addLabelComponents(
      ...(input.item.attachments.length > 0
        ? [label('기존 증빙 파일', new StringSelectMenuBuilder()
          .setCustomId(ScrumInputId.EntryAttachmentDisposition)
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('기존 파일 유지')
              .setValue('keep')
              .setDefault(true),
            new StringSelectMenuOptionBuilder()
              .setLabel('기존 파일 제거')
              .setValue('remove')
          ))]
        : []),
      label('새 증빙 파일', new FileUploadBuilder()
        .setCustomId(ScrumInputId.EntryFiles)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)),
      label('증빙 링크', textInput(
        ScrumInputId.EntryLinks,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          value: input.item.links.join('\n'),
          placeholder: 'HTTP/HTTPS 링크 1개를 입력해 주세요.',
        },
      )),
      label('메모', textInput(
        ScrumInputId.EntryComment,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          value: input.item.comment,
          placeholder: '진행 내용과 참고 사항 등을 적어 주세요.',
        },
      )),
    );
}

export function buildEntryNextTodosModal(
  sessionId: string,
  entry: ScrumEntry,
): ModalBuilder {
  const currentTodos = entry.nextTodos.join('\n');

  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.EntryNextTodosModal, sessionId))
    .setTitle('다음 스크럼까지 진행할 작업 수정')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `다음 스크럼 마감: **${formatScrumDate(entry.nextScrumDate)}**`,
      ),
    )
    .addLabelComponents(
      label('진행할 작업', textInput(
        ScrumInputId.EntryNextTodos,
        TextInputStyle.Paragraph,
        {
          maxLength: 4000,
          value: currentTodos.length <= 4000 ? currentTodos : undefined,
          placeholder: currentTodos.length <= 4000
            ? '한 줄에 하나씩 입력해 주세요.'
            : '기존 작업이 길어 전체 작업을 다시 입력해 주세요.',
        },
      )),
    );
}

export function buildInitialTodosEditModal(
  scrum: Pick<Scrum, 'id' | 'currentTodos' | 'nextScrumDate'>,
): ModalBuilder {
  const currentTodos = scrum.currentTodos.join('\n');

  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.InitialTodosModal, scrum.id))
    .setTitle('첫 진행할 작업 수정')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `첫 스크럼 마감: **${formatScrumDate(scrum.nextScrumDate)}**`,
      ),
    )
    .addLabelComponents(
      label('첫 스크럼까지 진행할 작업', textInput(
        ScrumInputId.InitialTodos,
        TextInputStyle.Paragraph,
        {
          maxLength: 4000,
          value: currentTodos.length <= 4000 ? currentTodos : undefined,
          placeholder: currentTodos.length <= 4000
            ? '한 줄에 하나씩 입력해 주세요. 최대 20개.'
            : '기존 작업이 길어 전체 작업을 다시 입력해 주세요.',
        },
      )),
    );
}

export function buildEntryNextTodosRequiredRow(
  sessionId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(withSession(ScrumCustomId.EditEntryNextTodos, sessionId))
      .setLabel('다음 진행할 작업 입력')
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildEntryExtraModal(sessionId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.EntryExtraModal, sessionId))
    .setTitle('추가 완료 작업 작성')
    .addLabelComponents(
      label('완료한 작업', textInput(
        ScrumInputId.EntryExtraTitle,
        TextInputStyle.Paragraph,
        { maxLength: 1000 },
      )),
      label('증빙 파일', new FileUploadBuilder()
        .setCustomId(ScrumInputId.EntryFiles)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)),
      label('증빙 링크', textInput(
        ScrumInputId.EntryLinks,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          placeholder: 'HTTP/HTTPS 링크 1개를 입력해 주세요.',
        },
      )),
      label('메모', textInput(
        ScrumInputId.EntryComment,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
        },
      )),
    );
}

export function buildAdminEditScrumModal(scrum: Scrum): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.AdminEditModal, scrum.threadId))
    .setTitle('스크럼 정보 수정')
    .addLabelComponents(
      label('스크럼 제목', textInput(
        ScrumInputId.AdminProjectName,
        TextInputStyle.Short,
        {
          maxLength: 80,
          value: scrum.projectName,
        },
      )),
      label('스크럼 개요', textInput(
        ScrumInputId.AdminOverview,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          value: scrum.overview,
        },
      )),
    );
}

export function buildAdminMarkIncompleteTaskRow(
  entry: ScrumEntry,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const items = [
    ...entry.completedItems.map((item, index) => ({
      kind: 'completed' as const,
      index,
      item,
    })).filter(({ item }) =>
      item.attachments.length > 0 || item.links.length > 0),
    ...entry.extraItems.map((item, index) => ({
      kind: 'extra' as const,
      index,
      item,
    })),
  ];

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(withSession(
        ScrumCustomId.AdminMarkIncompleteTask,
        entry.id,
      ))
      .setPlaceholder('관리할 작업을 선택하세요.')
      .addOptions(entryItemOptions(items)),
  );
}

export function buildAdminDeleteExtraModal(input: {
  entryId: string;
  index: number;
  title: string;
}): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSessionAndIndex(
      ScrumCustomId.AdminDeleteExtraModal,
      input.entryId,
      input.index,
    ))
    .setTitle('추가 완료 작업 삭제')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${truncateText(input.title, 900)}`,
      ),
    )
    .addLabelComponents(
      label('삭제 사유', textInput(
        ScrumInputId.AdminExtraDeletionReason,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          placeholder: '작성자에게 전달할 삭제 사유를 적어 주세요.',
        },
      )),
    );
}

export function buildAdminMarkIncompleteModal(input: {
  entryId: string;
  index: number;
  title: string;
}): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSessionAndIndex(
      ScrumCustomId.AdminMarkIncompleteModal,
      input.entryId,
      input.index,
    ))
    .setTitle('작업 강제 미완료 처리')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${truncateText(input.title, 900)}`,
      ),
    )
    .addLabelComponents(
      label('미완료 처리 사유', textInput(
        ScrumInputId.AdminIncompleteReason,
        TextInputStyle.Paragraph,
        {
          maxLength: 900,
          placeholder: '미완료로 처리하는 사유를 작성해 주세요.',
        },
      )),
    );
}

function buildTodoEvidenceModal(
  customIdPrefix: string,
  sessionId: string,
  index: number,
  total: number,
  todo: string,
  requireEvidence: boolean,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSessionAndIndex(customIdPrefix, sessionId, index))
    .setTitle('작업 기록')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        requireEvidence
          ? '스크럼을 완료하려면 아래 작업의 증빙 파일 또는 링크를 반드시 첨부해야 합니다.'
          : '아래 작업을 완료했다면 증빙 파일 또는 링크를 첨부해 주세요.\n완료하지 못했다면 메모에 사유를 작성해 주세요.',
        '',
        `> ${truncateText(todo, 900)}`,
      ].join('\n')),
    )
    .addLabelComponents(
      label('증빙 파일', new FileUploadBuilder()
        .setCustomId(ScrumInputId.TodoFiles)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)),
      label('증빙 링크', textInput(ScrumInputId.TodoLinks, TextInputStyle.Paragraph, {
        required: false,
        maxLength: 1000,
        placeholder: 'HTTP/HTTPS 링크 1개를 입력해 주세요.',
      })),
      label('메모', textInput(ScrumInputId.TodoComment, TextInputStyle.Paragraph, {
        required: false,
        maxLength: 1000,
        placeholder: '진행 내용, 완료하지 못한 이유, 참고 사항 등을 적어 주세요.',
      })),
    );
}

export function buildTodoModal(
  sessionId: string,
  index: number,
  total: number,
  todo: string,
): ModalBuilder {
  return buildTodoEvidenceModal(
    ScrumCustomId.Todo,
    sessionId,
    index,
    total,
    todo,
    false,
  );
}

export function buildCompletionTodoModal(
  draftId: string,
  index: number,
  total: number,
  todo: string,
): ModalBuilder {
  return buildTodoEvidenceModal(
    ScrumCustomId.CompleteTodo,
    draftId,
    index,
    total,
    todo,
    true,
  );
}

export function buildExtraDetailModal(sessionId: string, index: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSessionAndIndex(ScrumCustomId.ExtraDetail, sessionId, index))
    .setTitle(`추가 완료 작업 ${index + 1}`)
    .addLabelComponents(
      label('완료한 작업', textInput(ScrumInputId.ExtraTitle, TextInputStyle.Paragraph, {
        maxLength: 1000,
        placeholder: '추가로 완료한 작업을 적어 주세요.',
      })),
      label('증빙 파일', new FileUploadBuilder()
        .setCustomId(ScrumInputId.ExtraFiles)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(1)),
      label('증빙 링크', textInput(ScrumInputId.ExtraLinks, TextInputStyle.Paragraph, {
        required: false,
        maxLength: 1000,
        placeholder: 'HTTP/HTTPS 링크 1개를 입력해 주세요.',
      })),
      label('메모', textInput(ScrumInputId.ExtraComment, TextInputStyle.Paragraph, {
        required: false,
        maxLength: 1000,
        placeholder: '진행 내용과 참고 사항 등을 적어 주세요.',
      })),
    );
}

export function buildCarryoverTodosModal(
  sessionId: string,
  todos: string[],
  nextScrumDate: string,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.CarryoverTodos, sessionId))
    .setTitle('미완료 작업 이월')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `다음 스크럼 마감: **${formatScrumDate(nextScrumDate)}**`,
        '다음 스크럼에도 이어서 진행할 미완료 작업을 선택해 주세요.',
      ].join('\n')),
    )
    .addLabelComponents(
      label('이월할 진행할 작업', new StringSelectMenuBuilder()
        .setCustomId(ScrumInputId.CarryoverTodos)
        .setPlaceholder('이월하지 않으려면 선택하지 않아도 됩니다.')
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(todos.length)
        .addOptions(todos.map((todo, index) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(todo.replace(/\s+/g, ' ').trim(), 100))
            .setValue(String(index)),
        ))),
    );
}

export function buildNextTodosModal(
  sessionId: string,
  nextScrumDate: string,
  carryoverTodos: string[] = [],
): ModalBuilder {
  const display = [
    `다음 스크럼 마감: **${formatScrumDate(nextScrumDate)}**`,
  ];

  if (carryoverTodos.length > 0) {
    display.push(
      '',
      '**이월할 진행할 작업**',
      formatList(carryoverTodos.map((todo) => truncateText(todo, 120))),
    );
  }

  return new ModalBuilder()
    .setCustomId(withSession(ScrumCustomId.NextTodos, sessionId))
    .setTitle('다음 스크럼까지 진행할 작업')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(display.join('\n')),
    )
    .addLabelComponents(
      label('다음 스크럼까지 진행할 작업', textInput(ScrumInputId.NextTodos, TextInputStyle.Paragraph, {
        required: carryoverTodos.length === 0,
        maxLength: 4000,
        placeholder: carryoverTodos.length > 0
          ? '새 작업이 있다면 줄바꿈으로 구분해 추가해 주세요.'
          : '줄바꿈으로 구분해 주세요. 최대 20개.',
      })),
    );
}

export function buildTodoPreview(
  scrum: Scrum,
  scrumDate = scrum.nextScrumDate,
): string {
  return [
    `**${scrum.projectName}** 스크럼을 작성합니다.`,
    `**마감일**: ${formatScrumDate(scrumDate)}`,
    '',
    buildTodoStepPreview(scrum.currentTodos, 0),
  ].join('\n');
}

export function buildCompletionTodoPreview(
  scrum: Pick<Scrum, 'projectName' | 'currentTodos'>,
): string {
  return [
    `**${scrum.projectName}** 스크럼을 완료합니다.`,
    '',
    buildTodoStepPreview(scrum.currentTodos, 0),
  ].join('\n');
}

export function buildTodoStepPreview(
  todos: string[],
  index: number,
): string {
  const total = todos.length;
  const maxTitleLength = Math.max(
    40,
    Math.floor(1_500 / Math.max(total, 1)),
  );
  const lines = todos.map((todo, todoIndex) => {
    const title = truncateText(
      todo.replace(/\s+/g, ' ').trim(),
      maxTitleLength,
    );
    return todoIndex === index
      ? `- **${title}** <-`
      : `- ${title}`;
  });

  return [
    `**지금 기록할 작업 (${index + 1}/${total})**`,
    ...lines,
  ].join('\n');
}
