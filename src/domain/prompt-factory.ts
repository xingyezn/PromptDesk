import { promptSchema, type PromptMeta } from './schemas';
export function initialPrompt(input: {
  operationId: string;
  eventId: string;
  at: string;
  projectId: string;
  id: string;
  title: string;
  target: string;
  order: number;
  parentPromptId: string | null;
}): PromptMeta {
  return promptSchema.parse({
    schemaVersion: 2,
    revision: 0,
    lastOperationId: input.operationId,
    createdAt: input.at,
    updatedAt: input.at,
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    target: input.target,
    order: input.order,
    parentPromptId: input.parentPromptId,
    status: 'draft',
    priority: 'normal',
    tags: [],
    notes: '',
    submittedAt: null,
    completedAt: null,
    submittedVersion: null,
    currentVersion: 0,
    versions: [],
    deletedAt: null,
    statusHistory: [
      {
        id: input.eventId,
        operationId: input.operationId,
        from: null,
        to: 'draft',
        at: input.at,
        versionNumber: null,
        kind: 'created',
      },
    ],
  });
}
