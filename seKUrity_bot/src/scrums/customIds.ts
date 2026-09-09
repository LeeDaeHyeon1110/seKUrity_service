export const ScrumCustomId = Object.freeze({
  OpenNewScrum: 'scrum:open-new',
  WriteScrum: 'scrum:write',
  NewScrumDetails: 'scrum:new-details',
  NewScrumPlanningContinue: 'scrum:new-planning-continue',
  NewScrumPlanning: 'scrum:new-planning',
  NewScrumContinue: 'scrum:new-continue',
  NewScrumTodos: 'scrum:new-todos',
  SelectScrum: 'scrum:select',
  Continue: 'scrum:continue',
  SkipExtra: 'scrum:skip-extra',
  CarryoverTodos: 'scrum:carryover',
  NextTodos: 'scrum:next-todos',
  Todo: 'scrum:todo',
  ExtraDetail: 'scrum:extra',
  ApproveRequest: 'scrum:approve-request',
  RejectRequest: 'scrum:reject-request',
  RejectRequestModal: 'scrum:reject-request-modal',
  CompleteScrum: 'scrum:complete',
  AbandonScrum: 'scrum:abandon',
  AbandonScrumModal: 'scrum:abandon-modal',
  DeleteEntry: 'scrum:delete-entry',
  CompleteContinue: 'scrum:complete-continue',
  CompleteTodo: 'scrum:complete-todo',
  EditEntry: 'scrum:edit-entry',
  EntryEditAction: 'scrum:entry-edit-action',
  EditEntryItem: 'scrum:edit-entry-item',
  MarkEntryCompleted: 'scrum:mark-entry-completed',
  MarkEntryIncomplete: 'scrum:mark-entry-incomplete',
  DeleteEntryExtra: 'scrum:delete-entry-extra',
  AddEntryExtra: 'scrum:add-entry-extra',
  EditEntryNextTodos: 'scrum:edit-entry-next-todos',
  EntryItemModal: 'scrum:entry-item-modal',
  EntryExtraModal: 'scrum:entry-extra-modal',
  EntryNextTodosModal: 'scrum:entry-next-todos-modal',
  EntryDetailPage: 'scrum:entry-detail-page',
  AdminEditModal: 'scrum:admin-edit-modal',
  AdminMarkIncompleteTask: 'scrum:admin-mark-incomplete-task',
  AdminMarkIncompleteModal: 'scrum:admin-mark-incomplete-modal',
  AdminDeleteExtraModal: 'scrum:admin-delete-extra-modal',
});

export function withSession(prefix: string, sessionId: string): string {
  return `${prefix}:${sessionId}`;
}

export function withSessionAndIndex(prefix: string, sessionId: string, index: number): string {
  return `${prefix}:${sessionId}:${index}`;
}

export function parseSessionCustomId(customId: string): {
  prefix: string;
  sessionId: string;
  index: number | null;
} | null {
  const [scope, name, sessionId, index] = customId.split(':');

  if (scope !== 'scrum' || !name || !sessionId) {
    return null;
  }

  const parsedIndex = index === undefined ? null : Number(index);

  if (
    parsedIndex !== null
    && (!Number.isInteger(parsedIndex) || parsedIndex < 0)
  ) {
    return null;
  }

  return {
    prefix: `${scope}:${name}`,
    sessionId,
    index: parsedIndex,
  };
}
