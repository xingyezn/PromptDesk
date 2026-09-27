import { z } from 'zod';
import { AppFault } from '../types/errors';
import { validatePath, versionFile } from './paths';

const iso = z.iso.datetime();
const text = z.string().max(10_000);
const title = z.string().trim().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`));
export const promptIdSchema = z
  .string()
  .regex(/^P\d{3,}$/)
  .refine((value) => Number(value.slice(1)) > 0 && Number.isSafeInteger(Number(value.slice(1))));
export const slugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((value) => {
    try {
      validatePath([value]);
      return true;
    } catch {
      return false;
    }
  });
const tags = z
  .array(z.string().trim().min(1).max(64))
  .max(50)
  .refine((value) => new Set(value).size === value.length);
const target = z.string().trim().min(1).max(100);
const base = {
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  lastOperationId: id('op'),
  createdAt: iso,
  updatedAt: iso,
};
const baseV1 = { ...base, schemaVersion: z.literal(1) };
export const legacyStatusSchema = z.enum([
  'idea',
  'draft',
  'ready',
  'submitted',
  'waiting',
  'completed',
  'blocked',
  'archived',
]);
export const statusSchema = z.enum(['draft', 'ready', 'completed']);
export const prioritySchema = z.enum(['low', 'normal', 'high']);
export type PromptStatus = z.infer<typeof statusSchema>;
export type PromptPriority = z.infer<typeof prioritySchema>;
export const versionReasonLabels = {
  manual: '手动保存',
  ready: '待提交检查点',
  submitted: '提交检查点',
  before_restore: '恢复前保护',
  restore: '历史恢复',
} as const;
export const statusLabels: Record<PromptStatus, string> = {
  draft: '草稿',
  ready: '待提交',
  completed: '已完成',
};
export const priorityLabels: Record<PromptPriority, string> = {
  low: '低优先级',
  normal: '普通',
  high: '高优先级',
};
export const workspaceSchema = z
  .object({ ...base, id: id('workspace'), name: title, description: text })
  .passthrough();
export const settingsSchema = z
  .object({
    ...base,
    workspaceId: id('workspace'),
    defaultTarget: target,
    autosaveEnabled: z.boolean(),
    autosaveDelayMs: z.number().int().min(500).max(2000),
  })
  .passthrough();
export const projectSchema = z
  .object({
    ...base,
    id: id('project'),
    name: title,
    slug: slugSchema,
    description: text,
    status: z.enum(['active', 'archived']),
    tags,
    deletedAt: iso.nullable(),
  })
  .passthrough();
export const versionSchema = z
  .object({
    number: z.number().int().positive(),
    fileName: z.string(),
    createdAt: iso,
    reason: z.enum(['manual', 'ready', 'submitted', 'before_restore', 'restore']),
    note: text,
    contentHash: hash,
    restoredFrom: z.number().int().positive().nullable(),
    operationId: id('op'),
  })
  .passthrough()
  .refine((value) => value.fileName === versionFile(value.number))
  .refine((value) =>
    value.reason === 'restore'
      ? value.restoredFrom !== null && value.restoredFrom < value.number
      : value.restoredFrom === null,
  );
export const statusEventSchema = z
  .object({
    id: id('event'),
    operationId: id('op'),
    from: statusSchema.nullable(),
    to: statusSchema,
    at: iso,
    versionNumber: z.number().int().positive().nullable(),
    kind: z.enum(['created', 'transition']),
  })
  .passthrough();
export const promptSchema = z
  .object({
    ...base,
    id: promptIdSchema,
    projectId: id('project'),
    title,
    status: statusSchema,
    priority: prioritySchema,
    target,
    order: z.number().int().positive(),
    parentPromptId: promptIdSchema.nullable(),
    tags,
    notes: text,
    submittedAt: iso.nullable(),
    completedAt: iso.nullable(),
    submittedVersion: z.number().int().positive().nullable(),
    currentVersion: z.number().int().nonnegative(),
    versions: z.array(versionSchema),
    statusHistory: z.array(statusEventSchema).min(1),
    deletedAt: iso.nullable(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const numbers = value.versions.map((v) => v.number);
    const issue = () => ctx.addIssue({ code: 'custom', message: 'Invalid prompt relationships' });
    if (
      value.currentVersion !== (numbers.at(-1) ?? 0) ||
      numbers.some((n, i) => i > 0 && n <= (numbers[i - 1] ?? 0))
    )
      issue();
    if (value.submittedVersion !== null && !numbers.includes(value.submittedVersion)) issue();
    if (value.parentPromptId === value.id) issue();
    for (const [i, event] of value.statusHistory.entries()) {
      if (event.versionNumber !== null && !numbers.includes(event.versionNumber)) issue();
      if (
        i === 0
          ? event.from !== null || event.kind !== 'created'
          : event.from !== value.statusHistory[i - 1]?.to || event.kind === 'created'
      )
        issue();
    }
    if (value.statusHistory.at(-1)?.to !== value.status) issue();
  });
export const legacyWorkspaceSchema = workspaceSchema.extend({ schemaVersion: z.literal(1) });
export const legacySettingsSchema = settingsSchema.extend({ schemaVersion: z.literal(1) });
export const legacyProjectSchema = projectSchema.extend({ schemaVersion: z.literal(1) });
const legacyStatusEventSchema = z
  .object({
    id: id('event'),
    operationId: id('op'),
    from: legacyStatusSchema.nullable(),
    to: legacyStatusSchema,
    at: iso,
    versionNumber: z.number().int().positive().nullable(),
    kind: z.enum(['created', 'transition', 'resubmit']),
  })
  .passthrough();
export const legacyPromptSchema = z
  .object({
    ...baseV1,
    id: promptIdSchema,
    projectId: id('project'),
    title,
    status: legacyStatusSchema,
    target,
    order: z.number().int().positive(),
    parentPromptId: promptIdSchema.nullable(),
    tags,
    notes: text,
    submittedAt: iso.nullable(),
    completedAt: iso.nullable(),
    submittedVersion: z.number().int().positive().nullable(),
    currentVersion: z.number().int().nonnegative(),
    versions: z.array(versionSchema),
    statusHistory: z.array(legacyStatusEventSchema).min(1),
    deletedAt: iso.nullable(),
  })
  .passthrough();
export const scratchpadSchema = z
  .object({
    ...base,
    id: id('scratch'),
    title,
    deletedAt: iso.nullable(),
    transferredTo: z.object({ projectId: id('project'), promptId: promptIdSchema }).nullable(),
    transferredAt: iso.nullable(),
  })
  .passthrough();
export const quickNoteRecordSchema = z.object({
  id: z.string().regex(/^note_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  body: z.string().min(1).max(10_000),
  createdAt: iso,
  updatedAt: iso,
});
export const legacyScratchpadSchema = scratchpadSchema.extend({ schemaVersion: z.literal(1) });
const relativePath = z
  .array(z.string())
  .min(1)
  .refine((value) => {
    try {
      validatePath(value);
      return true;
    } catch {
      return false;
    }
  });
const snapshot = z.object({ snapshotPath: relativePath, sha256: hash });
export const pendingSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id('op'),
    workspaceId: id('workspace'),
    kind: z.enum([
      'initialize',
      'project',
      'draft',
      'prompt',
      'status',
      'checkpoint',
      'restore',
      'reorder',
      'delete',
      'scratchpad',
      'settings',
      'migration',
    ]),
    createdAt: iso,
    phase: z.enum(['prepared', 'committed']),
    commitMarkerPath: relativePath,
    entries: z
      .array(z.object({ targetPath: relativePath, before: snapshot.nullable(), after: snapshot }))
      .min(1),
  })
  .passthrough()
  .refine(
    (value) =>
      new Set(value.entries.map((e) => e.targetPath.join('/'))).size === value.entries.length,
  )
  .refine((value) =>
    value.entries.some((e) => e.targetPath.join('/') === value.commitMarkerPath.join('/')),
  );
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceSettings = z.infer<typeof settingsSchema>;
export type Project = z.infer<typeof projectSchema>;
export type PromptMeta = z.infer<typeof promptSchema>;
export type VersionMeta = z.infer<typeof versionSchema>;
export type PendingManifest = z.infer<typeof pendingSchema>;

export function parseDocument<T>(schema: z.ZodType<T>, content: string): T {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new AppFault('INVALID_JSON');
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion > 2
  )
    throw new AppFault('SCHEMA_TOO_NEW');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppFault('INVALID_SCHEMA');
  return parsed.data;
}
export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const baseDocument = (operationId: string) => {
  const at = new Date().toISOString();
  return {
    schemaVersion: 2 as const,
    revision: 0,
    lastOperationId: operationId,
    createdAt: at,
    updatedAt: at,
  };
};
