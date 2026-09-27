import { AppFault } from '../types/errors';
import type { PromptMeta, PromptStatus } from './schemas';

export function checkpointRequired(next: PromptStatus): boolean {
  return next === 'ready' || next === 'completed';
}
export interface CheckpointPlan {
  versionNumber: number;
  createVersion: boolean;
  versionReason: 'manual' | 'ready';
  statusVersionNumber: number | null;
  appendStatusEvent: boolean;
}
export function planCheckpoint(input: {
  currentStatus: PromptStatus;
  nextStatus: PromptStatus | null;
  latestVersionNumber: number | null;
  latestContentHash: string | null;
  bodyHash: string;
}): CheckpointPlan {
  const needsSnapshot = input.nextStatus === null || checkpointRequired(input.nextStatus);
  const createVersion = needsSnapshot && input.latestContentHash !== input.bodyHash;
  const versionNumber = (input.latestVersionNumber ?? 0) + Number(createVersion);
  if (!Number.isSafeInteger(versionNumber)) throw new AppFault('INVALID_SCHEMA');
  return {
    versionNumber,
    createVersion,
    versionReason: input.nextStatus === 'ready' ? 'ready' : 'manual',
    statusVersionNumber:
      input.nextStatus !== null && checkpointRequired(input.nextStatus) ? versionNumber : null,
    appendStatusEvent: input.nextStatus !== null && input.nextStatus !== input.currentStatus,
  };
}
export function validateTransition(meta: PromptMeta, next: PromptStatus, body: string): void {
  if (meta.deletedAt) throw new AppFault('INVALID_SCHEMA');
  if (checkpointRequired(next) && !body.trim()) throw new AppFault('INVALID_SCHEMA');
}
export function nextPromptId(names: readonly string[]): string {
  const numbers = names
    .filter((name) => /^P\d{3,}$/.test(name))
    .map((name) => Number(name.slice(1)));
  const next = Math.max(0, ...numbers) + 1;
  if (!Number.isSafeInteger(next)) throw new AppFault('INVALID_SCHEMA');
  return `P${String(next).padStart(3, '0')}`;
}
export function ordered(prompts: readonly PromptMeta[]): PromptMeta[] {
  return [...prompts].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export interface PromptOrderChange {
  promptId: string;
  order: number;
}
export interface PromptInsertionPlan {
  order: number;
  changes: PromptOrderChange[];
}
export function planPromptInsertion(
  prompts: readonly PromptMeta[],
  afterPromptId: string | null,
): PromptInsertionPlan {
  const sequence = ordered(prompts);
  const insertIndex =
    afterPromptId === null
      ? sequence.length
      : sequence.findIndex((prompt) => prompt.id === afterPromptId) + 1;
  if (afterPromptId !== null && insertIndex === 0) throw new AppFault('INVALID_SCHEMA');
  return {
    order: insertIndex + 1,
    changes: sequence.flatMap((prompt, index) => {
      const order = index < insertIndex ? index + 1 : index + 2;
      return prompt.order === order ? [] : [{ promptId: prompt.id, order }];
    }),
  };
}
export function tokenEstimate(body: string): number {
  const chars = [...body];
  const cjk = chars.filter((c) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c)).length;
  return Math.ceil(cjk + (chars.length - cjk) / 4);
}
