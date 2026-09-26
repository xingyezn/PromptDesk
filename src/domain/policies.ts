import { AppFault } from '../types/errors';
import type { PromptMeta, PromptStatus } from './schemas';

export function checkpointRequired(next: PromptStatus): boolean {
  return next === 'ready' || next === 'completed';
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
export function tokenEstimate(body: string): number {
  const chars = [...body];
  const cjk = chars.filter((c) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c)).length;
  return Math.ceil(cjk + (chars.length - cjk) / 4);
}
