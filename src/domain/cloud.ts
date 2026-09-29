import { z } from 'zod';

export const CLOUD_PROMPT_DEFAULT_BODY = '1. ';
export const cloudId = z.string().uuid();
export const cloudStatus = z.enum(['draft', 'ready', 'completed']);
export const cloudPriority = z.enum(['low', 'normal', 'high']);
export const cloudColor = z.enum([
  'slate',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
  'amber',
  'red',
]);
export const cloudProjectSchema = z.object({
  id: cloudId,
  name: z.string(),
  description: z.string(),
  color: cloudColor,
  sortOrder: z.number(),
  revision: z.number().int(),
  archived: z.number().int(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const cloudPromptSchema = z.object({
  id: cloudId,
  projectId: cloudId,
  title: z.string(),
  body: z.string(),
  status: cloudStatus,
  priority: cloudPriority,
  sortOrder: z.number(),
  revision: z.number().int(),
  nextVersion: z.number().int(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const cloudVersionSchema = z.object({
  id: cloudId,
  promptId: cloudId,
  number: z.number().int(),
  body: z.string(),
  createdAt: z.string(),
});
export const cloudAccessSchema = z.object({
  role: z.enum(['user', 'admin']),
  disabled: z.number().int(),
  mustChangePassword: z.number().int(),
});
export const cloudSpaceSchema = z.object({
  revision: z.number().int(),
  projects: z.array(cloudProjectSchema),
});
export const cloudExportPromptSchema = z.object({
  prompt: cloudPromptSchema,
  versions: z.array(cloudVersionSchema),
});
export const cloudExportProjectSchema = z.object({
  project: cloudProjectSchema,
  prompts: z.array(cloudExportPromptSchema),
});
export const cloudExportSchema = z.object({ projects: z.array(cloudExportProjectSchema) });
export const cloudShareSchema = z.object({
  active: z.boolean(),
  token: z.string().nullable(),
  createdAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export const cloudSharedProjectSchema = z.object({
  project: z.object({ name: z.string(), description: z.string() }),
  prompts: z.array(z.object({ title: z.string(), body: z.string() })),
});
export const managedUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['user', 'admin']),
  disabled: z.number().int(),
  mustChangePassword: z.number().int(),
  createdAt: z.union([z.number(), z.string().datetime()]),
});
export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(4000).default(''),
  })
  .strict();
export const projectPatch = z
  .object({
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(4000).optional(),
    color: cloudColor.optional(),
    archived: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .strict();
export const cloudOrderInput = z
  .object({ revision: z.number().int().positive(), ids: z.array(cloudId).max(500) })
  .strict();
export const promptPatch = z
  .object({
    revision: z.number().int().positive(),
    title: z.string().max(160).optional(),
    body: z.string().max(100000).optional(),
    status: cloudStatus.optional(),
    priority: cloudPriority.optional(),
    deleted: z.boolean().optional(),
    checkpoint: z.boolean().optional(),
    restoreVersion: z.number().int().positive().optional(),
  })
  .strict();
export const cloudLabels = { draft: '草稿', ready: '待提交', completed: '已完成' } as const;
export type CloudProject = z.infer<typeof cloudProjectSchema>;
export type CloudPrompt = z.infer<typeof cloudPromptSchema>;
export type CloudVersion = z.infer<typeof cloudVersionSchema>;
export type CloudAccess = z.infer<typeof cloudAccessSchema>;
export type CloudColor = z.infer<typeof cloudColor>;
export type CloudSpace = z.infer<typeof cloudSpaceSchema>;
export type CloudExport = z.infer<typeof cloudExportSchema>;
export type CloudExportProject = z.infer<typeof cloudExportProjectSchema>;
export type CloudShare = z.infer<typeof cloudShareSchema>;
export type CloudSharedProject = z.infer<typeof cloudSharedProjectSchema>;
export type ManagedUser = z.infer<typeof managedUserSchema>;
export type PromptPatch = z.infer<typeof promptPatch>;
