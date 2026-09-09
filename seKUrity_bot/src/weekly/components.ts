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
import type { WeeklyReport } from './types';

export const WeeklyCustomId = Object.freeze({
  Start: 'weekly:start',
  AddExtra: 'weekly:add-extra',
  Submit: 'weekly:submit',
  ExtraModal: 'weekly:extra',
  AddToReport: 'weekly:add-to-report',
  AddToReportModal: 'weekly:add-to-report-modal',
  EditExtra: 'weekly:edit-extra',
  EditExtraSelect: 'weekly:edit-extra-select',
  EditExtraModal: 'weekly:edit-extra-modal',
  Delete: 'weekly:delete',
  DeleteModal: 'weekly:delete-modal',
  AdminDeleteExtra: 'weekly:admin-delete-extra',
  AdminDeleteExtraModal: 'weekly:admin-delete-extra-modal',
});

export const WeeklyInputId = Object.freeze({
  ExtraTitle: 'weekly_extra_title',
  ExtraFiles: 'weekly_extra_files',
  ExtraLinks: 'weekly_extra_links',
  ExtraComment: 'weekly_extra_comment',
  ExtraAttachmentDisposition: 'weekly_extra_attachment_disposition',
  DeleteReason: 'weekly_delete_reason',
  AdminDeleteReason: 'weekly_admin_delete_reason',
});

export function weeklyCustomId(
  prefix: string,
  value: string,
  index?: number,
): string {
  return index === undefined
    ? `${prefix}:${value}`
    : `${prefix}:${value}:${index}`;
}

export function parseWeeklyCustomId(customId: string): {
  prefix: string;
  value: string;
  index: number | null;
} | null {
  const [scope, name, value, rawIndex] = customId.split(':');

  if (scope !== 'weekly' || !name || !value) {
    return null;
  }

  const index = rawIndex === undefined ? null : Number(rawIndex);

  if (
    index !== null
    && (!Number.isInteger(index) || index < 0)
  ) {
    return null;
  }

  return {
    prefix: `${scope}:${name}`,
    value,
    index,
  };
}

function textInput(
  customId: string,
  style: TextInputStyle,
  options: {
    required?: boolean;
    maxLength: number;
    placeholder?: string;
    value?: string;
  },
): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setRequired(options.required ?? true)
    .setMaxLength(options.maxLength);

  if (options.placeholder) {
    input.setPlaceholder(options.placeholder);
  }

  if (options.value) {
    input.setValue(options.value);
  }

  return input;
}

function textLabel(
  label: string,
  input: TextInputBuilder,
): LabelBuilder {
  return new LabelBuilder()
    .setLabel(label)
    .setTextInputComponent(input);
}

export function buildWeeklyStartRow(
  userId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(weeklyCustomId(WeeklyCustomId.Start, userId))
      .setLabel('이번 주 주간보고 작성')
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildWeeklyDecisionRow(
  sessionId: string,
  completedCount: number,
  canAddMore: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(weeklyCustomId(WeeklyCustomId.AddExtra, sessionId))
      .setLabel('추가 완료 작업 작성')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canAddMore),
    new ButtonBuilder()
      .setCustomId(weeklyCustomId(WeeklyCustomId.Submit, sessionId))
      .setLabel('주간보고 제출')
      .setStyle(ButtonStyle.Success)
      .setDisabled(completedCount === 0),
  );
}

export function buildWeeklyExtraModal(
  sessionId: string,
  index: number,
): ModalBuilder {
  return buildExtraModal(
    weeklyCustomId(WeeklyCustomId.ExtraModal, sessionId, index),
    index,
  );
}

export function buildWeeklyReportExtraModal(
  reportId: string,
  index: number,
): ModalBuilder {
  return buildExtraModal(
    weeklyCustomId(WeeklyCustomId.AddToReportModal, reportId, index),
    index,
  );
}

function buildExtraModal(
  customId: string,
  index: number,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(`추가 완료 작업 ${index + 1}`)
    .addLabelComponents(
      textLabel('완료한 작업', textInput(
        WeeklyInputId.ExtraTitle,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          placeholder: '이번 주에 별도로 완료한 작업을 적어 주세요.',
        },
      )),
      new LabelBuilder()
        .setLabel('증빙 파일')
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId(WeeklyInputId.ExtraFiles)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(1),
        ),
      textLabel('증빙 링크', textInput(
        WeeklyInputId.ExtraLinks,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          placeholder: 'HTTP/HTTPS 링크 1개를 입력해 주세요.',
        },
      )),
      textLabel('메모', textInput(
        WeeklyInputId.ExtraComment,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          placeholder: '진행 내용이나 참고 사항을 적어 주세요.',
        },
      )),
    );
}

export function buildWeeklyReportRow(
  report: Pick<WeeklyReport, 'id' | 'extraItems'>,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(weeklyCustomId(WeeklyCustomId.AddToReport, report.id))
      .setLabel('추가로 한 작업 작성')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(weeklyCustomId(WeeklyCustomId.EditExtra, report.id))
      .setLabel('추가 작업 수정')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(report.extraItems.length === 0),
    new ButtonBuilder()
      .setCustomId(weeklyCustomId(WeeklyCustomId.Delete, report.id))
      .setLabel('주간보고 삭제')
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildWeeklyExtraEditSelectRow(
  report: WeeklyReport,
): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(weeklyCustomId(WeeklyCustomId.EditExtraSelect, report.id))
      .setPlaceholder('수정할 추가 완료 작업을 선택하세요.')
      .addOptions(report.extraItems.map((item, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            item.title.replace(/\s+/g, ' ').trim().slice(0, 100),
          )
          .setValue(String(index)),
      )),
  );
}

export function buildWeeklyExtraEditModal(input: {
  reportId: string;
  index: number;
  item: WeeklyReport['extraItems'][number];
}): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(weeklyCustomId(
      WeeklyCustomId.EditExtraModal,
      input.reportId,
      input.index,
    ))
    .setTitle('주간보고 추가 작업 수정')
    .addLabelComponents(
      textLabel('완료한 작업', textInput(
        WeeklyInputId.ExtraTitle,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          value: input.item.title,
        },
      )),
      ...(input.item.attachments.length > 0
        ? [new LabelBuilder()
          .setLabel(`기존 증빙 파일 (${input.item.attachments.length}개)`)
          .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId(WeeklyInputId.ExtraAttachmentDisposition)
              .addOptions(
                new StringSelectMenuOptionBuilder()
                  .setLabel('기존 파일 유지')
                  .setValue('keep')
                  .setDefault(true),
                new StringSelectMenuOptionBuilder()
                  .setLabel('기존 파일 제거')
                  .setValue('remove'),
              ),
          )]
        : []),
      new LabelBuilder()
        .setLabel('새 증빙 파일')
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId(WeeklyInputId.ExtraFiles)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(1),
        ),
      textLabel('증빙 링크', textInput(
        WeeklyInputId.ExtraLinks,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          value: input.item.links.join('\n'),
          placeholder: 'HTTP/HTTPS 링크 1개를 입력해 주세요.',
        },
      )),
      textLabel('메모', textInput(
        WeeklyInputId.ExtraComment,
        TextInputStyle.Paragraph,
        {
          required: false,
          maxLength: 1000,
          value: input.item.comment,
          placeholder: '진행 내용이나 참고 사항을 적어 주세요.',
        },
      )),
    );
}

export function buildWeeklyDeleteModal(reportId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(weeklyCustomId(WeeklyCustomId.DeleteModal, reportId))
    .setTitle('주간보고 삭제')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '보고서를 삭제하면 해당 주차가 마감되기 전에 다시 작성할 수 있습니다.',
      ),
    )
    .addLabelComponents(
      textLabel('삭제 사유', textInput(
        WeeklyInputId.DeleteReason,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          placeholder: '주간보고를 삭제하는 이유를 적어 주세요.',
        },
      )),
    );
}

export function buildWeeklyAdminDeleteExtraRow(
  report: WeeklyReport,
): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(weeklyCustomId(
        WeeklyCustomId.AdminDeleteExtra,
        report.id,
      ))
      .setPlaceholder('삭제할 추가 완료 작업을 선택하세요.')
      .addOptions(report.extraItems.map((item, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            `[추가] ${item.title}`.replace(/\s+/g, ' ').trim().slice(0, 100),
          )
          .setValue(String(index)),
      )),
  );
}

export function buildWeeklyAdminDeleteExtraModal(input: {
  reportId: string;
  index: number;
  title: string;
}): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(weeklyCustomId(
      WeeklyCustomId.AdminDeleteExtraModal,
      input.reportId,
      input.index,
    ))
    .setTitle('주간보고 추가 작업 삭제')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${input.title.replace(/\s+/g, ' ').trim().slice(0, 900)}`,
      ),
    )
    .addLabelComponents(
      textLabel('삭제 사유', textInput(
        WeeklyInputId.AdminDeleteReason,
        TextInputStyle.Paragraph,
        {
          maxLength: 1000,
          placeholder: '작성자에게 전달할 삭제 사유를 적어 주세요.',
        },
      )),
    );
}
